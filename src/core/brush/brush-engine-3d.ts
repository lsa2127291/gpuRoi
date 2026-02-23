import type { CommitInput, CommitOutput, Vec2 } from './brush-types'
import type { MeshData, Vec3 } from '@/types'
import { add, cross, dot, normalize, scale, subtract } from '@/core/vec3'
import ManifoldModuleFactory from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
// @ts-expect-error vite resolves wasm asset url from dependency path.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'

export interface BrushEngine3D {
  commit(input: CommitInput): Promise<CommitOutput>
}

export interface BrushEngine3DOptions {
  backend?: 'manifold' | 'approx'
  displacementScaleMm?: number
  falloffMm?: number
  brushContourPoints?: number
  cutterDepthMm?: number
  cutterDepthPaddingMm?: number
  idPrefix?: string
}

interface PlaneBasis {
  normal: Vec3
  anchor: Vec3
  xAxis: Vec3
  yAxis: Vec3
}

type ManifoldFactory = (config?: {
  locateFile?: () => string
}) => Promise<ManifoldToplevel>

interface ManifoldDeleteable {
  delete?: () => void
}

interface ManifoldMeshData {
  numProp: number
  vertProperties: Float32Array
  triVerts: Uint32Array
}

const EPSILON = 1e-9
const DEFAULT_BRUSH_CONTOUR_POINTS = 40
const MIN_BRUSH_CONTOUR_POINTS = 12
const DEFAULT_CUTTER_DEPTH_PADDING_MM = 2

let manifoldRuntimePromise: Promise<ManifoldToplevel> | null = null

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function safeDelete(target: ManifoldDeleteable | null | undefined): void {
  if (!target || typeof target.delete !== 'function') return
  target.delete()
}

function safeDeleteMany(targets: Array<ManifoldDeleteable | null | undefined>): void {
  const seen = new Set<ManifoldDeleteable>()
  for (const target of targets) {
    if (!target || seen.has(target)) continue
    seen.add(target)
    safeDelete(target)
  }
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined'
}

async function loadManifoldRuntime(): Promise<ManifoldToplevel> {
  const factory = ManifoldModuleFactory as unknown as ManifoldFactory
  if (isBrowserRuntime()) {
    const wasmUrl = String(manifoldWasmUrl)
    const module = await factory({
      locateFile: () => wasmUrl,
    })
    module.setup()
    return module
  }

  const module = await factory()
  module.setup()
  return module
}

async function getManifoldRuntime(): Promise<ManifoldToplevel> {
  if (!manifoldRuntimePromise) {
    manifoldRuntimePromise = loadManifoldRuntime().catch((error) => {
      manifoldRuntimePromise = null
      throw error
    })
  }
  return manifoldRuntimePromise
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
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
  const theta = Math.atan2(to.y - from.y, to.x - from.x)
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

function buildPlaneTransformMatrix(basis: PlaneBasis): [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
] {
  return [
    basis.xAxis[0], basis.xAxis[1], basis.xAxis[2], 0,
    basis.yAxis[0], basis.yAxis[1], basis.yAxis[2], 0,
    basis.normal[0], basis.normal[1], basis.normal[2], 0,
    basis.anchor[0], basis.anchor[1], basis.anchor[2], 1,
  ]
}

function computeMeshSpanAlongNormal(vertices: Float32Array, normal: Vec3): number {
  if (vertices.length < 3) return 0

  let minProj = Infinity
  let maxProj = -Infinity

  for (let i = 0; i < vertices.length; i += 3) {
    const projection = vertices[i] * normal[0] + vertices[i + 1] * normal[1] + vertices[i + 2] * normal[2]
    minProj = Math.min(minProj, projection)
    maxProj = Math.max(maxProj, projection)
  }

  if (!Number.isFinite(minProj) || !Number.isFinite(maxProj)) return 0
  return Math.max(0, maxProj - minProj)
}

function computeCutterDepthMm(
  mesh: MeshData,
  normal: Vec3,
  strokeRadiusMm: number,
  options: { cutterDepthMm: number; cutterDepthPaddingMm: number },
): number {
  if (options.cutterDepthMm > 0) {
    return options.cutterDepthMm
  }

  const span = computeMeshSpanAlongNormal(mesh.vertices, normal)
  const fallbackThickness = Math.max(strokeRadiusMm * 2, options.cutterDepthPaddingMm * 2, 0.1)
  return span + fallbackThickness
}

function toManifoldMeshData(mesh: MeshData): ManifoldMeshData {
  return {
    numProp: 3,
    vertProperties: new Float32Array(mesh.vertices),
    triVerts: new Uint32Array(mesh.indices),
  }
}

function fromManifoldMeshData(manifoldMesh: ManifoldMeshData): MeshData {
  const numProp = Math.floor(manifoldMesh.numProp)
  if (!Number.isFinite(numProp) || numProp < 3) {
    throw new Error(`Invalid manifold mesh numProp=${manifoldMesh.numProp}`)
  }
  if (manifoldMesh.vertProperties.length % numProp !== 0) {
    throw new Error('Invalid manifold mesh vertProperties length')
  }

  const vertexCount = manifoldMesh.vertProperties.length / numProp
  const vertices = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const srcBase = i * numProp
    const dstBase = i * 3
    vertices[dstBase] = manifoldMesh.vertProperties[srcBase]
    vertices[dstBase + 1] = manifoldMesh.vertProperties[srcBase + 1]
    vertices[dstBase + 2] = manifoldMesh.vertProperties[srcBase + 2]
  }

  return {
    vertices,
    indices: new Uint32Array(manifoldMesh.triVerts),
  }
}

