import type { BrushMode, BrushSessionState, BrushStroke, CommitInput, CommitOutput, InvalidateReason, PreviewOutput, Segment2D, Vec2 } from './brush-types';
import type { BrushEngine2D } from './brush-engine-2d';
import type { BrushEngine3D } from './brush-engine-3d';
export interface BrushSession {
    readonly currentState: BrushSessionState;
    getCurrentSegments(): Segment2D[];
    setBaseSegments(segments: Segment2D[]): void;
    beginStroke(point: Vec2, radiusMm: number, mode: BrushMode): void;
    appendPoint(point: Vec2): PreviewOutput | null;
    endStroke(): Promise<CommitOutput>;
    cancelStroke(): void;
    invalidate(reason: InvalidateReason): void;
    resliceIfNeeded(): Promise<void>;
}
export interface BrushSessionDeps {
    previewEngine: BrushEngine2D;
    commitEngine: BrushEngine3D;
    createCommitInput: (stroke: BrushStroke) => Omit<CommitInput, 'stroke'>;
    requestReslice?: (reason: InvalidateReason) => Promise<Segment2D[]>;
    onPreview?: (preview: PreviewOutput) => void;
    onCommitSuccess?: (result: CommitOutput) => void;
    onCommitFail?: (error: unknown) => void;
    onStateChange?: (next: BrushSessionState, prev: BrushSessionState) => void;
}
export declare class DefaultBrushSession implements BrushSession {
    private readonly deps;
    private readonly strokeBuilder;
    private state;
    private baseSegments;
    private preStrokeSnapshot;
    private lastPreview;
    private previewToken;
    private commitPromise;
    private pendingInvalidateReason;
    private invalidatedReason;
    constructor(initialSegments: Segment2D[], deps: BrushSessionDeps);
    get currentState(): BrushSessionState;
    getCurrentSegments(): Segment2D[];
    setBaseSegments(segments: Segment2D[]): void;
    beginStroke(point: Vec2, radiusMm: number, mode: BrushMode): void;
    appendPoint(point: Vec2): PreviewOutput | null;
    endStroke(): Promise<CommitOutput>;
    cancelStroke(): void;
    invalidate(reason: InvalidateReason): void;
    resliceIfNeeded(): Promise<void>;
    private finishStrokeToIdle;
    private transitionTo;
}
export declare function createBrushSession(initialSegments: Segment2D[], deps: BrushSessionDeps): BrushSession;
//# sourceMappingURL=brush-session.d.ts.map