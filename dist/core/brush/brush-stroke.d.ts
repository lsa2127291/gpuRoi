import type { BrushMode, BrushStroke, Vec2 } from './brush-types';
export interface StrokeSimplifyOptions {
    epsilonMm?: number;
    minDistanceMm?: number;
}
export declare function cloneVec2(p: Vec2): Vec2;
export declare function distanceSquared2D(a: Vec2, b: Vec2): number;
export declare function simplifyStrokePoints(points: Vec2[], options?: StrokeSimplifyOptions): Vec2[];
export declare function createBrushStroke(points: Vec2[], radiusMm: number, mode: BrushMode, options?: StrokeSimplifyOptions): BrushStroke;
export declare class BrushStrokeBuilder {
    private points;
    private radiusMm;
    private mode;
    private readonly options;
    constructor(options?: StrokeSimplifyOptions);
    begin(point: Vec2, radiusMm: number, mode: BrushMode): void;
    append(point: Vec2): boolean;
    snapshot(): BrushStroke;
    clear(): void;
    get rawPoints(): Vec2[];
}
//# sourceMappingURL=brush-stroke.d.ts.map