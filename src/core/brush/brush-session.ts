import type {
  BrushMode,
  BrushSessionState,
  BrushStroke,
  CommitInput,
  CommitOutput,
  InvalidateReason,
  PreviewOutput,
  Segment2D,
  Vec2,
} from './brush-types'
import type { BrushEngine2D } from './brush-engine-2d'
import type { BrushEngine3D } from './brush-engine-3d'
import { BrushStrokeBuilder } from './brush-stroke'

export interface BrushSession {
  readonly currentState: BrushSessionState
  getCurrentSegments(): Segment2D[]
  setBaseSegments(segments: Segment2D[]): void
  beginStroke(point: Vec2, radiusMm: number, mode: BrushMode): void
  appendPoint(point: Vec2): PreviewOutput | null
  endStroke(): Promise<CommitOutput>
  cancelStroke(): void
  invalidate(reason: InvalidateReason): void
  resliceIfNeeded(): Promise<void>
}

export interface BrushSessionDeps {
  previewEngine: BrushEngine2D
  commitEngine: BrushEngine3D
  createCommitInput: (stroke: BrushStroke) => Omit<CommitInput, 'stroke'>
  requestReslice?: (reason: InvalidateReason) => Promise<Segment2D[]>
  onPreview?: (preview: PreviewOutput) => void
  onCommitSuccess?: (result: CommitOutput) => void
  onCommitFail?: (error: unknown) => void
  onStateChange?: (next: BrushSessionState, prev: BrushSessionState) => void
}

function cloneSegment(seg: Segment2D): Segment2D {
  return {
    a: { x: seg.a.x, y: seg.a.y },
    b: { x: seg.b.x, y: seg.b.y },
  }
}

function cloneSegments(segments: Segment2D[]): Segment2D[] {
  return segments.map(cloneSegment)
}

function emptyPreview(segments: Segment2D[]): PreviewOutput {
  return {
    nextSegments: cloneSegments(segments),
    dirtyBoundsMm: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    stats: { segmentCount: segments.length, elapsedMs: 0 },
  }
}

export class DefaultBrushSession implements BrushSession {
  private readonly deps: BrushSessionDeps
  private readonly strokeBuilder = new BrushStrokeBuilder()

  private state: BrushSessionState = 'idle'
  private baseSegments: Segment2D[]
  private preStrokeSnapshot: Segment2D[] = []
  private lastPreview: PreviewOutput | null = null
  private previewToken = 0
  private commitPromise: Promise<CommitOutput> | null = null
  private pendingInvalidateReason: InvalidateReason | null = null
  private invalidatedReason: InvalidateReason = 'meshChanged'

  constructor(initialSegments: Segment2D[], deps: BrushSessionDeps) {
    this.baseSegments = cloneSegments(initialSegments)
    this.deps = deps
  }

  get currentState(): BrushSessionState {
    return this.state
  }

  getCurrentSegments(): Segment2D[] {
    if (this.lastPreview) {
      return cloneSegments(this.lastPreview.nextSegments)
    }
    return cloneSegments(this.baseSegments)
  }

  setBaseSegments(segments: Segment2D[]): void {
    this.baseSegments = cloneSegments(segments)
    if (this.state === 'idle' || this.state === 'invalidated') {
      this.lastPreview = emptyPreview(this.baseSegments)
      this.deps.onPreview?.(this.lastPreview)
      if (this.state === 'invalidated') {
        // External reslice/update already provided fresh base data.
        this.transitionTo('idle')
      }
    }
  }

  beginStroke(point: Vec2, radiusMm: number, mode: BrushMode): void {
    if (this.state !== 'idle') {
      throw new Error(`Cannot begin stroke while state=${this.state}`)
    }

    this.preStrokeSnapshot = cloneSegments(this.baseSegments)
    this.lastPreview = null
    this.previewToken = 0
    this.strokeBuilder.begin(point, radiusMm, mode)
    this.transitionTo('drawing')
  }

