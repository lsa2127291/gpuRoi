import { add, cross, dot, normalize, scale, subtract } from '@/core/vec3';
function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function distancePointToSegment2D(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq <= 1e-12) {
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        return Math.hypot(dx, dy);
    }
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    return Math.hypot(p.x - qx, p.y - qy);
}
function distancePointToPolyline2D(point, points) {
    if (points.length === 0)
        return Infinity;
    if (points.length === 1) {
        return Math.hypot(point.x - points[0].x, point.y - points[0].y);
    }
    let minDist = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        minDist = Math.min(minDist, distancePointToSegment2D(point, points[i], points[i + 1]));
    }
    return minDist;
}
function smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}
function buildPlaneBasis(input) {
    const normal = normalize(input.slicePlane.normal);
    const anchor = input.slicePlane.anchor;
    if (input.slicePlane.xAxis && input.slicePlane.yAxis) {
        const xAxis = normalize(input.slicePlane.xAxis);
        const yAxis = normalize(input.slicePlane.yAxis);
        return { normal, anchor, xAxis, yAxis };
    }
    const ref = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const xAxis = normalize(cross(ref, normal));
    const yAxis = normalize(cross(normal, xAxis));
    return { normal, anchor, xAxis, yAxis };
}
function projectWorldToPlane(point, basis) {
    const rel = subtract(point, basis.anchor);
    return {
        x: dot(rel, basis.xAxis),
        y: dot(rel, basis.yAxis),
    };
}
export function mapStrokeTo3D(points, basis) {
    return points.map((p) => {
        const px = scale(basis.xAxis, p.x);
        const py = scale(basis.yAxis, p.y);
        return add(add(basis.anchor, px), py);
    });
}
function cloneMesh(mesh) {
    return {
        vertices: new Float32Array(mesh.vertices),
        indices: new Uint32Array(mesh.indices),
        normals: mesh.normals ? new Float32Array(mesh.normals) : undefined,
    };
}
export class ApproxBrushEngine3D {
    constructor(options = {}) {
        this.commitSeq = 0;
        this.options = {
            displacementScaleMm: options.displacementScaleMm ?? 0.3,
            falloffMm: options.falloffMm ?? 0.5,
            idPrefix: options.idPrefix ?? 'brush',
        };
    }
    async commit(input) {
        const t0 = nowMs();
        const basis = buildPlaneBasis(input);
        const strokePoints = input.stroke.simplified.length > 0
            ? input.stroke.simplified
            : input.stroke.points;
        if (strokePoints.length === 0 || input.stroke.radiusMm <= 0) {
            return {
                newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
                mesh: cloneMesh(input.mesh),
                triangleCount: input.mesh.indices.length / 3,
                elapsedMs: nowMs() - t0,
            };
        }
        const mesh = cloneMesh(input.mesh);
        const vertices = mesh.vertices;
        const influenceRadius = input.stroke.radiusMm + this.options.falloffMm;
        const displacementSign = input.stroke.mode === 'add' ? 1 : -1;
        for (let i = 0; i < vertices.length; i += 3) {
            const world = [vertices[i], vertices[i + 1], vertices[i + 2]];
            const p2 = projectWorldToPlane(world, basis);
            const distToStroke = distancePointToPolyline2D(p2, strokePoints);
            if (distToStroke > influenceRadius)
                continue;
            const normalizedDist = distToStroke / Math.max(influenceRadius, 1e-6);
            const influence = 1 - smoothstep01(normalizedDist);
            if (influence <= 0)
                continue;
            const delta = displacementSign * this.options.displacementScaleMm * influence;
            vertices[i] += basis.normal[0] * delta;
            vertices[i + 1] += basis.normal[1] * delta;
            vertices[i + 2] += basis.normal[2] * delta;
        }
        mesh.normals = undefined;
        return {
            newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
            mesh,
            triangleCount: mesh.indices.length / 3,
            elapsedMs: nowMs() - t0,
        };
    }
}
export function createBrushEngine3D(options) {
    return new ApproxBrushEngine3D(options);
}
//# sourceMappingURL=brush-engine-3d.js.map