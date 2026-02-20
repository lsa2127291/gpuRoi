import type { BrushMode, Segment2D, Vec2 } from '@/core/brush/brush-types'
import { CanvasWebGPULineRenderer } from '@/core/gpu/webgpu-line-renderer'

export interface BrushOverlayRendererOptions {
  scale: number
  activeColor?: string
  brushColor?: string
  activeLineWidthPx?: number
  showBrushTrail?: boolean
  autoCloseBitmaps?: boolean
}

export class BrushOverlayRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly lineRenderer: CanvasWebGPULineRenderer
  private scale: number
  private brushColor: string
  private readonly showBrushTrail: boolean
  private activeSegments: Segment2D[] = []
  private backgroundBitmap: ImageBitmap | null = null
  private activeBitmap: ImageBitmap | null = null
  private readonly autoCloseBitmaps: boolean

  constructor(canvas: HTMLCanvasElement, options: BrushOverlayRendererOptions) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D context for BrushOverlayRenderer')

    this.canvas = canvas
    this.ctx = ctx
    this.scale = options.scale
    this.brushColor = options.brushColor ?? options.activeColor ?? '#f5f5f5'
    this.showBrushTrail = options.showBrushTrail ?? true
    this.autoCloseBitmaps = options.autoCloseBitmaps ?? false

    this.lineRenderer = new CanvasWebGPULineRenderer(canvas, {
      color: options.activeColor ?? '#f5f5f5',
      lineWidthPx: options.activeLineWidthPx ?? 2,
      scale: this.scale,
      clearBeforeRender: false,
    })
  }

  setScale(scale: number): void {
    this.scale = scale
    this.lineRenderer.setScale(scale)
  }

  setBrushColor(color: string): void {
    this.brushColor = color
  }

  setBackgroundBitmap(bitmap: ImageBitmap | null): void {
    if (this.autoCloseBitmaps && this.backgroundBitmap && this.backgroundBitmap !== bitmap) {
      this.backgroundBitmap.close()
    }
    this.backgroundBitmap = bitmap
  }

  setActiveBitmap(bitmap: ImageBitmap | null): void {
    if (this.autoCloseBitmaps && this.activeBitmap && this.activeBitmap !== bitmap) {
      this.activeBitmap.close()
    }
    this.activeBitmap = bitmap
  }

  setActiveSegments(segments: Segment2D[]): void {
    this.activeSegments = segments.map((seg) => ({
      a: { x: seg.a.x, y: seg.a.y },
      b: { x: seg.b.x, y: seg.b.y },
    }))
  }

  renderStatic(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.backgroundBitmap) {
      this.ctx.drawImage(this.backgroundBitmap, 0, 0, this.canvas.width, this.canvas.height)
    }
    if (this.activeBitmap) {
      this.ctx.drawImage(this.activeBitmap, 0, 0, this.canvas.width, this.canvas.height)
    }

    this.lineRenderer.setSegments(this.activeSegments)
    this.lineRenderer.render()
  }

  renderPreview(
    previewSegments: Segment2D[],
    brushPolygon: Vec2[],
    mode: BrushMode,
  ): void {
    this.setActiveSegments(previewSegments)
    this.renderStatic()
    if (this.showBrushTrail) {
      this.drawBrushPolygon(brushPolygon, mode)
    }
  }

  renderCursor(point: Vec2, radiusMm: number, _mode: BrushMode): void {
    const [x, y] = this.mmToCanvas(point)
    const r = Math.max(1, radiusMm * this.scale)

    this.ctx.save()
    this.ctx.beginPath()
    this.ctx.arc(x, y, r, 0, Math.PI * 2)
    this.ctx.lineWidth = 1.5
    this.ctx.strokeStyle = this.brushColor
    this.ctx.globalAlpha = 0.95
    this.ctx.stroke()
    this.ctx.restore()
  }

  renderCommittedActive(segments: Segment2D[]): void {
    this.setActiveSegments(segments)
    this.renderStatic()
  }

  clear(): void {
    this.activeSegments = []
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  dispose(): void {
    this.lineRenderer.dispose()
    if (this.autoCloseBitmaps) {
      this.backgroundBitmap?.close()
      this.activeBitmap?.close()
    }
    this.backgroundBitmap = null
    this.activeBitmap = null
    this.activeSegments = []
  }

  private drawBrushPolygon(points: Vec2[], _mode: BrushMode): void {
    if (points.length < 3) return

    this.ctx.save()
    this.ctx.beginPath()

    const [x0, y0] = this.mmToCanvas(points[0])
    this.ctx.moveTo(x0, y0)
    for (let i = 1; i < points.length; i++) {
      const [x, y] = this.mmToCanvas(points[i])
      this.ctx.lineTo(x, y)
    }
    this.ctx.closePath()

    this.ctx.strokeStyle = this.withAlpha(this.brushColor, 0.9)

    this.ctx.lineWidth = 1.25
    this.ctx.stroke()
    this.ctx.restore()
  }

  private mmToCanvas(point: Vec2): [number, number] {
    return [
      this.canvas.width * 0.5 + point.x * this.scale,
      this.canvas.height * 0.5 - point.y * this.scale,
    ]
  }

  private withAlpha(color: string, alpha: number): string {
    if (color.startsWith('#') && color.length === 7) {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return color
  }
}
