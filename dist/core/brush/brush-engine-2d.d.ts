import type { PreviewInput, PreviewOutput, Vec2 } from './brush-types';
import type { BrushClipper2D } from './clipper2-wasm-adapter';
interface IntPoint {
    x: number;
    y: number;
}
export interface BrushEngine2DOptions {
    epsilonMm?: number;
    minDistanceMm?: number;
    zeroLengthEpsilonMm?: number;
    pointMergeEpsilonMm?: number;
    brushContourPoints?: number;
    arcSteps?: number;
    clipperAdapter?: BrushClipper2D;
}
export interface BrushEngine2D {
    preview(input: PreviewInput): PreviewOutput;
}
export declare function toClipperPath(points: Vec2[], scale?: number): IntPoint[];
export declare function fromClipperPath(path: IntPoint[], scale?: number): Vec2[];
export declare class DefaultBrushEngine2D implements BrushEngine2D {
    private readonly options;
    constructor(options?: BrushEngine2DOptions);
    preview(input: PreviewInput): PreviewOutput;
}
export declare function createBrushEngine2D(options?: BrushEngine2DOptions): BrushEngine2D;
export declare function createBrushEngine2DWithClipper2Wasm(options?: Omit<BrushEngine2DOptions, 'clipperAdapter'>): Promise<BrushEngine2D>;
export {};
//# sourceMappingURL=brush-engine-2d.d.ts.map