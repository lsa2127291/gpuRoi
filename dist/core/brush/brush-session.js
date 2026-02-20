import { BrushStrokeBuilder } from './brush-stroke';
function cloneSegment(seg) {
    return {
        a: { x: seg.a.x, y: seg.a.y },
        b: { x: seg.b.x, y: seg.b.y },
    };
}
function cloneSegments(segments) {
    return segments.map(cloneSegment);
}
function emptyPreview(segments) {
    return {
        nextSegments: cloneSegments(segments),
        dirtyBoundsMm: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        stats: { segmentCount: segments.length, elapsedMs: 0 },
    };
}
export class DefaultBrushSession {
    constructor(initialSegments, deps) {
        this.strokeBuilder = new BrushStrokeBuilder();
        this.state = 'idle';
        this.preStrokeSnapshot = [];
        this.lastPreview = null;
        this.previewToken = 0;
        this.commitPromise = null;
        this.pendingInvalidateReason = null;
        this.invalidatedReason = 'meshChanged';
        this.baseSegments = cloneSegments(initialSegments);
        this.deps = deps;
    }
    get currentState() {
        return this.state;
    }
    getCurrentSegments() {
        if (this.lastPreview) {
            return cloneSegments(this.lastPreview.nextSegments);
        }
        return cloneSegments(this.baseSegments);
    }
    setBaseSegments(segments) {
        this.baseSegments = cloneSegments(segments);
        if (this.state === 'idle' || this.state === 'invalidated') {
            this.lastPreview = emptyPreview(this.baseSegments);
            this.deps.onPreview?.(this.lastPreview);
        }
    }
    beginStroke(point, radiusMm, mode) {
        if (this.state !== 'idle') {
            throw new Error(`Cannot begin stroke while state=${this.state}`);
        }
        this.preStrokeSnapshot = cloneSegments(this.baseSegments);
        this.lastPreview = null;
        this.previewToken = 0;
        this.strokeBuilder.begin(point, radiusMm, mode);
        this.transitionTo('drawing');
    }
    appendPoint(point) {
        if (this.state !== 'drawing')
            return null;
        this.strokeBuilder.append(point);
        const token = ++this.previewToken;
        const stroke = this.strokeBuilder.snapshot();
        // Always compute from preStrokeSnapshot to avoid incremental polygon
        // overlap artifacts that cause jagged edges during mousemove strokes.
        const preview = this.deps.previewEngine.preview({
            baseSegments: this.preStrokeSnapshot,
            strokePoints: stroke.points,
            radiusMm: stroke.radiusMm,
            mode: stroke.mode,
        });
        if (token !== this.previewToken) {
            return null;
        }
        this.lastPreview = preview;
        this.deps.onPreview?.(preview);
        return preview;
    }
    async endStroke() {
        if (this.state !== 'drawing') {
            throw new Error(`Cannot commit stroke while state=${this.state}`);
        }
        if (this.commitPromise) {
            throw new Error('Commit is already running (single-flight)');
        }
        const stroke = this.strokeBuilder.snapshot();
        if (!this.lastPreview) {
            this.lastPreview = this.deps.previewEngine.preview({
                baseSegments: this.preStrokeSnapshot,
                strokePoints: stroke.points,
                radiusMm: stroke.radiusMm,
                mode: stroke.mode,
            });
            this.deps.onPreview?.(this.lastPreview);
        }
        this.transitionTo('committing');
        const commitInput = {
            ...this.deps.createCommitInput(stroke),
            stroke,
        };
        this.commitPromise = this.deps.commitEngine.commit(commitInput);
        try {
            const result = await this.commitPromise;
            this.baseSegments = cloneSegments(this.lastPreview.nextSegments);
            this.deps.onCommitSuccess?.(result);
            this.finishStrokeToIdle();
            return result;
        }
        catch (error) {
            this.baseSegments = cloneSegments(this.preStrokeSnapshot);
            const rollbackPreview = emptyPreview(this.baseSegments);
            this.lastPreview = rollbackPreview;
            this.deps.onPreview?.(rollbackPreview);
            this.deps.onCommitFail?.(error);
            this.finishStrokeToIdle();
            throw error;
        }
        finally {
            this.commitPromise = null;
        }
    }
    cancelStroke() {
        if (this.state !== 'drawing')
            return;
        this.baseSegments = cloneSegments(this.preStrokeSnapshot);
        this.lastPreview = emptyPreview(this.baseSegments);
        this.deps.onPreview?.(this.lastPreview);
        this.finishStrokeToIdle();
    }
    invalidate(reason) {
        if (this.state === 'drawing' || this.state === 'committing') {
            this.pendingInvalidateReason = reason;
            return;
        }
        this.invalidatedReason = reason;
        this.transitionTo('invalidated');
    }
    async resliceIfNeeded() {
        if (this.state !== 'invalidated')
            return;
        const reason = this.invalidatedReason;
        if (!this.deps.requestReslice) {
            this.transitionTo('idle');
            return;
        }
        const segments = await this.deps.requestReslice(reason);
        this.baseSegments = cloneSegments(segments);
        this.lastPreview = emptyPreview(this.baseSegments);
        this.deps.onPreview?.(this.lastPreview);
        this.transitionTo('idle');
    }
    finishStrokeToIdle() {
        this.strokeBuilder.clear();
        this.preStrokeSnapshot = [];
        this.previewToken = 0;
        if (this.pendingInvalidateReason) {
            this.invalidatedReason = this.pendingInvalidateReason;
            this.pendingInvalidateReason = null;
            this.transitionTo('invalidated');
            return;
        }
        this.transitionTo('idle');
    }
    transitionTo(next) {
        if (next === this.state)
            return;
        const prev = this.state;
        this.state = next;
        this.deps.onStateChange?.(next, prev);
    }
}
export function createBrushSession(initialSegments, deps) {
    return new DefaultBrushSession(initialSegments, deps);
}
//# sourceMappingURL=brush-session.js.map