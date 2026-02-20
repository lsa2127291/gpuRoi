import type { MeshData, Segment3D, Vec3 } from '@/types';
import type { MeshSlicer } from './slicer-interface';
/** CPU 实现的 MeshSlicer */
export declare class CPUSlicer implements MeshSlicer {
    readonly backend: "cpu";
    private mesh;
    init(mesh: MeshData): Promise<void>;
    slice(normal: Vec3, anchor: Vec3): Promise<Segment3D[]>;
    dispose(): void;
}
//# sourceMappingURL=cpu-slicer.d.ts.map