import type { MeshData } from '@/types';
/**
 * 生成随机球面 Mesh
 *
 * @param targetVertexCount - 目标顶点数（实际会接近此值）
 * @param radius - 球体半径
 * @param center - 球心偏移 [x, y, z]
 * @param seed - 随机种子（可选，不传则用 Math.random）
 */
export declare function generateRandomMesh(targetVertexCount: number, radius?: number, center?: [number, number, number], seed?: number): MeshData;
/**
 * 批量生成随机 Mesh
 *
 * @param count - mesh 数量
 * @param minVertices - 最小顶点数
 * @param maxVertices - 最大顶点数
 * @param seed - 随机种子（可选，传入则结果可复现）
 */
export declare function generateMeshBatch(count: number, minVertices?: number, maxVertices?: number, seed?: number): MeshData[];
//# sourceMappingURL=mesh-generator.d.ts.map