# Findings & Decisions

## Requirements
- 目标是完成 `doc/笔刷功能-实现计划.md` 的 M1-M3（不含 M4 性能验收）。
- 需要覆盖：2D 预览引擎、会话状态机、动态渲染接线、3D 提交闭环、mesh 更新与多视图刷新。
- 必须保留现有 `BatchGPUSlicer` 与 demo 的兼容性。

## Research Findings
- 现状没有 `src/core/brush/`、`src/core/gpu/webgpu-line-renderer.ts`、`src/renderer/brush-overlay-renderer.ts`、`src/renderer/multi-view-manager.ts`。
- `BatchMeshSlicer` 当前仅有 `initBatch/sliceBatch/sliceBatchFlat/sliceToBitmap`，缺少 `updateMesh` 与 filter 接口。
- `src/core/slicer-batch-bitmap.wgsl` 已是 triangle-list instanced line 渲染，但没有 mesh filter uniform。
- `src/demo/main.ts` 当前是单 canvas 单 mesh 基础 demo，可作为笔刷接入起点。
- `doc/task-mesh-update.md` 是更早版本任务清单，与 V3 计划不完全一致（如 `subtract` vs `erase`）。
- 已新增 `core/brush` 模块：类型、轨迹简化、2D 预览引擎、3D 提交引擎、会话状态机。
- 已新增 `core/gpu/webgpu-line-renderer.ts` 与 `renderer/brush-overlay-renderer.ts`，形成 `bg/active/ui` 分层渲染接口。
- `BatchGPUSlicer` 已补 `updateMesh(meshIndex, mesh)`，当前实现为“更新后重建 batch”以保证稳定。
- demo 页面已接入笔刷模式、半径、鼠标笔画交互、提交后 mesh 更新流程。
- `clipper2-wasm` npm 发布版本为 `0.2.1`，核心入口是 `dist/es/clipper2z.js` + `clipper2z.wasm`。
- 包的 TS 声明入口存在缺失/错位，直接 `import 'clipper2-wasm'` 在本项目 `tsc` 下不可解析。
- 该 wasm 在 Node 环境直接初始化会触发 `fetch(file://...)` 问题；浏览器/Vite 构建环境可正常打包与加载。
- 通过新增 `clipper2-wasm-adapter`，已将 Clipper2 用于轨迹膨胀（`InflatePathsD`）与 2D 布尔（`add=Union`，`erase=Difference`）。
- demo 侧已改为优先初始化 Clipper2 预览引擎，失败时自动回退纯 TS 预览引擎。
- `manifold-3d` npm 包可通过 Emscripten WASM 在 Node 侧直接 `Module().setup()` 初始化；浏览器打包场景可通过 `manifold.wasm?url` 定位资产。
- 用 `Manifold.ofMesh` + `CrossSection.compose(...).extrude(...).transform(...)` 可直接把 2D 笔刷轮廓提升为 3D cutter，并执行 `add/subtract` 布尔。
- Manifold 输出 `Mesh.vertProperties` 可能携带 >3 维属性，需要按 `numProp` 提取前 3 维回写 `MeshData` 顶点。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 使用 `BrushMode = 'add' | 'erase'` | 与 V3 计划一致 |
| 2D 预览输入输出统一为切面 local-mm 坐标 | 与计划 4.1 坐标约定一致 |
| 状态机严格按 `idle/drawing/committing/invalidated` 建模 | 与计划第 5 节一致 |
| `drawing` 阶段只保留 latest 预览结果 | 满足并发约束 latest-wins |
| 先采用纯 TS 几何实现预览布尔（并保留 `toClipperPath/fromClipperPath` 适配层） | 依赖缺失阶段先保证功能可测可接线 |
| 3D commit 采用可替换的近似形变引擎 `ApproxBrushEngine3D` | 在无 Manifold 时保持 API 与状态机闭环 |
| Clipper2 接入采用“适配层注入 + fallback” | 避免 wasm 初始化失败直接中断交互 |
| `add/erase` 分别使用 Clipper2 `Union/Difference`，并保留 fallback | 统一布尔引擎语义，同时降低 wasm 异常的可用性风险 |
| 3D 提交默认后端切换为 `manifold-3d`，保留 `backend: 'approx'` 显式回退 | 既满足“底层用 manifold”，又不破坏历史调用面 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| planning skill 的默认脚本路径指向 `~/.codex/skills`，本机安装在项目内 | 使用项目相对路径执行脚本 |
| `npm install clipper2-wasm` 在沙箱中网络连接被拒绝（EPERM） | 提权安装后成功 |
| 包声明缺失导致 TS 无法静态解析入口 | 在适配层中直接动态导入 ESM 产物并做窄类型封装 |
| `npm install manifold-3d` 在沙箱中网络连接被拒绝（EPERM） | 提权安装后成功 |
| `npm run build` 报错来自 `src/core/brush/brush-example.ts` 的外部项目路径依赖 | 属于既有文件问题，不影响本次新增 manifold 代码路径 |

## Resources
- `doc/笔刷功能-实现计划.md`
- `src/core/batch-gpu-slicer.ts`
- `src/core/slicer-batch-bitmap.wgsl`
- `src/renderer/slice-renderer.ts`
- `src/demo/main.ts`
- `src/core/brush/brush-engine-2d.ts`
- `src/core/brush/brush-session.ts`
- `src/core/brush/brush-engine-3d.ts`
- `src/core/brush/clipper2-wasm-adapter.ts`
- `src/core/brush/brush-engine-3d.ts`
- `src/core/__tests__/brush-engine-3d.test.ts`
- `node_modules/clipper2-wasm/README.md`
- `node_modules/manifold-3d/README.md`
