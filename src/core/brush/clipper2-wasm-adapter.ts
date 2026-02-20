import type { BrushMode, Segment2D, Vec2 } from './brush-types'
// @ts-expect-error vite resolves wasm asset url from dependency path.
import clipper2WasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url'

type ClipperEnumValue = { value: number }

interface ClipperPointD {
  x: number
  y: number
  z: number
  delete?: () => void
}

interface ClipperPathD {
  push_back(point: ClipperPointD): void
  size(): number
  get(index: number): ClipperPointD
  delete(): void
}

interface ClipperPathsD {
  push_back(path: ClipperPathD): void
  size(): number
  get(index: number): ClipperPathD
  delete(): void
}

interface ClipperDInstance {
  AddSubject(paths: ClipperPathsD): void
  AddOpenSubject(paths: ClipperPathsD): void
  AddClip(paths: ClipperPathsD): void
  ExecutePath(
    clipType: ClipperEnumValue,
    fillRule: ClipperEnumValue,
    closedSolution: ClipperPathsD,
    openSolution: ClipperPathsD,
  ): boolean
  SetPreserveCollinear(value: boolean): void
  delete(): void
}

interface Clipper2Module {
  FillRule: { NonZero: ClipperEnumValue }
  ClipType: { Union: ClipperEnumValue; Difference: ClipperEnumValue }
  JoinType: { Round: ClipperEnumValue }
  EndType: { Round: ClipperEnumValue }

  PointD: new (x: number, y: number, z: number) => ClipperPointD
  PathD: new () => ClipperPathD
  PathsD: new () => ClipperPathsD
  ClipperD: new () => ClipperDInstance
  CreateClipperD?: (preserveCollinear: boolean) => ClipperDInstance

  InflatePathsD(
    paths: ClipperPathsD,
    delta: number,
    joinType: ClipperEnumValue,
    endType: ClipperEnumValue,
    miterLimit: number,
    arcTolerance: number,
    precision: number,
  ): ClipperPathsD
}

type Clipper2Factory = (options?: {
  locateFile?: (path: string, prefix: string) => string
  wasmBinary?: ArrayBuffer | Uint8Array
}) => Promise<Clipper2Module>

export interface Clipper2BrushAdapterOptions {
  precisionDigits?: number
  miterLimit?: number
  arcTolerance?: number
}

export interface BrushClipper2D {
  inflateStrokeToPolygon(strokePoints: Vec2[], radiusMm: number): Vec2[]
  applyBoolean(baseSegments: Segment2D[], brushPolygon: Vec2[], mode: BrushMode): Segment2D[]
}

const DEFAULT_PRECISION_DIGITS = 3
const DEFAULT_MITER_LIMIT = 2
const DEFAULT_ARC_TOLERANCE = 0
const SEGMENT_KEY_SCALE = 1000
const SINGLE_POINT_CIRCLE_STEPS = 24

let clipper2ModulePromise: Promise<Clipper2Module> | null = null

function safeDelete(target: { delete?: () => void } | null | undefined): void {
  if (!target || typeof target.delete !== 'function') return
  target.delete()
}

function isValidWasmBinary(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
}

function cloneSegment(seg: Segment2D): Segment2D {
  return {
    a: { x: seg.a.x, y: seg.a.y },
    b: { x: seg.b.x, y: seg.b.y },
  }
}

function cloneVec2(p: Vec2): Vec2 {
  return { x: p.x, y: p.y }
}

function buildCirclePolygon(center: Vec2, radiusMm: number, steps = SINGLE_POINT_CIRCLE_STEPS): Vec2[] {
  const polygon: Vec2[] = []
  const n = Math.max(8, steps)
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n
    polygon.push({
      x: center.x + Math.cos(angle) * radiusMm,
      y: center.y + Math.sin(angle) * radiusMm,
    })
  }
  return polygon
}

function pointKey(p: Vec2): string {
  return `${Math.round(p.x * SEGMENT_KEY_SCALE)},${Math.round(p.y * SEGMENT_KEY_SCALE)}`
}

function snapVec2(p: Vec2): Vec2 {
  return {
    x: Math.round(p.x * SEGMENT_KEY_SCALE) / SEGMENT_KEY_SCALE,
    y: Math.round(p.y * SEGMENT_KEY_SCALE) / SEGMENT_KEY_SCALE,
  }
}

