import { createBatchSlicer } from '@/core/create-slicer'
import { createTestCube } from '@/core/test-data'
import { buildLocalBasis, projectPointTo2D } from '@/core/projection'
import { normalize } from '@/core/vec3'
import { BrushOverlayRenderer } from '@/renderer/brush-overlay-renderer'
import { MultiViewManager } from '@/renderer/multi-view-manager'
import { createBrushEngine2DWithClipper2Wasm } from '@/core/brush/brush-engine-2d'
import { createBrushEngine3D } from '@/core/brush/brush-engine-3d'
import { createBrushSession } from '@/core/brush/brush-session'
import { MPR_VIEWS } from '@/types'
import type { MeshColor, CameraData, Vec3, Segment3D } from '@/types'
import type { BrushMode, Segment2D as BrushSegment2D, Vec2 } from '@/core/brush/brush-types'

const SCALE = 3
const DEMO_MESH_COLOR: MeshColor = [0.91, 0.27, 0.38, 1]
const DEFAULT_BRUSH_RADIUS_MM = 6

function meshColorToCss(color: MeshColor): string {
  const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255)
  const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255)
  const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255)
  return `rgb(${r}, ${g}, ${b})`
}

const ACTIVE_MESH_COLOR_CSS = meshColorToCss(DEMO_MESH_COLOR)

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const slider = document.getElementById('slider') as HTMLInputElement
const sliderValue = document.getElementById('slider-value') as HTMLSpanElement
const backendLabel = document.getElementById('backend-label') as HTMLSpanElement

const btnAxial = document.getElementById('btn-axial') as HTMLButtonElement
const btnSagittal = document.getElementById('btn-sagittal') as HTMLButtonElement
const btnCoronal = document.getElementById('btn-coronal') as HTMLButtonElement
const btnCustom = document.getElementById('btn-custom') as HTMLButtonElement
const customPanel = document.getElementById('custom-panel') as HTMLDivElement

const nxInput = document.getElementById('nx') as HTMLInputElement
const nyInput = document.getElementById('ny') as HTMLInputElement
const nzInput = document.getElementById('nz') as HTMLInputElement
const uxInput = document.getElementById('ux') as HTMLInputElement
const uyInput = document.getElementById('uy') as HTMLInputElement
const uzInput = document.getElementById('uz') as HTMLInputElement

const brushModeAddBtn = document.getElementById('btn-brush-add') as HTMLButtonElement
const brushModeEraseBtn = document.getElementById('btn-brush-erase') as HTMLButtonElement
const brushRadiusInput = document.getElementById('brush-radius') as HTMLInputElement
const brushRadiusLabel = document.getElementById('brush-radius-value') as HTMLSpanElement

let currentView = 'Axial'
let updateToken = 0
let navigationLocked = false
let pointerDown = false
let lastPointerLocalMm: Vec2 | null = null

let currentMesh = createTestCube()
let currentMeshId = 'mesh-0'
let currentCamera: CameraData = MPR_VIEWS[currentView]
let currentAnchor: Vec3 = [0, 0, 0]

let brushMode: BrushMode = 'add'
let brushRadiusMm = Number(brushRadiusInput.value) || DEFAULT_BRUSH_RADIUS_MM
brushRadiusLabel.textContent = `${brushRadiusMm} mm`

const overlayRenderer = new BrushOverlayRenderer(canvas, {
  scale: SCALE,
  activeColor: ACTIVE_MESH_COLOR_CSS,
  brushColor: ACTIVE_MESH_COLOR_CSS,
  showBrushTrail: false,
  activeLineWidthPx: 2,
})

const commitEngine = createBrushEngine3D({
  backend: 'manifold',
  brushContourPoints: 40,
  cutterDepthPaddingMm: 2,
  idPrefix: 'demo-brush',
})

async function createDemoPreviewEngine() {
  return createBrushEngine2DWithClipper2Wasm({
    brushContourPoints: 40,
  })
}

function getCustomCamera(): CameraData {
  const normalVec = normalize([
    Number(nxInput.value) || 0,
    Number(nyInput.value) || 0,
    Number(nzInput.value) || 0,
  ])
  const viewUpVec = normalize([
    Number(uxInput.value) || 0,
    Number(uyInput.value) || 0,
    Number(uzInput.value) || 1,
  ])
  return { viewPlaneNormal: normalVec, viewUp: viewUpVec }
}

function getCurrentCamera(): CameraData {
  if (currentView === 'Custom') return getCustomCamera()
  return MPR_VIEWS[currentView]
}

function getAnchor(camera: CameraData, offset: number): Vec3 {
  const n = camera.viewPlaneNormal
  return [-n[0] * offset, -n[1] * offset, -n[2] * offset]
}

