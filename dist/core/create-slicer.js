import { getGPUDevice } from './gpu-device';
import { GPUSlicer } from './gpu-slicer';
import { CPUSlicer } from './cpu-slicer';
import { BatchGPUSlicer } from './batch-gpu-slicer';
/**
 * 工厂函数：自动选择 GPU 或 CPU 切割器
 * WebGPU 可用时返回 GPUSlicer，否则 fallback 到 CPUSlicer
 */
export async function createSlicer() {
    const device = await getGPUDevice();
    if (device) {
        return new GPUSlicer(device);
    }
    return new CPUSlicer();
}
/**
 * 工厂函数：创建批量切割器
 * WebGPU 可用时返回 BatchGPUSlicer，否则返回 null
 */
export async function createBatchSlicer() {
    const device = await getGPUDevice();
    if (device) {
        return new BatchGPUSlicer(device);
    }
    return null;
}
//# sourceMappingURL=create-slicer.js.map