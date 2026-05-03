import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressBar } from '../../src/output/progress.js';

describe('ProgressBar', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders on tick', () => {
    const bar = new ProgressBar(10, 'Test');
    bar.tick();
    expect(writeSpy).toHaveBeenCalled();
    const output = String(writeSpy.mock.calls[0]![0]);
    expect(output).toContain('1/10');
  });

  it('tick increments by 1 by default', () => {
    const bar = new ProgressBar(10, 'Test');
    bar.tick();
    bar.tick();
    const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0];
    expect(String(lastCall)).toContain('2/10');
  });

  it('tick accepts custom increment', () => {
    const bar = new ProgressBar(10, 'Test');
    bar.tick(5);
    const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0];
    expect(String(lastCall)).toContain('5/10');
  });

  it('complete writes newline', () => {
    const bar = new ProgressBar(5, 'Test');
    bar.complete();
    const calls = writeSpy.mock.calls.map(c => String(c[0]));
    expect(calls.some(s => s.includes('\n'))).toBe(true);
  });

  it('complete sets to 100%', () => {
    const bar = new ProgressBar(10, 'Test');
    bar.tick(3);
    bar.complete();
    const lastRender = writeSpy.mock.calls[writeSpy.mock.calls.length - 2]![0];
    expect(String(lastRender)).toContain('10/10');
  });

  it('does not exceed total on tick', () => {
    const bar = new ProgressBar(5, 'Test');
    bar.tick(10);
    const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0];
    expect(String(lastCall)).toContain('5/5');
  });

  it('includes the label in output', () => {
    const bar = new ProgressBar(10, 'MyLabel');
    bar.tick();
    const output = String(writeSpy.mock.calls[0]![0]);
    expect(output).toContain('MyLabel');
  });
});