function toBrushSegments(
  segments3D: Segment3D[],
  camera: CameraData,
  anchor: Vec3,
): BrushSegment2D[] {
  const basis = buildLocalBasis(camera.viewPlaneNormal, camera.viewUp)
  return segments3D.map((seg) => {
    const a2 = projectPointTo2D(seg.start, anchor, basis)
    const b2 = projectPointTo2D(seg.end, anchor, basis)
    return {
      a: { x: a2[0], y: a2[1] },
      b: { x: b2[0], y: b2[1] },
    }
  })
}

function updateBrushButtons(): void {
  brushModeAddBtn.classList.toggle('active', brushMode === 'add')
  brushModeEraseBtn.classList.toggle('active', brushMode === 'erase')
}

function setNavigationLock(locked: boolean): void {
  navigationLocked = locked

  slider.disabled = locked
  btnAxial.disabled = locked
  btnSagittal.disabled = locked
  btnCoronal.disabled = locked
  btnCustom.disabled = locked

  nxInput.disabled = locked
  nyInput.disabled = locked
  nzInput.disabled = locked
  uxInput.disabled = locked
  uyInput.disabled = locked
  uzInput.disabled = locked
}

function canvasToLocalMm(event: MouseEvent): Vec2 {
  const rect = canvas.getBoundingClientRect()
  const xPx = event.clientX - rect.left
  const yPx = event.clientY - rect.top
  return {
    x: (xPx - canvas.width * 0.5) / SCALE,
    y: (canvas.height * 0.5 - yPx) / SCALE,
  }
}