function splitSegmentsForUnion(segments: Segment2D[]): {
  closedLoops: Vec2[][]
  openSegments: Segment2D[]
} {
  type Edge = {
    a: Vec2
    b: Vec2
    aKey: string
    bKey: string
  }

  const edges: Edge[] = []
  for (const seg of segments) {
    const a = snapVec2(seg.a)
    const b = snapVec2(seg.b)
    edges.push({
      a,
      b,
      aKey: pointKey(a),
      bKey: pointKey(b),
    })
  }

  const adjacency = new Map<string, number[]>()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!adjacency.has(edge.aKey)) adjacency.set(edge.aKey, [])
    if (!adjacency.has(edge.bKey)) adjacency.set(edge.bKey, [])
    adjacency.get(edge.aKey)!.push(i)
    adjacency.get(edge.bKey)!.push(i)
  }

  const visited = new Array(edges.length).fill(false)
  const closedLoops: Vec2[][] = []
  const openSegments: Segment2D[] = []

  for (let i = 0; i < edges.length; i++) {
    if (visited[i]) continue

    const seed = edges[i]
    visited[i] = true

    const startKey = seed.aKey
    let previousKey = seed.aKey
    let currentKey = seed.bKey

    const pathPoints: Vec2[] = [cloneVec2(seed.a), cloneVec2(seed.b)]

    while (true) {
      if (currentKey === startKey) break

      const candidates = (adjacency.get(currentKey) ?? []).filter((edgeIdx) => !visited[edgeIdx])
      if (candidates.length === 0) break

      let nextEdgeIdx = candidates[0]
      if (candidates.length > 1) {
        const nonBacktrack = candidates.find((edgeIdx) => {
          const edge = edges[edgeIdx]
          const otherKey = edge.aKey === currentKey ? edge.bKey : edge.aKey
          return otherKey !== previousKey
        })
        if (nonBacktrack !== undefined) {
          nextEdgeIdx = nonBacktrack
        }
      }

      const nextEdge = edges[nextEdgeIdx]
      visited[nextEdgeIdx] = true

      const nextKey = nextEdge.aKey === currentKey ? nextEdge.bKey : nextEdge.aKey
      const nextPoint = nextEdge.aKey === currentKey ? nextEdge.b : nextEdge.a

      pathPoints.push(cloneVec2(nextPoint))
      previousKey = currentKey
      currentKey = nextKey
    }

    const closed = currentKey === startKey && pathPoints.length >= 4
    if (closed) {
      const firstKey = pointKey(pathPoints[0])
      const lastKey = pointKey(pathPoints[pathPoints.length - 1])
      if (firstKey === lastKey) {
        pathPoints.pop()
      }
      if (pathPoints.length >= 3) {
        closedLoops.push(pathPoints)
        continue
      }
    }

    for (let j = 0; j < pathPoints.length - 1; j++) {
      openSegments.push({
        a: cloneVec2(pathPoints[j]),
        b: cloneVec2(pathPoints[j + 1]),
      })
    }
  }

  return { closedLoops, openSegments }
}

function polygonSignedArea(points: Vec2[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    sum += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return sum * 0.5
}

function largestPolygon(polygons: Vec2[][]): Vec2[] {
  let winner: Vec2[] = []
  let maxAbsArea = 0
  for (const polygon of polygons) {
    const area = Math.abs(polygonSignedArea(polygon))
    if (area > maxAbsArea) {
      winner = polygon
      maxAbsArea = area
    }
  }
  return winner
}

function polygonToSegments(polygon: Vec2[]): Segment2D[] {
  if (polygon.length < 2) return []
  const segments: Segment2D[] = []
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    segments.push({
      a: { x: polygon[i].x, y: polygon[i].y },
      b: { x: polygon[j].x, y: polygon[j].y },
    })
  }
  return segments
}

class Clipper2WasmBrushAdapter implements BrushClipper2D {
  private readonly precisionDigits: number
  private readonly miterLimit: number
  private readonly arcTolerance: number

