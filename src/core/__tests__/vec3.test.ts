import { describe, it, expect } from 'vitest'
import { dot, cross, subtract, add, scale, normalize, length, lerp } from '@/core/vec3'
import type { Vec3 } from '@/types'

describe('Vec3 Math Utils', () => {
  it('dot product', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0)
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(dot([1, 0, 0], [1, 0, 0])).toBe(1)
  })

  it('cross product', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
    expect(cross([1, 0, 0], [1, 0, 0])).toEqual([0, 0, 0])
  })

  it('subtract', () => {
    expect(subtract([3, 4, 5], [1, 2, 3])).toEqual([2, 2, 2])
  })

  it('add', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9])
  })

  it('scale', () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6])
    expect(scale([1, 2, 3], 0)).toEqual([0, 0, 0])
  })

  it('normalize', () => {
    const result = normalize([3, 0, 0])
    expect(result[0]).toBeCloseTo(1)
    expect(result[1]).toBeCloseTo(0)
    expect(result[2]).toBeCloseTo(0)

    // 零向量
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('length', () => {
    expect(length([3, 4, 0])).toBe(5)
    expect(length([0, 0, 0])).toBe(0)
    expect(length([1, 0, 0])).toBe(1)
  })

  it('lerp', () => {
    const a: Vec3 = [0, 0, 0]
    const b: Vec3 = [10, 20, 30]
    const mid = lerp(a, b, 0.5)
    expect(mid).toEqual([5, 10, 15])

    expect(lerp(a, b, 0)).toEqual([0, 0, 0])
    expect(lerp(a, b, 1)).toEqual([10, 20, 30])
  })
})