async function main() {
  const batchSlicer = await createBatchSlicer()
  if (!batchSlicer) {
    backendLabel.textContent = '后端: ❌ GPU Bitmap 不可用（已禁用 fallback）'
    throw new Error('BatchGPUSlicer initialization failed: fallback renderer is disabled')
  }
  const activeSlicer = batchSlicer

  const multiViewManager = new MultiViewManager()
  backendLabel.textContent = '后端: 🟢 GPU Bitmap (WebGPU) + Brush Session'
  await activeSlicer.initBatch([currentMesh], [DEMO_MESH_COLOR])
  const previewEngine = await createDemoPreviewEngine()

  const brushSession = createBrushSession([], {
    previewEngine,
    commitEngine,
    createCommitInput: () => {
      const basis = buildLocalBasis(currentCamera.viewPlaneNormal, currentCamera.viewUp)
      return {
        meshId: currentMeshId,
        mesh: currentMesh,
        slicePlane: {
          normal: [...currentCamera.viewPlaneNormal] as Vec3,
          anchor: [...currentAnchor] as Vec3,
          xAxis: basis.xAxis,
          yAxis: basis.yAxis,
        },
      }
    },
    requestReslice: async () => {
      const seg3d = await activeSlicer.sliceBatchFlat(currentCamera.viewPlaneNormal, currentAnchor)
      return toBrushSegments(seg3d, currentCamera, currentAnchor)
    },
    onCommitFail: (error) => {
      console.error('Brush commit failed:', error)
    },
  })

  multiViewManager.registerView({
    id: 'main',
    refresh: async () => {
      await update()
    },
  })

  async function update(): Promise<void> {
    if (navigationLocked) return

    const token = ++updateToken
    const offset = Number(slider.value)
    sliderValue.textContent = `${offset} mm`
    const cameraSnapshot = getCurrentCamera()
    const anchorSnapshot = getAnchor(cameraSnapshot, offset)
    currentCamera = cameraSnapshot
    currentAnchor = anchorSnapshot

    try {
      const segments3D = await activeSlicer.sliceBatchFlat(
        cameraSnapshot.viewPlaneNormal,
        anchorSnapshot,
      )
      if (token !== updateToken) return
      const activeSegments = toBrushSegments(segments3D, cameraSnapshot, anchorSnapshot)
      brushSession.setBaseSegments(activeSegments)
      overlayRenderer.renderCommittedActive(activeSegments)

      if (!pointerDown && lastPointerLocalMm) {
        overlayRenderer.renderCursor(lastPointerLocalMm, brushRadiusMm, brushMode)
      }
    } catch (err) {
      console.error('Brush path update failed:', err)
    }
  }

  const allButtons = [btnAxial, btnSagittal, btnCoronal, btnCustom]
  const viewNames = ['Axial', 'Sagittal', 'Coronal', 'Custom']

  function switchView(viewName: string): void {
    if (navigationLocked) return

    currentView = viewName
    allButtons.forEach((btn, i) => {
      btn.classList.toggle('active', viewNames[i] === viewName)
    })
    customPanel.style.display = viewName === 'Custom' ? 'flex' : 'none'

    brushSession.invalidate('cameraRotate')

    void update()
  }

  async function commitCurrentStroke(): Promise<void> {
    if (brushSession.currentState !== 'drawing') return

    try {
      const commit = await brushSession.endStroke()
      currentMesh = commit.mesh
      currentMeshId = commit.newMeshId

      await activeSlicer.updateMesh(0, currentMesh)

      await multiViewManager.refreshOtherViews('main', 'meshUpdated')
      await update()
    } catch (error) {
      console.error('Commit stroke failed:', error)
      overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
    } finally {
      setNavigationLock(false)
    }
  }

  btnAxial.addEventListener('click', () => switchView('Axial'))
  btnSagittal.addEventListener('click', () => switchView('Sagittal'))
  btnCoronal.addEventListener('click', () => switchView('Coronal'))
  btnCustom.addEventListener('click', () => switchView('Custom'))
  slider.addEventListener('input', () => {
    if (navigationLocked) return
    brushSession.invalidate('anchorScroll')
    void update()
  })

  for (const input of [nxInput, nyInput, nzInput, uxInput, uyInput, uzInput]) {
    input.addEventListener('input', () => {
      if (navigationLocked) return
      if (currentView === 'Custom') {
        brushSession.invalidate('cameraRotate')
        void update()
      }
    })
  }

  brushModeAddBtn.addEventListener('click', () => {
    if (navigationLocked) return
    brushMode = 'add'
    updateBrushButtons()
    if (lastPointerLocalMm) {
      overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
      overlayRenderer.renderCursor(lastPointerLocalMm, brushRadiusMm, brushMode)
    }
  })

  brushModeEraseBtn.addEventListener('click', () => {
    if (navigationLocked) return
    brushMode = 'erase'
    updateBrushButtons()
    if (lastPointerLocalMm) {
      overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
      overlayRenderer.renderCursor(lastPointerLocalMm, brushRadiusMm, brushMode)
    }
  })

  brushRadiusInput.addEventListener('input', () => {
    brushRadiusMm = Math.max(0.1, Number(brushRadiusInput.value) || DEFAULT_BRUSH_RADIUS_MM)
    brushRadiusLabel.textContent = `${brushRadiusMm} mm`

    if (lastPointerLocalMm) {
      overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
      overlayRenderer.renderCursor(lastPointerLocalMm, brushRadiusMm, brushMode)
    }
  })

  canvas.addEventListener('mousedown', (event) => {
    if (brushSession.currentState !== 'idle') return

    pointerDown = true
    const localPoint = canvasToLocalMm(event)
    lastPointerLocalMm = localPoint

    try {
      brushSession.beginStroke(localPoint, brushRadiusMm, brushMode)
      const preview = brushSession.appendPoint(localPoint)
      if (preview) {
        overlayRenderer.renderPreview(
          preview.nextSegments,
          preview.brushPolygon2D ?? [],
          brushMode,
        )
      }
      overlayRenderer.renderCursor(localPoint, brushRadiusMm, brushMode)
      setNavigationLock(true)
    } catch (err) {
      pointerDown = false
      console.error('Begin stroke failed:', err)
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    const localPoint = canvasToLocalMm(event)
    lastPointerLocalMm = localPoint

    if (brushSession.currentState === 'drawing' && pointerDown) {
      // Use coalesced events for higher-resolution sampling during strokes
      const coalescedEvents = event.getCoalescedEvents?.() ?? []
      let preview: ReturnType<typeof brushSession.appendPoint> = null
      for (const ce of coalescedEvents) {
        const coalescedPreview = brushSession.appendPoint(canvasToLocalMm(ce))
        if (coalescedPreview) {
          preview = coalescedPreview
        }
      }
      // Always include the dispatch event's point to avoid losing the tail sample.
      const currentPreview = brushSession.appendPoint(localPoint)
      if (currentPreview) {
        preview = currentPreview
      }
      if (preview) {
        overlayRenderer.renderPreview(
          preview.nextSegments,
          preview.brushPolygon2D ?? [],
          brushMode,
        )
      }
      overlayRenderer.renderCursor(localPoint, brushRadiusMm, brushMode)
      return
    }

    overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
    overlayRenderer.renderCursor(localPoint, brushRadiusMm, brushMode)
  })

  window.addEventListener('mouseup', (event) => {
    if (!pointerDown) return

    if (brushSession.currentState === 'drawing') {
      const localPoint = canvasToLocalMm(event)
      lastPointerLocalMm = localPoint
      const preview = brushSession.appendPoint(localPoint)
      if (preview) {
        overlayRenderer.renderPreview(
          preview.nextSegments,
          preview.brushPolygon2D ?? [],
          brushMode,
        )
      }
      overlayRenderer.renderCursor(localPoint, brushRadiusMm, brushMode)
    }

    pointerDown = false
    void commitCurrentStroke()
  })

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return

    if (brushSession.currentState === 'drawing') {
      brushSession.cancelStroke()
      overlayRenderer.renderCommittedActive(brushSession.getCurrentSegments())
      setNavigationLock(false)
      pointerDown = false
    }
  })

  updateBrushButtons()
  await update()
}

void main().catch((error) => {
  console.error('Demo initialization failed:', error)
})
