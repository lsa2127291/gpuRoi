import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Segment2D } from '@/core/brush/brush-types'

const fillRuleCalls: number[] = []
const subjectPathCounts: number[] = []
const openSubjectPathCounts: number[] = []
const mockFillRule = {
  NonZero: { value: 1 },
  EvenOdd: { value: 2 },
}

class MockPointD {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}

  delete(): void {}
}

class MockPathD {
  private readonly points: MockPointD[] = []

  push_back(point: MockPointD): void {
    this.points.push(point)
  }

  size(): number {
    return this.points.length
  }

  get(index: number): MockPointD {
    return this.points[index]
  }

  delete(): void {}
}

class MockPathsD {
  private readonly paths: MockPathD[] = []

  push_back(path: MockPathD): void {
    this.paths.push(path)
  }

  size(): number {
    return this.paths.length
  }

  get(index: number): MockPathD {
    return this.paths[index]
  }

  delete(): void {}
}

class MockClipperD {
  AddSubject(paths: MockPathsD): void {
    subjectPathCounts.push(paths.size())
  }

  AddOpenSubject(paths: MockPathsD): void {
    openSubjectPathCounts.push(paths.size())
  }

  AddClip(_paths: MockPathsD): void {}

  ExecutePath(
    _clipType: { value: number },
    fillRule: { value: number },
    _closedSolution: MockPathsD,
    _openSolution: MockPathsD,
  ): boolean {
    fillRuleCalls.push(fillRule.value)
    return true
  }

  SetPreserveCollinear(_value: boolean): void {}

  delete(): void {}
}

function createMockClipperModule() {
  return {
    FillRule: mockFillRule,
    ClipType: { Union: { value: 10 }, Difference: { value: 11 } },
    JoinType: { Round: { value: 20 } },
    EndType: { Round: { value: 30 } },
    PointD: MockPointD,
    PathD: MockPathD,
    PathsD: MockPathsD,
    ClipperD: MockClipperD,
    InflatePathsD: () => new MockPathsD(),
  }
}

vi.mock('clipper2-wasm/dist/es/clipper2z.wasm?url', () => ({
  default: 'mock://clipper2.wasm',
}))

vi.mock('clipper2-wasm/dist/es/clipper2z.js', () => ({
  default: async () => createMockClipperModule(),
}))

function seg(aX: number, aY: number, bX: number, bY: number): Segment2D {
  return {
    a: { x: aX, y: aY },
    b: { x: bX, y: bY },
  }
}

describe('createClipper2WasmBrushAdapter', () => {
  beforeEach(() => {
    fillRuleCalls.length = 0
    subjectPathCounts.length = 0
    openSubjectPathCounts.length = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
      return new Response(bytes)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('add mode should use EvenOdd fill rule to preserve holes when loop winding is unstable', async () => {
    const { createClipper2WasmBrushAdapter } = await import('@/core/brush/clipper2-wasm-adapter')
    const adapter = await createClipper2WasmBrushAdapter()

    const baseSegments: Segment2D[] = [
      seg(-10, -10, 10, -10),
      seg(10, -10, 10, 10),
      seg(10, 10, -10, 10),
      seg(-10, 10, -10, -10),
      seg(-4, -4, 4, -4),
      seg(4, -4, 4, 4),
      seg(4, 4, -4, 4),
      seg(-4, 4, -4, -4),
    ]
    const brushPolygon = [
      { x: 20, y: 20 },
      { x: 24, y: 20 },
      { x: 22, y: 24 },
    ]

    adapter.applyBoolean(baseSegments, brushPolygon, 'add')

    expect(fillRuleCalls).toEqual([mockFillRule.EvenOdd.value])
  })

  it('add mode should still run boolean for near-closed loops after view reslice jitter', async () => {
    const { createClipper2WasmBrushAdapter } = await import('@/core/brush/clipper2-wasm-adapter')
    const adapter = await createClipper2WasmBrushAdapter()

    const baseSegments: Segment2D[] = [
      seg(0, 0, 20, 0),
      seg(20, 0, 20, 20),
      seg(20, 20, 0, 20),
      // Simulate reslice jitter: end-point almost returns to start but not exact.
      seg(0, 20, 0.02, 0.01),
    ]
    const brushPolygon = [
      { x: 8, y: 8 },
      { x: 12, y: 8 },
      { x: 10, y: 12 },
    ]

    adapter.applyBoolean(baseSegments, brushPolygon, 'add')

    // If near-closed rings are misclassified as open, addWithUnion falls back
    // and ExecutePath is never called.
    expect(fillRuleCalls).toEqual([mockFillRule.EvenOdd.value])
  })

  it('add mode should classify inner near-closed ring as closed subject, not open subject', async () => {
    const { createClipper2WasmBrushAdapter } = await import('@/core/brush/clipper2-wasm-adapter')
    const adapter = await createClipper2WasmBrushAdapter()

    const baseSegments: Segment2D[] = [
      seg(-10, -10, 10, -10),
      seg(10, -10, 10, 10),
      seg(10, 10, -10, 10),
      seg(-10, 10, -10, -10),
      seg(-4, -4, 4, -4),
      seg(4, -4, 4, 4),
      seg(4, 4, -4, 4),
      // Simulate tiny reslice drift on loop closure of inner ring.
      seg(-4, 4, -3.98, -4.02),
    ]
    const brushPolygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ]

    adapter.applyBoolean(baseSegments, brushPolygon, 'add')

    expect(fillRuleCalls).toEqual([mockFillRule.EvenOdd.value])
    expect(subjectPathCounts).toEqual([2])
    expect(openSubjectPathCounts).toEqual([])
  })

  it('add mode should keep very small inner closed ring editable', async () => {
    const { createClipper2WasmBrushAdapter } = await import('@/core/brush/clipper2-wasm-adapter')
    const adapter = await createClipper2WasmBrushAdapter()

    const baseSegments: Segment2D[] = [
      seg(-10, -10, 10, -10),
      seg(10, -10, 10, 10),
      seg(10, 10, -10, 10),
      seg(-10, 10, -10, -10),
      // Tiny inner hole (edge length 0.02mm) should still be treated as closed.
      seg(-0.01, -0.01, 0.01, -0.01),
      seg(0.01, -0.01, 0.01, 0.01),
      seg(0.01, 0.01, -0.01, 0.01),
      seg(-0.01, 0.01, -0.01, -0.01),
    ]
    const brushPolygon = [
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0.3, y: 0.6 },
    ]

    adapter.applyBoolean(baseSegments, brushPolygon, 'add')

    expect(fillRuleCalls).toEqual([mockFillRule.EvenOdd.value])
    expect(subjectPathCounts).toEqual([2])
  })
})
