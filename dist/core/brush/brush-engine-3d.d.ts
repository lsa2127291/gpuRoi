import type { CommitInput, CommitOutput, Vec2 } from './brush-types';
import type { Vec3 } from '@/types';
export interface BrushEngine3D {
    commit(input: CommitInput): Promise<CommitOutput>;
}
export interface BrushEngine3DOptions {
    backend?: 'manifold' | 'approx';
    displacementScaleMm?: number;
    falloffMm?: number;
    brushContourPoints?: number;
    cutterDepthMm?: number;
    cutterDepthPaddingMm?: number;
    idPrefix?: string;
}
interface PlaneBasis {
    normal: Vec3;
    anchor: Vec3;
    xAxis: Vec3;
    yAxis: Vec3;
}
export declare function mapStrokeTo3D(points: Vec2[], basis: PlaneBasis): Vec3[];
export declare class ApproxBrushEngine3D implements BrushEngine3D {
    private readonly options;
    private commitSeq;
    constructor(options?: BrushEngine3DOptions);
    commit(input: CommitInput): Promise<CommitOutput>;
}
export declare class ManifoldBrushEngine3D implements BrushEngine3D {
    private readonly options;
    private commitSeq;
    constructor(options?: BrushEngine3DOptions);
    commit(input: CommitInput): Promise<CommitOutput>;
}
export declare function createBrushEngine3D(options?: BrushEngine3DOptions): BrushEngine3D;
export {};
//# sourceMappingURL=brush-engine-3d.d.ts.map