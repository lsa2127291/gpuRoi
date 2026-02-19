import type { MeshColor, MeshData, Segment3D, SliceBitmapOptions, Vec3 } from '@/types'
import type { BatchMeshSlicer } from './batch-slicer-interface'
import type { Chunk } from './chunk-planner'
import { planChunks } from './chunk-planner'
import { buildLocalBasis } from './projection'
import { planeIntersectsBoundingBox } from './slicer'
import bitmapShaderSource from './slicer-batch-bitmap.wgsl?raw'

const WORKGROUP_SIZE = 64
const EPSILON = 1e-8
const SLICE_UNIFORM_SIZE = 48
const RENDER_UNIFORM_SIZE = 64
const SEGMENT_STRIDE = 32
const DRAW_ARGS_SIZE = 16
const MSAA_SAMPLE_COUNT = 4

type OutputCanvas = OffscreenCanvas | HTMLCanvasElement

interface ChunkGPU {
  chunk: Chunk
  workgroupCount: number
  localMeshCount: number

  sliceUniformBuffer: GPUBuffer
  vertexBuffer: GPUBuffer
  indexBuffer: GPUBuffer
  segmentBuffer: GPUBuffer
  counterBuffer: GPUBuffer
  meshInfoBuffer: GPUBuffer
  indirectBuffer: GPUBuffer

  readbackCounterBuffer: GPUBuffer
  readbackSegmentBuffer: GPUBuffer
  segmentByteCapacity: number

  sliceBindGroup: GPUBindGroup
  renderBindGroup: GPUBindGroup
}

interface BitmapWaiter {
  resolve: (bitmap: ImageBitmap) => void
  reject: (reason?: unknown) => void
}

interface PendingBitmapRequest {
  seq: number
  normal: Vec3
  anchor: Vec3
  options: SliceBitmapOptions
  waiters: BitmapWaiter[]
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toMeshColor(color: MeshColor): MeshColor {
  return [
    clamp01(color[0]),
    clamp01(color[1]),
    clamp01(color[2]),
    clamp01(color[3]),
  ]
}

function createDefaultColors(count: number): MeshColor[] {
  const colors: MeshColor[] = []

  for (let i = 0; i < count; i++) {
    const hue = count <= 1 ? 0 : i / count
    const s = 0.8
    const v = 0.95

    const h = hue * 6
    const c = v * s
    const x = c * (1 - Math.abs((h % 2) - 1))
    const m = v - c

    let r = 0
    let g = 0
    let b = 0

    if (h >= 0 && h < 1) { r = c; g = x; b = 0 }
    else if (h >= 1 && h < 2) { r = x; g = c; b = 0 }
    else if (h >= 2 && h < 3) { r = 0; g = c; b = x }
    else if (h >= 3 && h < 4) { r = 0; g = x; b = c }
    else if (h >= 4 && h < 5) { r = x; g = 0; b = c }
    else { r = c; g = 0; b = x }

    colors.push([r + m, g + m, b + m, 1])
  }

  return colors
}

function buildColorData(meshCount: number, colors?: MeshColor[]): Float32Array {
  const palette = createDefaultColors(meshCount)

  if (colors) {
    for (let i = 0; i < Math.min(meshCount, colors.length); i++) {
      palette[i] = toMeshColor(colors[i])
    }
  }

  const data = new Float32Array(meshCount * 4)
  for (let i = 0; i < meshCount; i++) {
    const base = i * 4
    const color = palette[i]
    data[base] = color[0]
    data[base + 1] = color[1]
    data[base + 2] = color[2]
    data[base + 3] = color[3]
  }

  return data
}

function cloneVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]]
}

function cloneBitmapOptions(options: SliceBitmapOptions): SliceBitmapOptions {
  return {
    viewUp: cloneVec3(options.viewUp),
    width: options.width,
    height: options.height,
    scale: options.scale,
    clearColor: options.clearColor ? [...options.clearColor] as MeshColor : undefined,
  }
}

export class BatchGPUSlicer implements BatchMeshSlicer {
  readonly backend = 'gpu' as const

  private readonly device: GPUDevice
  private readonly canvasFormat: GPUTextureFormat

  private slicePipeline: GPUComputePipeline | null = null
  private drawArgsPipeline: GPUComputePipeline | null = null
  private renderPipeline: GPURenderPipeline | null = null

  private sliceBindGroupLayout: GPUBindGroupLayout | null = null
  private renderBindGroupLayout: GPUBindGroupLayout | null = null

