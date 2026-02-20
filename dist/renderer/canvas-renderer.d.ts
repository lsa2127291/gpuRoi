import type { Segment2D, RenderStyle } from '@/types';
/**
 * Canvas 2D 渲染器
 * 职责单一：接收 2D 线段数组，绘制到 Canvas 上
 */
export declare class CanvasRenderer {
    private readonly canvas;
    private readonly ctx;
    private style;
    constructor(canvas: HTMLCanvasElement, style?: Partial<RenderStyle>);
    get width(): number;
    get height(): number;
    get scale(): number;
    /** 更新渲染样式 */
    setStyle(style: Partial<RenderStyle>): void;
    /** 清空画布 */
    clear(): void;
    /** 绘制 2D 线段数组 */
    drawSegments(segments: Segment2D[]): void;
}
//# sourceMappingURL=canvas-renderer.d.ts.map