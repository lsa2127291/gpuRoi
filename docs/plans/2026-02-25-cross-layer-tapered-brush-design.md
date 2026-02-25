# 跨层锥度笔刷设计（Cross-Layer Tapered Brush）

## 问题

当前笔刷每层 commit 生成纯圆柱薄片（slab），层厚 ±0.5mm，anchor 间距 1mm。用户在 axial 面连续画多层后，sagittal/coronal 视图呈现明显锯齿（矩形台阶堆叠）。

## 目标

- 多层绘画时，跨层边缘自然过渡，消除锯齿感
- 用户看到的始终是平滑结果（不是先锯齿再后处理）
- 单层场景行为完全不变（纯圆柱）
- 性能尽量高

## 设计决策

| 决策项 | 选择 |
|--------|------|
| 平滑阶段 | 3D commit 阶段，直接改 extrude 形状 |
| 过渡范围 | ±1 层（相邻层） |
| 过渡曲线 | 线性锥度 |
| 无相邻层时 | 不缩，保持圆柱截断 |
| 有相邻层时 | 过渡到相邻层的轮廓 |
| 回溯更新 | 需要 — 新层 commit 后同步回溯更新相邻层 |
| 回溯时机 | 同步，整个操作完成后才返回 |

## 3D 形状变化

之前（纯圆柱）：
```
层3:  ┌──────┐
层4:  ┌──────┐
层5:  ┌──────┐
```

之后（带锥度）：
```
层3:  ┌──────┐     ← 上方无层，保持平顶
       \    /      ← 下方有层4，线性过渡到层4轮廓
层4:   ┌────┐      ← 上下均有相邻层，两侧锥度过渡
       \  /
层5:    ┌──┐       ← 上方过渡到层4，下方无层，保持平底
```

## 实现路径

### 1. 改造 `ManifoldBrushEngine3D.commit()`

当前流程：
1. `collectBrushStamps` → 2D 轮廓
2. `CrossSection.compose(polygons)` → 合并为单个 2D cross-section
3. `.extrude(cutterDepthMm)` → 纯圆柱 slab
4. 布尔运算 add/subtract

新流程：
1. `collectBrushStamps` → 当前层 2D 轮廓
2. 查询上下相邻层的 2D 轮廓（通过新增回调获取）
3. 构建 z 方向多截面：
   - `z = -halfDepth`：下方有层 → 下方层轮廓；否则 → 当前层轮廓
   - `z = 0`：当前层轮廓
   - `z = +halfDepth`：上方有层 → 上方层轮廓；否则 → 当前层轮廓
4. 用 Manifold `loft()` 或分段 extrude 生成带锥度的 3D 形状
5. 布尔运算 add/subtract

### 2. 新增数据依赖

`CommitInput` 需要扩展，提供相邻层信息：

```typescript
interface AdjacentLayerInfo {
  /** 相邻层的 2D 轮廓（commit 后的最终 segments） */
  segments: Segment2D[] | null
  /** 相邻层的 slice plane */
  slicePlane: SlicePlane
}

interface CommitInput {
  // ... 现有字段
  /** 上方相邻层信息，null 表示无相邻层 */
  adjacentAbove: AdjacentLayerInfo | null
  /** 下方相邻层信息，null 表示无相邻层 */
  adjacentBelow: AdjacentLayerInfo | null
}
```

### 3. 回溯更新机制

commit 第 N 层后：
1. 检查第 N-1 层是否有笔画
   - 有 → 用新的锥度参数（现在它的上方有了第 N 层）重新生成第 N-1 层的 3D 形状，重新布尔运算
2. 检查第 N+1 层同理
3. 整个操作（当前层 + 回溯层）同步完成后才返回

需要新增回调：

```typescript
interface BrushSessionCallbacks {
  // ... 现有回调
  /** 获取指定层的 2D 轮廓 */
  getLayerSegments: (anchorOffset: number) => Segment2D[] | null
  /** 触发指定层的 mesh 重建 */
  recommitLayer: (anchorOffset: number, adjacentAbove: AdjacentLayerInfo | null, adjacentBelow: AdjacentLayerInfo | null) => Promise<void>
}
```

### 4. 不变的部分

- 2D 预览逻辑完全不变（每层独立预览）
- `BrushStrokeBuilder`、Douglas-Peucker、Chaikin 平滑不变
- Clipper2 布尔运算不变
- `BrushOverlayRenderer` 不变
- 单层场景：上下均无相邻层 → 三个截面都是当前层轮廓 → 等价于纯圆柱

## 边界情况

- **单层绘画**：上下均无相邻层，三个截面相同，退化为纯圆柱，行为不变
- **erase 模式**：同样适用锥度，erase 的 3D cutter 也带锥度过渡
- **相邻层轮廓差异大**：线性过渡可能产生较大斜面，但这是物理上合理的过渡
- **回溯链**：只回溯 ±1 层，不会级联（第 N 层 commit 不会触发第 N-2 层更新）
- **性能**：loft 比 extrude 稍慢，但只多了截面插值；回溯最多额外 2 次 commit，可接受
