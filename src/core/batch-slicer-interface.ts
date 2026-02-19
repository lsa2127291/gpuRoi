import type { MeshColor, MeshData, Segment3D, SliceBitmapOptions, Vec3 } from '@/types'

/** 批量 Mesh 切割器接口 */
export interface BatchMeshSlicer {
  /** 批量初始化：上传所有 mesh 数据，按 chunk 拆分 */
  initBatch(meshes: MeshData[], colors?: MeshColor[]): Promise<void>

  /** 批量切割：对所有 mesh 执行切面，返回每个 mesh 的线段数组 */
  sliceBatch(normal: Vec3, anchor: Vec3): Promise<Segment3D[][]>

  /** 批量切割（扁平输出）：返回所有 mesh 的线段合并数组，避免 per-mesh 分配开销 */
  sliceBatchFlat(normal: Vec3, anchor: Vec3): Promise<Segment3D[]>

  /** 批量切割并直接输出位图（用于 Canvas2D drawImage） */
  sliceToBitmap(
    normal: Vec3,
    anchor: Vec3,
    options: SliceBitmapOptions,
  ): Promise<ImageBitmap>

  /** 释放资源 */
  dispose(): void

  /** 后端类型标识 */
  readonly backend: 'gpu' | 'cpu'
}
