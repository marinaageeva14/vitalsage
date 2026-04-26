import type { NavigationMode } from '@vitalsage/types';

const PATCHED_SYMBOL = Symbol('vitalsage.patched');

export class NavigationObserver {
  private listeners: Array<(path: string) => void> = [];
  private currentPath: string;
  private mode: NavigationMode;
  private cleanups: Array<() => void> = [];

  constructor(mode: NavigationMode) {
    this.mode = mode;
    this.currentPath = location.pathname + location.hash;
  }

  start(): void {
    if (this.mode === 'mpa') return;

    // Prefer modern Navigation API (Chrome 102+).
    // Use a microtask so location.href has updated before we read it.
    if ('navigation' in window) {
      const handler = () => queueMicrotask(() => this.handleNavigation());
      (window as unknown as { navigation: EventTarget }).navigation
        .addEventListener('navigate', handler);
      this.cleanups.push(() =>
        (window as unknown as { navigation: EventTarget }).navigation
          .removeEventListener('navigate', handler),
      );
      return;
    }

    // Fall back to patching History API
    this.patchHistoryMethod('pushState');
    this.patchHistoryMethod('replaceState');

    const popstateHandler  = () => this.handleNavigation();
    const hashchangeHandler = () => this.handleNavigation();
    window.addEventListener('popstate',   popstateHandler);
    window.addEventListener('hashchange', hashchangeHandler);
    this.cleanups.push(() => {
      window.removeEventListener('popstate',   popstateHandler);
      window.removeEventListener('hashchange', hashchangeHandler);
    });
  }

  private patchHistoryMethod(method: 'pushState' | 'replaceState'): void {
    const original = history[method].bind(history);

    // Guard against double-patching (multiple VitalSage instances, HMR)
    if ((history[method] as unknown as Record<symbol, boolean>)[PATCHED_SYMBOL]) return;

    const patched = (...args: Parameters<History['pushState']>) => {
      original(...args);
      this.handleNavigation();
    };
    (patched as unknown as Record<symbol, boolean>)[PATCHED_SYMBOL] = true;
    history[method] = patched;

    this.cleanups.push(() => { history[method] = original; });
  }

  private handleNavigation(): void {
    const newPath = location.pathname + location.hash;
    if (newPath === this.currentPath) return; // deduplicate same-path calls
    this.currentPath = newPath;
    this.listeners.forEach(l => l(newPath));
  }

  onChange(cb: (path: string) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  stop(): void {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
    this.listeners = [];
  }
}
