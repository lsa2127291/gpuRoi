# 跨层锥度笔刷实现计划（Cross-Layer Tapered Brush）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将纯圆柱笔刷 slab 替换为带锥度的形状，线性过渡到相邻层轮廓，消除 sagittal/coronal 视图的锯齿。

**Architecture:** 修改 `ManifoldBrushEngine3D.commit()` — 用"差集锥体法"构建锥度 cutter：将当前层与相邻层截面分解为共有部分（交集，平直延伸）、当前层独有（差集，锥形收缩）、相邻层独有（差集，锥形扩张），三者 union 形成精准的线性过渡。commit 后同步回溯更新相邻层。

**Tech Stack:** TypeScript, Manifold 3D (WASM), Vitest

**Design doc:** `docs/plans/2026-02-25-cross-layer-tapered-brush-design.md`

---

## 锥度构建算法

当前层截面 = A，相邻层截面 = B，过渡方向为 z=0 → z=halfDepth：

1. **A ∩ B**（共有）→ `extrude(halfDepth)` 平直延伸
2. **A - B**（A 独有）→ `extrude(halfDepth, scaleTop=[0,0])` 锥形收缩到 0
3. **B - A**（B 独有）→ `extrude(halfDepth, scaleTop=[0,0])` 然后 z 轴翻转（从 z=halfDepth 向 z=0 收缩）

三者 union：z=0 处截面 = (A∩B) ∪ (A-B) = A，z=halfDepth 处截面 = (A∩B) ∪ (B-A) = B。

完整 cutter = 下半段（当前层→下方相邻层）union 上半段（当前层→上方相邻层）。

无相邻层时该半段退化为纯 extrude（A→A，无锥度）。

---

## Task 1: 扩展类型定义

**Files:**
- Modify: `src/core/brush/brush-types.ts`

**Step 1: 写失败测试**

在 `src/core/__tests__/brush-engine-3d.test.ts` 中添加类型导入测试：

```typescript
import type { AdjacentLayerInfo, CommitInput } from '@/core/brush/brush-types'

describe('CommitInput with adjacent layers', () => {
  it('should accept adjacentAbove and adjacentBelow fields', () => {
    const input: CommitInput = {
      meshId: 'test',
      mesh: { vertices: new Float32Array(), indices: new Uint32Array() },
      stroke: { points: [], simplified: [], radiusMm: 5, mode: 'add' },
      slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 0] },
      adjacentAbove: null,
      adjacentBelow: null,
    }
    expect(input.adjacentAbove).toBeNull()
    expect(input.adjacentBelow).toBeNull()
  })

  it('should accept AdjacentLayerInfo with segments and slicePlane', () => {
    const info: AdjacentLayerInfo = {
      segments: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
      slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 1] },
    }
    expect(info.segments).toHaveLength(1)
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: FAIL — `AdjacentLayerInfo` 类型不存在，`CommitInput` 缺少 `adjacentAbove`/`adjacentBelow`

**Step 3: 实现类型扩展**

在 `src/core/brush/brush-types.ts` 中添加：

```typescript
export interface AdjacentLayerInfo {
  /** 相邻层的 2D 轮廓 segments，null 表示该层无笔画 */
  segments: Segment2D[] | null
  /** 相邻层的 slice plane */
  slicePlane: SlicePlane
}
```

修改 `CommitInput`：

```typescript
export interface CommitInput {
  meshId: string
  mesh: MeshData
  stroke: BrushStroke
  slicePlane: SlicePlane
  /** 上方相邻层信息，null 表示无相邻层或无笔画 */
  adjacentAbove?: AdjacentLayerInfo | null
  /** 下方相邻层信息，null 表示无相邻层或无笔画 */
  adjacentBelow?: AdjacentLayerInfo | null
}
```

注意：用 `?` 可选字段保持向后兼容，现有调用不需要改。

**Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/core/brush/brush-types.ts src/core/__tests__/brush-engine-3d.test.ts
git commit -m "feat(brush): add AdjacentLayerInfo type and extend CommitInput"
```

---

## Task 2: 实现锥度 cutter 构建函数

**Files:**
- Modify: `src/core/brush/brush-engine-3d.ts`
- Test: `src/core/__tests__/brush-engine-3d.test.ts`

