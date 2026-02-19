import type { MeshData, CameraData, Vec3, SliceResult } from '@/types'
import type { MeshSlicer } from '@/core/slicer-interface'
import { createSlicer } from '@/core/create-slicer'
import { buildLocalBasis, projectSegments } from '@/core/projection'
import { CanvasRenderer } from '@/renderer/canvas-renderer'

/**
 * SliceRenderer 主类
 * 整合切割算法（GPU/CPU）、坐标转换、Canvas 渲染
 */
export class SliceRenderer {
  private canvasRenderer: CanvasRenderer
  private slicer: MeshSlicer | null = null
  private initPromise: Promise<void> | null = null
  private camera: CameraData | null = null
  private anchor: Vec3 = [0, 0, 0]
  private lastResult: SliceResult | null = null
  private renderPending = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvasRenderer = new CanvasRenderer(canvas)
    this.initPromise = this.initSlicer()
  }

  /** 当前使用的后端 */
  get backend(): 'gpu' | 'cpu' | 'pending' {
    return this.slicer?.backend ?? 'pending'
  }

  /** 等待初始化完成 */
  async ready(): Promise<void> {
    await this.initPromise
  }

  /** 初始化或更新 Mesh */
  async setMesh(data: MeshData): Promise<void> {
    await this.initPromise
    await this.slicer!.init(data)
    await this.render()
  }

  /** 更新切割参数并触发重绘 */
  async updateSlice(camera: CameraData, anchor: Vec3): Promise<void> {
    this.camera = camera
    this.anchor = anchor
    await this.render()
  }

  /** 设置渲染参数 */
  async setRenderStyle(color: string, width: number, scale: number): Promise<void> {
    this.canvasRenderer.setStyle({ color, lineWidth: width, scale })
    await this.render()
  }

  /** 获取最近一次切割结果 */
  getLastResult(): SliceResult | null {
    return this.lastResult
  }

  /** 释放资源 */
  dispose(): void {
    this.slicer?.dispose()
    this.slicer = null
  }

  private async initSlicer(): Promise<void> {
    this.slicer = await createSlicer()
  }

  /** 核心渲染流程：切割 → 投影 → 绘制 */
  private async render(): Promise<void> {
    if (!this.slicer || !this.camera) {
      this.canvasRenderer.clear()
      this.lastResult = null
      return
    }

    // 防止并发渲染，只保留最新一次
    if (this.renderPending) return
    this.renderPending = true

    try {
      // 1. 切割
      const segments3D = await this.slicer.slice(
        this.camera.viewPlaneNormal,
        this.anchor,
      )

      // 2. 投影
      const basis = buildLocalBasis(
        this.camera.viewPlaneNormal,
        this.camera.viewUp,
      )
      const segments2D = projectSegments(
        segments3D,
        this.anchor,
        basis,
        this.canvasRenderer.width,
        this.canvasRenderer.height,
        this.canvasRenderer.scale,
      )

      this.lastResult = { segments3D, segments2D }

      // 3. 绘制
      this.canvasRenderer.drawSegments(segments2D)
    } finally {
      this.renderPending = false
    }
  }
}
