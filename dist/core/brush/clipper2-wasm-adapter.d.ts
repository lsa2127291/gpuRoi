import type { BrushMode, Segment2D, Vec2 } from './brush-types';
export interface Clipper2BrushAdapterOptions {
    precisionDigits?: number;
    miterLimit?: number;
    arcTolerance?: number;
}
export interface BrushClipper2D {
    inflateStrokeToPolygon(strokePoints: Vec2[], radiusMm: number): Vec2[];
    applyBoolean(baseSegments: Segment2D[], brushPolygon: Vec2[], mode: BrushMode): Segment2D[];
}
export declare function createClipper2WasmBrushAdapter(options?: Clipper2BrushAdapterOptions): Promise<BrushClipper2D>;
//# sourceMappingURL=clipper2-wasm-adapter.d.ts.map