**Step 1: 写失败测试**

在 `src/core/__tests__/brush-engine-3d.test.ts` 中添加：

```typescript
import { buildTaperedHalf } from '@/core/brush/brush-engine-3d'

describe('buildTaperedHalf', () => {
  it('should return plain extrusion when no adjacent cross-section', async () => {
    // 无相邻层 → 纯 extrude，等价于原始行为
    const runtime = await getManifoldRuntime()
    const currentCS = runtime.CrossSection.compose([
      [[0, 0], [10, 0], [10, 10], [0, 10]]
    ])
    const result = buildTaperedHalf(runtime, currentCS, null, 0.5)
    expect(result).toBeDefined()
    // 体积应等于 10*10*0.5 = 50
    const vol = result.getProperties().volume
    expect(vol).toBeCloseTo(50, 0)
    result.delete()
    currentCS.delete()
  })

  it('should taper between two different cross-sections', async () => {
    const runtime = await getManifoldRuntime()
    // A = 10x10 正方形, B = 6x6 正方形（居中）
    const csA = runtime.CrossSection.compose([
      [[-5, -5], [5, -5], [5, 5], [-5, 5]]
    ])
    const csB = runtime.CrossSection.compose([
      [[-3, -3], [3, -3], [3, 3], [-3, 3]]
    ])
    const result = buildTaperedHalf(runtime, csA, csB, 0.5)
    expect(result).toBeDefined()
    // 体积应介于 B面积*h 和 A面积*h 之间
    const vol = result.getProperties().volume
    expect(vol).toBeGreaterThan(36 * 0.5) // > B*h
    expect(vol).toBeLessThan(100 * 0.5)   // < A*h
    result.delete()
    csA.delete()
    csB.delete()
  })

  it('should handle identical cross-sections (no taper)', async () => {
    const runtime = await getManifoldRuntime()
    const cs = runtime.CrossSection.compose([
      [[-5, -5], [5, -5], [5, 5], [-5, 5]]
    ])
    const csCopy = runtime.CrossSection.compose([
      [[-5, -5], [5, -5], [5, 5], [-5, 5]]
    ])
    const result = buildTaperedHalf(runtime, cs, csCopy, 0.5)
    const vol = result.getProperties().volume
    // 相同截面 → 纯圆柱，体积 = 100 * 0.5
    expect(vol).toBeCloseTo(50, 0)
    result.delete()
    cs.delete()
    csCopy.delete()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: FAIL — `buildTaperedHalf` 不存在

**Step 3: 实现 `buildTaperedHalf`**

在 `src/core/brush/brush-engine-3d.ts` 中添加并 export：

```typescript
/**
 * 构建从 currentCS 到 adjacentCS 的线性锥度半段。
 * 如果 adjacentCS 为 null，退化为纯 extrude。
 *
 * 算法：
 * 1. shared = currentCS ∩ adjacentCS（共有部分）→ extrude 平直
 * 2. currentOnly = currentCS - adjacentCS（当前独有）→ extrude + scaleTop=[0,0] 锥形收缩
 * 3. adjacentOnly = adjacentCS - currentCS（相邻独有）→ extrude + scaleTop=[0,0] 后翻转
 * 4. union 三者
 */
