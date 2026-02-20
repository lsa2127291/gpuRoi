import type { MeshData, Segment3D, Vec3 } from '@/types';
import type { MeshSlicer } from './slicer-interface';
export declare class GPUSlicer implements MeshSlicer {
    readonly backend: "gpu";
    private device;
    private pipeline;
    private bindGroupLayout;
    private bindGroup;
    private uniformBuffer;
    private vertexBuffer;
    private indexBuffer;
    private segmentBuffer;
    private counterBuffer;
    private readbackSegmentBuffer;
    private readbackCounterBuffer;
    private vertexBufferSize;
    private indexBufferSize;
    private segmentBufferSize;
    private triCount;
    private bbox;
    constructor(device: GPUDevice);
    init(mesh: MeshData): Promise<void>;
    slice(normal: Vec3, anchor: Vec3): Promise<Segment3D[]>;
    dispose(): void;
    private createPipeline;
    private disposeBuffers;
}
//# sourceMappingURL=gpu-slicer.d.ts.map