# WebGPU 切面算法重写计划

## 目标
用 WebGPU Compute Shader 重写 mesh slicing 算法，保留 CPU fallback，支持 Chrome 136+。

---

## Phase 1: WebGPU 基础设施

### Task 1.1: GPU 设备管理器 (`src/core/gpu-device.ts`)
- 封装 `navigator.gpu` → `requestAdapter` → `requestDevice` 流程
- 探测 WebGPU 可用性，返回 `GPUDevice | null`
- 单例模式，避免重复初始化
- Chrome 136+ 无特殊 feature flag 需求，标准 API 即可

### Task 1.2: Slicer 接口抽象 (`src/core/slicer-interface.ts`)
- 定义统一接口 `MeshSlicer`：
  ```typescript
  interface MeshSlicer {
    init(mesh: MeshData): Promise<void>
    slice(normal: Vec3, anchor: Vec3): Promise<Segment3D[]>
    dispose(): void
  }
  ```
- CPU 和 GPU 实现都遵循此接口
- 工厂函数 `createSlicer()` 自动选择 GPU/CPU

---

## Phase 2: WGSL Compute Shader

### Task 2.1: Shader 编写 (`src/core/slicer.wgsl`)
算法直译当前 CPU 逻辑到 WGSL：
- Uniform buffer: `normal`, `anchor`, `epsilon`, `triCount`
- Storage buffer (read): `vertices: array<f32>`, `indices: array<u32>`
- Storage buffer (write): `segments: array<f32>` (每个 segment 6 个 float)
- Atomic counter: `segmentCount`
- 每个 workgroup 处理一批三角形，workgroup size = 64
- 核心逻辑：
  1. 计算三顶点 signed distance
  2. 同侧/共面 → 跳过
  3. 边交点插值
  4. 顶点在平面上的处理
  5. atomicAdd 写入 output buffer

### Task 2.2: 16 字节对齐与 Buffer 布局
- Uniform struct 对齐到 16 bytes：
  ```wgsl
  struct Params {
    normal: vec3f,    // offset 0
    _pad0: f32,       // offset 12
    anchor: vec3f,    // offset 16
    _pad1: f32,       // offset 28
    epsilon: f32,     // offset 32
    triCount: u32,    // offset 36
  }
  ```
- Output buffer 预分配 `triCount * 6 * 4` bytes（最坏情况每个三角形一条线段）
- Counter buffer: 4 bytes (u32)

---

## Phase 3: GPU Slicer 实现

### Task 3.1: `GPUSlicer` 类 (`src/core/gpu-slicer.ts`)
- `init(mesh)`: 创建 vertex/index storage buffer，上传数据
- `slice(normal, anchor)`:
  1. 写入 uniform buffer（normal, anchor, epsilon, triCount）
  2. 重置 counter buffer 为 0
  3. 创建 compute pass，dispatch `ceil(triCount / 64)` workgroups
  4. 读回 counter + segments（mapAsync staging buffer）
  5. 解析为 `Segment3D[]`
- `dispose()`: 销毁所有 GPU buffer
- BoundingBox 提前剔除仍在 CPU 侧做（避免额外 GPU roundtrip）

### Task 3.2: Pipeline 缓存
- Compute pipeline 和 bind group layout 在 `init` 时创建一次
- `slice` 调用只更新 uniform buffer + dispatch
- Bind group 在 mesh 不变时复用

---

## Phase 4: 集成与 Fallback

### Task 4.1: 重构 `CPUSlicer` (`src/core/cpu-slicer.ts`)
- 将现有 `sliceMesh` 包装为 `MeshSlicer` 接口实现
- 保持原有逻辑不变

### Task 4.2: 工厂函数 (`src/core/create-slicer.ts`)
```typescript
async function createSlicer(): Promise<MeshSlicer> {
  const device = await getGPUDevice()
  if (device) return new GPUSlicer(device)
  return new CPUSlicer()
}
```

### Task 4.3: SliceRenderer 适配
- `SliceRenderer` 改为异步初始化（`init()` 或构造后 `await ready`）
- `updateSlice` 内部调用 `slicer.slice()` (async)
- Demo UI 显示当前使用的后端（GPU/CPU）

---

## Phase 5: 测试与验证

### Task 5.1: 单元测试
- GPU slicer 与 CPU slicer 对同一 TEST_CUBE 输出结果一致性验证
- 三视图 + 自定义平面 + 边界情况
- WebGPU 不可用时自动 fallback 到 CPU

### Task 5.2: Demo 更新
- 页面显示 "GPU" / "CPU" 标签
- 性能对比（可选：显示切割耗时）

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `src/core/gpu-device.ts` |
| 新增 | `src/core/slicer-interface.ts` |
| 新增 | `src/core/slicer.wgsl` |
| 新增 | `src/core/gpu-slicer.ts` |
| 新增 | `src/core/cpu-slicer.ts` |
| 新增 | `src/core/create-slicer.ts` |
| 修改 | `src/renderer/slice-renderer.ts` — 异步化 |
| 修改 | `src/demo/main.ts` — 异步初始化 + 后端标签 |
| 修改 | `src/demo/index.html` — 后端状态显示 |
| 修改 | `src/index.ts` — 新增导出 |
| 新增 | `src/core/__tests__/gpu-slicer.test.ts` |

## 依赖关系

```
Phase 1 (1.1, 1.2) → Phase 2 (2.1, 2.2) → Phase 3 (3.1, 3.2)
                                              ↓
Phase 4 (4.1 可并行) ──────────────────→ Phase 4 (4.2, 4.3)
                                              ↓
                                        Phase 5 (5.1, 5.2)
```

## Chrome 136+ 兼容性说明
- Chrome 113+ 默认启用 WebGPU，136 完全支持标准 API
- 无需 origin trial 或 feature flag
- 使用标准 `navigator.gpu` 探测即可
- WGSL 语法使用稳定特性，不依赖实验性扩展
