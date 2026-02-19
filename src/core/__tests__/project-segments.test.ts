import { describe, it, expect } from 'vitest'
import { buildLocalBasis, projectSegments } from '@/core/projection'
import type { Segment3D, Vec3 } from '@/types'

describe('projectSegments', () => {
  it('should project 3D segments to 2D canvas coordinates', () => {
    const basis = buildLocalBasis([0, 0, -1], [0, -1, 0])
    const anchor: Vec3 = [0, 0, 0]

    const segments3D: Segment3D[] = [
      { start: [-50, -50, 0], end: [50, -50, 0] },
      { start: [50, -50, 0], end: [50, 50, 0] },
    ]

    const result = projectSegments(segments3D, anchor, basis, 512, 512, 2)

    expect(result).toHaveLength(2)

    // 每个 segment 应有 start 和 end
    for (const seg of result) {
      expect(seg.start).toHaveLength(2)
      expect(seg.end).toHaveLength(2)
      // 坐标应在合理的 canvas 范围内
      expect(seg.start[0]).toBeGreaterThan(0)
      expect(seg.start[1]).toBeGreaterThan(0)
    }
  })

  it('should center origin at canvas center', () => {
    const basis = buildLocalBasis([0, 0, -1], [0, -1, 0])
    const anchor: Vec3 = [0, 0, 0]

    const segments3D: Segment3D[] = [
      { start: [0, 0, 0], end: [0, 0, 0] },
    ]

    const result = projectSegments(segments3D, anchor, basis, 512, 512, 1)

    // 原点应映射到 canvas 中心
    expect(result[0].start[0]).toBeCloseTo(256)
    expect(result[0].start[1]).toBeCloseTo(256)
  })
})
