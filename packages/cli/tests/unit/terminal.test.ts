import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printSuccess, printError, printWarning, printInfo, printReport } from '../../src/output/terminal.js';
import type { AnalysisReport } from '@vitalsage/types';

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    analysisId:      'test-id',
    generatedAt:     Date.now(),
    route:           { pattern: '/', path: '/', visitId: 'v1', navigationIndex: 0 },
    sampleSize:      100,
    syntheticCount:  0,
    realCount:       100,
    timeWindow:      { from: Date.now() - 3600000, to: Date.now() },
    confidence:      'medium',
    distributions:   {},
    suggestions:     [],
    analysisVersion: '0.1.0',
    ...overrides,
  };
}

describe('terminal output helpers', () => {
  let logSpy:   ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy:  ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy   = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('printSuccess calls console.log with the message', () => {
    printSuccess('Done!');
    expect(logSpy).toHaveBeenCalledOnce();
    const output = String(logSpy.mock.calls[0]![0]);
    expect(output).toContain('Done!');
  });

  it('printError calls console.error with the message', () => {
    printError('Something broke');
    expect(errorSpy).toHaveBeenCalledOnce();
    const output = String(errorSpy.mock.calls[0]![0]);
    expect(output).toContain('Something broke');
  });

  it('printWarning calls console.warn', () => {
    printWarning('Watch out');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('printInfo calls console.log', () => {
    printInfo('Loading...');
    expect(logSpy).toHaveBeenCalled();
  });

  it('printReport calls console.log multiple times for a report', () => {
    printReport([makeReport()]);
    expect(logSpy).toHaveBeenCalled();
  });

  it('printReport prints route pattern', () => {
    printReport([makeReport({ route: { pattern: '/checkout', path: '/checkout', visitId: 'v1', navigationIndex: 0 } })]);
    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('/checkout');
  });

  it('printReport handles empty suggestions', () => {
    expect(() => printReport([makeReport({ suggestions: [] })])).not.toThrow();
  });

  it('printReport prints suggestions by severity', () => {
    const report = makeReport({
      suggestions: [
        {
          id: 's1', agent: 'lcp', metric: 'LCP', severity: 'critical',
          title: 'Fix the LCP image', detail: 'Details here', effort: 'low',
          estimatedImpact: '200ms', confidence: 0.9,
        },
        {
          id: 's2', agent: 'cls', metric: 'CLS', severity: 'warning',
          title: 'Fix layout shifts', detail: 'Details here', effort: 'medium',
          estimatedImpact: '0.1 CLS', confidence: 0.75,
        },
      ],
    });
    printReport([report]);
    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('Fix the LCP image');
    expect(allOutput).toContain('Fix layout shifts');
  });

  it('printReport prints metric distributions', () => {
    const report = makeReport({
      distributions: {
        LCP: {
          p50: 2000, p75: 3200, p90: 4000, p95: 4500, p99: 6000,
          min: 800, max: 8000, mean: 2800, stdDev: 1000,
          sampleSize: 100, rating: 'needs-improvement',
          histogram: [], byDevice: {}, byConnection: {},
        },
      },
    });
    printReport([report]);
    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('LCP');
  });

  it('printReport handles multiple reports', () => {
    const reports = [
      makeReport({ route: { pattern: '/', path: '/', visitId: 'v1', navigationIndex: 0 } }),
      makeReport({ route: { pattern: '/about', path: '/about', visitId: 'v2', navigationIndex: 0 } }),
    ];
    expect(() => printReport(reports)).not.toThrow();
    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('/about');
  });
});
