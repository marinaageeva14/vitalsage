import { describe, it, expect, vi } from 'vitest';
import { generateId, generateSuggestionId } from '../../../src/utils/id.js';

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('produces unique values across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '12345678-1234-1234-1234-123456789abc',
    );
    const id = generateId();
    expect(spy).toHaveBeenCalled();
    // strips dashes, slices to 12 chars
    expect(id).toBe('123456781234');
    spy.mockRestore();
  });

  it('falls back to Math.random when crypto.randomUUID is absent', () => {
    const originalUUID = crypto.randomUUID;
    // @ts-expect-error — testing fallback path
    crypto.randomUUID = undefined;

    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    crypto.randomUUID = originalUUID;
  });
});

describe('generateSuggestionId', () => {
  it('returns an 8-char hex string', () => {
    const id = generateSuggestionId('lcp', 'LCP', 'Add fetchpriority');
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same inputs produce same output', () => {
    const a = generateSuggestionId('lcp', 'LCP', 'Add fetchpriority');
    const b = generateSuggestionId('lcp', 'LCP', 'Add fetchpriority');
    expect(a).toBe(b);
  });

  it('produces different IDs for different agents', () => {
    const a = generateSuggestionId('lcp',  'LCP', 'Fix image');
    const b = generateSuggestionId('ttfb', 'LCP', 'Fix image');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different metrics', () => {
    const a = generateSuggestionId('lcp', 'LCP',  'Same title');
    const b = generateSuggestionId('lcp', 'TTFB', 'Same title');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different titles', () => {
    const a = generateSuggestionId('lcp', 'LCP', 'Add fetchpriority');
    const b = generateSuggestionId('lcp', 'LCP', 'Use preload link');
    expect(a).not.toBe(b);
  });

  it('normalises title case and whitespace', () => {
    const a = generateSuggestionId('lcp', 'LCP', 'Add  Fetchpriority');
    const b = generateSuggestionId('lcp', 'LCP', 'add  fetchpriority');
    expect(a).toBe(b);
  });

  it('truncates title to 60 chars before hashing', () => {
    const longTitle  = 'A'.repeat(80);
    const shortTitle = 'A'.repeat(60);
    expect(generateSuggestionId('lcp', 'LCP', longTitle)).toBe(
      generateSuggestionId('lcp', 'LCP', shortTitle),
    );
  });
});
