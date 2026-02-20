import type { Vec3 } from '@/types';
/** 点积 */
export declare function dot(a: Vec3, b: Vec3): number;
/** 叉积 */
export declare function cross(a: Vec3, b: Vec3): Vec3;
/** 向量减法 */
export declare function subtract(a: Vec3, b: Vec3): Vec3;
/** 向量加法 */
export declare function add(a: Vec3, b: Vec3): Vec3;
/** 缩放 */
export declare function scale(v: Vec3, s: number): Vec3;
/** 归一化 */
export declare function normalize(v: Vec3): Vec3;
/** 向量长度 */
export declare function length(v: Vec3): number;
/** 线性插值 */
export declare function lerp(a: Vec3, b: Vec3, t: number): Vec3;
//# sourceMappingURL=vec3.d.ts.map