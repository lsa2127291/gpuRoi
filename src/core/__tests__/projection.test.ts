import { describe, it, expect } from 'vitest'
import { buildLocalBasis, projectPointTo2D, toCanvasCoord } from '@/core/projection'
import { dot, length } from '@/core/vec3'
import type { Vec3 } from '@/types'

describe('Projection', () => {
  describe('buildLocalBasis', () => {
    it('should produce orthonormal basis for Axial view', () => {
      const basis = buildLocalBasis([0, 0, -1], [0, -1, 0])

      // 各轴应为单位向量
      expect(length(basis.xAxis)).toBeCloseTo(1)
      expect(length(basis.yAxis)).toBeCloseTo(1)
      expect(length(basis.zAxis)).toBeCloseTo(1)

      // 各轴应互相垂直
      expect(dot(basis.xAxis, basis.yAxis)).toBeCloseTo(0, 5)
      expect(dot(basis.xAxis, basis.zAxis)).toBeCloseTo(0, 5)
      expect(dot(basis.yAxis, basis.zAxis)).toBeCloseTo(0, 5)
    })

    it('should produce orthonormal basis for Sagittal view', () => {
      const basis = buildLocalBasis([-1, 0, 0], [0, 0, 1])

      expect(length(basis.xAxis)).toBeCloseTo(1)
      expect(length(basis.yAxis)).toBeCloseTo(1)
      expect(length(basis.zAxis)).toBeCloseTo(1)

      expect(dot(basis.xAxis, basis.yAxis)).toBeCloseTo(0, 5)
      expect(dot(basis.xAxis, basis.zAxis)).toBeCloseTo(0, 5)
      expect(dot(basis.yAxis, basis.zAxis)).toBeCloseTo(0, 5)
    })
  })

  describe('projectPointTo2D', () => {
    it('should project point relative to anchor', () => {
      const basis = buildLocalBasis([0, 0, -1], [0, -1, 0])
      const anchor: Vec3 = [0, 0, 0]

      // 原点投影到自身应为 (0, 0)
      const [x, y] = projectPointTo2D([0, 0, 0], anchor, basis)
      expect(x).toBeCloseTo(0)
      expect(y).toBeCloseTo(0)
    })

    it('should correctly project offset points', () => {
      const basis = buildLocalBasis([0, 0, -1], [0, -1, 0])
      const anchor: Vec3 = [0, 0, 0]

      // Axial 视图下，X 轴方向的点应投影到 2D X 轴
      const [x1, y1] = projectPointTo2D([50, 0, 0], anchor, basis)
      expect(Math.abs(x1)).toBeGreaterThan(0)
      expect(y1).toBeCloseTo(0)
    })
  })

  describe('toCanvasCoord', () => {
    it('should map origin to canvas center', () => {
      const [cx, cy] = toCanvasCoord([0, 0], 512, 512, 1)
      expect(cx).toBe(256)
      expect(cy).toBe(256)
    })

    it('should apply scale correctly', () => {
      const [cx, cy] = toCanvasCoord([10, 20], 512, 512, 2)
      expect(cx).toBe(256 + 10 * 2)
      expect(cy).toBe(256 - 20 * 2) // Y 翻转
    })
  })
})
