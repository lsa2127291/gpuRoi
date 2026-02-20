import type { Vec3, MeshData, Segment3D, BoundingBox } from '@/types';
/** 计算 Mesh 包围盒 */
export declare function computeBoundingBox(vertices: Float32Array): BoundingBox;
/** 检查平面是否与包围盒相交 */
export declare function planeIntersectsBoundingBox(normal: Vec3, anchor: Vec3, bbox: BoundingBox): boolean;
/**
 * 核心切割算法：计算 Mesh 与平面的交线段
 *
 * @param mesh - 网格数据
 * @param normal - 切割平面法线（归一化）
 * @param anchor - 切割平面上的一点
 * @returns 3D 线段数组
 */
export declare function sliceMesh(mesh: MeshData, normal: Vec3, anchor: Vec3): Segment3D[];
//# sourceMappingURL=slicer.d.ts.map