import { createSlicer, createBatchSlicer } from '@/core/create-slicer'
import { generateMeshBatch } from '@/core/mesh-generator'
import { buildLocalBasis, projectSegments } from '@/core/projection'
import { CanvasRenderer } from '@/renderer/canvas-renderer'
import { MPR_VIEWS } from '@/types'
import type { MeshSlicer } from '@/core/slicer-interface'
import type { BatchMeshSlicer } from '@/core/batch-slicer-interface'
import type { MeshColor, MeshData, CameraData, Vec3, Segment3D } from '@/types'

const BENCH_SEED = 42
const MESH_COUNT = 80

const status = document.getElementById('status') as HTMLParagraphElement
const log = document.getElementById('log') as HTMLDivElement
const bitmapCanvas = document.getElementById('canvas-bitmap') as HTMLCanvasElement
const segmentCanvas = document.getElementById('canvas-segment') as HTMLCanvasElement
const diffCanvas = document.getElementById('canvas-diff') as HTMLCanvasElement
const slider = document.getElementById('slider') as HTMLInputElement
const sliderValue = document.getElementById('slider-value') as HTMLSpanElement
const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement
const btnRun = document.getElementById('btn-run') as HTMLButtonElement
const btnAxial = document.getElementById('btn-axial') as HTMLButtonElement
const btnSagittal = document.getElementById('btn-sagittal') as HTMLButtonElement
const btnCoronal = document.getElementById('btn-coronal') as HTMLButtonElement

const bitmapCanvas2D = bitmapCanvas.getContext('2d') as CanvasRenderingContext2D
if (!bitmapCanvas2D) throw new Error('Failed to get bitmap canvas 2D context')
const segmentCanvas2D = segmentCanvas.getContext('2d') as CanvasRenderingContext2D
if (!segmentCanvas2D) throw new Error('Failed to get segment canvas 2D context')
const diffCanvas2D = diffCanvas.getContext('2d') as CanvasRenderingContext2D
if (!diffCanvas2D) throw new Error('Failed to get diff canvas 2D context')

const segmentRenderer = new CanvasRenderer(segmentCanvas, {
  color: '#e94560',
  lineWidth: 1,
  scale: 3,
})

const DIFF_ALPHA_THRESHOLD = 16
const DIFF_WARN_RATE = 0.08

let slicer: MeshSlicer | null = null
let batchSlicer: BatchMeshSlicer | null = null
let meshes: MeshData[] = []
let batchInited = false
let currentView = 'Axial'
let runToken = 0

function appendLog(msg: string, cls = ''): void {
  const span = document.createElement('span')
  if (cls) span.className = cls
  span.textContent = msg + '\n'
  log.appendChild(span)
  log.scrollTop = log.scrollHeight
}

function clearLog(): void {
  log.innerHTML = ''
}

interface DisplayDiffStats {
  unionPixels: number
  overlapPixels: number
  onlyNewPixels: number
  onlyOldPixels: number
  diffPixels: number
  diffRate: number
  overlapRate: number
}

