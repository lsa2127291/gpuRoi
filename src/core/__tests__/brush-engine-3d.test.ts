import { describe, expect, it } from 'vitest'
import { ApproxBrushEngine3D, ManifoldBrushEngine3D, createBrushEngine3D } from '@/core/brush/brush-engine-3d'
import { sliceMesh } from '@/core/slicer'
import type { MeshData } from '@/types'

function makeCubeMesh(size = 2): MeshData {
  const h = size / 2
  return {
    vertices: new Float32Array([
      -h, -h, -h,
      h, -h, -h,
      h, h, -h,
      -h, h, -h,
      -h, -h, h,
      h, -h, h,
      h, h, h,
      -h, h, h,
    ]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ]),
  }
}

function isOnSquareBoundary(point: [number, number, number], halfSize: number, epsilon = 1e-4): boolean {
  return Math.abs(Math.abs(point[0]) - halfSize) <= epsilon
    || Math.abs(Math.abs(point[1]) - halfSize) <= epsilon
}

function hasInteriorEndpointsAtAnchor(
  segments: ReturnType<typeof sliceMesh>,
  halfSize: number,
): boolean {
  for (const seg of segments) {
    if (!isOnSquareBoundary(seg.start, halfSize) || !isOnSquareBoundary(seg.end, halfSize)) {
      return true
    }
  }
  return false
}

function hasHorizontalBoundaryCrossingCenter(
  segments: ReturnType<typeof sliceMesh>,
  y: number,
  epsilon = 1e-4,
): boolean {
  for (const seg of segments) {
    if (Math.abs(seg.start[1] - y) > epsilon || Math.abs(seg.end[1] - y) > epsilon) continue
    const minX = Math.min(seg.start[0], seg.end[0])
    const maxX = Math.max(seg.start[0], seg.end[0])
    if (minX <= 0 + epsilon && maxX >= 0 - epsilon) {
      return true
    }
  }
  return false
}

describe('brush-engine-3d factory', () => {
  it('should default to manifold backend', () => {
    const engine = createBrushEngine3D()
    expect(engine).toBeInstanceOf(ManifoldBrushEngine3D)
  })

  it('should still allow approx backend explicitly', () => {
    const engine = createBrushEngine3D({ backend: 'approx' })
    expect(engine).toBeInstanceOf(ApproxBrushEngine3D)
  })
})

describe('ApproxBrushEngine3D', () => {
  it('should follow raw stroke points instead of pre-smoothed simplified path', async () => {
    const engine = new ApproxBrushEngine3D({
      displacementScaleMm: 1,
      falloffMm: 0,
      idPrefix: 'approx-test',
    })

    const mesh: MeshData = {
      vertices: new Float32Array([
        0, 1, 0,
        1, 1, 0,
        0, 0, 0,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    }

    const out = await engine.commit({
      meshId: 'mesh-0',
      mesh,
      slicePlane: {
        normal: [0, 0, 1],
        anchor: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
      stroke: {
        points: [
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 0 },
        ],
        simplified: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        radiusMm: 0.2,
        mode: 'add',
      },
    })

    expect(out.mesh.vertices[2]).toBeGreaterThan(0.5)
  })
})

describe('ManifoldBrushEngine3D', () => {
  it('should return cloned mesh for empty stroke input without throwing', async () => {
    const engine = new ManifoldBrushEngine3D({ idPrefix: 'manifold-test' })
    const mesh = makeCubeMesh()
    const out = await engine.commit({
      meshId: 'mesh-0',
      mesh,
      slicePlane: {
        normal: [0, 0, 1],
        anchor: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
      stroke: {
        points: [],
        simplified: [],
        radiusMm: 0.8,
        mode: 'add',
      },
    })

    expect(out.mesh).not.toBe(mesh)
    expect(out.mesh.vertices).not.toBe(mesh.vertices)
    expect(out.triangleCount).toBe(mesh.indices.length / 3)
  })

  it('should perform boolean erase with manifold backend', async () => {
    const engine = new ManifoldBrushEngine3D({
      idPrefix: 'manifold-test',
      brushContourPoints: 32,
      cutterDepthPaddingMm: 1,
    })
    const mesh = makeCubeMesh(4)

    const out = await engine.commit({
      meshId: 'mesh-0',
      mesh,
      slicePlane: {
        normal: [0, 0, 1],
        anchor: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
      stroke: {
        points: [{ x: 0, y: 0 }],
        simplified: [{ x: 0, y: 0 }],
        radiusMm: 0.9,
        mode: 'erase',
      },
    })

    expect(out.newMeshId).toContain('manifold-test')
    expect(out.mesh.indices.length).toBeGreaterThan(0)
    expect(out.mesh.indices.length).not.toBe(mesh.indices.length)
  }, 20000)

  it('should not leak stroke edits to far parallel anchors', async () => {
    const engine = new ManifoldBrushEngine3D({
      idPrefix: 'manifold-test',
      brushContourPoints: 32,
      cutterDepthPaddingMm: 0.2,
    })
    const mesh = makeCubeMesh(4)

    const normal: [number, number, number] = [0, 0, 1]
    const farAnchor: [number, number, number] = [0, 0, 1.5]
    const baseFarSegments = sliceMesh(mesh, normal, farAnchor)
    expect(hasInteriorEndpointsAtAnchor(baseFarSegments, 2)).toBe(false)

    const out = await engine.commit({
      meshId: 'mesh-0',
      mesh,
      slicePlane: {
        normal,
        anchor: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
      stroke: {
        points: [{ x: 0, y: 0 }],
        simplified: [{ x: 0, y: 0 }],
        radiusMm: 0.6,
        mode: 'erase',
      },
    })

    const farSegmentsAfterCommit = sliceMesh(out.mesh, normal, farAnchor)
    expect(hasInteriorEndpointsAtAnchor(farSegmentsAfterCommit, 2)).toBe(false)
  }, 20000)

  it('add stroke crossing top boundary should replace center part of original top edge', async () => {
    const engine = new ManifoldBrushEngine3D({
      idPrefix: 'manifold-test',
      brushContourPoints: 40,
      cutterDepthPaddingMm: 0.2,
    })
    const mesh = makeCubeMesh(4)

    const normal: [number, number, number] = [0, 0, 1]
    const anchor: [number, number, number] = [0, 0, 0]
    const out = await engine.commit({
      meshId: 'mesh-0',
      mesh,
      slicePlane: {
        normal,
        anchor,
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
      stroke: {
        points: [
          { x: 0, y: 1.8 },
          { x: 0, y: 2.35 },
        ],
        simplified: [
          { x: 0, y: 1.8 },
          { x: 0, y: 2.35 },
        ],
        radiusMm: 0.35,
        mode: 'add',
      },
    })

    const segments = sliceMesh(out.mesh, normal, anchor)
    expect(hasHorizontalBoundaryCrossingCenter(segments, 2)).toBe(false)
  }, 20000)
})
