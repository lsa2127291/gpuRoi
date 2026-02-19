import type { MeshData } from '@/types'

/** 简单的可复现伪随机数生成器 (mulberry32) */
function createRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成随机球面 Mesh
 *
 * @param targetVertexCount - 目标顶点数（实际会接近此值）
 * @param radius - 球体半径
 * @param center - 球心偏移 [x, y, z]
 * @param seed - 随机种子（可选，不传则用 Math.random）
 */
export function generateRandomMesh(
  targetVertexCount: number,
  radius: number = 50,
  center: [number, number, number] = [0, 0, 0],
  seed?: number,
): MeshData {
  const rng = seed !== undefined ? createRng(seed) : Math.random

  const n = Math.max(4, Math.round(Math.sqrt(targetVertexCount)))
  const stacks = n
  const slices = n

  const vertexCount = (stacks + 1) * (slices + 1)
  const triCount = stacks * slices * 2
  const vertices = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triCount * 3)

  const noiseSeed = rng() * 1000
  const jitter = radius * 0.15

  let vi = 0
  for (let i = 0; i <= stacks; i++) {
    const phi = (Math.PI * i) / stacks
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)

    for (let j = 0; j <= slices; j++) {
      const theta = (2 * Math.PI * j) / slices

      // 法线方向
      const nx = sinPhi * Math.cos(theta)
      const ny = sinPhi * Math.sin(theta)
      const nz = cosPhi

      // 随机扰动半径
      const noise = 1 + jitter / radius * Math.sin(noiseSeed + i * 7.3 + j * 13.7)
      const r = radius * noise

      vertices[vi * 3] = center[0] + nx * r
      vertices[vi * 3 + 1] = center[1] + ny * r
      vertices[vi * 3 + 2] = center[2] + nz * r

      normals[vi * 3] = nx
      normals[vi * 3 + 1] = ny
      normals[vi * 3 + 2] = nz

      vi++
    }
  }

  // 生成三角形索引
  let ii = 0
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j
      const b = a + slices + 1

      indices[ii++] = a
      indices[ii++] = b
      indices[ii++] = a + 1

      indices[ii++] = a + 1
      indices[ii++] = b
      indices[ii++] = b + 1
    }
  }

  return { vertices, indices, normals }
}

/**
 * 批量生成随机 Mesh
 *
 * @param count - mesh 数量
 * @param minVertices - 最小顶点数
 * @param maxVertices - 最大顶点数
 * @param seed - 随机种子（可选，传入则结果可复现）
 */
export function generateMeshBatch(
  count: number,
  minVertices: number = 20000,
  maxVertices: number = 1000000,
  seed?: number,
): MeshData[] {
  const rng = seed !== undefined ? createRng(seed) : Math.random
  const meshes: MeshData[] = []

  for (let i = 0; i < count; i++) {
    const targetVerts = Math.round(
      minVertices + rng() * (maxVertices - minVertices),
    )

    const radius = 30 + rng() * 40 // 30-70mm
    const cx = (rng() - 0.5) * 100
    const cy = (rng() - 0.5) * 100
    const cz = (rng() - 0.5) * 100

    // 每个 mesh 用不同的子种子
    const meshSeed = seed !== undefined ? seed + i * 997 : undefined
    meshes.push(generateRandomMesh(targetVerts, radius, [cx, cy, cz], meshSeed))
  }

  return meshes
}
