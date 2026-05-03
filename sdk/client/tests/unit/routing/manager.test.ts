import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RouteContextManager } from '../../../src/routing/manager.js';
import type { RouteConfig } from '@vitalsage/types';

const routes: RouteConfig[] = [
  { pattern: '/',         label: 'Home' },
  { pattern: '/about',    label: 'About' },
  { pattern: '/blog/*',   label: 'Blog Post' },
  { pattern: '/post/:id', label: 'Post' },
];

// jsdom's location.pathname is non-configurable — stub the whole location object
function stubPathname(path: string) {
  vi.stubGlobal('location', { ...location, pathname: path, hash: '' });
}

describe('RouteContextManager', () => {
  beforeEach(() => {
    stubPathname('/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initialises with current location.pathname', () => {
    const mgr = new RouteContextManager(routes);
    expect(mgr.current().path).toBe('/');
    expect(mgr.current().navigationIndex).toBe(0);
  });

  it('matches the correct route on init', () => {
    const mgr = new RouteContextManager(routes);
    expect(mgr.current().pattern).toBe('/');
    expect(mgr.current().label).toBe('Home');
  });

  it('uses /** as fallback pattern when no route matches', () => {
    stubPathname('/unknown-page');
    const mgr = new RouteContextManager(routes);
    expect(mgr.current().pattern).toBe('/**');
    expect(mgr.current().label).toBeUndefined();
  });

  it('assigns a unique visitId on init', () => {
    const mgr = new RouteContextManager(routes);
    expect(typeof mgr.current().visitId).toBe('string');
    expect(mgr.current().visitId.length).toBeGreaterThan(0);
  });

  it('navigate() increments navigationIndex', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/about');
    expect(mgr.current().navigationIndex).toBe(1);
    mgr.navigate('/blog/post-1');
    expect(mgr.current().navigationIndex).toBe(2);
  });

  it('navigate() updates path and pattern', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/about');
    expect(mgr.current().path).toBe('/about');
    expect(mgr.current().pattern).toBe('/about');
    expect(mgr.current().label).toBe('About');
  });

  it('navigate() assigns a new visitId each time', () => {
    const mgr = new RouteContextManager(routes);
    const id1 = mgr.current().visitId;
    mgr.navigate('/about');
    const id2 = mgr.current().visitId;
    expect(id1).not.toBe(id2);
  });

  it('navigate() matches wildcard route', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/blog/hello-world');
    expect(mgr.current().pattern).toBe('/blog/*');
    expect(mgr.current().label).toBe('Blog Post');
  });

  it('navigate() matches param route', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/post/42');
    expect(mgr.current().pattern).toBe('/post/:id');
  });

  it('current() always returns the latest context', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/about');
    mgr.navigate('/blog/x');
    expect(mgr.current().path).toBe('/blog/x');
  });

  it('matchedConfig() returns the RouteConfig for current route', () => {
    const mgr = new RouteContextManager(routes);
    mgr.navigate('/about');
    expect(mgr.matchedConfig()?.label).toBe('About');
  });

  it('matchedConfig() returns undefined when no route matches', () => {
    stubPathname('/unknown');
    const mgr = new RouteContextManager(routes);
    expect(mgr.matchedConfig()).toBeUndefined();
  });

  it('works correctly with empty routes array (all fall back to /**)', () => {
    const mgr = new RouteContextManager([]);
    expect(mgr.current().pattern).toBe('/**');
    mgr.navigate('/anything');
    expect(mgr.current().pattern).toBe('/**');
  });
});
