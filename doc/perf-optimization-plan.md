# 性能优化计划 v2：Bench 切面总耗时降至 60ms 以内

## 1. 目标与约束

### 1.1 目标
- 在固定数据集（80 mesh）下，将 bench 总耗时压到 `< 60ms`（warm-up 后，统计 P50/P95）。
- 保持结果一致性：Batch GPU 输出与现有 CPU/GPU 单 mesh 路径误差在容差内。

### 1.2 约束
- 不假设“80 mesh 一次性全量提交”可行，必须按设备能力分块。
- 保留 CPU fallback。
- 优化优先顺序：先低风险（复用/读回），再高收益（批处理）。

---

## 2. 现状瓶颈（已确认）

当前 bench 对 80 个 mesh 串行执行 `init()` + `slice()`：

| 阶段 | 瓶颈 | 现状代码 |
|------|------|---------|
| `init()` × 80 | 每次 destroy + create 多个 GPU buffer | `src/core/gpu-slicer.ts` |
| `slice()` × 80 | 每次 2 次 `mapAsync` + 全量 segment copy | `src/core/gpu-slicer.ts` |
| `slice()` × 80 | 每次独立 `queue.submit` | `src/demo/bench.ts` |
| 整体 | 串行流程，吞吐受限 | `src/demo/bench.ts` |

---

## 3. v2 总体方案

### 3.1 关键原则
1. 分块批处理：按 `GPUDevice.limits` + 内存预算拆分 chunk，不做单批全量硬顶。
2. 先筛选再计算：保留 CPU 侧 bbox 剔除，仅提交可能相交的 mesh。
3. 两阶段读回：先读 counter，再按需 copy segments。
4. 缓冲池复用：容量不足才扩容，避免频繁 `createBuffer`/`destroy`。

### 3.2 目标架构
- 保留现有 `MeshSlicer`（单 mesh）。
- 新增 `BatchMeshSlicer`（批量路径）：
  - `initBatch(meshes)`
  - `sliceBatch(normal, anchor)`
- Bench 优先走批量接口，失败自动降级到单 mesh 方案。

---

## 4. 分阶段落地

## Phase 0：基线与可观测性（必须先做）
- 在 `bench.ts` 增加阶段计时：`init/upload/dispatch/copy/map/parse/render`。
- 固定随机种子，保证不同版本可比。
- 输出 JSON 结果（P50/P95/P99 + 总耗时）。

验收：
- 能稳定复现当前基线，误差 < 5%。

## Phase 1：低风险提速（先拿确定收益）
- `GPUSlicer` 改为容量复用，不再每次 `disposeBuffers()`。
- `slice()` 改为两阶段读回：
  1. dispatch + copy counter + map counter；
  2. 根据 `segmentCount` 再 copy/读回有效 segments。
- 复用 staging/readback buffer，避免热路径反复创建。

验收：
- 单 mesh 路径总耗时下降 20%+；
- 结果与当前实现一致。

## Phase 2：分块批处理（核心）
- 新增 `BatchGPUSlicer` 与 `slicer-batch.wgsl`。
- `initBatch`：
  - 预计算每个 mesh 的 `triCount/bbox/offset`；
  - 建立 chunk（受 `maxStorageBufferBindingSize`、`maxBufferSize`、预算上限约束）；
  - 每个 chunk 使用拼接后的 vertex/index/meshInfo/counter/segment buffer。
- `sliceBatch`：
  - 先做 active mesh 筛选（bbox 与平面相交）；
  - 对 active chunk 执行 dispatch；
  - 先读 counter 数组，再按需读有效 segments。

建议预算：
- 默认 chunk 预算 `128MB`（可配置），超限自动拆块。

验收：
- 在目标数据集下，`submit` 次数显著下降；
- 批处理路径稳定，无 OOM/设备丢失崩溃。

## Phase 3：Bench 集成与回退策略
- Bench 优先检测并调用 `sliceBatch`。
- 增加对比报告：`single` vs `batch`。
- 任一 chunk 失败时自动回退单 mesh 路径并记录日志。

验收：
- 功能可回退、结果可对齐、性能报表完整。

---

## 5. 文件变更清单（v2）

| 操作 | 文件 |
|------|------|
| 新增 | `src/core/batch-slicer-interface.ts` |
| 新增 | `src/core/batch-gpu-slicer.ts` |
| 新增 | `src/core/slicer-batch.wgsl` |
| 新增 | `src/core/chunk-planner.ts` |
| 修改 | `src/core/gpu-slicer.ts`（Phase 1 复用 + 两阶段读回） |
| 修改 | `src/core/cpu-slicer.ts`（可选实现批量 fallback） |
| 修改 | `src/core/create-slicer.ts` |
| 修改 | `src/demo/bench.ts` |
| 修改 | `src/index.ts` |

---

## 6. 验收指标（最终）

| 指标 | 基线 | v2 目标 |
|------|------|--------|
| Init 总耗时 | 当前实测 | 下降 3x+ |
| Slice 总耗时 | 当前实测 | 下降 5x+ |
| 总耗时（P50） | 当前实测 | `< 60ms` |
| 结果一致性 | - | CPU/GPU 输出一致（容差内） |
| 稳定性 | - | 连续 100 次无崩溃/无泄漏趋势 |

---

## 7. 风险与应对

1. 内存压力过高：通过 chunk 预算和自动拆块规避，不走单批全量。
2. 读回仍是瓶颈：确保“先 counter、后按需 segments”，避免全量 copy。
3. 某些设备 WebGPU 表现不稳定：保留 CPU fallback 与错误降级路径。
4. 指标不达标：保留 Phase 1 成果，不阻塞上线；Phase 2 按设备分级启用。
