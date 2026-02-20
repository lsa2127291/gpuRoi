import { computeBoundingBox, planeIntersectsBoundingBox } from './slicer';
import shaderSource from './slicer.wgsl?raw';
const WORKGROUP_SIZE = 64;
const EPSILON = 1e-8;
// Uniform buffer layout (48 bytes, aligned to 16)
const UNIFORM_SIZE = 48;
export class GPUSlicer {
    constructor(device) {
        this.backend = 'gpu';
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;
        this.uniformBuffer = null;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.segmentBuffer = null;
        this.counterBuffer = null;
        this.readbackSegmentBuffer = null;
        this.readbackCounterBuffer = null;
        // 容量跟踪，用于复用判断
        this.vertexBufferSize = 0;
        this.indexBufferSize = 0;
        this.segmentBufferSize = 0;
        this.triCount = 0;
        this.bbox = null;
        this.device = device;
    }
    async init(mesh) {
        const { vertices, indices } = mesh;
        this.triCount = indices.length / 3;
        this.bbox = computeBoundingBox(vertices);
        if (!this.pipeline) {
            this.createPipeline();
        }
        const device = this.device;
        const neededVertSize = vertices.byteLength;
        const neededIdxSize = indices.byteLength;
        const neededSegSize = Math.max(this.triCount * 6 * 4, 4);
        let needRebind = false;
        // Vertex buffer: 复用或扩容
        if (!this.vertexBuffer || this.vertexBufferSize < neededVertSize) {
            this.vertexBuffer?.destroy();
            this.vertexBufferSize = neededVertSize;
            this.vertexBuffer = device.createBuffer({
                size: neededVertSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            needRebind = true;
        }
        device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
        // Index buffer: 复用或扩容
        if (!this.indexBuffer || this.indexBufferSize < neededIdxSize) {
            this.indexBuffer?.destroy();
            this.indexBufferSize = neededIdxSize;
            this.indexBuffer = device.createBuffer({
                size: neededIdxSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            needRebind = true;
        }
        device.queue.writeBuffer(this.indexBuffer, 0, indices);
        // Uniform buffer: 只创建一次
        if (!this.uniformBuffer) {
            this.uniformBuffer = device.createBuffer({
                size: UNIFORM_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            needRebind = true;
        }
        // Segment buffer: 复用或扩容
        if (!this.segmentBuffer || this.segmentBufferSize < neededSegSize) {
            this.segmentBuffer?.destroy();
            this.readbackSegmentBuffer?.destroy();
            this.segmentBufferSize = neededSegSize;
            this.segmentBuffer = device.createBuffer({
                size: neededSegSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            this.readbackSegmentBuffer = device.createBuffer({
                size: neededSegSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            needRebind = true;
        }
        // Counter buffer: 只创建一次
        if (!this.counterBuffer) {
            this.counterBuffer = device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            needRebind = true;
        }
        // Readback counter buffer: 只创建一次
        if (!this.readbackCounterBuffer) {
            this.readbackCounterBuffer = device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
        }
        // 仅在 buffer 变化时重建 bind group
        if (needRebind) {
            this.bindGroup = device.createBindGroup({
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: { buffer: this.vertexBuffer } },
                    { binding: 2, resource: { buffer: this.indexBuffer } },
                    { binding: 3, resource: { buffer: this.segmentBuffer } },
                    { binding: 4, resource: { buffer: this.counterBuffer } },
                ],
            });
        }
    }
    async slice(normal, anchor) {
        if (!this.pipeline || !this.bindGroup || !this.uniformBuffer) {
            return [];
        }
        // CPU-side bounding box early rejection
        if (this.bbox && !planeIntersectsBoundingBox(normal, anchor, this.bbox)) {
            return [];
        }
        const device = this.device;
        // Write uniforms
        const uniformData = new ArrayBuffer(UNIFORM_SIZE);
        const f32 = new Float32Array(uniformData);
        const u32 = new Uint32Array(uniformData);
        f32[0] = normal[0];
        f32[1] = normal[1];
        f32[2] = normal[2];
        f32[4] = anchor[0];
        f32[5] = anchor[1];
        f32[6] = anchor[2];
        f32[8] = EPSILON;
        u32[9] = this.triCount;
        device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        // Reset counter to 0
        device.queue.writeBuffer(this.counterBuffer, 0, new Uint32Array([0]));
        // === 两阶段读回 ===
        // Stage 1: dispatch + copy counter only
        const enc1 = device.createCommandEncoder();
        const pass = enc1.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.triCount / WORKGROUP_SIZE));
        pass.end();
        enc1.copyBufferToBuffer(this.counterBuffer, 0, this.readbackCounterBuffer, 0, 4);
        device.queue.submit([enc1.finish()]);
        // Read counter
        await this.readbackCounterBuffer.mapAsync(GPUMapMode.READ);
        const countArray = new Uint32Array(this.readbackCounterBuffer.getMappedRange());
        const segmentCount = countArray[0];
        this.readbackCounterBuffer.unmap();
        if (segmentCount === 0)
            return [];
        // Stage 2: copy only the valid segments
        const validByteSize = segmentCount * 6 * 4;
        const enc2 = device.createCommandEncoder();
        enc2.copyBufferToBuffer(this.segmentBuffer, 0, this.readbackSegmentBuffer, 0, validByteSize);
        device.queue.submit([enc2.finish()]);
        await this.readbackSegmentBuffer.mapAsync(GPUMapMode.READ);
        const segData = new Float32Array(this.readbackSegmentBuffer.getMappedRange(0, validByteSize));
        const segments = [];
        for (let i = 0; i < segmentCount; i++) {
            const base = i * 6;
            segments.push({
                start: [segData[base], segData[base + 1], segData[base + 2]],
                end: [segData[base + 3], segData[base + 4], segData[base + 5]],
            });
        }
        this.readbackSegmentBuffer.unmap();
        return segments;
    }
    dispose() {
        this.disposeBuffers();
        this.pipeline = null;
        this.bindGroupLayout = null;
    }
    createPipeline() {
        const device = this.device;
        const shaderModule = device.createShaderModule({
            code: shaderSource,
        });
        this.bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.pipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: shaderModule,
                entryPoint: 'main',
            },
        });
    }
    disposeBuffers() {
        this.vertexBuffer?.destroy();
        this.indexBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.segmentBuffer?.destroy();
        this.counterBuffer?.destroy();
        this.readbackSegmentBuffer?.destroy();
        this.readbackCounterBuffer?.destroy();
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.segmentBuffer = null;
        this.counterBuffer = null;
        this.readbackSegmentBuffer = null;
        this.readbackCounterBuffer = null;
        this.bindGroup = null;
        this.vertexBufferSize = 0;
        this.indexBufferSize = 0;
        this.segmentBufferSize = 0;
    }
}
//# sourceMappingURL=gpu-slicer.js.map