import { sliceMesh } from './slicer';
/** CPU 实现的 MeshSlicer */
export class CPUSlicer {
    constructor() {
        this.backend = 'cpu';
        this.mesh = null;
    }
    async init(mesh) {
        this.mesh = mesh;
    }
    async slice(normal, anchor) {
        if (!this.mesh)
            return [];
        return sliceMesh(this.mesh, normal, anchor);
    }
    dispose() {
        this.mesh = null;
    }
}
//# sourceMappingURL=cpu-slicer.js.map