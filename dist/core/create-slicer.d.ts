import type { MeshSlicer } from './slicer-interface';
import type { BatchMeshSlicer } from './batch-slicer-interface';
/**
 * 工厂函数：自动选择 GPU 或 CPU 切割器
 * WebGPU 可用时返回 GPUSlicer，否则 fallback 到 CPUSlicer
 */
export declare function createSlicer(): Promise<MeshSlicer>;
/**
 * 工厂函数：创建批量切割器
 * WebGPU 可用时返回 BatchGPUSlicer，否则返回 null
 */
export declare function createBatchSlicer(): Promise<BatchMeshSlicer | null>;
//# sourceMappingURL=create-slicer.d.ts.map