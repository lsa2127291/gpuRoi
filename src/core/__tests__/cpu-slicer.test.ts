import { describe, it, expect } from 'vitest'
import { CPUSlicer } from '@/core/cpu-slicer'
import { createTestCube } from '@/core/test-data'
import { MPR_VIEWS } from '@/types'
import type { Vec3 } from '@/types'

describe('CPUSlicer (MeshSlicer interface)', () => {
  it('should report cpu backend', () => {
    const slicer = new CPUSlicer()
    expect(slicer.backend).toBe('cpu')
  })

  it('should return empty before init', async () => {
    const slicer = new CPUSlicer()
    const result = await slicer.slice([0, 0, -1], [0, 0, 0])
    expect(result).toEqual([])
  })

  it('should slice after init (Axial)', async () => {
    const slicer = new CPUSlicer()
    await slicer.init(createTestCube())

    const { viewPlaneNormal } = MPR_VIEWS.Axial
    const anchor: Vec3 = [0, 0, 0]
    const segments = await slicer.slice(viewPlaneNormal, anchor)

    expect(segments.length).toBeGreaterThanOrEqual(4)
    for (const seg of segments) {
      expect(seg.start[2]).toBeCloseTo(0, 5)
      expect(seg.end[2]).toBeCloseTo(0, 5)
    }
  })

  it('should slice Sagittal view', async () => {
    const slicer = new CPUSlicer()
    await slicer.init(createTestCube())

    const { viewPlaneNormal } = MPR_VIEWS.Sagittal
    const segments = await slicer.slice(viewPlaneNormal, [0, 0, 0])

    expect(segments.length).toBeGreaterThanOrEqual(4)
    for (const seg of segments) {
      expect(seg.start[0]).toBeCloseTo(0, 5)
      expect(seg.end[0]).toBeCloseTo(0, 5)
    }
  })

  it('should slice Coronal view', async () => {
    const slicer = new CPUSlicer()
    await slicer.init(createTestCube())

    const { viewPlaneNormal } = MPR_VIEWS.Coronal
    const segments = await slicer.slice(viewPlaneNormal, [0, 0, 0])

    expect(segments.length).toBeGreaterThanOrEqual(4)
    for (const seg of segments) {
      expect(seg.start[1]).toBeCloseTo(0, 5)
      expect(seg.end[1]).toBeCloseTo(0, 5)
    }
  })

  it('should return empty for out-of-range anchor', async () => {
    const slicer = new CPUSlicer()
    await slicer.init(createTestCube())

    const segments = await slicer.slice([0, 0, -1], [0, 0, 60])
    expect(segments).toEqual([])
  })

  it('should return empty after dispose', async () => {
    const slicer = new CPUSlicer()
    await slicer.init(createTestCube())
    slicer.dispose()

    const segments = await slicer.slice([0, 0, -1], [0, 0, 0])
    expect(segments).toEqual([])
  })
})
