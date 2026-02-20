import type { MeshData, Vec3 } from '@/types';
export declare const CLIPPER_SCALE = 1000;
export declare const BRUSH_PRECISION_MM = 0.1;
export declare const BRUSH_MAX_RADIUS_MM = 50;
export declare const BRUSH_MIN_RADIUS_MM = 0.1;
export type BrushMode = 'add' | 'erase';
export interface Vec2 {
    x: number;
    y: number;
}
export interface Segment2D {
    a: Vec2;
    b: Vec2;
}
export interface BrushStroke {
    points: Vec2[];
    simplified: Vec2[];
    radiusMm: number;
    mode: BrushMode;
}
export interface BrushDirtyBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export interface PreviewInput {
    baseSegments: Segment2D[];
    strokePoints: Vec2[];
    radiusMm: number;
    mode: BrushMode;
}
export interface PreviewOutput {
    nextSegments: Segment2D[];
    dirtyBoundsMm: BrushDirtyBounds;
    stats: {
        segmentCount: number;
        elapsedMs: number;
    };
    brushPolygon2D?: Vec2[];
    strokeSimplified?: Vec2[];
}
export interface SlicePlane {
    normal: Vec3;
    anchor: Vec3;
    xAxis?: Vec3;
    yAxis?: Vec3;
}
export interface CommitInput {
    meshId: string;
    mesh: MeshData;
    stroke: BrushStroke;
    slicePlane: SlicePlane;
}
export interface CommitOutput {
    newMeshId: string;
    mesh: MeshData;
    triangleCount: number;
    elapsedMs: number;
}
export type BrushSessionState = 'idle' | 'drawing' | 'committing' | 'invalidated';
export type InvalidateReason = 'cameraRotate' | 'anchorScroll' | 'meshChanged';
//# sourceMappingURL=brush-types.d.ts.map