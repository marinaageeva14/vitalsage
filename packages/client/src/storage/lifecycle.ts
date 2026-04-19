import type { SessionReport, StorageAdapter } from '@vitalsage/types';

export class LifecycleManager {
  private emitted = new Set<string>();

  constructor(
    private getReport: () => SessionReport,
    private adapter: StorageAdapter,
  ) {}

  attach(): void {
    window.addEventListener('pagehide', () => this.emit(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.emit();
    });
  }

  emitForVisit(visitId: string): void {
    this.emit(visitId);
  }

  private emit(visitId?: string): void {
    const report = this.getReport();
    const id = visitId ?? report.visitId;

    if (this.emitted.has(id)) return;
    this.emitted.add(id);

    if (!this.adapter.onReport) return;

    try {
      const result = this.adapter.onReport(report);
      if (result instanceof Promise) {
        result.catch(err =>
          console.warn('[VitalSage] onReport Promise rejected:', err)
        );
      }
    } catch (err) {
      console.warn('[VitalSage] onReport threw synchronously:', err);
    }
  }
}
