import { describe, it, expect } from 'vitest'
import { sliceMesh } from '@/core/slicer'
import { createTestCube } from '@/core/test-data'
import { MPR_VIEWS } from '@/types'
import type { Vec3, Segment3D } from '@/types'

/** 辅助：收集所有线段端点的某个坐标分量的极值 */
function getCoordRange(segments: Segment3D[], axis: 0 | 1 | 2): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const seg of segments) {
    for (const p of [seg.start, seg.end]) {
      if (p[axis] < min) min = p[axis]
      if (p[axis] > max) max = p[axis]
    }
  }
  return [min, max]
}

describe('Mesh Slicing', () => {
  const cube = createTestCube()

  describe('Axial view (Z=0 plane)', () => {
    it('should produce a square cross-section', () => {
      const { viewPlaneNormal } = MPR_VIEWS.Axial
      const anchor: Vec3 = [0, 0, 0]
      const segments = sliceMesh(cube, viewPlaneNormal, anchor)

      // 立方体在 Z=0 平面切割应产生 4 条线段（正方形）
      expect(segments.length).toBeGreaterThanOrEqual(4)

      // 所有交点的 Z 坐标应为 0
      for (const seg of segments) {
        expect(seg.start[2]).toBeCloseTo(0, 5)
        expect(seg.end[2]).toBeCloseTo(0, 5)
      }

      // X 和 Y 范围应为 [-50, 50]
      const [xMin, xMax] = getCoordRange(segments, 0)
      const [yMin, yMax] = getCoordRange(segments, 1)
      expect(xMin).toBeCloseTo(-50, 1)
      expect(xMax).toBeCloseTo(50, 1)
      expect(yMin).toBeCloseTo(-50, 1)
      expect(yMax).toBeCloseTo(50, 1)
    })
  })

  describe('Sagittal view (X=0 plane)', () => {
    it('should produce a square cross-section', () => {
      const { viewPlaneNormal } = MPR_VIEWS.Sagittal
      const anchor: Vec3 = [0, 0, 0]
      const segments = sliceMesh(cube, viewPlaneNormal, anchor)

      expect(segments.length).toBeGreaterThanOrEqual(4)

      // 所有交点的 X 坐标应为 0
      for (const seg of segments) {
        expect(seg.start[0]).toBeCloseTo(0, 5)
        expect(seg.end[0]).toBeCloseTo(0, 5)
      }

      const [yMin, yMax] = getCoordRange(segments, 1)
      const [zMin, zMax] = getCoordRange(segments, 2)
      expect(yMin).toBeCloseTo(-50, 1)
      expect(yMax).toBeCloseTo(50, 1)
      expect(zMin).toBeCloseTo(-50, 1)
      expect(zMax).toBeCloseTo(50, 1)
    })
  })

  describe('Coronal view (Y=0 plane)', () => {
    it('should produce a square cross-section', () => {
      const { viewPlaneNormal } = MPR_VIEWS.Coronal
      const anchor: Vec3 = [0, 0, 0]
      const segments = sliceMesh(cube, viewPlaneNormal, anchor)

      expect(segments.length).toBeGreaterThanOrEqual(4)

      for (const seg of segments) {
        expect(seg.start[1]).toBeCloseTo(0, 5)
        expect(seg.end[1]).toBeCloseTo(0, 5)
      }

      const [xMin, xMax] = getCoordRange(segments, 0)
      const [zMin, zMax] = getCoordRange(segments, 2)
      expect(xMin).toBeCloseTo(-50, 1)
      expect(xMax).toBeCloseTo(50, 1)
      expect(zMin).toBeCloseTo(-50, 1)
      expect(zMax).toBeCloseTo(50, 1)
    })
  })

  describe('Edge cases', () => {
    it('anchor at edge [0,0,50] should still produce segments', () => {
      const { viewPlaneNormal } = MPR_VIEWS.Axial
      const anchor: Vec3 = [0, 0, 50]
      const segments = sliceMesh(cube, viewPlaneNormal, anchor)

      // 切到立方体顶面边缘，应有交线
      expect(segments.length).toBeGreaterThanOrEqual(1)
    })

    it('anchor outside mesh [0,0,60] should produce no segments', () => {
      const { viewPlaneNormal } = MPR_VIEWS.Axial
      const anchor: Vec3 = [0, 0, 60]
      const segments = sliceMesh(cube, viewPlaneNormal, anchor)

      expect(segments.length).toBe(0)
    })
  })
})