function distancePointToSegment2D(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq <= 1e-12) {
    const dx = p.x - a.x
    const dy = p.y - a.y
    return Math.hypot(dx, dy)
  }

  const apx = p.x - a.x
  const apy = p.y - a.y
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq))
  const qx = a.x + abx * t
  const qy = a.y + aby * t
  return Math.hypot(p.x - qx, p.y - qy)
}

function distancePointToPolyline2D(point: Vec2, points: Vec2[]): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y)
  }

  let minDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    minDist = Math.min(minDist, distancePointToSegment2D(point, points[i], points[i + 1]))
  }
  return minDist
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

function buildPlaneBasis(input: CommitInput): PlaneBasis {
  const normal = normalize(input.slicePlane.normal)
  const anchor = input.slicePlane.anchor

  if (input.slicePlane.xAxis && input.slicePlane.yAxis) {
    const xAxis = normalize(input.slicePlane.xAxis)
    const yAxis = normalize(input.slicePlane.yAxis)
    return { normal, anchor, xAxis, yAxis }
  }

  const ref = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] as Vec3 : [0, 1, 0] as Vec3
  const xAxis = normalize(cross(ref, normal))
  const yAxis = normalize(cross(normal, xAxis))
  return { normal, anchor, xAxis, yAxis }
}

function projectWorldToPlane(point: Vec3, basis: PlaneBasis): Vec2 {
  const rel = subtract(point, basis.anchor)
  return {
    x: dot(rel, basis.xAxis),
    y: dot(rel, basis.yAxis),
  }
}

export function mapStrokeTo3D(points: Vec2[], basis: PlaneBasis): Vec3[] {
  return points.map((p) => {
    const px = scale(basis.xAxis, p.x)
    const py = scale(basis.yAxis, p.y)
    return add(add(basis.anchor, px), py)
  })
}

function cloneMesh(mesh: MeshData): MeshData {
  return {
    vertices: new Float32Array(mesh.vertices),
    indices: new Uint32Array(mesh.indices),
    normals: mesh.normals ? new Float32Array(mesh.normals) : undefined,
  }
}

export class ApproxBrushEngine3D implements BrushEngine3D {
  private readonly options: {
    displacementScaleMm: number
    falloffMm: number
    idPrefix: string
  }
  private commitSeq = 0

  constructor(options: BrushEngine3DOptions = {}) {
    this.options = {
      displacementScaleMm: options.displacementScaleMm ?? 0.3,
      falloffMm: options.falloffMm ?? 0.5,
      idPrefix: options.idPrefix ?? 'brush',
    }
  }

  async commit(input: CommitInput): Promise<CommitOutput> {
    const t0 = nowMs()
    const basis = buildPlaneBasis(input)
    const strokePoints = input.stroke.simplified.length > 0
      ? input.stroke.simplified
      : input.stroke.points

    if (strokePoints.length === 0 || input.stroke.radiusMm <= 0) {
      return {
        newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
        mesh: cloneMesh(input.mesh),
        triangleCount: input.mesh.indices.length / 3,
        elapsedMs: nowMs() - t0,
      }
    }

    const mesh = cloneMesh(input.mesh)
    const vertices = mesh.vertices
    const influenceRadius = input.stroke.radiusMm + this.options.falloffMm
    const displacementSign = input.stroke.mode === 'add' ? 1 : -1

    for (let i = 0; i < vertices.length; i += 3) {
      const world: Vec3 = [vertices[i], vertices[i + 1], vertices[i + 2]]
      const p2 = projectWorldToPlane(world, basis)
      const distToStroke = distancePointToPolyline2D(p2, strokePoints)
      if (distToStroke > influenceRadius) continue

      const normalizedDist = distToStroke / Math.max(influenceRadius, 1e-6)
      const influence = 1 - smoothstep01(normalizedDist)
      if (influence <= 0) continue

      const delta = displacementSign * this.options.displacementScaleMm * influence
      vertices[i] += basis.normal[0] * delta
      vertices[i + 1] += basis.normal[1] * delta
      vertices[i + 2] += basis.normal[2] * delta
    }

    mesh.normals = undefined

    return {
      newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
      mesh,
      triangleCount: mesh.indices.length / 3,
      elapsedMs: nowMs() - t0,
    }
  }
}

