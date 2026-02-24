import type { Segment3D, Vec3 } from '@/types'

export interface SliceSegmentEntry {
  start: Vec3
  end: Vec3
  meshIndex: number
}

export interface SliceSegmentNormalizeOptions {
  zeroLengthEpsilonMm?: number
  pointMergeEpsilonMm?: number
}

interface QuantizedVec3 {
  x: number
  y: number
  z: number
}

const DEFAULT_ZERO_EPSILON_MM = 1e-7
const DEFAULT_POINT_MERGE_EPSILON_MM = 1e-4

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

function quantize(point: Vec3, scale: number): QuantizedVec3 {
  return {
    x: Math.round(point[0] * scale),
    y: Math.round(point[1] * scale),
    z: Math.round(point[2] * scale),
  }
}

function compareQuantized(lhs: QuantizedVec3, rhs: QuantizedVec3): number {
  if (lhs.x !== rhs.x) return lhs.x - rhs.x
  if (lhs.y !== rhs.y) return lhs.y - rhs.y
  return lhs.z - rhs.z
}

function quantizedKey(point: QuantizedVec3): string {
  return `${point.x},${point.y},${point.z}`
}

export function normalizeSliceSegmentEntries(
  entries: SliceSegmentEntry[],
  options: SliceSegmentNormalizeOptions = {},
): SliceSegmentEntry[] {
  const zeroLengthEpsilonMm = options.zeroLengthEpsilonMm ?? DEFAULT_ZERO_EPSILON_MM
  const pointMergeEpsilonMm = options.pointMergeEpsilonMm ?? DEFAULT_POINT_MERGE_EPSILON_MM
  const zeroSq = zeroLengthEpsilonMm * zeroLengthEpsilonMm
  const quantizeScale = 1 / Math.max(pointMergeEpsilonMm, 1e-12)

  const toggled = new Map<string, SliceSegmentEntry>()
  for (const entry of entries) {
    if (distanceSquared(entry.start, entry.end) <= zeroSq) continue

    const qStart = quantize(entry.start, quantizeScale)
    const qEnd = quantize(entry.end, quantizeScale)
    const keepDirection = compareQuantized(qStart, qEnd) <= 0
    const first = keepDirection ? qStart : qEnd
    const second = keepDirection ? qEnd : qStart
    const key = `${entry.meshIndex}|${quantizedKey(first)}|${quantizedKey(second)}`

    if (toggled.has(key)) {
      toggled.delete(key)
      continue
    }

    toggled.set(key, {
      meshIndex: entry.meshIndex,
      start: keepDirection
        ? [entry.start[0], entry.start[1], entry.start[2]]
        : [entry.end[0], entry.end[1], entry.end[2]],
      end: keepDirection
        ? [entry.end[0], entry.end[1], entry.end[2]]
        : [entry.start[0], entry.start[1], entry.start[2]],
    })
  }

  return Array.from(toggled.values())
}

export function normalizeSliceSegments(
  segments: Segment3D[],
  options?: SliceSegmentNormalizeOptions,
): Segment3D[] {
  return normalizeSliceSegmentEntries(
    segments.map((seg) => ({
      meshIndex: 0,
      start: seg.start,
      end: seg.end,
    })),
    options,
  ).map(({ start, end }) => ({ start, end }))
}
