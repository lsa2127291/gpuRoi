import type { Segment2D, RenderStyle } from '@/types'

const DEFAULT_STYLE: RenderStyle = {
  color: '#ff0000',
  lineWidth: 2,
  scale: 1,
}

/**
 * Canvas 2D 渲染器
 * 职责单一：接收 2D 线段数组，绘制到 Canvas 上
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private style: RenderStyle

  constructor(
    private readonly canvas: HTMLCanvasElement,
    style?: Partial<RenderStyle>,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get Canvas 2D context')
    this.ctx = ctx
    this.style = { ...DEFAULT_STYLE, ...style }
  }

  get width(): number {
    return this.canvas.width
  }

  get height(): number {
    return this.canvas.height
  }

  get scale(): number {
    return this.style.scale
  }

  /** 更新渲染样式 */
  setStyle(style: Partial<RenderStyle>): void {
    this.style = { ...this.style, ...style }
  }

  /** 清空画布 */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /** 绘制 2D 线段数组 */
  drawSegments(segments: Segment2D[]): void {
    this.clear()

    const { ctx } = this
    ctx.strokeStyle = this.style.color
    ctx.lineWidth = this.style.lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    for (const seg of segments) {
      ctx.moveTo(seg.start[0], seg.start[1])
      ctx.lineTo(seg.end[0], seg.end[1])
    }
    ctx.stroke()
  }
}
