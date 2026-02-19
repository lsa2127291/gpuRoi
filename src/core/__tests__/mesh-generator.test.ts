import { describe, it, expect } from 'vitest'
import { generateRandomMesh, generateMeshBatch } from '../mesh-generator'

describe('seeded mesh generation', () => {
  it('should produce identical meshes with same seed', () => {
    const m1 = generateRandomMesh(1000, 50, [0, 0, 0], 42)
    const m2 = generateRandomMesh(1000, 50, [0, 0, 0], 42)

    expect(m1.vertices).toEqual(m2.vertices)
    expect(m1.indices).toEqual(m2.indices)
  })

  it('should produce different meshes with different seeds', () => {
    const m1 = generateRandomMesh(1000, 50, [0, 0, 0], 42)
    const m2 = generateRandomMesh(1000, 50, [0, 0, 0], 99)

    // 顶点数相同但值不同
    expect(m1.vertices.length).toBe(m2.vertices.length)
    expect(m1.vertices).not.toEqual(m2.vertices)
  })

  it('should produce reproducible batches with seed', () => {
    const batch1 = generateMeshBatch(5, 100, 500, 42)
    const batch2 = generateMeshBatch(5, 100, 500, 42)

    expect(batch1.length).toBe(batch2.length)
    for (let i = 0; i < batch1.length; i++) {
      expect(batch1[i].vertices).toEqual(batch2[i].vertices)
      expect(batch1[i].indices).toEqual(batch2[i].indices)
    }
  })
})