export function buildTaperedHalf(
  runtime: ManifoldToplevel,
  currentCS: InstanceType<typeof runtime.CrossSection>,
  adjacentCS: InstanceType<typeof runtime.CrossSection> | null,
  halfDepth: number,
): InstanceType<typeof runtime.Manifold> {
  if (!adjacentCS || halfDepth <= 0) {
    // 无相邻层或深度为0 → 纯 extrude
    return currentCS.extrude(halfDepth)
  }

  const shared = currentCS.intersect(adjacentCS)
  const currentOnly = currentCS.subtract(adjacentCS)
  const adjacentOnly = adjacentCS.subtract(currentCS)

  const parts: InstanceType<typeof runtime.Manifold>[] = []

  try {
    // 1. 共有部分：平直延伸
    if (shared.area() > EPSILON) {
      parts.push(shared.extrude(halfDepth))
    }

    // 2. 当前层独有：锥形收缩到 0
    if (currentOnly.area() > EPSILON) {
      parts.push(currentOnly.extrude(halfDepth, 0, 0, [0, 0]))
    }

    // 3. 相邻层独有：从 0 扩张到完整（反向锥体）
    if (adjacentOnly.area() > EPSILON) {
      const cone = adjacentOnly.extrude(halfDepth, 0, 0, [0, 0])
      // 翻转：沿 z 轴镜像后平移到 [0, halfDepth]
      // mirror z: scale(1,1,-1) 然后 translate(0,0,halfDepth)
      const flipped = cone.scale([1, 1, -1]).translate([0, 0, halfDepth])
      parts.push(flipped)
      if (flipped !== cone) safeDelete(cone)
    }

    if (parts.length === 0) {
      return currentCS.extrude(halfDepth)
    }

    if (parts.length === 1) {
      return parts[0]
    }

    return runtime.Manifold.union(parts)
  } finally {
    safeDelete(shared)
    safeDelete(currentOnly)
    safeDelete(adjacentOnly)
  }
}
```

注意：Manifold 的 `scale` 和 `translate` 是 Manifold 方法（不是 CrossSection 方法），所以 extrude 后再变换是正确的。需要确认 `scale([1,1,-1])` 是否会导致 non-manifold（翻转法线），如果是，可能需要用 `mirror` 或手动调整。实现时需要验证。

**Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/core/brush/brush-engine-3d.ts src/core/__tests__/brush-engine-3d.test.ts
git commit -m "feat(brush): add buildTaperedHalf for cross-layer taper"
```

---

## Task 3: 改造 ManifoldBrushEngine3D.commit() 使用锥度 cutter

**Files:**
- Modify: `src/core/brush/brush-engine-3d.ts`
- Test: `src/core/__tests__/brush-engine-3d.test.ts`

**Step 1: 写失败测试**

在 `src/core/__tests__/brush-engine-3d.test.ts` 中添加：

```typescript
describe('ManifoldBrushEngine3D with adjacent layers', () => {
  it('should produce tapered cutter when adjacentBelow is provided', async () => {
    const engine = new ManifoldBrushEngine3D()
    // 构造一个简单的立方体 mesh 作为 source
    const mesh = createTestCubeMesh(20) // 20mm 立方体
    const input: CommitInput = {
      meshId: 'test',
      mesh,
      stroke: {
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        simplified: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        radiusMm: 3,
        mode: 'add',
      },
      slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 5] },
      adjacentAbove: null,
      adjacentBelow: {
        segments: [
          // 一个较小的圆形轮廓（半径2mm）
          ...generateCircleSegments({ x: 2.5, y: 0 }, 2, 20),
        ],
        slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 4] },
      },
    }
    const result = await engine.commit(input)
    expect(result.mesh).toBeDefined()
    expect(result.triangleCount).toBeGreaterThan(0)
  })

  it('should produce same result as before when no adjacent layers', async () => {
    const engine = new ManifoldBrushEngine3D()
    const mesh = createTestCubeMesh(20)
    const baseInput: CommitInput = {
      meshId: 'test',
      mesh,
      stroke: {
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        simplified: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        radiusMm: 3,
        mode: 'add',
      },
      slicePlane: { normal: [0, 0, 1], anchor: [0, 0, 5] },
    }
    // 无 adjacent 字段 → 向后兼容
    const result = await engine.commit(baseInput)
    expect(result.mesh).toBeDefined()
    expect(result.triangleCount).toBeGreaterThan(0)
  })
})
```

辅助函数 `createTestCubeMesh` 和 `generateCircleSegments` 需要在测试文件顶部定义。

**Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: FAIL — commit 不识别 adjacentAbove/adjacentBelow

**Step 3: 改造 commit 方法**

修改 `ManifoldBrushEngine3D.commit()` 中构建 cutter 的部分（约 `brush-engine-3d.ts:456-477`）：

