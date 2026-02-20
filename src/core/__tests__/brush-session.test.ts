import { describe, expect, it, vi } from 'vitest'
import type { BrushEngine2D } from '@/core/brush/brush-engine-2d'
import type { BrushEngine3D } from '@/core/brush/brush-engine-3d'
import { DefaultBrushSession } from '@/core/brush/brush-session'
import type { CommitInput, CommitOutput, Segment2D } from '@/core/brush/brush-types'
import type { MeshData } from '@/types'

function seg(ax: number, ay: number, bx: number, by: number): Segment2D {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
  }
}

function makeMesh(): MeshData {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  }
}

describe('DefaultBrushSession', () => {
  it('should switch to incremental preview after first stamp and skip no-op points', () => {
    const callStrokePointLengths: number[] = []
    const callBaseSegmentLengths: number[] = []

    const previewEngine: BrushEngine2D = {
      preview(input) {
        callStrokePointLengths.push(input.strokePoints.length)
        callBaseSegmentLengths.push(input.baseSegments.length)
        const p = input.strokePoints[input.strokePoints.length - 1]
        return {
          nextSegments: [...input.baseSegments, seg(0, 0, p.x, p.y)],
          dirtyBoundsMm: { minX: 0, minY: 0, maxX: p.x, maxY: p.y },
          stats: { segmentCount: input.baseSegments.length + 1, elapsedMs: 0 },
        }
      },
    }

    const commitEngine: BrushEngine3D = {
      async commit(input: CommitInput): Promise<CommitOutput> {
        return {
          newMeshId: `${input.meshId}:ok`,
          mesh: input.mesh,
          triangleCount: input.mesh.indices.length / 3,
          elapsedMs: 0,
        }
      },
    }

    const session = new DefaultBrushSession([], {
      previewEngine,
      commitEngine,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.beginStroke({ x: 0, y: 0 }, 2, 'add')
    session.appendPoint({ x: 0, y: 0 })
    session.appendPoint({ x: 1, y: 0 })
    session.appendPoint({ x: 2, y: 0 })

    // no-op append (distance < minDistanceMm) should not trigger preview
    const noOpPreview = session.appendPoint({ x: 2.001, y: 0 })
    expect(noOpPreview).toBeNull()

    expect(callStrokePointLengths).toEqual([1, 2, 2])
    expect(callBaseSegmentLengths).toEqual([0, 1, 2])
  })

  it('latest preview should win while drawing', () => {
    const previewEngine: BrushEngine2D = {
      preview(input) {
        const p = input.strokePoints[input.strokePoints.length - 1]
        return {
          nextSegments: [seg(0, 0, p.x, p.y)],
          dirtyBoundsMm: { minX: 0, minY: 0, maxX: p.x, maxY: p.y },
          stats: { segmentCount: 1, elapsedMs: 0 },
        }
      },
    }

    const commitEngine: BrushEngine3D = {
      async commit(input: CommitInput): Promise<CommitOutput> {
        return {
          newMeshId: `${input.meshId}:ok`,
          mesh: input.mesh,
          triangleCount: input.mesh.indices.length / 3,
          elapsedMs: 0,
        }
      },
    }

    const session = new DefaultBrushSession([], {
      previewEngine,
      commitEngine,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.beginStroke({ x: 0, y: 0 }, 2, 'add')
    session.appendPoint({ x: 1, y: 1 })
    session.appendPoint({ x: 3, y: 4 })

    const current = session.getCurrentSegments()
    expect(current).toHaveLength(1)
    expect(current[0].b.x).toBe(3)
    expect(current[0].b.y).toBe(4)
  })

  it('should enforce single-flight commit', async () => {
    const previewEngine: BrushEngine2D = {
      preview(input) {
        return {
          nextSegments: input.baseSegments,
          dirtyBoundsMm: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          stats: { segmentCount: input.baseSegments.length, elapsedMs: 0 },
        }
      },
    }

    let resolveCommit: ((value: CommitOutput) => void) | null = null
    const commitEngine: BrushEngine3D = {
      commit: vi.fn((input: CommitInput) => {
        return new Promise<CommitOutput>((resolve) => {
          resolveCommit = resolve
          void input
        })
      }),
    }

    const session = new DefaultBrushSession([], {
      previewEngine,
      commitEngine,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.beginStroke({ x: 0, y: 0 }, 3, 'add')
    session.appendPoint({ x: 2, y: 0 })
    const pending = session.endStroke()

    await expect(session.endStroke()).rejects.toThrow('state=committing')
    expect(session.currentState).toBe('committing')

    resolveCommit?.({
      newMeshId: 'mesh-1:ok',
      mesh: makeMesh(),
      triangleCount: 1,
      elapsedMs: 0,
    })

    await pending
    expect(session.currentState).toBe('idle')
  })

  it('cancel should rollback preview to pre-stroke snapshot', () => {
    const previewEngine: BrushEngine2D = {
      preview() {
        return {
          nextSegments: [seg(-2, 0, 2, 0)],
          dirtyBoundsMm: { minX: -2, minY: 0, maxX: 2, maxY: 0 },
          stats: { segmentCount: 1, elapsedMs: 0 },
        }
      },
    }

    const commitEngine: BrushEngine3D = {
      async commit(input: CommitInput) {
        return {
          newMeshId: `${input.meshId}:ok`,
          mesh: input.mesh,
          triangleCount: 1,
          elapsedMs: 0,
        }
      },
    }

    const base = [seg(0, 0, 1, 0)]
    const session = new DefaultBrushSession(base, {
      previewEngine,
      commitEngine,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.beginStroke({ x: 0, y: 0 }, 2, 'erase')
    session.appendPoint({ x: 1, y: 0 })
    expect(session.getCurrentSegments()).toEqual([seg(-2, 0, 2, 0)])

    session.cancelStroke()
    expect(session.currentState).toBe('idle')
    expect(session.getCurrentSegments()).toEqual(base)
  })

  it('commit failure should rollback and keep session usable', async () => {
    const previewEngine: BrushEngine2D = {
      preview() {
        return {
          nextSegments: [seg(5, 0, 8, 0)],
          dirtyBoundsMm: { minX: 5, minY: 0, maxX: 8, maxY: 0 },
          stats: { segmentCount: 1, elapsedMs: 0 },
        }
      },
    }

    const commitEngine: BrushEngine3D = {
      async commit() {
        throw new Error('mock commit failed')
      },
    }

    const onCommitFail = vi.fn()
    const base = [seg(0, 0, 2, 0)]
    const session = new DefaultBrushSession(base, {
      previewEngine,
      commitEngine,
      onCommitFail,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.beginStroke({ x: 0, y: 0 }, 2, 'add')
    session.appendPoint({ x: 1, y: 1 })
    await expect(session.endStroke()).rejects.toThrow('mock commit failed')

    expect(session.currentState).toBe('idle')
    expect(session.getCurrentSegments()).toEqual(base)
    expect(onCommitFail).toHaveBeenCalledTimes(1)

    session.beginStroke({ x: 0, y: 0 }, 2, 'erase')
    session.cancelStroke()
    expect(session.currentState).toBe('idle')
  })

  it('setBaseSegments should recover session from invalidated to idle', () => {
    const previewEngine: BrushEngine2D = {
      preview(input) {
        return {
          nextSegments: input.baseSegments,
          dirtyBoundsMm: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          stats: { segmentCount: input.baseSegments.length, elapsedMs: 0 },
        }
      },
    }

    const commitEngine: BrushEngine3D = {
      async commit(input: CommitInput): Promise<CommitOutput> {
        return {
          newMeshId: `${input.meshId}:ok`,
          mesh: input.mesh,
          triangleCount: input.mesh.indices.length / 3,
          elapsedMs: 0,
        }
      },
    }

    const session = new DefaultBrushSession([], {
      previewEngine,
      commitEngine,
      createCommitInput: () => ({
        meshId: 'mesh-1',
        mesh: makeMesh(),
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      }),
    })

    session.invalidate('cameraRotate')
    expect(session.currentState).toBe('invalidated')

    session.setBaseSegments([seg(-1, 0, 1, 0)])
    expect(session.currentState).toBe('idle')

    session.beginStroke({ x: 0, y: 0 }, 2, 'add')
    expect(session.currentState).toBe('drawing')
  })

})
