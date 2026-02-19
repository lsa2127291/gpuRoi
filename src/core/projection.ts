import type { Vec3, Segment3D, Segment2D } from '@/types'
import { dot, cross, subtract, normalize } from './vec3'

/** 正交局部坐标系 */
export interface LocalBasis {
  xAxis: Vec3
  yAxis: Vec3
  zAxis: Vec3
}

/**
 * 根据 viewPlaneNormal 和 viewUp 构建正交局部坐标系
 * 含正交化处理：确保 viewUp 与 normal 垂直
 */
export function buildLocalBasis(
  viewPlaneNormal: Vec3,
  viewUp: Vec3,
): LocalBasis {
  const zAxis = normalize(viewPlaneNormal)

  // X = viewUp × normal
  let xAxis = normalize(cross(viewUp, zAxis))

  // 正交化 Y = normal × X
  const yAxis = normalize(cross(zAxis, xAxis))

  // 重新计算 X 确保完全正交
  xAxis = normalize(cross(yAxis, zAxis))

  return { xAxis, yAxis, zAxis }
}

/**
 * 将 3D 点投影到局部 2D 坐标（相对于 anchor）
 */
export function projectPointTo2D(
  point: Vec3,
  anchor: Vec3,
  basis: LocalBasis,
): [number, number] {
  const relative = subtract(point, anchor)
  const x = dot(relative, basis.xAxis)
  const y = dot(relative, basis.yAxis)
  return [x, y]
}

/**
 * 将物理坐标（mm）映射到 Canvas 像素空间
 */
export function toCanvasCoord(
  point: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): [number, number] {
  const cx = canvasWidth / 2
  const cy = canvasHeight / 2
  return [
    cx + point[0] * scale,
    cy - point[1] * scale, // Canvas Y 轴向下，物理 Y 轴向上
  ]
}

/**
 * 将 3D 线段集合投影为 2D Canvas 线段
 */
export function projectSegments(
  segments3D: Segment3D[],
  anchor: Vec3,
  basis: LocalBasis,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): Segment2D[] {
  return segments3D.map((seg) => {
    const start2D = projectPointTo2D(seg.start, anchor, basis)
    const end2D = projectPointTo2D(seg.end, anchor, basis)
    return {
      start: toCanvasCoord(start2D, canvasWidth, canvasHeight, scale),
      end: toCanvasCoord(end2D, canvasWidth, canvasHeight, scale),
    }
  })
}
