import { describe, expect, it } from 'vitest'
import { DefaultBrushEngine2D } from '@/core/brush/brush-engine-2d'
import { ApproxBrushEngine3D } from '@/core/brush/brush-engine-3d'
import { DefaultBrushSession } from '@/core/brush/brush-session'
import type { MeshData } from '@/types'
import type { BrushClipper2D } from '@/core/brush/clipper2-wasm-adapter'
import type { Segment2D } from '@/core/brush/brush-types'

function makeMesh(): MeshData {
  return {
    vertices: new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, 1, 0,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  }
}

function polygonToSegments(polygon: { x: number; y: number }[]): Segment2D[] {
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

const testClipperAdapter: BrushClipper2D = {
  inflateStrokeToPolygon(strokePoints, radiusMm) {
    return strokePoints.map((p) => ({ x: p.x + radiusMm, y: p.y }))
  },
  applyBoolean(baseSegments, brushPolygon, mode) {
    if (mode === 'erase') return []
    return [...baseSegments, ...polygonToSegments(brushPolygon)]
  },
}

describe('Brush end-to-end flow', () => {
  it('should run mousedown -> mousemove -> mouseup -> commit chain', async () => {
    const previewEngine = new DefaultBrushEngine2D({
      brushContourPoints: 40,
      clipperAdapter: testClipperAdapter,
    })
    const commitEngine = new ApproxBrushEngine3D({
      displacementScaleMm: 0.8,
      falloffMm: 0.2,
      idPrefix: 'e2e',
    })

    let mesh = makeMesh()
    const session = new DefaultBrushSession(
      [
        { a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      ],
      {
        previewEngine,
        commitEngine,
        createCommitInput: () => ({
          meshId: 'demo-mesh',
          mesh,
          slicePlane: {
            normal: [0, 0, 1],
            anchor: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
          },
        }),
        onCommitSuccess: (result) => {
          mesh = result.mesh
        },
      },
    )

    session.beginStroke({ x: 0, y: 0 }, 0.8, 'add')
    const preview1 = session.appendPoint({ x: 0.6, y: 0 })
    const preview2 = session.appendPoint({ x: 1.2, y: 0.2 })

    expect(preview1).not.toBeNull()
    expect(preview2).not.toBeNull()
    expect(session.currentState).toBe('drawing')

    const commit = await session.endStroke()
    expect(commit.newMeshId).toContain('e2e')
    expect(commit.triangleCount).toBe(2)
    expect(session.currentState).toBe('idle')

    const maxZ = Math.max(
      mesh.vertices[2],
      mesh.vertices[5],
      mesh.vertices[8],
      mesh.vertices[11],
    )
    expect(maxZ).toBeGreaterThan(0)
  })
})
