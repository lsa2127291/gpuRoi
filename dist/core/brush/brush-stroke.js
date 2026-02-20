import { BRUSH_PRECISION_MM } from './brush-types';
const DEFAULT_MIN_DISTANCE_MM = 0.05;
const EPSILON = 1e-9;
export function cloneVec2(p) {
    return { x: p.x, y: p.y };
}
export function distanceSquared2D(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
}
function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= EPSILON) {
        return Math.sqrt(distanceSquared2D(point, lineStart));
    }
    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
    const clampedT = Math.max(0, Math.min(1, t));
    const projX = lineStart.x + dx * clampedT;
    const projY = lineStart.y + dy * clampedT;
    const ddx = point.x - projX;
    const ddy = point.y - projY;
    return Math.sqrt(ddx * ddx + ddy * ddy);
}
function douglasPeucker(points, epsilonMm) {
    if (points.length <= 2) {
        return points.map(cloneVec2);
    }
    let maxDistance = -1;
    let splitIndex = -1;
    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
        if (dist > maxDistance) {
            maxDistance = dist;
            splitIndex = i;
        }
    }
    if (maxDistance <= epsilonMm || splitIndex === -1) {
        return [cloneVec2(points[0]), cloneVec2(points[points.length - 1])];
    }
    const left = douglasPeucker(points.slice(0, splitIndex + 1), epsilonMm);
    const right = douglasPeucker(points.slice(splitIndex), epsilonMm);
    return [...left.slice(0, left.length - 1), ...right];
}
function dedupeSequential(points, minDistanceMm) {
    if (points.length === 0)
        return [];
    const minDistSq = minDistanceMm * minDistanceMm;
    const result = [cloneVec2(points[0])];
    for (let i = 1; i < points.length; i++) {
        if (distanceSquared2D(result[result.length - 1], points[i]) >= minDistSq) {
            result.push(cloneVec2(points[i]));
        }
    }
    if (result.length === 1 && points.length > 1) {
        result.push(cloneVec2(points[points.length - 1]));
    }
    return result;
}
/**
 * Chaikin corner-cutting subdivision for smoothing open polylines.
 * Each iteration replaces interior corners with two points at 25%/75%
 * along each segment, preserving the first and last endpoints.
 */
function chaikinSmooth(points, iterations) {
    if (points.length <= 2 || iterations <= 0)
        return points;
    let current = points;
    for (let iter = 0; iter < iterations; iter++) {
        const next = [cloneVec2(current[0])];
        for (let i = 0; i < current.length - 1; i++) {
            const a = current[i];
            const b = current[i + 1];
            next.push({
                x: a.x * 0.75 + b.x * 0.25,
                y: a.y * 0.75 + b.y * 0.25,
            });
            next.push({
                x: a.x * 0.25 + b.x * 0.75,
                y: a.y * 0.25 + b.y * 0.75,
            });
        }
        next.push(cloneVec2(current[current.length - 1]));
        current = next;
    }
    return current;
}
export function simplifyStrokePoints(points, options = {}) {
    if (points.length === 0)
        return [];
    if (points.length === 1)
        return [cloneVec2(points[0])];
    const epsilonMm = options.epsilonMm ?? BRUSH_PRECISION_MM;
    const minDistanceMm = options.minDistanceMm ?? DEFAULT_MIN_DISTANCE_MM;
    const deduped = dedupeSequential(points, minDistanceMm);
    if (deduped.length <= 2) {
        return deduped;
    }
    const simplified = douglasPeucker(deduped, epsilonMm);
    // Smooth after simplification: removes jagged corners from mouse jitter
    return chaikinSmooth(simplified, 2);
}
export function createBrushStroke(points, radiusMm, mode, options = {}) {
    return {
        points: points.map(cloneVec2),
        simplified: simplifyStrokePoints(points, options),
        radiusMm,
        mode,
    };
}
export class BrushStrokeBuilder {
    constructor(options = {}) {
        this.points = [];
        this.radiusMm = 0;
        this.mode = 'add';
        this.options = options;
    }
    begin(point, radiusMm, mode) {
        this.points = [cloneVec2(point)];
        this.radiusMm = radiusMm;
        this.mode = mode;
    }
    append(point) {
        if (this.points.length === 0)
            return false;
        const minDistanceMm = this.options.minDistanceMm ?? DEFAULT_MIN_DISTANCE_MM;
        const minDistSq = minDistanceMm * minDistanceMm;
        if (distanceSquared2D(this.points[this.points.length - 1], point) < minDistSq) {
            return false;
        }
        this.points.push(cloneVec2(point));
        return true;
    }
    snapshot() {
        return createBrushStroke(this.points, this.radiusMm, this.mode, this.options);
    }
    clear() {
        this.points = [];
        this.radiusMm = 0;
        this.mode = 'add';
    }
    get rawPoints() {
        return this.points.map(cloneVec2);
    }
}
//# sourceMappingURL=brush-stroke.js.map