/** 统计辅助 */
function computeStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((s, t) => s + t, 0)
  return {
    total: sum,
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

function createMeshColors(count: number): MeshColor[] {
  const colors: MeshColor[] = []

  for (let i = 0; i < count; i++) {
    const hue = count <= 1 ? 0 : i / count
    const h = hue * 6
    const s = 0.8
    const v = 0.95
    const c = v * s
    const x = c * (1 - Math.abs((h % 2) - 1))
    const m = v - c

    let r = 0
    let g = 0
    let b = 0

    if (h >= 0 && h < 1) { r = c; g = x }
    else if (h >= 1 && h < 2) { r = x; g = c }
    else if (h >= 2 && h < 3) { g = c; b = x }
    else if (h >= 3 && h < 4) { g = x; b = c }
    else if (h >= 4 && h < 5) { r = x; b = c }
    else { r = c; b = x }

    colors.push([r + m, g + m, b + m, 1])
  }

  return colors
}

function detectDisplayDiff(): DisplayDiffStats {
  const width = Math.min(bitmapCanvas.width, segmentCanvas.width, diffCanvas.width)
  const height = Math.min(bitmapCanvas.height, segmentCanvas.height, diffCanvas.height)

  const newData = bitmapCanvas2D.getImageData(0, 0, width, height).data
  const oldData = segmentCanvas2D.getImageData(0, 0, width, height).data
  const diffImage = diffCanvas2D.createImageData(width, height)
  const diffData = diffImage.data

  let unionPixels = 0
  let overlapPixels = 0
  let onlyNewPixels = 0
  let onlyOldPixels = 0

  for (let i = 0; i < newData.length; i += 4) {
    const newOn = newData[i + 3] > DIFF_ALPHA_THRESHOLD
    const oldOn = oldData[i + 3] > DIFF_ALPHA_THRESHOLD

    if (newOn || oldOn) unionPixels++

    if (newOn && oldOn) {
      overlapPixels++
      diffData[i] = 78
      diffData[i + 1] = 205
      diffData[i + 2] = 196
      diffData[i + 3] = 180
      continue
    }

    if (newOn) {
      onlyNewPixels++
      diffData[i] = 249
      diffData[i + 1] = 168
      diffData[i + 2] = 37
      diffData[i + 3] = 220
      continue
    }

    if (oldOn) {
      onlyOldPixels++
      diffData[i] = 233
      diffData[i + 1] = 69
      diffData[i + 2] = 96
      diffData[i + 3] = 220
      continue
    }

    diffData[i + 3] = 0
  }

  diffCanvas2D.clearRect(0, 0, diffCanvas.width, diffCanvas.height)
  diffCanvas2D.putImageData(diffImage, 0, 0)

  const diffPixels = onlyNewPixels + onlyOldPixels
  const diffRate = unionPixels > 0 ? diffPixels / unionPixels : 0
  const overlapRate = unionPixels > 0 ? overlapPixels / unionPixels : 1

  return {
    unionPixels,
    overlapPixels,
    onlyNewPixels,
    onlyOldPixels,
    diffPixels,
    diffRate,
    overlapRate,
  }
}

async function initSlicers(): Promise<void> {
  slicer = await createSlicer()
  batchSlicer = await createBatchSlicer()

  const batchStatus = batchSlicer ? '🟢 可用' : '🔴 不可用'
  status.textContent = `后端: ${slicer.backend === 'gpu' ? '🟢 GPU' : '🔵 CPU'} | 批量: ${batchStatus}`
  appendLog(`Slicer 初始化完成，后端: ${slicer.backend}，批量: ${batchStatus}`, 'stat')
}

async function generateMeshes(): Promise<void> {
  btnGenerate.disabled = true
  clearLog()
  appendLog(`开始生成 ${MESH_COUNT} 个随机 Mesh（seed=${BENCH_SEED}）...`)

  const t0 = performance.now()
  meshes = generateMeshBatch(MESH_COUNT, 20000, 380000, BENCH_SEED)
  const elapsed = performance.now() - t0

  let totalVerts = 0
  let totalTris = 0
  let minV = Infinity
  let maxV = 0

  for (const m of meshes) {
    const vCount = m.vertices.length / 3
    totalVerts += vCount
    totalTris += m.indices.length / 3
    if (vCount < minV) minV = vCount
    if (vCount > maxV) maxV = vCount
  }

  appendLog(`生成完成，耗时 ${elapsed.toFixed(0)} ms`, 'stat')
  appendLog(`  Mesh 数量: ${meshes.length}`)
  appendLog(`  总顶点数: ${(totalVerts / 1e6).toFixed(2)}M`)
  appendLog(`  总三角形数: ${(totalTris / 1e6).toFixed(2)}M`)
  appendLog(`  单 Mesh 顶点范围: ${minV} ~ ${maxV}`)
  appendLog(`  平均顶点数: ${Math.round(totalVerts / meshes.length)}`)
  appendLog('')

  if (batchSlicer) {
    const tBatch = performance.now()
    const colors = createMeshColors(meshes.length)
    await batchSlicer.initBatch(meshes, colors)
    batchInited = true
    appendLog(`Batch initBatch + 80色表 耗时: ${(performance.now() - tBatch).toFixed(1)} ms`, 'stat')
    appendLog('')
  }

  btnGenerate.disabled = false
  btnRun.disabled = false
}

// ==================== Single Mesh Benchmark ====================

async function runSingleBenchmark(
  camera: CameraData,
  anchor: Vec3,
): Promise<{ segments: Segment3D[]; initTime: number; sliceTime: number; timings: number[] }> {
  if (!slicer) return { segments: [], initTime: 0, sliceTime: 0, timings: [] }

  const allSegments: Segment3D[] = []
  const sliceTimings: number[] = []
  let totalInitTime = 0

  for (let i = 0; i < meshes.length; i++) {
    const t0 = performance.now()
    await slicer.init(meshes[i])
    totalInitTime += performance.now() - t0

    const t1 = performance.now()
    const segs = await slicer.slice(camera.viewPlaneNormal, anchor)
    sliceTimings.push(performance.now() - t1)

    allSegments.push(...segs)
  }

  const sliceStats = computeStats(sliceTimings)
  return {
    segments: allSegments,
    initTime: totalInitTime,
    sliceTime: sliceStats.total,
    timings: sliceTimings,
  }
}

// ==================== Batch Bitmap Benchmark ====================

async function runBatchBenchmark(
  camera: CameraData,
  anchor: Vec3,
): Promise<{ bitmap: ImageBitmap; initTime: number; sliceTime: number } | null> {
  if (!batchSlicer || !batchInited) return null

  try {
    for (let w = 0; w < 2; w++) {
      const warmup = await batchSlicer.sliceToBitmap(
        camera.viewPlaneNormal,
        anchor,
        {
          viewUp: camera.viewUp,
          width: bitmapCanvas.width,
          height: bitmapCanvas.height,
          scale: segmentRenderer.scale,
        },
      )
      warmup.close()
    }

    const t1 = performance.now()
    const bitmap = await batchSlicer.sliceToBitmap(
        camera.viewPlaneNormal,
        anchor,
        {
          viewUp: camera.viewUp,
          width: bitmapCanvas.width,
          height: bitmapCanvas.height,
          scale: segmentRenderer.scale,
        },
      )
    const sliceTime = performance.now() - t1

    return { bitmap, initTime: 0, sliceTime }
  } catch (err) {
    appendLog(`⚠ 批量位图路径失败，回退到单 mesh: ${err}`, 'err')
    return null
  }
}

// ==================== Main Benchmark ====================

async function runBenchmark(): Promise<void> {
  if (!slicer || meshes.length === 0) return

  const token = ++runToken
  btnRun.disabled = true
  const camera = MPR_VIEWS[currentView]
  const offset = Number(slider.value)
  const anchor = getAnchor(camera, offset)
  diffCanvas2D.clearRect(0, 0, diffCanvas.width, diffCanvas.height)

  try {
    appendLog(`--- 切面测试: ${currentView}, offset=${offset}mm ---`)

    appendLog(`\n[Single] 正在逐个执行 init + slice（${meshes.length} meshes）...`)
    const singleTask = runSingleBenchmark(camera, anchor).then((singleResult) => {
      const singleTimings = computeStats(singleResult.timings)
      const singleTotal = singleResult.initTime + singleResult.sliceTime

      if (token === runToken) {
        appendLog(`[Single] Init 总耗时: ${singleResult.initTime.toFixed(1)} ms`)
        appendLog(`[Single] Slice 总耗时: ${singleResult.sliceTime.toFixed(1)} ms`, 'stat')
        appendLog(`[Single] Slice P50: ${singleTimings.p50.toFixed(2)} ms`)
        appendLog(`[Single] Slice P95: ${singleTimings.p95.toFixed(2)} ms`, 'warn')
        appendLog(`[Single] Slice P99: ${singleTimings.p99.toFixed(2)} ms`, 'warn')
        appendLog(`[Single] 总耗时: ${singleTotal.toFixed(1)} ms`, 'stat')
        appendLog(`[Single] 线段数: ${singleResult.segments.length}`, 'stat')
        renderAllSegments(singleResult.segments, camera, anchor)
      }

      return { singleResult, singleTimings, singleTotal }
    })

    let batchTask: Promise<{ bitmap: ImageBitmap; initTime: number; sliceTime: number } | null>
    if (batchSlicer) {
      appendLog(`\n[BatchBitmap] 正在执行批量切面 + GPU多色渲染（${meshes.length} meshes）...`)
      batchTask = runBatchBenchmark(camera, anchor).then((batchResult) => {
        if (token !== runToken) {
          batchResult?.bitmap.close()
          return batchResult
        }

        if (batchResult) {
          const batchTotal = batchResult.initTime + batchResult.sliceTime
          appendLog(`[BatchBitmap] Init: ${batchResult.initTime.toFixed(1)} ms`, 'stat')
          appendLog(`[BatchBitmap] Slice+Render: ${batchResult.sliceTime.toFixed(1)} ms`, 'stat')
          appendLog(`[BatchBitmap] 总耗时: ${batchTotal.toFixed(1)} ms`, 'stat')
          bitmapCanvas2D.clearRect(0, 0, bitmapCanvas.width, bitmapCanvas.height)
          bitmapCanvas2D.drawImage(batchResult.bitmap, 0, 0, bitmapCanvas.width, bitmapCanvas.height)
          batchResult.bitmap.close()
          appendLog(`Bitmap Canvas: drawImage 输出 80 mesh 多色切面图`, 'stat')
        } else {
          bitmapCanvas2D.clearRect(0, 0, bitmapCanvas.width, bitmapCanvas.height)
          appendLog(`Bitmap Canvas: 无可用输出（batch 不可用）`, 'warn')
        }

        return batchResult
      })
    } else {
      batchTask = Promise.resolve(null)
    }

    const [singleSettled, batchSettled] = await Promise.allSettled([singleTask, batchTask])

    if (singleSettled.status === 'rejected') {
      appendLog(`[Single] 执行失败: ${singleSettled.reason}`, 'err')
    }
    if (batchSettled.status === 'rejected') {
      appendLog(`[BatchBitmap] 执行失败: ${batchSettled.reason}`, 'err')
    }

    const singleData = singleSettled.status === 'fulfilled' ? singleSettled.value : null
    const batchResult = batchSettled.status === 'fulfilled' ? batchSettled.value : null

    if (token === runToken && batchResult && singleData) {
      const batchTotal = batchResult.initTime + batchResult.sliceTime
      const speedup = singleData.singleTotal / batchTotal
      const diffStats = detectDisplayDiff()
      appendLog('')
      appendLog(`=== 对比 ===`, 'stat')
      appendLog(`  Single 总耗时: ${singleData.singleTotal.toFixed(1)} ms`)
      appendLog(`  BatchBitmap 总耗时: ${batchTotal.toFixed(1)} ms`)
      appendLog(`  加速比: ${speedup.toFixed(1)}x`, speedup >= 2 ? 'stat' : 'warn')
      appendLog('')
      appendLog(`=== 显示差异检测 ===`, 'stat')
      appendLog(`  重叠像素: ${diffStats.overlapPixels}`)
      appendLog(`  仅 New 像素: ${diffStats.onlyNewPixels}`)
      appendLog(`  仅 Old 像素: ${diffStats.onlyOldPixels}`)
      appendLog(`  差异率: ${(diffStats.diffRate * 100).toFixed(2)}%`, diffStats.diffRate <= DIFF_WARN_RATE ? 'stat' : 'warn')
      appendLog(`  重叠率(IoU): ${(diffStats.overlapRate * 100).toFixed(2)}%`, diffStats.overlapRate >= (1 - DIFF_WARN_RATE) ? 'stat' : 'warn')
      appendLog(`Diff Canvas: 青色=重叠，橙色=仅 New，红色=仅 Old`)

      const jsonResult = {
        view: currentView,
        offset,
        seed: BENCH_SEED,
        meshCount: MESH_COUNT,
        single: {
          initMs: +singleData.singleResult.initTime.toFixed(1),
          sliceMs: +singleData.singleResult.sliceTime.toFixed(1),
          totalMs: +singleData.singleTotal.toFixed(1),
          segments: singleData.singleResult.segments.length,
          p50: +singleData.singleTimings.p50.toFixed(2),
          p95: +singleData.singleTimings.p95.toFixed(2),
          p99: +singleData.singleTimings.p99.toFixed(2),
        },
        batchBitmap: {
          initMs: +batchResult.initTime.toFixed(1),
          totalMs: +batchTotal.toFixed(1),
        },
        displayDiff: {
          unionPixels: diffStats.unionPixels,
          overlapPixels: diffStats.overlapPixels,
          onlyNewPixels: diffStats.onlyNewPixels,
          onlyOldPixels: diffStats.onlyOldPixels,
          diffPixels: diffStats.diffPixels,
          diffRate: +diffStats.diffRate.toFixed(4),
          overlapRate: +diffStats.overlapRate.toFixed(4),
        },
        speedup: +speedup.toFixed(1),
      }
      appendLog('')
      appendLog(`JSON: ${JSON.stringify(jsonResult)}`)
    }
  } catch (err) {
    appendLog(`⚠ 运行失败: ${err}`, 'err')
    console.error('runBenchmark failed:', err)
  } finally {
    if (token === runToken) {
      appendLog('')
      btnRun.disabled = false
    }
  }
}

function requestBenchmarkRun(): void {
  if (!slicer || meshes.length === 0) return

  void runBenchmark()
}

function getAnchor(camera: CameraData, offset: number): Vec3 {
  const n = camera.viewPlaneNormal
  return [-n[0] * offset, -n[1] * offset, -n[2] * offset]
}

function renderAllSegments(
  segments3D: Segment3D[],
  camera: CameraData,
  anchor: Vec3,
): void {
  const basis = buildLocalBasis(camera.viewPlaneNormal, camera.viewUp)
  const segments2D = projectSegments(
    segments3D,
    anchor,
    basis,
    segmentCanvas.width,
    segmentCanvas.height,
    segmentRenderer.scale,
  )
  segmentRenderer.drawSegments(segments2D)
  appendLog(`Segment Canvas: 渲染 ${segments2D.length} 条 2D 线段`, 'stat')
}

btnGenerate.addEventListener('click', generateMeshes)
btnRun.addEventListener('click', requestBenchmarkRun)

btnAxial.addEventListener('click', () => { currentView = 'Axial'; requestBenchmarkRun() })
btnSagittal.addEventListener('click', () => { currentView = 'Sagittal'; requestBenchmarkRun() })
btnCoronal.addEventListener('click', () => { currentView = 'Coronal'; requestBenchmarkRun() })
slider.addEventListener('change', () => {
  sliderValue.textContent = `${slider.value} mm`
  if (meshes.length > 0) requestBenchmarkRun()
})

initSlicers()
