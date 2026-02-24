import { add, cross, dot, normalize, scale, subtract } from '@/core/vec3';
import ManifoldModuleFactory from 'manifold-3d';
// @ts-expect-error vite resolves wasm asset url from dependency path.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
const EPSILON = 1e-9;
const DEFAULT_BRUSH_CONTOUR_POINTS = 40;
const MIN_BRUSH_CONTOUR_POINTS = 12;
const DEFAULT_CUTTER_DEPTH_PADDING_MM = 2;
let manifoldRuntimePromise = null;
function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function safeDelete(target) {
    if (!target || typeof target.delete !== 'function')
        return;
    target.delete();
}
function safeDeleteMany(targets) {
    const seen = new Set();
    for (const target of targets) {
        if (!target || seen.has(target))
            continue;
        seen.add(target);
        safeDelete(target);
    }
}
function isBrowserRuntime() {
    return typeof window !== 'undefined';
}
async function loadManifoldRuntime() {
    const factory = ManifoldModuleFactory;
    if (isBrowserRuntime()) {
        const wasmUrl = String(manifoldWasmUrl);
        const module = await factory({
            locateFile: () => wasmUrl,
        });
        module.setup();
        return module;
    }
    const module = await factory();
    module.setup();
    return module;
}
async function getManifoldRuntime() {
    if (!manifoldRuntimePromise) {
        manifoldRuntimePromise = loadManifoldRuntime().catch((error) => {
            manifoldRuntimePromise = null;
            throw error;
        });
    }
    return manifoldRuntimePromise;
}
function distanceSquared(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
}
function buildCirclePolygon(center, radiusMm, contourPoints) {
    if (radiusMm <= 0)
        return [];
    const steps = Math.max(MIN_BRUSH_CONTOUR_POINTS, contourPoints);
    const polygon = [];
    for (let i = 0; i < steps; i++) {
        const angle = (Math.PI * 2 * i) / steps;
        polygon.push({
            x: center.x + Math.cos(angle) * radiusMm,
            y: center.y + Math.sin(angle) * radiusMm,
        });
    }
    return polygon;
}
function buildCapsulePolygon(from, to, radiusMm, contourPoints) {
    if (radiusMm <= 0)
        return [];
    if (distanceSquared(from, to) <= EPSILON) {
        return buildCirclePolygon(from, radiusMm, contourPoints);
    }
    const steps = Math.max(MIN_BRUSH_CONTOUR_POINTS, contourPoints);
    const half = Math.max(6, Math.floor(steps / 2));
    const theta = Math.atan2(to.y - from.y, to.x - from.x);
    const polygon = [];
    for (let i = 0; i <= half; i++) {
        const angle = theta + Math.PI * 0.5 + (Math.PI * i) / half;
        polygon.push({
            x: from.x + Math.cos(angle) * radiusMm,
            y: from.y + Math.sin(angle) * radiusMm,
        });
    }
    for (let i = 0; i <= half; i++) {
        const angle = theta - Math.PI * 0.5 + (Math.PI * i) / half;
        polygon.push({
            x: to.x + Math.cos(angle) * radiusMm,
            y: to.y + Math.sin(angle) * radiusMm,
        });
    }
    return polygon;
}
function collectBrushStamps(strokePoints, radiusMm, contourPoints) {
    if (strokePoints.length === 0 || radiusMm <= 0)
        return [];
    if (strokePoints.length === 1) {
        return [buildCirclePolygon(strokePoints[0], radiusMm, contourPoints)];
    }
    const polygons = [];
    for (let i = 1; i < strokePoints.length; i++) {
        const from = strokePoints[i - 1];
        const to = strokePoints[i];
        if (distanceSquared(from, to) <= EPSILON)
            continue;
        polygons.push(buildCapsulePolygon(from, to, radiusMm, contourPoints));
    }
    if (polygons.length === 0) {
        polygons.push(buildCirclePolygon(strokePoints[strokePoints.length - 1], radiusMm, contourPoints));
    }
    return polygons;
}
function buildPlaneTransformMatrix(basis) {
    return [
        basis.xAxis[0], basis.xAxis[1], basis.xAxis[2], 0,
        basis.yAxis[0], basis.yAxis[1], basis.yAxis[2], 0,
        basis.normal[0], basis.normal[1], basis.normal[2], 0,
        basis.anchor[0], basis.anchor[1], basis.anchor[2], 1,
    ];
}
function computeCutterDepthMm(strokeRadiusMm, options) {
    if (options.cutterDepthMm > 0) {
        return options.cutterDepthMm;
    }
    // Keep default edits local to the current anchor plane. The previous
    // full-mesh span depth caused one stroke to leak into many anchors.
    return Math.max(strokeRadiusMm * 2, options.cutterDepthPaddingMm * 2, 0.1);
}
function centerExtrusionAnchor(anchor, normal, depthMm) {
    const halfDepth = depthMm * 0.5;
    if (halfDepth <= 0) {
        return [anchor[0], anchor[1], anchor[2]];
    }
    return subtract(anchor, scale(normal, halfDepth));
}
function toManifoldMeshData(mesh) {
    return {
        numProp: 3,
        vertProperties: new Float32Array(mesh.vertices),
        triVerts: new Uint32Array(mesh.indices),
    };
}
function fromManifoldMeshData(manifoldMesh) {
    const numProp = Math.floor(manifoldMesh.numProp);
    if (!Number.isFinite(numProp) || numProp < 3) {
        throw new Error(`Invalid manifold mesh numProp=${manifoldMesh.numProp}`);
    }
    if (manifoldMesh.vertProperties.length % numProp !== 0) {
        throw new Error('Invalid manifold mesh vertProperties length');
    }
    const vertexCount = manifoldMesh.vertProperties.length / numProp;
    const vertices = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        const srcBase = i * numProp;
        const dstBase = i * 3;
        vertices[dstBase] = manifoldMesh.vertProperties[srcBase];
        vertices[dstBase + 1] = manifoldMesh.vertProperties[srcBase + 1];
        vertices[dstBase + 2] = manifoldMesh.vertProperties[srcBase + 2];
    }
    return {
        vertices,
        indices: new Uint32Array(manifoldMesh.triVerts),
    };
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
        // Keep commit geometry aligned with interactive incremental preview:
        // use the raw sampled trail instead of a globally smoothed path.
        const strokePoints = input.stroke.points;
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
export class ManifoldBrushEngine3D {
    constructor(options = {}) {
        this.commitSeq = 0;
        this.options = {
            brushContourPoints: Math.max(MIN_BRUSH_CONTOUR_POINTS, Math.round(options.brushContourPoints ?? DEFAULT_BRUSH_CONTOUR_POINTS)),
            cutterDepthMm: options.cutterDepthMm ?? 0,
            cutterDepthPaddingMm: Math.max(0, options.cutterDepthPaddingMm ?? DEFAULT_CUTTER_DEPTH_PADDING_MM),
            idPrefix: options.idPrefix ?? 'brush',
        };
    }
    async commit(input) {
        const t0 = nowMs();
        const basis = buildPlaneBasis(input);
        // Keep commit geometry aligned with interactive incremental preview:
        // use the raw sampled trail instead of a globally smoothed path.
        const strokePoints = input.stroke.points;
        if (strokePoints.length === 0 || input.stroke.radiusMm <= 0) {
            return {
                newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
                mesh: cloneMesh(input.mesh),
                triangleCount: input.mesh.indices.length / 3,
                elapsedMs: nowMs() - t0,
            };
        }
        const brushStamps = collectBrushStamps(strokePoints, input.stroke.radiusMm, this.options.brushContourPoints);
        if (brushStamps.length === 0) {
            return {
                newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
                mesh: cloneMesh(input.mesh),
                triangleCount: input.mesh.indices.length / 3,
                elapsedMs: nowMs() - t0,
            };
        }
        const runtime = await getManifoldRuntime();
        let sourceMeshObj = null;
        let sourceSolid = null;
        let brushCrossSection = null;
        let cutterLocal = null;
        let cutterWorld = null;
        let resultSolid = null;
        let resultMesh = null;
        let stitchedSolid = null;
        let stitchedMesh = null;
        try {
            const sourceMeshData = toManifoldMeshData(input.mesh);
            sourceMeshObj = new runtime.Mesh(sourceMeshData);
            sourceMeshObj.merge?.();
            sourceSolid = runtime.Manifold.ofMesh(sourceMeshObj);
            const polygons = brushStamps.map((polygon) => polygon.map((p) => [p.x, p.y]));
            brushCrossSection = runtime.CrossSection.compose(polygons);
            const cutterDepthMm = computeCutterDepthMm(input.stroke.radiusMm, {
                cutterDepthMm: this.options.cutterDepthMm,
                cutterDepthPaddingMm: this.options.cutterDepthPaddingMm,
            });
            if (cutterDepthMm <= 0) {
                throw new Error('invalid cutter depth');
            }
            cutterLocal = brushCrossSection.extrude(cutterDepthMm, 0, 0, [1, 1], true);
            const cutterBasis = {
                ...basis,
                anchor: centerExtrusionAnchor(basis.anchor, basis.normal, cutterDepthMm),
            };
            cutterWorld = cutterLocal.transform(buildPlaneTransformMatrix(cutterBasis));
            resultSolid = input.stroke.mode === 'add'
                ? sourceSolid.add(cutterWorld)
                : sourceSolid.subtract(cutterWorld);
            resultMesh = resultSolid.getMesh();
            resultMesh.merge?.();
            // Rebuild once from mesh data to reduce coplanar seam leftovers that
            // can surface as duplicate slice segments after view/anchor changes.
            stitchedSolid = runtime.Manifold.ofMesh(resultMesh);
            stitchedMesh = stitchedSolid.getMesh();
            stitchedMesh.merge?.();
            const mesh = fromManifoldMeshData(stitchedMesh);
            return {
                newMeshId: `${input.meshId}:${this.options.idPrefix}:${++this.commitSeq}`,
                mesh,
                triangleCount: mesh.indices.length / 3,
                elapsedMs: nowMs() - t0,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`ManifoldBrushEngine3D commit failed: ${message}`);
        }
        finally {
            safeDeleteMany([stitchedMesh, stitchedSolid, resultMesh, resultSolid, cutterWorld, cutterLocal, brushCrossSection, sourceSolid, sourceMeshObj]);
        }
    }
}
export function createBrushEngine3D(options = {}) {
    if (options.backend === 'approx') {
        return new ApproxBrushEngine3D(options);
    }
    return new ManifoldBrushEngine3D(options);
}
//# sourceMappingURL=brush-engine-3d.js.map