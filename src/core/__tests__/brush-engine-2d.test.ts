import { describe, expect, it } from 'vitest'
import { DefaultBrushEngine2D } from '@/core/brush/brush-engine-2d'
import type { BrushClipper2D } from '@/core/brush/clipper2-wasm-adapter'
import type { PreviewInput, Segment2D } from '@/core/brush/brush-types'

function seg(aX: number, aY: number, bX: number, bY: number): Segment2D {
  return {
    a: { x: aX, y: aY },
    b: { x: bX, y: bY },
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

function createRecordingAdapter() {
  const calls: Array<{
    baseSegments: Segment2D[]
    brushPolygon: { x: number; y: number }[]
    mode: 'add' | 'erase'
  }> = []

  const adapter: BrushClipper2D = {
    inflateStrokeToPolygon(strokePoints, radiusMm) {
      return strokePoints.map((p) => ({ x: p.x + radiusMm, y: p.y }))
    },
    applyBoolean(baseSegments, brushPolygon, mode) {
      calls.push({
        baseSegments: baseSegments.map((s) => ({
          a: { x: s.a.x, y: s.a.y },
          b: { x: s.b.x, y: s.b.y },
        })),
        brushPolygon: brushPolygon.map((p) => ({ x: p.x, y: p.y })),
        mode,
      })

      if (mode === 'erase') {
        return []
      }

      return [...baseSegments, ...polygonToSegments(brushPolygon)]
    },
  }

  return { adapter, calls }
}

describe('DefaultBrushEngine2D', () => {
  it('should require clipper adapter when fallback is disabled', () => {
    expect(() => new DefaultBrushEngine2D()).toThrow('requires clipperAdapter')
  })

  it('single-point stroke should produce circle polygon with fixed contour points', () => {
    const { adapter, calls } = createRecordingAdapter()
    const engine = new DefaultBrushEngine2D({
      clipperAdapter: adapter,
      brushContourPoints: 40,
    })

    const out = engine.preview({
      baseSegments: [],
      strokePoints: [{ x: 10, y: 20 }],
      radiusMm: 5,
      mode: 'add',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].mode).toBe('add')
    expect(calls[0].brushPolygon).toHaveLength(40)
    expect(out.brushPolygon2D).toHaveLength(40)
    expect(out.dirtyBoundsMm.minX).toBeCloseTo(5, 3)
    expect(out.dirtyBoundsMm.maxX).toBeCloseTo(15, 3)
    expect(out.dirtyBoundsMm.minY).toBeCloseTo(15, 3)
    expect(out.dirtyBoundsMm.maxY).toBeCloseTo(25, 3)
    expect(out.nextSegments.length).toBeGreaterThan(0)
  })

  it('should stamp capsule polygons segment-by-segment on multi-point stroke', () => {
    const { adapter, calls } = createRecordingAdapter()
    const engine = new DefaultBrushEngine2D({
      clipperAdapter: adapter,
      brushContourPoints: 40,
    })

    const input: PreviewInput = {
      baseSegments: [seg(-5, 0, 5, 0)],
      strokePoints: [
        { x: -2, y: 0 },
        { x: 0, y: 2 },
        { x: 2, y: 0 },
      ],
      radiusMm: 1,
      mode: 'add',
    }

    const out = engine.preview(input)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0].brushPolygon.length).toBeGreaterThanOrEqual(40)
    expect(out.brushPolygon2D?.length).toBeGreaterThanOrEqual(40)
    expect(out.nextSegments.length).toBeGreaterThan(input.baseSegments.length)
  })

  it('should handle degenerate stroke input and return normalized base segments', () => {
    const { adapter, calls } = createRecordingAdapter()
    const engine = new DefaultBrushEngine2D({
      clipperAdapter: adapter,
    })

    const input: PreviewInput = {
      baseSegments: [
        seg(0, 0, 0, 0),
        seg(1, 1, 2, 2),
        seg(2, 2, 1, 1),
      ],
      strokePoints: [],
      radiusMm: 5,
      mode: 'erase',
    }

    const out = engine.preview(input)
    expect(out.nextSegments.length).toBe(1)
    expect(out.nextSegments[0]).toEqual(seg(1, 1, 2, 2))
    expect(out.dirtyBoundsMm).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
    expect(calls).toHaveLength(0)
  })

  it('should propagate boolean errors instead of using fallback logic', () => {
    const clipperAdapter: BrushClipper2D = {
      inflateStrokeToPolygon(strokePoints, radiusMm) {
        return strokePoints.map((p) => ({ x: p.x + radiusMm, y: p.y }))
      },
      applyBoolean() {
        throw new Error('clipper failed')
      },
    }

    const engine = new DefaultBrushEngine2D({
      clipperAdapter,
    })

    expect(() => engine.preview({
      baseSegments: [seg(-1, 0, 1, 0)],
      strokePoints: [{ x: 0, y: 0 }],
      radiusMm: 2,
      mode: 'erase',
    })).toThrow('clipper failed')
  })
})
