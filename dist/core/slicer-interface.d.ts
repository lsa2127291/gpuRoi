import type { MeshData, Segment3D, Vec3 } from '@/types';
/** 统一的 Mesh 切割器接口 */
export interface MeshSlicer {
    /** 初始化/更新 mesh 数据 */
    init(mesh: MeshData): Promise<void>;
    /** 执行切割，返回 3D 线段数组 */
    slice(normal: Vec3, anchor: Vec3): Promise<Segment3D[]>;
    /** 释放资源 */
    dispose(): void;
    /** 后端类型标识 */
    readonly backend: 'gpu' | 'cpu';
}
//# sourceMappingURL=slicer-interface.d.ts.map