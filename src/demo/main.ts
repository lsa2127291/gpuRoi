import { createBatchSlicer } from '@/core/create-slicer'
import { createTestCube } from '@/core/test-data'
import { normalize } from '@/core/vec3'
import { SliceRenderer } from '@/renderer/slice-renderer'
import { MPR_VIEWS } from '@/types'
import type { MeshColor, CameraData, Vec3 } from '@/types'

const SCALE = 3
const DEMO_MESH_COLOR: MeshColor = [0.91, 0.27, 0.38, 1]

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

const canvas2D = canvas.getContext('2d') as CanvasRenderingContext2D
if (!canvas2D) throw new Error('Failed to get 2D canvas context')

let currentView = 'Axial'
let updateToken = 0

function getCustomCamera(): CameraData {
  const normal = normalize([
    Number(nxInput.value) || 0,
    Number(nyInput.value) || 0,
    Number(nzInput.value) || 0,
  ])
  const viewUp = normalize([
    Number(uxInput.value) || 0,
    Number(uyInput.value) || 0,
    Number(uzInput.value) || 1,
  ])
  return { viewPlaneNormal: normal, viewUp }
}

function getCurrentCamera(): CameraData {
  if (currentView === 'Custom') return getCustomCamera()
  return MPR_VIEWS[currentView]
}

function getAnchor(camera: CameraData, offset: number): Vec3 {
  const n = camera.viewPlaneNormal
  return [-n[0] * offset, -n[1] * offset, -n[2] * offset]
}

async function main() {
  const mesh = createTestCube()

  const batchSlicer = await createBatchSlicer()
  let fallbackRenderer: SliceRenderer | null = null

  if (batchSlicer) {
    backendLabel.textContent = '后端: 🟢 GPU Bitmap (WebGPU)'
    await batchSlicer.initBatch([mesh], [DEMO_MESH_COLOR])
  } else {
    fallbackRenderer = new SliceRenderer(canvas)
    await fallbackRenderer.ready()
    const label = fallbackRenderer.backend === 'gpu' ? '🟢 GPU (WebGPU)' : '🔵 CPU (Fallback)'
    backendLabel.textContent = `后端: ${label}`
    await fallbackRenderer.setMesh(mesh)
    await fallbackRenderer.setRenderStyle('#e94560', 2, SCALE)
  }

  async function update(): Promise<void> {
    const token = ++updateToken
    const offset = Number(slider.value)
    sliderValue.textContent = `${offset} mm`
    const camera = getCurrentCamera()
    const anchor = getAnchor(camera, offset)

    if (batchSlicer) {
      try {
        const bitmap = await batchSlicer.sliceToBitmap(
          camera.viewPlaneNormal,
          anchor,
          {
            viewUp: camera.viewUp,
            width: canvas.width,
            height: canvas.height,
            scale: SCALE,
          },
        )

        if (token !== updateToken) {
          bitmap.close()
          return
        }

        canvas2D.clearRect(0, 0, canvas.width, canvas.height)
        canvas2D.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
      } catch (err) {
        console.error('Bitmap rendering failed:', err)
      }
      return
    }

    if (fallbackRenderer) {
      await fallbackRenderer.updateSlice(camera, anchor)
    }
  }

  const allButtons = [btnAxial, btnSagittal, btnCoronal, btnCustom]
  const viewNames = ['Axial', 'Sagittal', 'Coronal', 'Custom']

  function switchView(viewName: string): void {
    currentView = viewName
    allButtons.forEach((btn, i) => {
      btn.classList.toggle('active', viewNames[i] === viewName)
    })
    customPanel.style.display = viewName === 'Custom' ? 'flex' : 'none'
    void update()
  }

  btnAxial.addEventListener('click', () => switchView('Axial'))
  btnSagittal.addEventListener('click', () => switchView('Sagittal'))
  btnCoronal.addEventListener('click', () => switchView('Coronal'))
  btnCustom.addEventListener('click', () => switchView('Custom'))
  slider.addEventListener('input', () => { void update() })

  for (const input of [nxInput, nyInput, nzInput, uxInput, uyInput, uzInput]) {
    input.addEventListener('input', () => {
      if (currentView === 'Custom') {
        void update()
      }
    })
  }

  await update()
}

main()
