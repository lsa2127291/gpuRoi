# MPR Slice Renderer

3D Mesh 切面实时渲染模块 — 根据相机视角和锚点，实时计算 Mesh 与平面的截面轮廓，并绘制在 Canvas 上。

适用于医学影像 MPR（多平面重建）视图、CAD 剖面查看等场景。

## 快速开始

```bash
# 安装依赖
npm install

# 启动 Demo
npm run dev

# 运行测试
npm test

# 测试覆盖率
npm run test:coverage

# 构建
npm run build
```

## API 参考

### SliceRenderer

主入口类，整合切割算法、坐标转换和 Canvas 渲染。

```typescript
import { SliceRenderer } from './src/renderer/slice-renderer'

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const renderer = new SliceRenderer(canvas)
```

#### `setMesh(data: MeshData): void`

初始化或更新 Mesh 数据。

```typescript
renderer.setMesh({
  vertices: new Float32Array([...]),  // [x,y,z, x,y,z, ...]
  indices: new Uint32Array([...]),    // [v0,v1,v2, ...]
  normals: new Float32Array([...]),   // 可选
})
```

#### `updateSlice(camera: CameraData, anchor: Vec3): void`

更新切割参数并触发重绘。

```typescript
renderer.updateSlice(
  { viewPlaneNormal: [0, 0, -1], viewUp: [0, -1, 0] },
  [0, 0, 0]  // 切面经过的点
)
```

#### `setRenderStyle(color: string, width: number, scale: number): void`

设置渲染样式。

```typescript
renderer.setRenderStyle('#ff0000', 2, 3)  // 红色, 2px线宽, 3倍缩放
```

## 数据格式

### MeshData

| 字段 | 类型 | 说明 |
|------|------|------|
| `vertices` | `Float32Array` | 顶点坐标 `[x,y,z, ...]` |
| `indices` | `Uint32Array` | 三角形索引 `[v0,v1,v2, ...]` |
| `normals` | `Float32Array?` | 顶点法线（可选） |

### CameraData

| 字段 | 类型 | 说明 |
|------|------|------|
| `viewPlaneNormal` | `[number, number, number]` | 切割平面法线（归一化） |
| `viewUp` | `[number, number, number]` | 视图上方向（归一化） |

### Vec3

```typescript
type Vec3 = [number, number, number]
```

## MPR 预设视图

```typescript
import { MPR_VIEWS } from './src/types'

MPR_VIEWS.Axial    // Normal: [0, 0, -1], Up: [0, -1, 0]
MPR_VIEWS.Sagittal // Normal: [-1, 0, 0], Up: [0, 0, 1]
MPR_VIEWS.Coronal  // Normal: [0, -1, 0], Up: [0, 0, 1]
```

## 项目结构

```
src/
├── core/
│   ├── vec3.ts          # 向量数学工具
│   ├── slicer.ts        # 网格切割算法
│   ├── projection.ts    # 3D→2D 坐标投影
│   └── test-data.ts     # 测试用立方体数据
├── renderer/
│   ├── canvas-renderer.ts  # Canvas 2D 渲染器
│   └── slice-renderer.ts  # 主类（API 入口）
├── types/
│   └── index.ts         # 类型定义与常量
├── demo/
│   ├── index.html       # Demo 页面
│   └── main.ts          # Demo 逻辑
└── index.ts             # 导出入口
```

## Demo

运行 `npm run dev` 后打开浏览器，可以：

1. 点击 Axial / Sagittal / Coronal 按钮切换视角
2. 拖动滑动条沿法线方向移动切面位置
3. 使用 TEST_CUBE（边长 100mm 立方体）实时查看切面效果
