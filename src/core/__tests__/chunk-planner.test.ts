import { describe, it, expect } from 'vitest'
import { planChunks } from '../chunk-planner'
import { generateRandomMesh } from '../mesh-generator'
import type { MeshData } from '@/types'

function makeMesh(vertexCount: number): MeshData {
  return generateRandomMesh(vertexCount, 50, [0, 0, 0], 123)
}

describe('planChunks', () => {
  it('should put all meshes in one chunk when within budget', () => {
    const meshes = [makeMesh(100), makeMesh(200), makeMesh(300)]
    const chunks = planChunks(meshes)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].meshInfos).toHaveLength(3)
    expect(chunks[0].meshInfos[0].meshIndex).toBe(0)
    expect(chunks[0].meshInfos[1].meshIndex).toBe(1)
    expect(chunks[0].meshInfos[2].meshIndex).toBe(2)
  })

  it('should split into multiple chunks when exceeding budget', () => {
    const meshes = [makeMesh(10000), makeMesh(10000), makeMesh(10000)]

    // 设置极小预算强制拆分
    const chunks = planChunks(meshes, { maxChunkBytes: 1 })

    expect(chunks.length).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(chunks[i].meshInfos).toHaveLength(1)
      expect(chunks[i].meshInfos[0].meshIndex).toBe(i)
    }
  })

  it('should correctly remap indices in concatenated buffer', () => {
    const meshes = [makeMesh(100), makeMesh(200)]
    const chunks = planChunks(meshes)
    const chunk = chunks[0]

    // 第二个 mesh 的索引应该偏移了第一个 mesh 的顶点数
    const info0 = chunk.meshInfos[0]
    const info1 = chunk.meshInfos[1]

    expect(info0.triOffset).toBe(0)
    expect(info1.triOffset).toBe(info0.triCount)

    // 验证拼接后的 vertices 长度
    const totalVerts = meshes[0].vertices.length + meshes[1].vertices.length
    expect(chunk.vertices.length).toBe(totalVerts)
  })

  it('should compute correct totalTriCount', () => {
    const meshes = [makeMesh(100), makeMesh(200)]
    const chunks = planChunks(meshes)
    const chunk = chunks[0]

    const expectedTris = meshes[0].indices.length / 3 + meshes[1].indices.length / 3
    expect(chunk.totalTriCount).toBe(expectedTris)
  })

  it('should handle empty mesh list', () => {
    const chunks = planChunks([])
    expect(chunks).toHaveLength(0)
  })

  it('should respect maxStorageBufferBindingSize', () => {
    const meshes = [makeMesh(5000), makeMesh(5000)]

    // 设置 storage binding 限制使得单个 mesh 的 vertex buffer 就超限
    const singleVertBytes = meshes[0].vertices.byteLength
    const chunks = planChunks(meshes, {
      maxStorageBufferBindingSize: singleVertBytes + 1,
    })

    expect(chunks.length).toBe(2)
  })
})
