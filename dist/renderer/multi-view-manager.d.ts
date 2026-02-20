export interface ManagedSliceView {
    id: string;
    refresh: (reason: 'meshUpdated' | 'cameraChanged' | 'full') => Promise<void> | void;
}
export declare class MultiViewManager {
    private readonly views;
    registerView(view: ManagedSliceView): void;
    unregisterView(viewId: string): void;
    refreshOtherViews(sourceViewId: string, reason?: 'meshUpdated' | 'cameraChanged' | 'full'): Promise<void>;
    refreshAllViews(reason?: 'meshUpdated' | 'cameraChanged' | 'full'): Promise<void>;
}
//# sourceMappingURL=multi-view-manager.d.ts.map