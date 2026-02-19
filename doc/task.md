# 任务拆分：3D Mesh 切面实时渲染模块 (MPR Slice Renderer)

## 依赖关系

```
1 → 2 → 3 → 4/5（可并行）→ 6 → 7 → 8/9（可并行）→ 10
```

---

## Task 1: 项目初始化与工程搭建

初始化 TypeScript 项目结构，配置构建工具（Vite）、tsconfig、package.json。创建基本目录结构：

- `src/core` — 算法
- `src/renderer` — 渲染
- `src/types` — 类型定义
- `src/demo` — 演示页面

---

## Task 2: 类型定义与数据接口（Types & Interfaces）

定义核心 TypeScript 类型接口：

- `MeshData`（vertices / indices / normals）
- `CameraData`（viewPlaneNormal / viewUp）
- `Vec3` 类型别名
- `Segment3D` / `Segment2D` 线段类型
- `SliceResult` 输出类型
- MPR 预设视图常量（Axial / Sagittal / Coronal）

---

## Task 3: 向量数学工具库（Vec3 Math Utils）

实现 3D 向量数学工具函数：

- `dot` — 点积
- `cross` — 叉积
- `subtract` — 向量减法
- `normalize` — 归一化
- `scale` — 缩放
- `add` — 加法

所有函数直接操作数值数组，避免创建类实例，注重性能。

---

## Task 4: 核心算法：网格切割（Mesh Slicing）

实现核心 Mesh 切割算法：

1. 根据 Anchor + viewPlaneNormal 定义平面方程
2. 遍历三角形，计算顶点到平面的有符号距离
3. 判断三角形与平面的相交情况
4. 计算边与平面的交点（线性插值）
5. 输出 3D 线段集合

包含 BoundingBox 提前剔除优化和对象池复用策略。

---

## Task 5: 坐标转换模块（3D to 2D Projection）

实现 3D 到 2D 坐标投影：

1. 根据 viewPlaneNormal 和 viewUp 构建正交局部坐标系（含正交化处理）
2. 将 3D 交点投影到局部 2D 坐标（相对于 Anchor 的点积计算）
3. 将物理坐标（mm）映射到 Canvas 像素空间（scale + offset）

---

## Task 6: Canvas 2D 渲染模块（Renderer）

实现 Canvas 2D 渲染器：

- 清空画布
- 遍历 2D 线段数组绘制（beginPath / moveTo / lineTo / stroke）
- 支持线条颜色和线宽配置

封装为独立渲染模块，职责单一。

---

## Task 7: SliceRenderer 主类集成（API 封装）

实现 `SliceRenderer` 主类，整合切割算法、坐标转换、Canvas 渲染三个模块。

暴露 API：

- `setMesh(data)` — 初始化或更新 Mesh
- `updateSlice(camera, anchor)` — 更新切割参数并触发重绘
- `setRenderStyle(color, width, scale)` — 设置渲染参数

实现响应式更新：任意数据变化自动触发「重计算 → 重投影 → 重绘制」流程。

---

## Task 8: 单元测试（Unit Tests）

创建 TEST_CUBE 测试数据（边长 100mm 立方体，中心在原点）。编写单元测试覆盖：

1. 向量数学工具函数
2. 切割算法 — Axial / Sagittal / Coronal 三视图切割正方形输出
3. 边界测试 — Anchor `[0,0,50]` 边缘切割、`[0,0,60]` 无相交
4. 坐标转换正确性验证

目标覆盖率 80%+。

---

## Task 9: Demo 演示页面

创建 Demo HTML 页面：

1. Canvas 画布展示切面渲染结果
2. 三个按钮切换视角（Axial / Sagittal / Coronal）
3. 滑动条控制 Anchor 位置（沿当前视图法线方向移动）
4. 集成 TEST_CUBE 数据，页面加载即可看到切面效果

---

## Task 10: API 开发文档

编写 API 使用文档（README.md），包含：

- 项目简介
- 快速开始
- API 参考（SliceRenderer 类方法说明）
- 数据格式说明
- MPR 预设视图常量
- Demo 运行方式