  appendPoint(point: Vec2): PreviewOutput | null {
    if (this.state !== 'drawing') return null

    const appended = this.strokeBuilder.append(point)
    if (!appended && this.lastPreview) {
      // Skip no-op points once preview has started.
      return null
    }

    const token = ++this.previewToken
    const stroke = this.strokeBuilder.snapshot()
    const incrementalPoints = this.lastPreview && stroke.points.length >= 2
      ? stroke.points.slice(stroke.points.length - 2)
      : stroke.points
    const previewBaseSegments = this.lastPreview
      ? this.lastPreview.nextSegments
      : this.preStrokeSnapshot

    // Use incremental preview after the first brush stamp to keep mousemove
    // latency stable for long strokes.
    const preview = this.deps.previewEngine.preview({
      baseSegments: previewBaseSegments,
      strokePoints: incrementalPoints,
      radiusMm: stroke.radiusMm,
      mode: stroke.mode,
    })

    if (token !== this.previewToken) {
      return null
    }

    this.lastPreview = preview
    this.deps.onPreview?.(preview)
    return preview
  }

  async endStroke(): Promise<CommitOutput> {
    if (this.state !== 'drawing') {
      throw new Error(`Cannot commit stroke while state=${this.state}`)
    }
    if (this.commitPromise) {
      throw new Error('Commit is already running (single-flight)')
    }

    const stroke = this.strokeBuilder.snapshot()
    if (!this.lastPreview) {
      this.lastPreview = this.deps.previewEngine.preview({
        baseSegments: this.preStrokeSnapshot,
        strokePoints: stroke.points,
        radiusMm: stroke.radiusMm,
        mode: stroke.mode,
      })
      this.deps.onPreview?.(this.lastPreview)
    }

    this.transitionTo('committing')

    const commitInput = {
      ...this.deps.createCommitInput(stroke),
      stroke,
    }

    this.commitPromise = this.deps.commitEngine.commit(commitInput)

    try {
      const result = await this.commitPromise
      this.baseSegments = cloneSegments(this.lastPreview.nextSegments)
      this.deps.onCommitSuccess?.(result)
      this.finishStrokeToIdle()
      return result
    } catch (error) {
      this.baseSegments = cloneSegments(this.preStrokeSnapshot)
      const rollbackPreview = emptyPreview(this.baseSegments)
      this.lastPreview = rollbackPreview
      this.deps.onPreview?.(rollbackPreview)
      this.deps.onCommitFail?.(error)
      this.finishStrokeToIdle()
      throw error
    } finally {
      this.commitPromise = null
    }
  }

  cancelStroke(): void {
    if (this.state !== 'drawing') return

    this.baseSegments = cloneSegments(this.preStrokeSnapshot)
    this.lastPreview = emptyPreview(this.baseSegments)
    this.deps.onPreview?.(this.lastPreview)
    this.finishStrokeToIdle()
  }

  invalidate(reason: InvalidateReason): void {
    if (this.state === 'drawing' || this.state === 'committing') {
      this.pendingInvalidateReason = reason
      return
    }

    this.invalidatedReason = reason
    this.transitionTo('invalidated')
  }

  async resliceIfNeeded(): Promise<void> {
    if (this.state !== 'invalidated') return

    const reason = this.invalidatedReason
    if (!this.deps.requestReslice) {
      this.transitionTo('idle')
      return
    }

    const segments = await this.deps.requestReslice(reason)
    this.baseSegments = cloneSegments(segments)
    this.lastPreview = emptyPreview(this.baseSegments)
    this.deps.onPreview?.(this.lastPreview)
    this.transitionTo('idle')
  }

  private finishStrokeToIdle(): void {
    this.strokeBuilder.clear()
    this.preStrokeSnapshot = []
    this.previewToken = 0

    if (this.pendingInvalidateReason) {
      this.invalidatedReason = this.pendingInvalidateReason
      this.pendingInvalidateReason = null
      this.transitionTo('invalidated')
      return
    }

    this.transitionTo('idle')
  }

  private transitionTo(next: BrushSessionState): void {
    if (next === this.state) return
    const prev = this.state
    this.state = next
    this.deps.onStateChange?.(next, prev)
  }
}

export function createBrushSession(
  initialSegments: Segment2D[],
  deps: BrushSessionDeps,
): BrushSession {
  return new DefaultBrushSession(initialSegments, deps)
}
