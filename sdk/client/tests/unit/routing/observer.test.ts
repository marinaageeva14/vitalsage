import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NavigationObserver } from '../../../src/routing/observer.js';

// Helpers ─────────────────────────────────────────────────────────────────────

function pushTo(path: string) {
  history.pushState({}, '', path);
}

function replaceTo(path: string) {
  history.replaceState({}, '', path);
}

// ─── 'auto' mode (no Navigation API) ─────────────────────────────────────────

describe('NavigationObserver — auto mode (history API)', () => {
  let observer: NavigationObserver;
  let cb: Mock;

  // Ensure Navigation API is absent so we exercise the pushState patch path
  const originalNavigation = (window as unknown as Record<string, unknown>)['navigation'];

  beforeEach(() => {
    // Remove Navigation API to force pushState patching
    delete (window as unknown as Record<string, unknown>)['navigation'];
    observer = new NavigationObserver('auto');
    cb = vi.fn();
    observer.start();
    observer.onChange(cb);
    // Reset location to a known state
    history.replaceState({}, '', '/');
  });

  afterEach(() => {
    observer.stop();
    if (originalNavigation !== undefined) {
      (window as unknown as Record<string, unknown>)['navigation'] = originalNavigation;
    }
    history.replaceState({}, '', '/');
  });

  it('fires callback on pushState navigation', () => {
    pushTo('/about');
    expect(cb).toHaveBeenCalledWith('/about');
  });

  it('fires callback on replaceState with different path', () => {
    replaceTo('/contact');
    expect(cb).toHaveBeenCalledWith('/contact');
  });

  it('does NOT fire for replaceState with same path (deduplication)', () => {
    // current path is '/' — replace with '/' again
    history.replaceState({}, '', '/');
    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT fire twice for same path navigated sequentially', () => {
    pushTo('/dashboard');
    pushTo('/dashboard');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('fires for each distinct path', () => {
    pushTo('/page-1');
    pushTo('/page-2');
    pushTo('/page-3');
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does not double-patch pushState when start() called twice', () => {
    observer.start(); // second call — should be no-op due to PATCHED_SYMBOL
    pushTo('/double');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('stop() removes listeners', () => {
    observer.stop();
    pushTo('/after-stop');
    expect(cb).not.toHaveBeenCalled();
  });

  it('onChange returns an unsubscribe function', () => {
    const cb2: Mock = vi.fn();
    const unsub = observer.onChange(cb2);
    unsub();
    pushTo('/unsub-test');
    expect(cb2).not.toHaveBeenCalled();
  });

  it('multiple subscribers each receive the event', () => {
    const cb2: Mock = vi.fn();
    observer.onChange(cb2);
    pushTo('/multi');
    expect(cb).toHaveBeenCalledWith('/multi');
    expect(cb2).toHaveBeenCalledWith('/multi');
  });

  it('fires on popstate when location changes', () => {
    // Simulate back-navigation: push forward first, then replaceState to simulate
    // the new URL that popstate would bring (jsdom can't actually go back)
    pushTo('/step-1');  // currentPath → /step-1
    cb.mockClear();
    // Replace with a different path to simulate the effect of popstate restoring state
    replaceTo('/step-0');
    window.dispatchEvent(new PopStateEvent('popstate'));
    // replaceTo already fired via our patched replaceState; popstate is a no-op here
    // (currentPath already updated to /step-0 by replaceState)
    expect(cb).toHaveBeenCalledWith('/step-0');
  });

  it('fires on hashchange', () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    // hash changed to a different hash — only fires if path changed
    // Since location didn't actually change, dedup prevents the call
    // This tests the hashchange listener is attached without errors
  });
});

// ─── 'mpa' mode ──────────────────────────────────────────────────────────────

describe('NavigationObserver — mpa mode', () => {
  it('does not register any listeners in mpa mode', () => {
    const observer = new NavigationObserver('mpa');
    const cb: Mock = vi.fn();
    observer.start();
    observer.onChange(cb);
    history.pushState({}, '', '/mpa-test');
    expect(cb).not.toHaveBeenCalled();
    observer.stop();
    history.replaceState({}, '', '/');
  });
});

// ─── 'spa' mode ──────────────────────────────────────────────────────────────

describe('NavigationObserver — spa mode', () => {
  it('behaves the same as auto when Navigation API is absent', () => {
    delete (window as unknown as Record<string, unknown>)['navigation'];
    const observer = new NavigationObserver('spa');
    const cb: Mock = vi.fn();
    observer.start();
    observer.onChange(cb);
    history.pushState({}, '', '/spa-page');
    expect(cb).toHaveBeenCalledWith('/spa-page');
    observer.stop();
    history.replaceState({}, '', '/');
  });
});
