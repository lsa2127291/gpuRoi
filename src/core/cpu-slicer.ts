import type { MeshData, Segment3D, Vec3 } from '@/types'
import type { MeshSlicer } from './slicer-interface'
import { sliceMesh } from './slicer'

/** CPU 实现的 MeshSlicer */
export class CPUSlicer implements MeshSlicer {
  readonly backend = 'cpu' as const
  private mesh: MeshData | null = null

  async init(mesh: MeshData): Promise<void> {
    this.mesh = mesh
  }

  async slice(normal: Vec3, anchor: Vec3): Promise<Segment3D[]> {
    if (!this.mesh) return []
    return sliceMesh(this.mesh, normal, anchor)
  }

  dispose(): void {
    this.mesh = null
  }
}
