import { describe, it, expect } from 'vitest';
import { INJECTOR_SCRIPT } from '../../src/injector.js';

describe('INJECTOR_SCRIPT', () => {
  it('is a non-empty string', () => {
    expect(typeof INJECTOR_SCRIPT).toBe('string');
    expect(INJECTOR_SCRIPT.length).toBeGreaterThan(100);
  });

  it('sets up __vitalsage_session', () => {
    expect(INJECTOR_SCRIPT).toContain('__vitalsage_session');
  });

  it('observes LCP', () => {
    expect(INJECTOR_SCRIPT).toContain('largest-contentful-paint');
  });

  it('observes CLS', () => {
    expect(INJECTOR_SCRIPT).toContain('layout-shift');
  });

  it('observes FCP', () => {
    expect(INJECTOR_SCRIPT).toContain('paint');
  });

  it('includes rateMetric function', () => {
    expect(INJECTOR_SCRIPT).toContain('rateMetric');
  });

  it('uses IIFE pattern to avoid global pollution', () => {
    expect(INJECTOR_SCRIPT.trim()).toMatch(/^\(function\(\)/);
  });

  it('does not contain Node.js require or import statements', () => {
    expect(INJECTOR_SCRIPT).not.toContain('require(');
    expect(INJECTOR_SCRIPT).not.toContain('import ');
  });
});
