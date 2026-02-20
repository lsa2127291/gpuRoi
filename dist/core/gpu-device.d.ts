/**
 * 获取 WebGPU 设备（单例）
 * 返回 null 表示 WebGPU 不可用
 */
export declare function getGPUDevice(): Promise<GPUDevice | null>;
/** 检查 WebGPU 是否可用（同步，需先调用过 getGPUDevice） */
export declare function isWebGPUAvailable(): boolean;
/** 重置缓存（用于测试） */
export declare function resetGPUDevice(): void;
//# sourceMappingURL=gpu-device.d.ts.map