  private renderUniformBuffer: GPUBuffer | null = null
  private meshColorBuffer: GPUBuffer | null = null

  private chunkGPUs: ChunkGPU[] = []
  private meshCount = 0

  private outputCanvas: OutputCanvas | null = null
  private outputContext: GPUCanvasContext | null = null
  private msaaTexture: GPUTexture | null = null
  private msaaTextureSize: { width: number; height: number } = { width: 0, height: 0 }

  private readonly zeroCounter = new Uint32Array([0])
  private readonly zeroDrawArgs = new Uint32Array([6, 0, 0, 0])

  private bitmapRenderRunning = false
  private bitmapRequestSeq = 0
  private pendingBitmapRequest: PendingBitmapRequest | null = null
  private disposed = false

  constructor(device: GPUDevice) {
    this.device = device
    this.canvasFormat =
      typeof navigator !== 'undefined' && navigator.gpu
        ? navigator.gpu.getPreferredCanvasFormat()
        : 'bgra8unorm'
  }

  async initBatch(meshes: MeshData[], colors?: MeshColor[]): Promise<void> {
    if (this.disposed) {
      throw new Error('BatchGPUSlicer has been disposed')
    }

    this.disposeChunks()

    if (!this.slicePipeline || !this.drawArgsPipeline || !this.renderPipeline) {
      this.createPipelines()
    }

    if (!this.renderUniformBuffer) {
      this.renderUniformBuffer = this.device.createBuffer({
        size: RENDER_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    }

    this.meshCount = meshes.length

    this.meshColorBuffer?.destroy()
    const colorData = buildColorData(this.meshCount, colors)
    this.meshColorBuffer = this.device.createBuffer({
      size: Math.max(colorData.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    if (colorData.byteLength > 0) {
      this.device.queue.writeBuffer(this.meshColorBuffer, 0, colorData as unknown as ArrayBuffer)
    }

    const chunks = planChunks(meshes, {
      maxStorageBufferBindingSize: this.device.limits.maxStorageBufferBindingSize,
      maxBufferSize: this.device.limits.maxBufferSize,
    })

    for (const chunk of chunks) {
      this.chunkGPUs.push(this.createChunkGPU(chunk))
    }
  }

  async sliceBatch(normal: Vec3, anchor: Vec3): Promise<Segment3D[][]> {
    if (!this.slicePipeline || this.chunkGPUs.length === 0) {
      return []
    }

    const results: Segment3D[][] = new Array(this.meshCount)
    for (let i = 0; i < this.meshCount; i++) results[i] = []

    for (const chunkGPU of this.getActiveChunks(normal, anchor)) {
      const segmentCount = await this.dispatchAndReadCounter(chunkGPU, normal, anchor)
      if (segmentCount === 0) continue

      const segments = await this.readbackSegments(chunkGPU, segmentCount)
      for (const entry of segments) {
        if (entry.meshIndex >= 0 && entry.meshIndex < results.length) {
          results[entry.meshIndex].push({ start: entry.start, end: entry.end })
        }
      }
    }

    return results
  }

  async sliceBatchFlat(normal: Vec3, anchor: Vec3): Promise<Segment3D[]> {
    if (!this.slicePipeline || this.chunkGPUs.length === 0) {
      return []
    }

    const allSegments: Segment3D[] = []

    for (const chunkGPU of this.getActiveChunks(normal, anchor)) {
      const segmentCount = await this.dispatchAndReadCounter(chunkGPU, normal, anchor)
      if (segmentCount === 0) continue

      const segments = await this.readbackSegments(chunkGPU, segmentCount)
      for (const entry of segments) {
        allSegments.push({ start: entry.start, end: entry.end })
      }
    }

    return allSegments
  }

  async sliceToBitmap(
    normal: Vec3,
    anchor: Vec3,
    options: SliceBitmapOptions,
  ): Promise<ImageBitmap> {
    if (this.disposed) {
      throw new Error('BatchGPUSlicer has been disposed')
    }
    if (!this.slicePipeline || !this.drawArgsPipeline || !this.renderPipeline) {
      throw new Error('BatchGPUSlicer is not initialized')
    }
    if (!this.renderUniformBuffer || !this.meshColorBuffer) {
      throw new Error('BatchGPUSlicer buffers are not initialized')
    }

    return new Promise<ImageBitmap>((resolve, reject) => {
      const waiter: BitmapWaiter = { resolve, reject }
      const nextRequest: PendingBitmapRequest = {
        seq: ++this.bitmapRequestSeq,
        normal: cloneVec3(normal),
        anchor: cloneVec3(anchor),
        options: cloneBitmapOptions(options),
        waiters: this.pendingBitmapRequest
          ? [...this.pendingBitmapRequest.waiters, waiter]
          : [waiter],
      }

      this.pendingBitmapRequest = nextRequest

      if (!this.bitmapRenderRunning) {
        void this.runBitmapRenderLoop()
      }
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.pendingBitmapRequest) {
      this.rejectBitmapWaiters(this.pendingBitmapRequest.waiters, new Error('BatchGPUSlicer has been disposed'))
      this.pendingBitmapRequest = null
    }
    this.disposeChunks()

    this.renderUniformBuffer?.destroy()
    this.meshColorBuffer?.destroy()
    this.msaaTexture?.destroy()

    this.renderUniformBuffer = null
    this.meshColorBuffer = null
    this.msaaTexture = null
    this.msaaTextureSize = { width: 0, height: 0 }

    this.slicePipeline = null
    this.drawArgsPipeline = null
    this.renderPipeline = null
    this.sliceBindGroupLayout = null
    this.renderBindGroupLayout = null

    this.outputContext = null
    this.outputCanvas = null
    this.meshCount = 0
  }

  private async runBitmapRenderLoop(): Promise<void> {
    if (this.bitmapRenderRunning) {
      return
    }

    this.bitmapRenderRunning = true
    try {
      while (this.pendingBitmapRequest) {
        const request = this.pendingBitmapRequest
        this.pendingBitmapRequest = null

        if (this.disposed) {
          this.rejectBitmapWaiters(request.waiters, new Error('BatchGPUSlicer has been disposed'))
          continue
        }

        try {
          const bitmap = await this.renderBitmapOnce(
            request.normal,
            request.anchor,
            request.options,
          )

          const queuedRequest = this.pendingBitmapRequest as PendingBitmapRequest | null
          if (queuedRequest && queuedRequest.seq > request.seq) {
            bitmap.close()
            queuedRequest.waiters = [
              ...queuedRequest.waiters,
              ...request.waiters,
            ]
            continue
          }

          if (this.disposed) {
            bitmap.close()
            this.rejectBitmapWaiters(request.waiters, new Error('BatchGPUSlicer has been disposed'))
            continue
          }

          await this.resolveBitmapWaiters(request.waiters, bitmap)
        } catch (err) {
          this.rejectBitmapWaiters(request.waiters, err)
        }
      }
    } finally {
      this.bitmapRenderRunning = false

      if (!this.disposed && this.pendingBitmapRequest) {
        void this.runBitmapRenderLoop()
      }
    }
  }

  private async renderBitmapOnce(
    normal: Vec3,
    anchor: Vec3,
    options: SliceBitmapOptions,
  ): Promise<ImageBitmap> {
    if (!this.slicePipeline || !this.drawArgsPipeline || !this.renderPipeline) {
      throw new Error('BatchGPUSlicer is not initialized')
    }
    if (!this.renderUniformBuffer || !this.meshColorBuffer) {
      throw new Error('BatchGPUSlicer buffers are not initialized')
    }

    const width = Math.max(1, Math.floor(options.width))
    const height = Math.max(1, Math.floor(options.height))
    this.ensureOutputContext(width, height)
    this.ensureMsaaTexture(width, height)

    const activeChunks = this.getActiveChunks(normal, anchor)

    this.writeRenderUniform(normal, anchor, options)

    const encoder = this.device.createCommandEncoder()

    if (activeChunks.length > 0) {
      this.encodeSlicePass(encoder, activeChunks, normal, anchor)
    }

    const clearColor = options.clearColor ?? [0, 0, 0, 0]
    const targetView = this.outputContext!.getCurrentTexture().createView()
    const colorAttachment: GPURenderPassColorAttachment = {
      view: this.msaaTexture ? this.msaaTexture.createView() : targetView,
      resolveTarget: this.msaaTexture ? targetView : undefined,
      loadOp: 'clear',
      clearValue: {
        r: clamp01(clearColor[0]),
        g: clamp01(clearColor[1]),
        b: clamp01(clearColor[2]),
        a: clamp01(clearColor[3]),
      },
      storeOp: 'store',
    }

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
    })

    renderPass.setPipeline(this.renderPipeline)
    for (const chunkGPU of activeChunks) {
      renderPass.setBindGroup(1, chunkGPU.renderBindGroup)
      renderPass.drawIndirect(chunkGPU.indirectBuffer, 0)
    }
    renderPass.end()

    this.device.queue.submit([encoder.finish()])
    await this.device.queue.onSubmittedWorkDone()

    return this.captureBitmap()
  }

  private async resolveBitmapWaiters(waiters: BitmapWaiter[], primaryBitmap: ImageBitmap): Promise<void> {
    if (waiters.length === 0) {
      primaryBitmap.close()
      return
    }

    const outputs: ImageBitmap[] = [primaryBitmap]
    try {
      for (let i = 1; i < waiters.length; i++) {
        outputs.push(await this.cloneBitmap(primaryBitmap))
      }
    } catch (err) {
      for (const bmp of outputs) {
        bmp.close()
      }
      this.rejectBitmapWaiters(waiters, err)
      return
    }

    for (let i = 0; i < waiters.length; i++) {
      waiters[i].resolve(outputs[i])
    }
  }

  private rejectBitmapWaiters(waiters: BitmapWaiter[], reason: unknown): void {
    for (const waiter of waiters) {
      waiter.reject(reason)
    }
  }

  private async cloneBitmap(bitmap: ImageBitmap): Promise<ImageBitmap> {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(bitmap)
    }
    throw new Error('createImageBitmap is required when sliceToBitmap has merged waiters')
  }

  private createPipelines(): void {
    const shaderModule = this.device.createShaderModule({ code: bitmapShaderSource })

    this.sliceBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    })

    this.slicePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.sliceBindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'slice_main',
      },
    })

    this.drawArgsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.sliceBindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'build_draw_args',
      },
    })

    const emptyLayout = this.device.createBindGroupLayout({ entries: [] })

    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [emptyLayout, this.renderBindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.canvasFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
      multisample: {
        count: MSAA_SAMPLE_COUNT,
      },
    })
  }

  private createChunkGPU(chunk: Chunk): ChunkGPU {
    if (!this.sliceBindGroupLayout || !this.renderBindGroupLayout || !this.renderUniformBuffer || !this.meshColorBuffer) {
      throw new Error('BatchGPUSlicer pipelines are not initialized')
    }

    const meshCount = chunk.meshInfos.length
    const segmentByteCapacity = Math.max(chunk.totalSegCapacity * SEGMENT_STRIDE, SEGMENT_STRIDE)

    const vertexBuffer = this.device.createBuffer({
      size: chunk.vertices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(vertexBuffer, 0, chunk.vertices as unknown as ArrayBuffer)

    const indexBuffer = this.device.createBuffer({
      size: chunk.indices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(indexBuffer, 0, chunk.indices as unknown as ArrayBuffer)

    const sliceUniformBuffer = this.device.createBuffer({
      size: SLICE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const segmentBuffer = this.device.createBuffer({
      size: segmentByteCapacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })

    const counterBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })

    const meshInfoData = new Uint32Array(meshCount * 4)
    for (let i = 0; i < meshCount; i++) {
      const info = chunk.meshInfos[i]
      meshInfoData[i * 4] = info.triOffset
      meshInfoData[i * 4 + 1] = info.triCount
      meshInfoData[i * 4 + 2] = info.meshIndex
      meshInfoData[i * 4 + 3] = 0
    }

    const meshInfoBuffer = this.device.createBuffer({
      size: Math.max(meshInfoData.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    if (meshInfoData.byteLength > 0) {
      this.device.queue.writeBuffer(meshInfoBuffer, 0, meshInfoData as unknown as ArrayBuffer)
    }

    const indirectBuffer = this.device.createBuffer({
      size: DRAW_ARGS_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    })

    const readbackCounterBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    const readbackSegmentBuffer = this.device.createBuffer({
      size: segmentByteCapacity,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    const sliceBindGroup = this.device.createBindGroup({
      layout: this.sliceBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sliceUniformBuffer } },
        { binding: 1, resource: { buffer: vertexBuffer } },
        { binding: 2, resource: { buffer: indexBuffer } },
        { binding: 3, resource: { buffer: segmentBuffer } },
        { binding: 4, resource: { buffer: counterBuffer } },
        { binding: 5, resource: { buffer: meshInfoBuffer } },
        { binding: 6, resource: { buffer: indirectBuffer } },
      ],
    })

    const renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: segmentBuffer } },
        { binding: 2, resource: { buffer: this.meshColorBuffer } },
      ],
    })

    return {
      chunk,
      workgroupCount: Math.ceil(chunk.totalTriCount / WORKGROUP_SIZE),
      localMeshCount: meshCount,
      sliceUniformBuffer,
      vertexBuffer,
      indexBuffer,
      segmentBuffer,
      counterBuffer,
      meshInfoBuffer,
      indirectBuffer,
      readbackCounterBuffer,
      readbackSegmentBuffer,
      segmentByteCapacity,
      sliceBindGroup,
      renderBindGroup,
    }
  }

  private encodeSlicePass(
    encoder: GPUCommandEncoder,
    activeChunks: ChunkGPU[],
    normal: Vec3,
    anchor: Vec3,
  ): void {
    for (const chunkGPU of activeChunks) {
      this.writeSliceUniform(chunkGPU, normal, anchor)
      this.device.queue.writeBuffer(chunkGPU.counterBuffer, 0, this.zeroCounter as unknown as ArrayBuffer)
      this.device.queue.writeBuffer(chunkGPU.indirectBuffer, 0, this.zeroDrawArgs as unknown as ArrayBuffer)
    }

    const pass = encoder.beginComputePass()
    for (const chunkGPU of activeChunks) {
      pass.setPipeline(this.slicePipeline!)
      pass.setBindGroup(0, chunkGPU.sliceBindGroup)
      pass.dispatchWorkgroups(chunkGPU.workgroupCount)

      pass.setPipeline(this.drawArgsPipeline!)
      pass.setBindGroup(0, chunkGPU.sliceBindGroup)
      pass.dispatchWorkgroups(1)
    }
    pass.end()
  }

  private writeSliceUniform(chunkGPU: ChunkGPU, normal: Vec3, anchor: Vec3): void {
    const uniformData = new ArrayBuffer(SLICE_UNIFORM_SIZE)
    const f32 = new Float32Array(uniformData)
    const u32 = new Uint32Array(uniformData)

    f32[0] = normal[0]
    f32[1] = normal[1]
    f32[2] = normal[2]

    f32[4] = anchor[0]
    f32[5] = anchor[1]
    f32[6] = anchor[2]

    f32[8] = EPSILON
    u32[9] = chunkGPU.chunk.totalTriCount
    u32[10] = chunkGPU.localMeshCount

    this.device.queue.writeBuffer(chunkGPU.sliceUniformBuffer, 0, uniformData)
  }

  private writeRenderUniform(normal: Vec3, anchor: Vec3, options: SliceBitmapOptions): void {
    if (!this.renderUniformBuffer) return

    const basis = buildLocalBasis(normal, options.viewUp)

    const width = Math.max(1, options.width)
    const height = Math.max(1, options.height)
    const uniformData = new ArrayBuffer(RENDER_UNIFORM_SIZE)
    const f32 = new Float32Array(uniformData)
    const u32 = new Uint32Array(uniformData)

    f32[0] = anchor[0]
    f32[1] = anchor[1]
    f32[2] = anchor[2]

    f32[4] = basis.xAxis[0]
    f32[5] = basis.xAxis[1]
    f32[6] = basis.xAxis[2]

    f32[8] = basis.yAxis[0]
    f32[9] = basis.yAxis[1]
    f32[10] = basis.yAxis[2]

    f32[12] = options.scale
    f32[13] = 2 / width
    f32[14] = 2 / height
    u32[15] = this.meshCount

    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, uniformData)
  }

  private getActiveChunks(normal: Vec3, anchor: Vec3): ChunkGPU[] {
    const activeChunks: ChunkGPU[] = []

    for (const chunkGPU of this.chunkGPUs) {
      let anyActive = false
      for (const info of chunkGPU.chunk.meshInfos) {
        if (planeIntersectsBoundingBox(normal, anchor, info.bbox)) {
          anyActive = true
          break
        }
      }

      if (anyActive) {
        activeChunks.push(chunkGPU)
      }
    }

    return activeChunks
  }

  private async dispatchAndReadCounter(
    chunkGPU: ChunkGPU,
    normal: Vec3,
    anchor: Vec3,
  ): Promise<number> {
    this.writeSliceUniform(chunkGPU, normal, anchor)
    this.device.queue.writeBuffer(chunkGPU.counterBuffer, 0, this.zeroCounter as unknown as ArrayBuffer)
    this.device.queue.writeBuffer(chunkGPU.indirectBuffer, 0, this.zeroDrawArgs as unknown as ArrayBuffer)

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.slicePipeline!)
    pass.setBindGroup(0, chunkGPU.sliceBindGroup)
    pass.dispatchWorkgroups(chunkGPU.workgroupCount)

    pass.setPipeline(this.drawArgsPipeline!)
    pass.setBindGroup(0, chunkGPU.sliceBindGroup)
    pass.dispatchWorkgroups(1)
    pass.end()

    encoder.copyBufferToBuffer(
      chunkGPU.counterBuffer,
      0,
      chunkGPU.readbackCounterBuffer,
      0,
      4,
    )

    this.device.queue.submit([encoder.finish()])

    await chunkGPU.readbackCounterBuffer.mapAsync(GPUMapMode.READ)
    const count = new Uint32Array(chunkGPU.readbackCounterBuffer.getMappedRange(0, 4))[0]
    chunkGPU.readbackCounterBuffer.unmap()

    return count
  }

  private async readbackSegments(
    chunkGPU: ChunkGPU,
    segmentCount: number,
  ): Promise<Array<{ start: Vec3; end: Vec3; meshIndex: number }>> {
    const validByteSize = segmentCount * SEGMENT_STRIDE

    const encoder = this.device.createCommandEncoder()
    encoder.copyBufferToBuffer(
      chunkGPU.segmentBuffer,
      0,
      chunkGPU.readbackSegmentBuffer,
      0,
      validByteSize,
    )
    this.device.queue.submit([encoder.finish()])

    await chunkGPU.readbackSegmentBuffer.mapAsync(GPUMapMode.READ)
    const view = new DataView(chunkGPU.readbackSegmentBuffer.getMappedRange(0, validByteSize))

    const segments: Array<{ start: Vec3; end: Vec3; meshIndex: number }> = []
    for (let i = 0; i < segmentCount; i++) {
      const base = i * SEGMENT_STRIDE
      segments.push({
        start: [
          view.getFloat32(base, true),
          view.getFloat32(base + 4, true),
          view.getFloat32(base + 8, true),
        ],
        meshIndex: view.getUint32(base + 12, true),
        end: [
          view.getFloat32(base + 16, true),
          view.getFloat32(base + 20, true),
          view.getFloat32(base + 24, true),
        ],
      })
    }

    chunkGPU.readbackSegmentBuffer.unmap()

    return segments
  }

  private ensureOutputContext(width: number, height: number): void {
    if (!this.outputCanvas || !this.outputContext) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.outputCanvas = new OffscreenCanvas(width, height)
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        this.outputCanvas = canvas
      } else {
        throw new Error('No canvas surface available for bitmap output')
      }

      const context = this.outputCanvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) {
        throw new Error('Failed to create WebGPU canvas context for bitmap output')
      }

      this.outputContext = context
    }

    if (this.outputCanvas.width !== width) this.outputCanvas.width = width
    if (this.outputCanvas.height !== height) this.outputCanvas.height = height

    this.outputContext.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private ensureMsaaTexture(width: number, height: number): void {
    if (MSAA_SAMPLE_COUNT <= 1) {
      return
    }

    if (
      this.msaaTexture &&
      this.msaaTextureSize.width === width &&
      this.msaaTextureSize.height === height
    ) {
      return
    }

    this.msaaTexture?.destroy()
    this.msaaTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.canvasFormat,
      sampleCount: MSAA_SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.msaaTextureSize = { width, height }
  }

  private async captureBitmap(): Promise<ImageBitmap> {
    if (!this.outputCanvas) {
      throw new Error('Output canvas is not initialized')
    }

    if (typeof OffscreenCanvas !== 'undefined' && this.outputCanvas instanceof OffscreenCanvas) {
      return this.outputCanvas.transferToImageBitmap()
    }

    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(this.outputCanvas as HTMLCanvasElement)
    }

    throw new Error('createImageBitmap is not available')
  }

  private disposeChunks(): void {
    for (const cg of this.chunkGPUs) {
      cg.sliceUniformBuffer.destroy()
      cg.vertexBuffer.destroy()
      cg.indexBuffer.destroy()
      cg.segmentBuffer.destroy()
      cg.counterBuffer.destroy()
      cg.meshInfoBuffer.destroy()
      cg.indirectBuffer.destroy()
      cg.readbackCounterBuffer.destroy()
      cg.readbackSegmentBuffer.destroy()
    }
    this.chunkGPUs = []
  }
}
