# 任务拆分：笔刷功能（Brush Boolean Editing）

## 依赖关系

```
1 → 2/3（可并行）→ 4 → 5 → 6 → 7 → 8 → 9 → 10
```

---

## Task 1: 笔刷类型定义（brush-types.ts）

新建 `src/core/brush/brush-types.ts`，定义笔刷功能所需的全部类型：

- `BrushMode`：`'add' | 'subtract'`
- `BrushConfig`：radius / precision / mode
- `BrushPoint`：切面局部 mm 坐标 + timestamp
- `BrushSessionState`：状态机状态（idle / drawing / committing）
- 新增 `PlaneSegment2D`（local-mm 坐标系）供布尔计算使用，避免复用现有 canvas-px 的 `Segment2D`
- `BrushPreviewResult` / `BrushCommitRequest` 接口

---

## Task 2: 轨迹采集与简化（brush-stroke.ts）

新建 `src/core/brush/brush-stroke.ts`，实现：

- `canvasToLocalMm()`：canvas 像素坐标 → 切面局部 mm 坐标（逆 `toCanvasCoord` + 逆 `projectPointTo2D`）
- 明确布尔链路坐标规范：`brushPolygon2D` / `activeSegments2D` / `resultSegments2D` 全部使用 local-mm
- `simplifyStroke()`：Douglas-Peucker 轨迹简化，按 precision (0.1mm) 最小间距去重
- 单元测试 `src/core/__tests__/brush-stroke.test.ts`

---

## Task 3: 轨迹膨胀为闭合多边形（brush-polygon.ts）

新建 `src/core/brush/brush-polygon.ts`，实现：

- `strokeToPolygon()`：笔刷轨迹 polyline 按半径 r 做 Minkowski sum 膨胀
  - 单点 → 正 N 边形近似圆
  - 多点 → 沿轨迹等距偏移轮廓 + 两端半圆帽
- 时间复杂度 O(N)
- 单元测试 `src/core/__tests__/brush-polygon.test.ts`

---

## Task 4: 统一 2D 线段布尔引擎（segment-boolean.ts）★ 核心

新建 `src/core/brush/segment-boolean.ts`，实现：

- `segmentBooleanWithPolygon(segments, polygon, mode)` — 纯函数，无副作用
- subtract 模式：线段与多边形各边求交 → 按参数 t 分割 → point-in-polygon 过滤 → 保留外部子段
- add 模式（先定义为可实现版本）：
  - 先把输入线段按容差“连环成闭合轮廓”（可能多环）
  - 对轮廓区域与 brushPolygon 做区域并集
  - 将并集结果边界重新线段化为 `PlaneSegment2D[]`
  - 闭环失败时降级为“保留原线段 + brushPolygon 边界线段”，并打诊断日志
- point-in-polygon 射线法实现
- 复杂度 O(S×E)，目标 < 5ms（S=2000, E=200）
- 单元测试 `src/core/__tests__/segment-boolean.test.ts`，覆盖：
  - 基本 subtract / add
  - 笔刷完全在 mesh 外 → 不变
  - 笔刷完全覆盖 → subtract 后为空
  - 边界退化（线段端点恰好在多边形边上）

---

## Task 5: WGSL Shader mesh filter 支持

修改 `src/core/slicer-batch-bitmap.wgsl`：

- 增加 mesh filter uniform 参数（`filterMode: all/include/exclude` + `targetMeshIndex`）
- compute 阶段根据 segment 所属 meshIndex 执行 include/exclude 分支
- 不影响现有 `mode='all'` 的默认行为

---

## Task 6: BatchMeshSlicer 接口扩展与实现

修改 `src/core/batch-slicer-interface.ts` 和 `src/core/batch-gpu-slicer.ts`：