```typescript
async commit(input: CommitInput): Promise<CommitOutput> {
  // ... 前面不变（t0, basis, strokePoints, brushStamps 等）

  const runtime = await getManifoldRuntime()
  // ... sourceMeshObj, sourceSolid 构建不变

  // 构建当前层截面
  const polygons = brushStamps.map((polygon) =>
    polygon.map((p) => [p.x, p.y] as [number, number])
  )
  const currentCS = runtime.CrossSection.compose(polygons)

  const cutterDepthMm = computeCutterDepthMm({
    cutterDepthMm: this.options.cutterDepthMm,
    cutterDepthPaddingMm: this.options.cutterDepthPaddingMm,
  })
  const halfDepth = cutterDepthMm * 0.5

  // 构建相邻层截面（如果有）
  const belowCS = this.buildAdjacentCrossSection(
    runtime, input.adjacentBelow, basis
  )
  const aboveCS = this.buildAdjacentCrossSection(
    runtime, input.adjacentAbove, basis
  )

  // 构建锥度 cutter：下半段 + 上半段
  const bottomHalf = buildTaperedHalf(runtime, currentCS, belowCS, halfDepth)
  const topHalf = buildTaperedHalf(runtime, currentCS, aboveCS, halfDepth)

  // 下半段需要翻转到 z 负方向
  const bottomFlipped = bottomHalf.scale([1, 1, -1])
  // 合并上下两半
  const cutterLocal = runtime.Manifold.union([bottomFlipped, topHalf])

  // 变换到世界坐标（anchor 居中）
  const cutterBasis: PlaneBasis = {
    ...basis,
    anchor: centerExtrusionAnchor(basis.anchor, basis.normal, cutterDepthMm),
  }
  // 注意：bottomFlipped 把下半段翻到了 z<0，topHalf 在 z>0
  // 但 centerExtrusionAnchor 已经把 anchor 下移了 halfDepth
  // 所以需要调整：cutter 整体在 z=[-halfDepth, +halfDepth]，
  // 然后 transform 到世界坐标时 anchor 在层中心
  const cutterWorld = cutterLocal.transform(
    buildPlaneTransformMatrix(basis)
  )

  // ... 后面的布尔运算、stitching 不变
}
```

新增私有方法：

```typescript
private buildAdjacentCrossSection(
  runtime: ManifoldToplevel,
  adjacent: AdjacentLayerInfo | null | undefined,
  currentBasis: PlaneBasis,
): InstanceType<typeof runtime.CrossSection> | null {
  if (!adjacent?.segments?.length) return null

  // 将相邻层的 segments 转换为 2D 多边形
  // segments 已经是当前视图平面的 2D 坐标
  const polygons = segmentsToPolygons(adjacent.segments)
  if (polygons.length === 0) return null

  return runtime.CrossSection.compose(
    polygons.map(poly => poly.map(p => [p.x, p.y] as [number, number]))
  )
}
```

需要新增辅助函数 `segmentsToPolygons`：从 `Segment2D[]` 重建闭合多边形环。

**Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/core/brush/brush-engine-3d.ts src/core/__tests__/brush-engine-3d.test.ts
git commit -m "feat(brush): integrate tapered cutter into ManifoldBrushEngine3D.commit"
```

---

## Task 4: 实现 segmentsToPolygons 辅助函数

**Files:**
- Modify: `src/core/brush/brush-engine-3d.ts`
- Test: `src/core/__tests__/brush-engine-3d.test.ts`

**Step 1: 写失败测试**

```typescript
import { segmentsToPolygons } from '@/core/brush/brush-engine-3d'

