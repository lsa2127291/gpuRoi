import type { BrushMode, Segment2D, Vec2 } from '@/core/brush/brush-types';
export interface BrushOverlayRendererOptions {
    scale: number;
    activeColor?: string;
    brushColor?: string;
    activeLineWidthPx?: number;
    showBrushTrail?: boolean;
    autoCloseBitmaps?: boolean;
}
export declare class BrushOverlayRenderer {
    private readonly canvas;
    private readonly ctx;
    private readonly lineRenderer;
    private scale;
    private brushColor;
    private readonly showBrushTrail;
    private activeSegments;
    private backgroundBitmap;
    private activeBitmap;
    private readonly autoCloseBitmaps;
    constructor(canvas: HTMLCanvasElement, options: BrushOverlayRendererOptions);
    setScale(scale: number): void;
    setBrushColor(color: string): void;
    setBackgroundBitmap(bitmap: ImageBitmap | null): void;
    setActiveBitmap(bitmap: ImageBitmap | null): void;
    setActiveSegments(segments: Segment2D[]): void;
    renderStatic(): void;
    renderPreview(previewSegments: Segment2D[], brushPolygon: Vec2[], mode: BrushMode): void;
    renderCursor(point: Vec2, radiusMm: number, _mode: BrushMode): void;
    renderCommittedActive(segments: Segment2D[]): void;
    clear(): void;
    dispose(): void;
    private drawBrushPolygon;
    private mmToCanvas;
    private withAlpha;
}
//# sourceMappingURL=brush-overlay-renderer.d.ts.map