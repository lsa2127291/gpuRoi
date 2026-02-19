/** 3D 向量类型 [x, y, z] */
export type Vec3 = [number, number, number]

/** 3D Mesh 数据 */
export interface MeshData {
  vertices: Float32Array
  indices: Uint32Array
  normals?: Float32Array
}

/** 相机/视图定义 */
export interface CameraData {
  viewPlaneNormal: Vec3
  viewUp: Vec3
}

/** 3D 线段 */
export interface Segment3D {
  start: Vec3
  end: Vec3
}

/** 2D 线段 */
export interface Segment2D {
  start: [number, number]
  end: [number, number]
}

/** RGBA 颜色（0~1） */
export type MeshColor = [number, number, number, number]

/** 切割结果 */
export interface SliceResult {
  segments3D: Segment3D[]
  segments2D: Segment2D[]
}

/** GPU 位图切面输出参数 */
export interface SliceBitmapOptions {
  viewUp: Vec3
  width: number
  height: number
  scale: number
  clearColor?: MeshColor
}

/** 渲染样式 */
export interface RenderStyle {
  color: string
  lineWidth: number
  scale: number
}

/** 包围盒 */
export interface BoundingBox {
  min: Vec3
  max: Vec3
}

/** MPR 预设视图 */
export const MPR_VIEWS: Record<string, CameraData> = {
  Axial: {
    viewPlaneNormal: [0, 0, -1],
    viewUp: [0, -1, 0],
  },
  Sagittal: {
    viewPlaneNormal: [-1, 0, 0],
    viewUp: [0, 0, 1],
  },
  Coronal: {
    viewPlaneNormal: [0, -1, 0],
    viewUp: [0, 0, 1],
  },
} as const
