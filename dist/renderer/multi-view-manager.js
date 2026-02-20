export class MultiViewManager {
    constructor() {
        this.views = new Map();
    }
    registerView(view) {
        this.views.set(view.id, view);
    }
    unregisterView(viewId) {
        this.views.delete(viewId);
    }
    async refreshOtherViews(sourceViewId, reason = 'meshUpdated') {
        const tasks = [];
        for (const [id, view] of this.views) {
            if (id === sourceViewId)
                continue;
            tasks.push(Promise.resolve(view.refresh(reason)));
        }
        await Promise.all(tasks);
    }
    async refreshAllViews(reason = 'full') {
        const tasks = [];
        for (const view of this.views.values()) {
            tasks.push(Promise.resolve(view.refresh(reason)));
        }
        await Promise.all(tasks);
    }
}
//# sourceMappingURL=multi-view-manager.js.map