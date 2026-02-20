# Task Plan: Brush 功能 M1-M3 开发落地

## Goal
完成 `doc/笔刷功能-实现计划.md` 的 M1-M3：2D 预览闭环、状态机与渲染接线、3D 提交与 mesh 更新闭环，并补齐核心测试。

## Current Phase
Phase 6

## Phases

### Phase 1: Requirements & Discovery
- [x] 阅读 `doc/笔刷功能-实现计划.md` 明确 M1-M3 范围
- [x] 检查现有实现（无 brush 模块、无 multi-view manager、无 mesh filter）
- [x] 明确现有可复用能力（`BatchGPUSlicer` 切片与位图输出、`projection` 坐标系）
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 定义 M1-M3 的最小可实现方案（按现有架构可落地）
- [x] 规划新增模块与文件（`core/brush`, `core/gpu`, `renderer`）
- [x] 对齐导出入口与 demo 接入方式
- **Status:** complete

### Phase 3: Implementation
- [x] M1: `brush-types` / `brush-stroke` / `brush-engine-2d` + 单测
- [x] M2: `webgpu-line-renderer` / `brush-overlay-renderer` / `brush-session` + 集成到 demo
- [x] M3: `brush-engine-3d` / commit 主链路 / `BatchGPUSlicer.updateMesh` / `multi-view-manager`
- [x] 补充状态机与 e2e 流程测试
- **Status:** complete

### Phase 4: Testing & Verification
- [x] 运行 `npm test` 验证新增单测
- [x] 运行 `npm run build` 验证类型与构建
- [ ] 手动确认 demo 基本交互链路可运行
- **Status:** in_progress

### Phase 5: Delivery
- [x] 汇总改动文件、关键设计与已知限制
- [x] 输出后续建议（性能压测/真实 manifold 接入优化）
- **Status:** complete

### Phase 6: Clipper2-WASM Integration
- [x] 安装 `clipper2-wasm` 并更新 lockfile
- [x] 新增 `clipper2-wasm` 适配层（轨迹膨胀 + erase 差集）
- [x] `BrushEngine2D` 接入适配层并保留纯 TS fallback
- [x] demo 初始化改为“优先 Clipper2，失败回退”
- [x] 补充适配器注入测试并验证构建
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 先实现 M1-M3 的“可运行闭环”，性能基线（M4）不在本次强行完成 | 用户明确要求仅 M1-M3 |
| 2D 预览采用本地几何算法（多边形膨胀 + 线段裁剪），接口保留 Clipper2 风格 | 当前仓库未安装 Clipper2 依赖，先保证功能可测可接线 |
| 3D 提交先实现可替换的近似布尔（局部位移/简化策略）并封装 `BrushEngine3D` | 当前仓库未安装 Manifold 依赖，先打通状态机与 mesh 更新链路 |
| `BatchGPUSlicer.updateMesh` 先采用安全回退策略（内部全量 `initBatch`） | 优先保证提交链路正确，再做 chunk 局部更新优化 |
| Clipper2 接入采用“适配层注入 + 运行时 fallback” | 降低 wasm 初始化失败时的功能中断风险 |
| `add/erase` 均切到 Clipper2（分别走 Union / Difference） | 对齐 V3 计划里的 2D 布尔引擎目标，减少双轨行为差异 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| `~/.codex/skills/.../session-catchup.py` 路径不存在 | 改为项目内 `.codex/skills/planning-with-files/scripts/session-catchup.py` |
| `npm install clipper2-wasm` 在沙箱内网络连接 `EPERM` | 按流程提权后安装成功 |
| `clipper2-wasm` 发布包缺失可解析 ESM type 入口 | 运行时直接 import ESM 产物并在适配层做类型收敛 |
