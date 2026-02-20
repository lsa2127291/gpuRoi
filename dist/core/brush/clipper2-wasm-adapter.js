// @ts-expect-error vite resolves wasm asset url from dependency path.
import clipper2WasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
const DEFAULT_PRECISION_DIGITS = 3;
const DEFAULT_MITER_LIMIT = 2;
const DEFAULT_ARC_TOLERANCE = 0;
const SEGMENT_KEY_SCALE = 1000;
const SINGLE_POINT_CIRCLE_STEPS = 24;
let clipper2ModulePromise = null;
function safeDelete(target) {
    if (!target || typeof target.delete !== 'function')
        return;
    target.delete();
}
function isValidWasmBinary(bytes) {
    return bytes.length >= 4 &&
        bytes[0] === 0x00 &&
        bytes[1] === 0x61 &&
        bytes[2] === 0x73 &&
        bytes[3] === 0x6d;
}
function cloneSegment(seg) {
    return {
        a: { x: seg.a.x, y: seg.a.y },
        b: { x: seg.b.x, y: seg.b.y },
    };
}
function cloneVec2(p) {
    return { x: p.x, y: p.y };
}
function buildCirclePolygon(center, radiusMm, steps = SINGLE_POINT_CIRCLE_STEPS) {
    const polygon = [];
    const n = Math.max(8, steps);
    for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n;
        polygon.push({
            x: center.x + Math.cos(angle) * radiusMm,
            y: center.y + Math.sin(angle) * radiusMm,
        });
    }
    return polygon;
}
function pointKey(p) {
    return `${Math.round(p.x * SEGMENT_KEY_SCALE)},${Math.round(p.y * SEGMENT_KEY_SCALE)}`;
}
function snapVec2(p) {
    return {
        x: Math.round(p.x * SEGMENT_KEY_SCALE) / SEGMENT_KEY_SCALE,
        y: Math.round(p.y * SEGMENT_KEY_SCALE) / SEGMENT_KEY_SCALE,
    };
}
function splitSegmentsForUnion(segments) {
    const edges = [];
    for (const seg of segments) {
        const a = snapVec2(seg.a);
        const b = snapVec2(seg.b);
        edges.push({
            a,
            b,
            aKey: pointKey(a),
            bKey: pointKey(b),
        });
    }
    const adjacency = new Map();
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (!adjacency.has(edge.aKey))
            adjacency.set(edge.aKey, []);
        if (!adjacency.has(edge.bKey))
            adjacency.set(edge.bKey, []);
        adjacency.get(edge.aKey).push(i);
        adjacency.get(edge.bKey).push(i);
    }
    const visited = new Array(edges.length).fill(false);
    const closedLoops = [];
    const openSegments = [];
    for (let i = 0; i < edges.length; i++) {
        if (visited[i])
            continue;
        const seed = edges[i];
        visited[i] = true;
        const startKey = seed.aKey;
        let previousKey = seed.aKey;
        let currentKey = seed.bKey;
        const pathPoints = [cloneVec2(seed.a), cloneVec2(seed.b)];
        while (true) {
            if (currentKey === startKey)
                break;
            const candidates = (adjacency.get(currentKey) ?? []).filter((edgeIdx) => !visited[edgeIdx]);
            if (candidates.length === 0)
                break;
            let nextEdgeIdx = candidates[0];
            if (candidates.length > 1) {
                const nonBacktrack = candidates.find((edgeIdx) => {
                    const edge = edges[edgeIdx];
                    const otherKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
                    return otherKey !== previousKey;
                });
                if (nonBacktrack !== undefined) {
                    nextEdgeIdx = nonBacktrack;
                }
            }
            const nextEdge = edges[nextEdgeIdx];
            visited[nextEdgeIdx] = true;
            const nextKey = nextEdge.aKey === currentKey ? nextEdge.bKey : nextEdge.aKey;
            const nextPoint = nextEdge.aKey === currentKey ? nextEdge.b : nextEdge.a;
            pathPoints.push(cloneVec2(nextPoint));
            previousKey = currentKey;
            currentKey = nextKey;
        }
        const closed = currentKey === startKey && pathPoints.length >= 4;
        if (closed) {
            const firstKey = pointKey(pathPoints[0]);
            const lastKey = pointKey(pathPoints[pathPoints.length - 1]);
            if (firstKey === lastKey) {
                pathPoints.pop();
            }
            if (pathPoints.length >= 3) {
                closedLoops.push(pathPoints);
                continue;
            }
        }
        for (let j = 0; j < pathPoints.length - 1; j++) {
            openSegments.push({
                a: cloneVec2(pathPoints[j]),
                b: cloneVec2(pathPoints[j + 1]),
            });
        }
    }
    return { closedLoops, openSegments };
}
function polygonSignedArea(points) {
    if (points.length < 3)
        return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        sum += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return sum * 0.5;
}
function largestPolygon(polygons) {
    let winner = [];
    let maxAbsArea = 0;
    for (const polygon of polygons) {
        const area = Math.abs(polygonSignedArea(polygon));
        if (area > maxAbsArea) {
            winner = polygon;
            maxAbsArea = area;
        }
    }
    return winner;
}
function polygonToSegments(polygon) {
    if (polygon.length < 2)
        return [];
    const segments = [];
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        segments.push({
            a: { x: polygon[i].x, y: polygon[i].y },
            b: { x: polygon[j].x, y: polygon[j].y },
        });
    }
    return segments;
}
class Clipper2WasmBrushAdapter {
    constructor(module, options) {
        this.module = module;
        this.precisionDigits = options.precisionDigits ?? DEFAULT_PRECISION_DIGITS;
        this.miterLimit = options.miterLimit ?? DEFAULT_MITER_LIMIT;
        this.arcTolerance = options.arcTolerance ?? DEFAULT_ARC_TOLERANCE;
    }
    inflateStrokeToPolygon(strokePoints, radiusMm) {
        if (strokePoints.length === 0 || radiusMm <= 0)
            return [];
        if (strokePoints.length === 1) {
            return buildCirclePolygon(strokePoints[0], radiusMm);
        }
        const inputPaths = this.createPaths([strokePoints]);
        try {
            const inflated = this.module.InflatePathsD(inputPaths, radiusMm, this.module.JoinType.Round, this.module.EndType.Round, this.miterLimit, this.arcTolerance, this.precisionDigits);
            try {
                const polygons = this.readPaths(inflated);
                return largestPolygon(polygons);
            }
            finally {
                safeDelete(inflated);
            }
        }
        finally {
            safeDelete(inputPaths);
        }
    }
    applyBoolean(baseSegments, brushPolygon, mode) {
        if (brushPolygon.length < 3) {
            return baseSegments.map(cloneSegment);
        }
        if (mode === 'add') {
            return this.addWithUnion(baseSegments, brushPolygon);
        }
        return this.eraseWithDifference(baseSegments, brushPolygon);
    }
    createClipperInstance() {
        try {
            return new this.module.ClipperD();
        }
        catch (constructorError) {
            if (typeof this.module.CreateClipperD === 'function') {
                try {
                    return this.module.CreateClipperD(true);
                }
                catch (factoryError) {
                    throw new Error(`Failed to create ClipperD instance via ctor/factory. ctor=${constructorError instanceof Error ? constructorError.message : String(constructorError)}, factory=${factoryError instanceof Error ? factoryError.message : String(factoryError)}`);
                }
            }
            throw constructorError;
        }
    }
    addWithUnion(baseSegments, brushPolygon) {
        const split = splitSegmentsForUnion(baseSegments);
        if (split.closedLoops.length === 0) {
            const merged = baseSegments.map(cloneSegment);
            merged.push(...polygonToSegments(brushPolygon));
            return merged;
        }
        const closedSubject = this.createPaths(split.closedLoops);
        const openSubject = this.createPaths(split.openSegments.map((seg) => [seg.a, seg.b]));
        const clipPaths = this.createPaths([brushPolygon]);
        const clipper = this.createClipperInstance();
        const closedSolution = new this.module.PathsD();
        const openSolution = new this.module.PathsD();
        try {
            clipper.SetPreserveCollinear(true);
            clipper.AddSubject(closedSubject);
            if (split.openSegments.length > 0) {
                clipper.AddOpenSubject(openSubject);
            }
            clipper.AddClip(clipPaths);
            const succeeded = clipper.ExecutePath(this.module.ClipType.Union, this.module.FillRule.NonZero, closedSolution, openSolution);
            if (!succeeded) {
                throw new Error('Clipper2 union ExecutePath failed');
            }
            const resultSegments = split.openSegments.map(cloneSegment);
            const closedPolygons = this.readPaths(closedSolution);
            for (const polygon of closedPolygons) {
                resultSegments.push(...polygonToSegments(polygon));
            }
            return resultSegments;
        }
        finally {
            safeDelete(openSolution);
            safeDelete(closedSolution);
            safeDelete(clipper);
            safeDelete(clipPaths);
            safeDelete(openSubject);
            safeDelete(closedSubject);
        }
    }
    eraseWithDifference(baseSegments, brushPolygon) {
        if (baseSegments.length === 0)
            return [];
        const openSubject = this.createPaths(baseSegments.map((seg) => [seg.a, seg.b]));
        const clipPaths = this.createPaths([brushPolygon]);
        const clipper = this.createClipperInstance();
        const closedSolution = new this.module.PathsD();
        const openSolution = new this.module.PathsD();
        try {
            clipper.SetPreserveCollinear(true);
            clipper.AddOpenSubject(openSubject);
            clipper.AddClip(clipPaths);
            const succeeded = clipper.ExecutePath(this.module.ClipType.Difference, this.module.FillRule.NonZero, closedSolution, openSolution);
            if (!succeeded) {
                throw new Error('Clipper2 difference ExecutePath failed');
            }
            return this.readPathsAsOpenSegments(openSolution);
        }
        finally {
            safeDelete(openSolution);
            safeDelete(closedSolution);
            safeDelete(clipper);
            safeDelete(clipPaths);
            safeDelete(openSubject);
        }
    }
    createPath(points) {
        const path = new this.module.PathD();
        for (const point of points) {
            const pointD = new this.module.PointD(point.x, point.y, 0);
            path.push_back(pointD);
            safeDelete(pointD);
        }
        return path;
    }
    createPaths(paths) {
        const out = new this.module.PathsD();
        for (const points of paths) {
            if (points.length === 0)
                continue;
            const path = this.createPath(points);
            out.push_back(path);
            safeDelete(path);
        }
        return out;
    }
    readPath(path) {
        const points = [];
        const size = path.size();
        for (let i = 0; i < size; i++) {
            const p = path.get(i);
            points.push({ x: p.x, y: p.y });
            safeDelete(p);
        }
        return points;
    }
    readPaths(paths) {
        const out = [];
        const size = paths.size();
        for (let i = 0; i < size; i++) {
            const path = paths.get(i);
            const points = this.readPath(path);
            safeDelete(path);
            if (points.length > 0) {
                out.push(points);
            }
        }
        return out;
    }
    readPathsAsOpenSegments(paths) {
        const out = [];
        const vecPaths = this.readPaths(paths);
        for (const points of vecPaths) {
            for (let i = 0; i < points.length - 1; i++) {
                out.push({
                    a: { x: points[i].x, y: points[i].y },
                    b: { x: points[i + 1].x, y: points[i + 1].y },
                });
            }
        }
        return out;
    }
}
async function loadClipper2Module() {
    // `clipper2-wasm` currently doesn't publish a resolvable ESM type entry.
    // We intentionally import runtime code directly and cast the factory.
    // @ts-expect-error third-party package ships broken type entry for this path.
    const factoryModule = await import('clipper2-wasm/dist/es/clipper2z.js');
    const factory = (factoryModule.default ?? factoryModule);
    const wasmUrl = String(clipper2WasmUrl);
    const response = await fetch(wasmUrl, { credentials: 'same-origin' });
    const wasmBuffer = await response.arrayBuffer();
    const wasmBinary = new Uint8Array(wasmBuffer);
    if (!isValidWasmBinary(wasmBinary)) {
        const header = Array.from(wasmBinary.slice(0, 4))
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(' ');
        throw new Error(`Invalid wasm binary from ${wasmUrl}, header=${header}`);
    }
    return factory({
        wasmBinary,
        locateFile: (path) => {
            if (path.includes('.wasm'))
                return wasmUrl;
            return path;
        },
    });
}
async function getClipper2Module() {
    if (!clipper2ModulePromise) {
        clipper2ModulePromise = loadClipper2Module();
    }
    return clipper2ModulePromise;
}
export async function createClipper2WasmBrushAdapter(options = {}) {
    const module = await getClipper2Module();
    return new Clipper2WasmBrushAdapter(module, options);
}
//# sourceMappingURL=clipper2-wasm-adapter.js.map