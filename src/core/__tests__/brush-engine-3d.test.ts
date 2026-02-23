import { describe, expect, it } from 'vitest'
import { ApproxBrushEngine3D, ManifoldBrushEngine3D, createBrushEngine3D } from '@/core/brush/brush-engine-3d'
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
})
