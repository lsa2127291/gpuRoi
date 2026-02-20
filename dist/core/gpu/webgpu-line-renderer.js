function cloneSegment(seg) {
    return {
        a: { x: seg.a.x, y: seg.a.y },
        b: { x: seg.b.x, y: seg.b.y },
    };
}
export class CanvasWebGPULineRenderer {
    constructor(canvas, options = {}) {
        this.segments = [];
        this.disposed = false;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context for line renderer');
        }
        this.canvas = canvas;
        this.ctx = ctx;
        this.color = options.color ?? '#f5f5f5';
        this.lineWidthPx = options.lineWidthPx ?? 2;
        this.scale = options.scale ?? 1;
        this.alpha = options.alpha ?? 1;
        this.clearBeforeRender = options.clearBeforeRender ?? false;
    }
    setSegments(segments) {
        this.segments = segments.map(cloneSegment);
    }
    setScale(scale) {
        this.scale = scale;
    }
    setStyle(style) {
        if (style.color !== undefined)
            this.color = style.color;
        if (style.lineWidthPx !== undefined)
            this.lineWidthPx = style.lineWidthPx;
        if (style.alpha !== undefined)
            this.alpha = style.alpha;
        if (style.clearBeforeRender !== undefined)
            this.clearBeforeRender = style.clearBeforeRender;
    }
    render() {
        if (this.disposed)
            return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const cx = width * 0.5;
        const cy = height * 0.5;
        if (this.clearBeforeRender) {
            this.ctx.clearRect(0, 0, width, height);
        }
        if (this.segments.length === 0) {
            return;
        }
        this.ctx.save();
        this.ctx.strokeStyle = this.color;
        this.ctx.globalAlpha = this.alpha;
        this.ctx.lineWidth = this.lineWidthPx;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        for (const seg of this.segments) {
            const x0 = cx + seg.a.x * this.scale;
            const y0 = cy - seg.a.y * this.scale;
            const x1 = cx + seg.b.x * this.scale;
            const y1 = cy - seg.b.y * this.scale;
            this.ctx.moveTo(x0, y0);
            this.ctx.lineTo(x1, y1);
        }
        this.ctx.stroke();
        this.ctx.restore();
    }
    dispose() {
        this.segments = [];
        this.disposed = true;
    }
}
//# sourceMappingURL=webgpu-line-renderer.js.map