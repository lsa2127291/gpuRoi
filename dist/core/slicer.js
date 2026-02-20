import { dot, subtract, lerp } from './vec3';
const EPSILON = 1e-8;
/** 计算 Mesh 包围盒 */
export function computeBoundingBox(vertices) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices.length; i += 3) {
        for (let j = 0; j < 3; j++) {
            if (vertices[i + j] < min[j])
                min[j] = vertices[i + j];
            if (vertices[i + j] > max[j])
                max[j] = vertices[i + j];
        }
    }
    return { min, max };
}
/** 检查平面是否与包围盒相交 */
export function planeIntersectsBoundingBox(normal, anchor, bbox) {
    // 找到包围盒在法线方向上的投影范围
    let dMin = Infinity;
    let dMax = -Infinity;
    for (let i = 0; i < 8; i++) {
        const corner = [
            (i & 1) ? bbox.max[0] : bbox.min[0],
            (i & 2) ? bbox.max[1] : bbox.min[1],
            (i & 4) ? bbox.max[2] : bbox.min[2],
        ];
        const d = dot(normal, subtract(corner, anchor));
        if (d < dMin)
            dMin = d;
        if (d > dMax)
            dMax = d;
    }
    return dMin <= EPSILON && dMax >= -EPSILON;
}
/** 获取顶点坐标 */
function getVertex(vertices, index) {
    const i = index * 3;
    return [vertices[i], vertices[i + 1], vertices[i + 2]];
}
/** 计算点到平面的有符号距离 */
function signedDistance(point, normal, anchor) {
    return dot(normal, subtract(point, anchor));
}
/**
 * 核心切割算法：计算 Mesh 与平面的交线段
 *
 * @param mesh - 网格数据
 * @param normal - 切割平面法线（归一化）
 * @param anchor - 切割平面上的一点
 * @returns 3D 线段数组
 */
export function sliceMesh(mesh, normal, anchor) {
    const { vertices, indices } = mesh;
    // BoundingBox 提前剔除
    const bbox = computeBoundingBox(vertices);
    if (!planeIntersectsBoundingBox(normal, anchor, bbox)) {
        return [];
    }
    const segments = [];
    const triCount = indices.length / 3;
    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3];
        const i1 = indices[t * 3 + 1];
        const i2 = indices[t * 3 + 2];
        const v0 = getVertex(vertices, i0);
        const v1 = getVertex(vertices, i1);
        const v2 = getVertex(vertices, i2);
        const d0 = signedDistance(v0, normal, anchor);
        const d1 = signedDistance(v1, normal, anchor);
        const d2 = signedDistance(v2, normal, anchor);
        const onPlane0 = Math.abs(d0) <= EPSILON;
        const onPlane1 = Math.abs(d1) <= EPSILON;
        const onPlane2 = Math.abs(d2) <= EPSILON;
        // 所有顶点在同一侧，跳过
        if (d0 > EPSILON && d1 > EPSILON && d2 > EPSILON)
            continue;
        if (d0 < -EPSILON && d1 < -EPSILON && d2 < -EPSILON)
            continue;
        // 三角形完全共面，跳过（避免输出三角形内部对角线）
        if (onPlane0 && onPlane1 && onPlane2)
            continue;
        const intersections = [];
        // 检查每条边与平面的交点
        computeEdgeIntersection(v0, v1, d0, d1, intersections);
        computeEdgeIntersection(v1, v2, d1, d2, intersections);
        computeEdgeIntersection(v2, v0, d2, d0, intersections);
        // 处理顶点恰好在平面上的情况
        if (onPlane0)
            addUniquePoint(intersections, v0);
        if (onPlane1)
            addUniquePoint(intersections, v1);
        if (onPlane2)
            addUniquePoint(intersections, v2);
        if (intersections.length >= 2) {
            segments.push({ start: intersections[0], end: intersections[1] });
        }
    }
    return segments;
}
/** 计算边与平面的交点 */
function computeEdgeIntersection(v0, v1, d0, d1, out) {
    // 两端点在平面同侧或都在平面上，不产生边交点
    if ((d0 > EPSILON && d1 > EPSILON) || (d0 < -EPSILON && d1 < -EPSILON)) {
        return;
    }
    // 两端点都在平面上，由顶点处理逻辑负责
    if (Math.abs(d0) <= EPSILON && Math.abs(d1) <= EPSILON) {
        return;
    }
    // 一端在平面上，由顶点处理逻辑负责
    if (Math.abs(d0) <= EPSILON || Math.abs(d1) <= EPSILON) {
        return;
    }
    // 真正的边穿越：d0 和 d1 异号
    const t = d0 / (d0 - d1);
    addUniquePoint(out, lerp(v0, v1, t));
}
/** 添加不重复的点 */
function addUniquePoint(points, p) {
    for (const existing of points) {
        const dx = existing[0] - p[0];
        const dy = existing[1] - p[1];
        const dz = existing[2] - p[2];
        if (dx * dx + dy * dy + dz * dz < EPSILON * EPSILON)
            return;
    }
    points.push(p);
}
//# sourceMappingURL=slicer.js.map