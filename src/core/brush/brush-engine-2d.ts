import type {
  BrushDirtyBounds,
  PreviewInput,
  PreviewOutput,
  Segment2D,
  Vec2,
} from './brush-types'
import { BRUSH_PRECISION_MM, CLIPPER_SCALE } from './brush-types'
import { simplifyStrokePoints } from './brush-stroke'
import { createClipper2WasmBrushAdapter } from './clipper2-wasm-adapter'
import type { BrushClipper2D } from './clipper2-wasm-adapter'

interface IntPoint {
  x: number
  y: number
}

export interface BrushEngine2DOptions {
  epsilonMm?: number
  minDistanceMm?: number
  zeroLengthEpsilonMm?: number
  pointMergeEpsilonMm?: number
  brushContourPoints?: number
  // Deprecated alias kept for compatibility with older call sites.
  arcSteps?: number
  clipperAdapter?: BrushClipper2D
}

export interface BrushEngine2D {
  preview(input: PreviewInput): PreviewOutput
}

const EPSILON = 1e-9
const DEFAULT_BRUSH_CONTOUR_POINTS = 40
const MIN_BRUSH_CONTOUR_POINTS = 12

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function cloneVec2(p: Vec2): Vec2 {
  return { x: p.x, y: p.y }
}

function cloneSegment(seg: Segment2D): Segment2D {
  return { a: cloneVec2(seg.a), b: cloneVec2(seg.b) }
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
}

function normalizeSegments(
  segments: Segment2D[],
  zeroLengthEpsilonMm: number,
  pointMergeEpsilonMm: number,
): Segment2D[] {
  const zeroSq = zeroLengthEpsilonMm * zeroLengthEpsilonMm
  const keyScale = 1 / Math.max(pointMergeEpsilonMm, 1e-6)

  const out: Segment2D[] = []
  const seen = new Set<string>()

  const quantize = (v: number) => Math.round(v * keyScale)

  for (const seg of segments) {
    if (distanceSquared(seg.a, seg.b) <= zeroSq) continue

    const aQx = quantize(seg.a.x)
    const aQy = quantize(seg.a.y)
    const bQx = quantize(seg.b.x)
    const bQy = quantize(seg.b.y)

    const forwardKey = `${aQx},${aQy}|${bQx},${bQy}`
    const reverseKey = `${bQx},${bQy}|${aQx},${aQy}`
    const canonicalKey = forwardKey < reverseKey ? forwardKey : reverseKey

    if (seen.has(canonicalKey)) continue
    seen.add(canonicalKey)
    out.push(cloneSegment(seg))
  }

  return out
}

function buildCirclePolygon(center: Vec2, radiusMm: number, contourPoints: number): Vec2[] {
  if (radiusMm <= 0) return []
  const steps = Math.max(MIN_BRUSH_CONTOUR_POINTS, contourPoints)
  const polygon: Vec2[] = []
  for (let i = 0; i < steps; i++) {
    const angle = (Math.PI * 2 * i) / steps
    polygon.push({
      x: center.x + Math.cos(angle) * radiusMm,
      y: center.y + Math.sin(angle) * radiusMm,
    })
  }
  return polygon
}

function buildCapsulePolygon(from: Vec2, to: Vec2, radiusMm: number, contourPoints: number): Vec2[] {
  if (radiusMm <= 0) return []
  if (distanceSquared(from, to) <= EPSILON) {
    return buildCirclePolygon(from, radiusMm, contourPoints)
  }

  const steps = Math.max(MIN_BRUSH_CONTOUR_POINTS, contourPoints)
  const half = Math.max(6, Math.floor(steps / 2))

  const dx = to.x - from.x
  const dy = to.y - from.y
  const theta = Math.atan2(dy, dx)
  const polygon: Vec2[] = []

  for (let i = 0; i <= half; i++) {
    const angle = theta + Math.PI * 0.5 + (Math.PI * i) / half
    polygon.push({
      x: from.x + Math.cos(angle) * radiusMm,
      y: from.y + Math.sin(angle) * radiusMm,
    })
  }

  for (let i = 0; i <= half; i++) {
    const angle = theta - Math.PI * 0.5 + (Math.PI * i) / half
    polygon.push({
      x: to.x + Math.cos(angle) * radiusMm,
      y: to.y + Math.sin(angle) * radiusMm,
    })
  }

  return polygon
}

function collectBrushStamps(
  strokePoints: Vec2[],
  radiusMm: number,
  contourPoints: number,
): Vec2[][] {
  if (strokePoints.length === 0 || radiusMm <= 0) return []
  if (strokePoints.length === 1) {
    return [buildCirclePolygon(strokePoints[0], radiusMm, contourPoints)]
  }

  const polygons: Vec2[][] = []
  for (let i = 1; i < strokePoints.length; i++) {
    const from = strokePoints[i - 1]
    const to = strokePoints[i]
    if (distanceSquared(from, to) <= EPSILON) continue
    polygons.push(buildCapsulePolygon(from, to, radiusMm, contourPoints))
  }

  if (polygons.length === 0) {
    polygons.push(buildCirclePolygon(strokePoints[strokePoints.length - 1], radiusMm, contourPoints))
  }

  return polygons
}

