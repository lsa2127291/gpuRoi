import type { Segment2D } from '@/core/brush/brush-types';
export interface WebGPULineRenderer {
    setSegments(segments: Segment2D[]): void;
    render(): void;
    dispose(): void;
}
export interface WebGPULineRendererOptions {
    color?: string;
    lineWidthPx?: number;
    scale?: number;
    clearBeforeRender?: boolean;
    alpha?: number;
}
export declare class CanvasWebGPULineRenderer implements WebGPULineRenderer {
    private readonly ctx;
    private readonly canvas;
    private color;
    private lineWidthPx;
    private scale;
    private alpha;
    private clearBeforeRender;
    private segments;
    private disposed;
    constructor(canvas: HTMLCanvasElement, options?: WebGPULineRendererOptions);
    setSegments(segments: Segment2D[]): void;
    setScale(scale: number): void;
    setStyle(style: {
        color?: string;
        lineWidthPx?: number;
        alpha?: number;
        clearBeforeRender?: boolean;
    }): void;
    render(): void;
    dispose(): void;
}
//# sourceMappingURL=webgpu-line-renderer.d.ts.map