export class ManifoldBrushEngine3D implements BrushEngine3D {
  private readonly options: {
    brushContourPoints: number
    cutterDepthMm: number
    cutterDepthPaddingMm: number
    idPrefix: string
  }
  private commitSeq = 0

  constructor(options: BrushEngine3DOptions = {}) {
    this.options = {
      brushContourPoints: Math.max(
        MIN_BRUSH_CONTOUR_POINTS,
        Math.round(options.brushContourPoints ?? DEFAULT_BRUSH_CONTOUR_POINTS),
      ),
      cutterDepthMm: options.cutterDepthMm ?? 0,
      cutterDepthPaddingMm: Math.max(0, options.cutterDepthPaddingMm ?? DEFAULT_CUTTER_DEPTH_PADDING_MM),
      idPrefix: options.idPrefix ?? 'brush',
    }
  }

  async commit(input: CommitInput): Promise<CommitOutput> {
    const t0 = nowMs()
    const basis = buildPlaneBasis(input)
    const strokePoints = input.stroke.simplified.length > 0
      ? input.stroke.simplified
      : input.stroke.points

    if (strokePoints.length === 0 || input.stroke.radiusMm <= 0) {
      return {
        newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
        mesh: cloneMesh(input.mesh),
        triangleCount: input.mesh.indices.length / 3,
        elapsedMs: nowMs() - t0,
      }
    }

    const brushStamps = collectBrushStamps(
      strokePoints,
      input.stroke.radiusMm,
      this.options.brushContourPoints,
    )
    if (brushStamps.length === 0) {
      return {
        newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
        mesh: cloneMesh(input.mesh),
        triangleCount: input.mesh.indices.length / 3,
        elapsedMs: nowMs() - t0,
      }
    }

    const runtime = await getManifoldRuntime()
    let sourceMeshObj: ManifoldDeleteable | null = null
    let sourceSolid: ManifoldDeleteable | null = null
    let brushCrossSection: ManifoldDeleteable | null = null
    let cutterLocal: ManifoldDeleteable | null = null
    let cutterWorld: ManifoldDeleteable | null = null
    let resultSolid: ManifoldDeleteable | null = null
    let resultMesh: ManifoldDeleteable | null = null

    try {
      const sourceMeshData = toManifoldMeshData(input.mesh)
      sourceMeshObj = new runtime.Mesh(sourceMeshData) as unknown as ManifoldDeleteable
      ;(sourceMeshObj as { merge?: () => boolean }).merge?.()

      sourceSolid = runtime.Manifold.ofMesh(sourceMeshObj as InstanceType<typeof runtime.Mesh>)

      const polygons = brushStamps.map((polygon) => polygon.map((p) => [p.x, p.y] as [number, number]))
      brushCrossSection = runtime.CrossSection.compose(polygons)

      const cutterDepthMm = computeCutterDepthMm(
        input.mesh,
        basis.normal,
        input.stroke.radiusMm,
        {
          cutterDepthMm: this.options.cutterDepthMm,
          cutterDepthPaddingMm: this.options.cutterDepthPaddingMm,
        },
      )
      if (cutterDepthMm <= 0) {
        throw new Error('invalid cutter depth')
      }

      cutterLocal = (brushCrossSection as InstanceType<typeof runtime.CrossSection>).extrude(
        cutterDepthMm,
        0,
        0,
        [1, 1],
        true,
      )
      cutterWorld = (cutterLocal as InstanceType<typeof runtime.Manifold>).transform(buildPlaneTransformMatrix(basis))

      resultSolid = input.stroke.mode === 'add'
        ? (sourceSolid as InstanceType<typeof runtime.Manifold>).add(cutterWorld as InstanceType<typeof runtime.Manifold>)
        : (sourceSolid as InstanceType<typeof runtime.Manifold>).subtract(cutterWorld as InstanceType<typeof runtime.Manifold>)

      resultMesh = (resultSolid as InstanceType<typeof runtime.Manifold>).getMesh() as unknown as ManifoldDeleteable
      const mesh = fromManifoldMeshData(resultMesh as unknown as ManifoldMeshData)

      return {
        newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
        mesh,
        triangleCount: mesh.indices.length / 3,
        elapsedMs: nowMs() - t0,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`ManifoldBrushEngine3D commit failed: ${message}`)
    } finally {
      safeDeleteMany([resultMesh, resultSolid, cutterWorld, cutterLocal, brushCrossSection, sourceSolid, sourceMeshObj])
    }
  }
}

export function createBrushEngine3D(options: BrushEngine3DOptions = {}): BrushEngine3D {
  if (options.backend === 'approx') {
    return new ApproxBrushEngine3D(options)
  }
  return new ManifoldBrushEngine3D(options)
}