function computeBounds(points: Vec2[]): BrushDirtyBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  let minX = points[0].x
  let minY = points[0].y
  let maxX = points[0].x
  let maxY = points[0].y

  for (let i = 1; i < points.length; i++) {
    minX = Math.min(minX, points[i].x)
    minY = Math.min(minY, points[i].y)
    maxX = Math.max(maxX, points[i].x)
    maxY = Math.max(maxY, points[i].y)
  }

  return { minX, minY, maxX, maxY }
}

function mergeBounds(lhs: BrushDirtyBounds, rhs: BrushDirtyBounds): BrushDirtyBounds {
  return {
    minX: Math.min(lhs.minX, rhs.minX),
    minY: Math.min(lhs.minY, rhs.minY),
    maxX: Math.max(lhs.maxX, rhs.maxX),
    maxY: Math.max(lhs.maxY, rhs.maxY),
  }
}

function computeBoundsFromPolygons(polygons: Vec2[][]): BrushDirtyBounds {
  if (polygons.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  let bounds = computeBounds(polygons[0])
  for (let i = 1; i < polygons.length; i++) {
    bounds = mergeBounds(bounds, computeBounds(polygons[i]))
  }
  return bounds
}

export function toClipperPath(points: Vec2[], scale = CLIPPER_SCALE): IntPoint[] {
  return points.map((p) => ({
    x: Math.round(p.x * scale),
    y: Math.round(p.y * scale),
  }))
}

export function fromClipperPath(path: IntPoint[], scale = CLIPPER_SCALE): Vec2[] {
  return path.map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  }))
}

export class DefaultBrushEngine2D implements BrushEngine2D {
  private readonly options: {
    epsilonMm: number
    minDistanceMm: number
    zeroLengthEpsilonMm: number
    pointMergeEpsilonMm: number
    brushContourPoints: number
    clipperAdapter: BrushClipper2D
  }

  constructor(options: BrushEngine2DOptions = {}) {
    if (!options.clipperAdapter) {
      throw new Error('DefaultBrushEngine2D requires clipperAdapter (fallback is disabled)')
    }

    this.options = {
      epsilonMm: options.epsilonMm ?? BRUSH_PRECISION_MM,
      minDistanceMm: options.minDistanceMm ?? 0.05,
      zeroLengthEpsilonMm: options.zeroLengthEpsilonMm ?? 1e-4,
      pointMergeEpsilonMm: options.pointMergeEpsilonMm ?? 1e-3,
      brushContourPoints: Math.max(
        MIN_BRUSH_CONTOUR_POINTS,
        Math.round(options.brushContourPoints ?? options.arcSteps ?? DEFAULT_BRUSH_CONTOUR_POINTS),
      ),
      clipperAdapter: options.clipperAdapter,
    }
  }

  preview(input: PreviewInput): PreviewOutput {
    const t0 = nowMs()

    const simplified = simplifyStrokePoints(input.strokePoints, {
      epsilonMm: this.options.epsilonMm,
      minDistanceMm: this.options.minDistanceMm,
    })

    if (simplified.length === 0 || input.radiusMm <= 0) {
      const nextSegments = normalizeSegments(
        input.baseSegments,
        this.options.zeroLengthEpsilonMm,
        this.options.pointMergeEpsilonMm,
      )
      return {
        nextSegments,
        dirtyBoundsMm: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        stats: {
          segmentCount: nextSegments.length,
          elapsedMs: nowMs() - t0,
        },
        strokeSimplified: simplified,
      }
    }

    // 保留 Clipper 风格路径变换接口，后续可无缝替换为真实 WASM 调用
    const clipperPath = toClipperPath(simplified)
    const simplifiedForBoolean = fromClipperPath(clipperPath)

    const brushStamps = collectBrushStamps(
      simplifiedForBoolean,
      input.radiusMm,
      this.options.brushContourPoints,
    )

    let booleanResult = input.baseSegments.map(cloneSegment)
    for (const brushPolygon of brushStamps) {
      if (brushPolygon.length < 3) continue
      booleanResult = this.options.clipperAdapter.applyBoolean(
        booleanResult,
        brushPolygon,
        input.mode,
      )
      if (!Array.isArray(booleanResult)) {
        throw new Error('clipperAdapter.applyBoolean must return Segment2D[]')
      }
    }

    const nextSegments = normalizeSegments(
      booleanResult,
      this.options.zeroLengthEpsilonMm,
      this.options.pointMergeEpsilonMm,
    )

    return {
      nextSegments,
      dirtyBoundsMm: computeBoundsFromPolygons(brushStamps),
      stats: {
        segmentCount: nextSegments.length,
        elapsedMs: nowMs() - t0,
      },
      brushPolygon2D: brushStamps.length > 0 ? brushStamps[brushStamps.length - 1] : [],
      strokeSimplified: simplifiedForBoolean,
    }
  }
}

export function createBrushEngine2D(options?: BrushEngine2DOptions): BrushEngine2D {
  return new DefaultBrushEngine2D(options)
}

export async function createBrushEngine2DWithClipper2Wasm(
  options: Omit<BrushEngine2DOptions, 'clipperAdapter'> = {},
): Promise<BrushEngine2D> {
  const clipperAdapter = await createClipper2WasmBrushAdapter()
  return new DefaultBrushEngine2D({
    ...options,
    clipperAdapter,
  })
}