  constructor(
    private readonly module: Clipper2Module,
    options: Clipper2BrushAdapterOptions,
  ) {
    this.precisionDigits = options.precisionDigits ?? DEFAULT_PRECISION_DIGITS
    this.miterLimit = options.miterLimit ?? DEFAULT_MITER_LIMIT
    this.arcTolerance = options.arcTolerance ?? DEFAULT_ARC_TOLERANCE
  }

  inflateStrokeToPolygon(strokePoints: Vec2[], radiusMm: number): Vec2[] {
    if (strokePoints.length === 0 || radiusMm <= 0) return []
    if (strokePoints.length === 1) {
      return buildCirclePolygon(strokePoints[0], radiusMm)
    }

    const inputPaths = this.createPaths([strokePoints])
    try {
      const inflated = this.module.InflatePathsD(
        inputPaths,
        radiusMm,
        this.module.JoinType.Round,
        this.module.EndType.Round,
        this.miterLimit,
        this.arcTolerance,
        this.precisionDigits,
      )
      try {
        const polygons = this.readPaths(inflated)
        return largestPolygon(polygons)
      } finally {
        safeDelete(inflated)
      }
    } finally {
      safeDelete(inputPaths)
    }
  }

  applyBoolean(baseSegments: Segment2D[], brushPolygon: Vec2[], mode: BrushMode): Segment2D[] {
    if (brushPolygon.length < 3) {
      return baseSegments.map(cloneSegment)
    }

    if (mode === 'add') {
      return this.addWithUnion(baseSegments, brushPolygon)
    }

    return this.eraseWithDifference(baseSegments, brushPolygon)
  }

  private createClipperInstance(): ClipperDInstance {
    try {
      return new this.module.ClipperD()
    } catch (constructorError) {
      if (typeof this.module.CreateClipperD === 'function') {
        try {
          return this.module.CreateClipperD(true)
        } catch (factoryError) {
          throw new Error(
            `Failed to create ClipperD instance via ctor/factory. ctor=${
              constructorError instanceof Error ? constructorError.message : String(constructorError)
            }, factory=${factoryError instanceof Error ? factoryError.message : String(factoryError)}`,
          )
        }
      }
      throw constructorError
    }
  }

  private addWithUnion(baseSegments: Segment2D[], brushPolygon: Vec2[]): Segment2D[] {
    const split = splitSegmentsForUnion(baseSegments)
    if (split.closedLoops.length === 0) {
      const merged = baseSegments.map(cloneSegment)
      merged.push(...polygonToSegments(brushPolygon))
      return merged
    }

    const closedSubject = this.createPaths(split.closedLoops)
    const openSubject = this.createPaths(split.openSegments.map((seg) => [seg.a, seg.b]))
    const clipPaths = this.createPaths([brushPolygon])
    const clipper = this.createClipperInstance()
    const closedSolution = new this.module.PathsD()
    const openSolution = new this.module.PathsD()
    try {
      clipper.SetPreserveCollinear(true)
      clipper.AddSubject(closedSubject)
      if (split.openSegments.length > 0) {
        clipper.AddOpenSubject(openSubject)
      }
      clipper.AddClip(clipPaths)

      const succeeded = clipper.ExecutePath(
        this.module.ClipType.Union,
        this.module.FillRule.NonZero,
        closedSolution,
        openSolution,
      )

      if (!succeeded) {
        throw new Error('Clipper2 union ExecutePath failed')
      }

      const resultSegments = split.openSegments.map(cloneSegment)
      const closedPolygons = this.readPaths(closedSolution)
      for (const polygon of closedPolygons) {
        resultSegments.push(...polygonToSegments(polygon))
      }

      return resultSegments
    } finally {
      safeDelete(openSolution)
      safeDelete(closedSolution)
      safeDelete(clipper)
      safeDelete(clipPaths)
      safeDelete(openSubject)
      safeDelete(closedSubject)
    }
  }

