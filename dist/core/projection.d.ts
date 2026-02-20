import type { Vec3, Segment3D, Segment2D } from '@/types';
/** 正交局部坐标系 */
export interface LocalBasis {
    xAxis: Vec3;
    yAxis: Vec3;
    zAxis: Vec3;
}
/**
 * 根据 viewPlaneNormal 和 viewUp 构建正交局部坐标系
 * 含正交化处理：确保 viewUp 与 normal 垂直
 */
export declare function buildLocalBasis(viewPlaneNormal: Vec3, viewUp: Vec3): LocalBasis;
/**
 * 将 3D 点投影到局部 2D 坐标（相对于 anchor）
 */
export declare function projectPointTo2D(point: Vec3, anchor: Vec3, basis: LocalBasis): [number, number];
/**
 * 将物理坐标（mm）映射到 Canvas 像素空间
 */
export declare function toCanvasCoord(point: [number, number], canvasWidth: number, canvasHeight: number, scale: number): [number, number];
/**
 * 将 3D 线段集合投影为 2D Canvas 线段
 */
export declare function projectSegments(segments3D: Segment3D[], anchor: Vec3, basis: LocalBasis, canvasWidth: number, canvasHeight: number, scale: number): Segment2D[];
//# sourceMappingURL=projection.d.ts.map