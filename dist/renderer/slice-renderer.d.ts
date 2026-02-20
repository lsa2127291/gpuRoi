import type { MeshData, CameraData, Vec3, SliceResult } from '@/types';
/**
 * SliceRenderer 主类
 * 整合切割算法（GPU/CPU）、坐标转换、Canvas 渲染
 */
export declare class SliceRenderer {
    private canvasRenderer;
    private slicer;
    private initPromise;
    private camera;
    private anchor;
    private lastResult;
    private renderPending;
    constructor(canvas: HTMLCanvasElement);
    /** 当前使用的后端 */
    get backend(): 'gpu' | 'cpu' | 'pending';
    /** 等待初始化完成 */
    ready(): Promise<void>;
    /** 初始化或更新 Mesh */
    setMesh(data: MeshData): Promise<void>;
    /** 更新切割参数并触发重绘 */
    updateSlice(camera: CameraData, anchor: Vec3): Promise<void>;
    /** 设置渲染参数 */
    setRenderStyle(color: string, width: number, scale: number): Promise<void>;
    /** 获取最近一次切割结果 */
    getLastResult(): SliceResult | null;
    /** 释放资源 */
    dispose(): void;
    private initSlicer;
    /** 核心渲染流程：切割 → 投影 → 绘制 */
    private render;
}
//# sourceMappingURL=slice-renderer.d.ts.map