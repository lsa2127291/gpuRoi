import { describe, expect, it } from 'vitest'
import { normalizeSliceSegmentEntries } from '@/core/slice-segment-normalizer'
import type { Vec3 } from '@/types'

function v(x: number, y: number, z: number): Vec3 {
  return [x, y, z]
}

describe('normalizeSliceSegmentEntries', () => {
  it('should cancel reverse duplicate segments in the same mesh', () => {
    const out = normalizeSliceSegmentEntries([
      { start: v(0, 0, 0), end: v(1, 0, 0), meshIndex: 0 },
      { start: v(1, 0, 0), end: v(0, 0, 0), meshIndex: 0 },
    ])

    expect(out).toEqual([])
  })

  it('should keep one segment when duplicated odd times', () => {
    const out = normalizeSliceSegmentEntries([
      { start: v(0, 0, 0), end: v(1, 0, 0), meshIndex: 0 },
      { start: v(1, 0, 0), end: v(0, 0, 0), meshIndex: 0 },
      { start: v(0, 0, 0), end: v(1, 0, 0), meshIndex: 0 },
    ])

    expect(out).toHaveLength(1)
    expect(out[0].meshIndex).toBe(0)
  })

  it('should not cancel segments across different meshes', () => {
    const out = normalizeSliceSegmentEntries([
      { start: v(0, 0, 0), end: v(1, 0, 0), meshIndex: 0 },
      { start: v(1, 0, 0), end: v(0, 0, 0), meshIndex: 1 },
    ])

    expect(out).toHaveLength(2)
  })

  it('should drop zero-length segments', () => {
    const out = normalizeSliceSegmentEntries([
      { start: v(0, 0, 0), end: v(0, 0, 0), meshIndex: 0 },
    ])

    expect(out).toEqual([])
  })
})
