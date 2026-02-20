export interface ManagedSliceView {
  id: string
  refresh: (reason: 'meshUpdated' | 'cameraChanged' | 'full') => Promise<void> | void
}

export class MultiViewManager {
  private readonly views = new Map<string, ManagedSliceView>()

  registerView(view: ManagedSliceView): void {
    this.views.set(view.id, view)
  }

  unregisterView(viewId: string): void {
    this.views.delete(viewId)
  }

  async refreshOtherViews(
    sourceViewId: string,
    reason: 'meshUpdated' | 'cameraChanged' | 'full' = 'meshUpdated',
  ): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [id, view] of this.views) {
      if (id === sourceViewId) continue
      tasks.push(Promise.resolve(view.refresh(reason)))
    }
    await Promise.all(tasks)
  }

  async refreshAllViews(reason: 'meshUpdated' | 'cameraChanged' | 'full' = 'full'): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const view of this.views.values()) {
      tasks.push(Promise.resolve(view.refresh(reason)))
    }
    await Promise.all(tasks)
  }
}
