import type { MeshData, BoundingBox } from '@/types';
/** 单个 mesh 在拼接 buffer 中的元信息 */
export interface MeshInfo {
    /** 三角形起始偏移（在拼接后的 index buffer 中） */
    triOffset: number;
    /** 三角形数量 */
    triCount: number;
    /** 顶点起始偏移（在拼接后的 vertex buffer 中，以 float 计） */
    vertexFloatOffset: number;
    /** segment 输出起始偏移（在 segment buffer 中，以 segment 计） */
    segOffset: number;
    /** 包围盒 */
    bbox: BoundingBox;
    /** 原始 mesh 索引 */
    meshIndex: number;
}
/** 一个 chunk 包含若干 mesh 的拼接数据 */
export interface Chunk {
    /** 拼接后的顶点数据 */
    vertices: Float32Array;
    /** 拼接后的索引数据（已重映射） */
    indices: Uint32Array;
    /** 每个 mesh 的元信息 */
    meshInfos: MeshInfo[];
    /** 总三角形数 */
    totalTriCount: number;
    /** 总 segment 容量（= totalTriCount，最坏情况每个三角形产生 1 个 segment） */
    totalSegCapacity: number;
}
export interface ChunkPlannerOptions {
    /** 单 chunk 最大字节预算，默认 128MB */
    maxChunkBytes?: number;
    /** 设备 maxStorageBufferBindingSize */
    maxStorageBufferBindingSize?: number;
    /** 设备 maxBufferSize */
    maxBufferSize?: number;
}
/**
 * 将 mesh 列表拆分为若干 chunk
 * 每个 chunk 的拼接 buffer 不超过设备限制和预算
 */
export declare function planChunks(meshes: MeshData[], options?: ChunkPlannerOptions): Chunk[];
//# sourceMappingURL=chunk-planner.d.ts.map