describe('segmentsToPolygons', () => {
  it('should reconstruct a closed square from segments', () => {
    const segments: Segment2D[] = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: 10, y: 10 }, b: { x: 0, y: 10 } },
      { a: { x: 0, y: 10 }, b: { x: 0, y: 0 } },
    ]
    const polygons = segmentsToPolygons(segments)
    expect(polygons).toHaveLength(1)
    expect(polygons[0]).toHaveLength(4)
  })

  it('should handle multiple disjoint loops', () => {
    const segments: Segment2D[] = [
      // 第一个三角形
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      { a: { x: 5, y: 0 }, b: { x: 2.5, y: 5 } },
      { a: { x: 2.5, y: 5 }, b: { x: 0, y: 0 } },
      // 第二个三角形（远离第一个）
      { a: { x: 20, y: 20 }, b: { x: 25, y: 20 } },
      { a: { x: 25, y: 20 }, b: { x: 22.5, y: 25 } },
      { a: { x: 22.5, y: 25 }, b: { x: 20, y: 20 } },
    ]
    const polygons = segmentsToPolygons(segments)
    expect(polygons).toHaveLength(2)
  })

  it('should return empty for empty segments', () => {
    expect(segmentsToPolygons([])).toHaveLength(0)
  })

  it('should skip open polylines (non-closed)', () => {
    const segments: Segment2D[] = [
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      { a: { x: 5, y: 0 }, b: { x: 10, y: 5 } },
      // 不闭合
    ]
    const polygons = segmentsToPolygons(segments)
    // 开口线段不构成多边形，应被跳过
    expect(polygons).toHaveLength(0)
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: FAIL — `segmentsToPolygons` 不存在

**Step 3: 实现**

```typescript
const SEGMENT_MATCH_EPSILON = 0.01

/**
 * 从无序 Segment2D[] 重建闭合多边形环。
 * 只返回闭合环，跳过开口线段。
 */
export function segmentsToPolygons(segments: Segment2D[]): Vec2[][] {
  if (segments.length === 0) return []

  const used = new Uint8Array(segments.length)
  const polygons: Vec2[][] = []

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue
    used[start] = 1

    const chain: Vec2[] = [segments[start].a]
    let current = segments[start].b

    let found = true
    while (found) {
      // 检查是否闭合
      if (
        Math.abs(current.x - chain[0].x) < SEGMENT_MATCH_EPSILON &&
        Math.abs(current.y - chain[0].y) < SEGMENT_MATCH_EPSILON
      ) {
        if (chain.length >= 3) {
          polygons.push(chain)
        }
        found = false
        break
      }

      chain.push(current)
      found = false

      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue
        const seg = segments[i]
        if (
          Math.abs(seg.a.x - current.x) < SEGMENT_MATCH_EPSILON &&
          Math.abs(seg.a.y - current.y) < SEGMENT_MATCH_EPSILON
        ) {
          used[i] = 1
          current = seg.b
          found = true
          break
        }
        if (
          Math.abs(seg.b.x - current.x) < SEGMENT_MATCH_EPSILON &&
          Math.abs(seg.b.y - current.y) < SEGMENT_MATCH_EPSILON
        ) {
          used[i] = 1
          current = seg.a
          found = true
          break
        }
      }
    }
  }

  return polygons
}
```

**Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-engine-3d.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/core/brush/brush-engine-3d.ts src/core/__tests__/brush-engine-3d.test.ts
git commit -m "feat(brush): add segmentsToPolygons utility"
```

---

## Task 5: 扩展 BrushSessionDeps 支持相邻层查询与回溯

**Files:**
- Modify: `src/core/brush/brush-session.ts`
- Test: `src/core/__tests__/brush-session.test.ts`

**Step 1: 写失败测试**

在 `src/core/__tests__/brush-session.test.ts` 中添加：

```typescript
describe('BrushSession cross-layer backtrack', () => {
  it('should call getAdjacentLayerInfo during endStroke', async () => {
    const getAdjacentLayerInfo = vi.fn().mockReturnValue(null)
    const session = createBrushSession([], {
      previewEngine: mockPreviewEngine,
      commitEngine: mockCommitEngine,
      createCommitInput: (stroke) => ({
        meshId: 'test',
        mesh: testMesh,
        slicePlane: testPlane,
      }),
      getAdjacentLayerInfo,
    })
    session.beginStroke({ x: 0, y: 0 }, 5, 'add')
    session.appendPoint({ x: 5, y: 0 })
    await session.endStroke()
    // 应该查询上下两层
    expect(getAdjacentLayerInfo).toHaveBeenCalledWith('above')
    expect(getAdjacentLayerInfo).toHaveBeenCalledWith('below')
  })

  it('should call recommitAdjacentLayer when adjacent has segments', async () => {
    const adjacentInfo = {
      segments: [{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }],
      slicePlane: { normal: [0, 0, 1] as Vec3, anchor: [0, 0, 4] as Vec3 },
    }
    const getAdjacentLayerInfo = vi.fn()
      .mockReturnValueOnce(adjacentInfo)  // below
      .mockReturnValueOnce(null)          // above
    const recommitAdjacentLayer = vi.fn().mockResolvedValue(undefined)

    const session = createBrushSession([], {
      previewEngine: mockPreviewEngine,
      commitEngine: mockCommitEngine,
      createCommitInput: (stroke) => ({
        meshId: 'test',
        mesh: testMesh,
        slicePlane: testPlane,
      }),
      getAdjacentLayerInfo,
      recommitAdjacentLayer,
    })
    session.beginStroke({ x: 0, y: 0 }, 5, 'add')
    session.appendPoint({ x: 5, y: 0 })
    await session.endStroke()
    // 下方有相邻层 → 应触发回溯
    expect(recommitAdjacentLayer).toHaveBeenCalledWith('below')
  })

  it('should NOT call recommitAdjacentLayer when no adjacent layers', async () => {
    const getAdjacentLayerInfo = vi.fn().mockReturnValue(null)
    const recommitAdjacentLayer = vi.fn()

    const session = createBrushSession([], {
      previewEngine: mockPreviewEngine,
      commitEngine: mockCommitEngine,
      createCommitInput: (stroke) => ({
        meshId: 'test',
        mesh: testMesh,
        slicePlane: testPlane,
      }),
      getAdjacentLayerInfo,
      recommitAdjacentLayer,
    })
    session.beginStroke({ x: 0, y: 0 }, 5, 'add')
    session.appendPoint({ x: 5, y: 0 })
    await session.endStroke()
    expect(recommitAdjacentLayer).not.toHaveBeenCalled()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/__tests__/brush-session.test.ts`
Expected: FAIL — `getAdjacentLayerInfo` 和 `recommitAdjacentLayer` 不在 deps 类型中

**Step 3: 扩展 BrushSessionDeps**

在 `src/core/brush/brush-session.ts` 中修改 `BrushSessionDeps`：

```typescript
import type { AdjacentLayerInfo } from './brush-types'

export interface BrushSessionDeps {
  previewEngine: BrushEngine2D
  commitEngine: BrushEngine3D
  createCommitInput: (stroke: BrushStroke) => Omit<CommitInput, 'stroke'>
  requestReslice?: (reason: InvalidateReason) => Promise<Segment2D[]>
  onPreview?: (preview: PreviewOutput) => void
  onCommitSuccess?: (result: CommitOutput) => void
  onCommitFail?: (error: unknown) => void
  onStateChange?: (next: BrushSessionState, prev: BrushSessionState) => void
  /** 查询相邻层信息。direction: 'above' | 'below' */
  getAdjacentLayerInfo?: (direction: 'above' | 'below') => AdjacentLayerInfo | null
  /** 触发相邻层回溯重建。direction: 'above' | 'below' */
  recommitAdjacentLayer?: (direction: 'above' | 'below') => Promise<void>
}
```

**Step 4: 修改 endStroke 加入相邻层查询与回溯**

在 `DefaultBrushSession.endStroke()` 中，commit 成功后、`finishStrokeToIdle()` 之前：

```typescript
async endStroke(): Promise<CommitOutput> {
  // ... 现有逻辑直到 commit 成功

  try {
    const result = await this.commitPromise
    this.baseSegments = cloneSegments(this.lastPreview.nextSegments)
    this.deps.onCommitSuccess?.(result)

    // === 新增：回溯更新相邻层 ===
    await this.backtrackAdjacentLayers()

    this.finishStrokeToIdle()
    return result
  } catch (error) {
    // ... 现有错误处理不变
  }
}

private async backtrackAdjacentLayers(): Promise<void> {
  if (!this.deps.getAdjacentLayerInfo || !this.deps.recommitAdjacentLayer) return

  for (const direction of ['below', 'above'] as const) {
    const info = this.deps.getAdjacentLayerInfo(direction)
    if (info?.segments?.length) {
      await this.deps.recommitAdjacentLayer(direction)
    }
  }
}
```

**Step 5: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-session.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add src/core/brush/brush-session.ts src/core/__tests__/brush-session.test.ts
git commit -m "feat(brush): add adjacent layer query and backtrack to BrushSession"
```

---

## Task 6: 将相邻层信息注入 createCommitInput

**Files:**
- Modify: `src/core/brush/brush-session.ts`

**Step 1: 修改 endStroke 中的 commitInput 构建**

当前代码：

```typescript
const commitInput = {
  ...this.deps.createCommitInput(stroke),
  stroke,
}
```

改为：

```typescript
const baseCommitInput = this.deps.createCommitInput(stroke)
const commitInput: CommitInput = {
  ...baseCommitInput,
  stroke,
  adjacentAbove: this.deps.getAdjacentLayerInfo?.('above') ?? null,
  adjacentBelow: this.deps.getAdjacentLayerInfo?.('below') ?? null,
}
```

这样 `ManifoldBrushEngine3D.commit()` 就能拿到相邻层信息来构建锥度 cutter。

**Step 2: 运行全部测试确认通过**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: 提交**

```bash
git add src/core/brush/brush-session.ts
git commit -m "feat(brush): inject adjacent layer info into CommitInput during endStroke"
```

---

## Task 7: 端到端集成测试

**Files:**
- Test: `src/core/__tests__/brush-e2e-flow.test.ts`

**Step 1: 写集成测试**

在 `src/core/__tests__/brush-e2e-flow.test.ts` 中添加：

```typescript
describe('cross-layer taper e2e', () => {
  it('should commit with taper when adjacent layer exists', async () => {
    // 1. 创建 session，配置 getAdjacentLayerInfo 和 recommitAdjacentLayer
    // 2. 在层 5 画一笔
    // 3. 验证 commit 成功
    // 4. 验证 getAdjacentLayerInfo 被调用
    // 5. 配置层 4 有 segments
    // 6. 在层 5 再画一笔
    // 7. 验证 recommitAdjacentLayer('below') 被调用
  })

  it('should not backtrack when no adjacent layers have segments', async () => {
    // 1. 创建 session，getAdjacentLayerInfo 返回 null
    // 2. 画一笔并 commit
    // 3. 验证 recommitAdjacentLayer 未被调用
  })

  it('single layer should behave identically to original', async () => {
    // 1. 创建 session，无 getAdjacentLayerInfo 回调
    // 2. 画一笔并 commit
    // 3. 验证结果与原始行为一致（向后兼容）
  })
})
```

具体的 mock 和断言参考现有 `brush-e2e-flow.test.ts` 中的模式。

**Step 2: 运行测试确认通过**

Run: `npx vitest run src/core/__tests__/brush-e2e-flow.test.ts`
Expected: PASS

**Step 3: 提交**

```bash
git add src/core/__tests__/brush-e2e-flow.test.ts
git commit -m "test(brush): add cross-layer taper e2e tests"
```

---

## Task 8: 全量测试 + 构建验证

**Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

**Step 3: 构建**

Run: `npm run build`
Expected: 构建成功

**Step 4: 提交（如有修复）**

```bash
git add -A
git commit -m "fix(brush): address build/type issues from taper integration"
```

---

## 实现注意事项

1. **Manifold `scale([1,1,-1])` 可能翻转法线**：extrude 后 `scale([1,1,-1])` 会产生负行列式变换，Manifold 可能自动修正法线方向，但需要在 Task 2 的测试中验证。如果产生 non-manifold 错误，替代方案是用 `Manifold.ofMesh()` 手动翻转三角形绕序。

2. **CrossSection 的 `area()` 方法**：需要确认 Manifold 的 CrossSection 是否有 `area()` 方法。如果没有，可以用 `toPolygons()` 检查是否为空来替代。

3. **segmentsToPolygons 的鲁棒性**：当前实现是简单的链式匹配，对于复杂拓扑（多个嵌套环、自交叉）可能不够健壮。但对于笔刷 commit 后的 segments（已经过 Clipper2 规范化），应该足够。

4. **性能**：每次 commit 最多额外 2 次 Manifold 布尔运算（回溯上下层）。每次 `buildTaperedHalf` 内部有 3 次 CrossSection 布尔 + 3 次 extrude + 1 次 union。总计约 10-15 次 Manifold 操作，预计增加 50-100ms。

5. **内存管理**：所有 Manifold 中间对象必须在 finally 中 `safeDelete`，防止 WASM 内存泄漏。Task 3 的实现中需要仔细追踪所有临时对象。