  private eraseWithDifference(baseSegments: Segment2D[], brushPolygon: Vec2[]): Segment2D[] {
    if (baseSegments.length === 0) return []

    const split = splitSegmentsForUnion(baseSegments)
    const closedSubject = this.createPaths(split.closedLoops)
    const openSubject = this.createPaths(split.openSegments.map((seg) => [seg.a, seg.b]))
    const clipPaths = this.createPaths([brushPolygon])
    const clipper = this.createClipperInstance()
    const closedSolution = new this.module.PathsD()
    const openSolution = new this.module.PathsD()

    try {
      clipper.SetPreserveCollinear(true)
      if (split.closedLoops.length > 0) {
        clipper.AddSubject(closedSubject)
      }
      if (split.openSegments.length > 0) {
        clipper.AddOpenSubject(openSubject)
      }
      clipper.AddClip(clipPaths)

      const succeeded = clipper.ExecutePath(
        this.module.ClipType.Difference,
        this.module.FillRule.NonZero,
        closedSolution,
        openSolution,
      )

      if (!succeeded) {
        throw new Error('Clipper2 difference ExecutePath failed')
      }

      const result: Segment2D[] = []
      const closedPolygons = this.readPaths(closedSolution)
      for (const polygon of closedPolygons) {
        result.push(...polygonToSegments(polygon))
      }
      result.push(...this.readPathsAsOpenSegments(openSolution))
      return result
    } finally {
      safeDelete(openSolution)
      safeDelete(closedSolution)
      safeDelete(clipper)
      safeDelete(clipPaths)
      safeDelete(openSubject)
      safeDelete(closedSubject)
    }
  }

  private createPath(points: Vec2[]): ClipperPathD {
    const path = new this.module.PathD()
    for (const point of points) {
      const pointD = new this.module.PointD(point.x, point.y, 0)
      path.push_back(pointD)
      safeDelete(pointD)
    }
    return path
  }

  private createPaths(paths: Vec2[][]): ClipperPathsD {
    const out = new this.module.PathsD()
    for (const points of paths) {
      if (points.length === 0) continue
      const path = this.createPath(points)
      out.push_back(path)
      safeDelete(path)
    }
    return out
  }

  private readPath(path: ClipperPathD): Vec2[] {
    const points: Vec2[] = []
    const size = path.size()
    for (let i = 0; i < size; i++) {
      const p = path.get(i)
      points.push({ x: p.x, y: p.y })
      safeDelete(p)
    }
    return points
  }

  private readPaths(paths: ClipperPathsD): Vec2[][] {
    const out: Vec2[][] = []
    const size = paths.size()
    for (let i = 0; i < size; i++) {
      const path = paths.get(i)
      const points = this.readPath(path)
      safeDelete(path)
      if (points.length > 0) {
        out.push(points)
      }
    }
    return out
  }

  private readPathsAsOpenSegments(paths: ClipperPathsD): Segment2D[] {
    const out: Segment2D[] = []
    const vecPaths = this.readPaths(paths)
    for (const points of vecPaths) {
      for (let i = 0; i < points.length - 1; i++) {
        out.push({
          a: { x: points[i].x, y: points[i].y },
          b: { x: points[i + 1].x, y: points[i + 1].y },
        })
      }
    }
    return out
  }
}

async function loadClipper2Module(): Promise<Clipper2Module> {
  // `clipper2-wasm` currently doesn't publish a resolvable ESM type entry.
  // We intentionally import runtime code directly and cast the factory.
  // @ts-expect-error third-party package ships broken type entry for this path.
  const factoryModule = await import('clipper2-wasm/dist/es/clipper2z.js')
  const factory = (factoryModule.default ?? factoryModule) as Clipper2Factory
  const wasmUrl = String(clipper2WasmUrl)
  const response = await fetch(wasmUrl, { credentials: 'same-origin' })
  const wasmBuffer = await response.arrayBuffer()
  const wasmBinary = new Uint8Array(wasmBuffer)

  if (!isValidWasmBinary(wasmBinary)) {
    const header = Array.from(wasmBinary.slice(0, 4))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(' ')
    throw new Error(`Invalid wasm binary from ${wasmUrl}, header=${header}`)
  }

  return factory({
    wasmBinary,
    locateFile: (path: string) => {
      if (path.includes('.wasm')) return wasmUrl
      return path
    },
  })
}

async function getClipper2Module(): Promise<Clipper2Module> {
  if (!clipper2ModulePromise) {
    clipper2ModulePromise = loadClipper2Module()
  }
  return clipper2ModulePromise
}

export async function createClipper2WasmBrushAdapter(
  options: Clipper2BrushAdapterOptions = {},
): Promise<BrushClipper2D> {
  const module = await getClipper2Module()
  return new Clipper2WasmBrushAdapter(module, options)
}