- 新增类型 `SliceFilterMode` / `SliceMeshFilter`
- 新增接口方法：
  - `updateMesh(meshIndex, newMesh)` — 增量更新单个 mesh（实现上允许重建所属 chunk）
  - `sliceToBitmapFiltered(normal, anchor, options, filter)` — 带 mesh 过滤的位图切面
  - `sliceToSplitBitmaps(normal, anchor, options, activeMeshIndex)` — 单请求产出 bgBitmap + activeBitmap（不能拆成两次 filtered 调用）
- `updateMesh` 实现：默认重建 mesh 所在 chunk；若 chunk 变动影响全局布局则回退全量 `initBatch`
- 验证：
  - `include(active)` 仅包含 activeMesh（像素级）
  - `exclude(active)` 不包含 activeMesh（像素级）
  - `bgBitmap + activeBitmap ≈ 全量 sliceToBitmap`

---

## Task 7: 笔刷预览渲染器（BrushOverlayRenderer）

新建 `src/renderer/brush-overlay-renderer.ts`，实现三层合成渲染：

- Layer 0：`drawImage(bgBitmap)` — 非 activeMesh 背景层
- Layer 1：`drawImage(activeBitmap)` 或 `drawImage(activePreviewBitmap)` — activeMesh 层
- Layer 2：笔刷 UI — 半透明区域填充（add=绿 / subtract=红）+ 光标圆圈
- 提供方法：`setBackgroundBitmap` / `setActiveBitmap` / `renderStatic` / `renderPreview` / `renderCursor` / `renderCommittedActive` / `clear`

---

## Task 8: 笔刷会话状态机（BrushSession）

新建 `src/core/brush/brush-session.ts`，实现：

- 状态机：`idle → drawing → committing → idle`
- `onMouseDown`：初始化 stroke，读取已缓存的 bgBitmap / activeBitmap / activeSegments2D
- `onMouseMove`：坐标转换 → 累积轨迹 → 膨胀多边形 → `segmentBooleanWithPolygon` → `rasterizeSegmentsToBitmap` → 返回 `BrushPreviewResult`
- `onMouseUp`：同一 `segmentBooleanWithPolygon` 结果 → 返回 `BrushCommitRequest`（含 brushPolygon3D 反投影）
- 缓存管理：activeSegments2D（local-mm）在 active 切换 / 视图变化时预生成
- 操作期间锁定 anchor，禁止滚动
- 目标：mousemove 帧耗时 < 30ms

---

## Task 9: 3D Mesh 布尔修改 + 一致性验证（mesh-boolean.ts）

新建 `src/core/brush/mesh-boolean.ts`，实现：

- `applyBrushToMesh(mesh, brushPolygon3D, normal, anchor, precision, mode)` → 新 MeshData
- 算法：
  1. 筛选与切面相交的三角形（bbox 预剔除）
  2. brushPolygon3D 沿 normal 拉伸 ±(precision/2) → 薄片棱柱
  3. 投影到切面 2D → Sutherland-Hodgman 裁剪三角形
  4. subtract 保留外部 → ear-clipping 重三角化；add 保留原 + 新三角形
  5. 合并所有三角形 → 新 vertices + indices
- ★ 一致性测试 `src/core/__tests__/consistency.test.ts`：
  - `slice(applyBrush(mesh)) ≈ segmentBoolean(slice(mesh), polygon)` 容差 0.05mm
  - N 种随机笔刷轨迹验证最大偏差

---

## Task 10: 多视图协调 + Demo 集成

新建 `src/renderer/multi-view-manager.ts` 并修改 `src/demo/main.ts`：

- `MultiViewManager`：registerView / refreshOtherViews / refreshAllViews
- 提交后流程：当前视图固化 activePreviewBitmap → 异步 applyBrushToMesh + updateMesh → 各视图仅重建 activeBitmap
- Demo 页面接入笔刷交互：
  - 选择 activeMesh
  - 笔刷模式切换（add / subtract）
  - 半径调节
  - 实时预览 + 提交
- 端到端性能验证：mousemove < 30ms，commit < 500ms
- 边界情况处理：空 mesh、笔刷超出视图、极小/极大半径
