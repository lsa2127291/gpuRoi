import type { Segment3D, Vec3 } from '@/types';
export interface SliceSegmentEntry {
    start: Vec3;
    end: Vec3;
    meshIndex: number;
}
export interface SliceSegmentNormalizeOptions {
    zeroLengthEpsilonMm?: number;
    pointMergeEpsilonMm?: number;
}
export declare function normalizeSliceSegmentEntries(entries: SliceSegmentEntry[], options?: SliceSegmentNormalizeOptions): SliceSegmentEntry[];
export declare function normalizeSliceSegments(segments: Segment3D[], options?: SliceSegmentNormalizeOptions): Segment3D[];
//# sourceMappingURL=slice-segment-normalizer.d.ts.map