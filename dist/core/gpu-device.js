let cachedDevice = null;
let probed = false;
/**
 * 获取 WebGPU 设备（单例）
 * 返回 null 表示 WebGPU 不可用
 */
export async function getGPUDevice() {
    if (probed)
        return cachedDevice;
    probed = true;
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return null;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
            return null;
        cachedDevice = await adapter.requestDevice();
        cachedDevice.lost.then((info) => {
            console.warn('WebGPU device lost:', info.message);
            cachedDevice = null;
            probed = false;
        });
        return cachedDevice;
    }
    catch {
        return null;
    }
}
/** 检查 WebGPU 是否可用（同步，需先调用过 getGPUDevice） */
export function isWebGPUAvailable() {
    return cachedDevice !== null;
}
/** 重置缓存（用于测试） */
export function resetGPUDevice() {
    cachedDevice = null;
    probed = false;
}
//# sourceMappingURL=gpu-device.js.map