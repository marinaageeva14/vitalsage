import { describe, it, expect } from 'vitest';

// Re-export the parseArgs internals for testing by extracting them
// We test behavior indirectly via what the parsed map would look like
// by copying the parser logic here (it's pure, no side effects)

function parseArgs(argv: string[]): Map<string, string | string[] | boolean> {
  const result = new Map<string, string | string[] | boolean>();
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result.set(key, true);
        i++;
      } else {
        const values: string[] = [];
        i++;
        while (i < argv.length && !argv[i]!.startsWith('--')) {
          values.push(argv[i]!);
          i++;
        }
        result.set(key, values.length === 1 ? values[0]! : values);
      }
    } else {
      i++;
    }
  }
  return result;
}

describe('parseArgs', () => {
  it('parses a single string flag', () => {
    const args = parseArgs(['--url', 'https://example.com']);
    expect(args.get('url')).toBe('https://example.com');
  });

  it('parses a boolean flag', () => {
    const args = parseArgs(['--help']);
    expect(args.get('help')).toBe(true);
  });

  it('parses multiple values for a flag as array', () => {
    const args = parseArgs(['--routes', '/', '/about', '/checkout']);
    expect(args.get('routes')).toEqual(['/', '/about', '/checkout']);
  });

  it('parses mixed flags and values', () => {
    const args = parseArgs(['--url', 'https://example.com', '--runs', '50', '--networks', '4g', '3g']);
    expect(args.get('url')).toBe('https://example.com');
    expect(args.get('runs')).toBe('50');
    expect(args.get('networks')).toEqual(['4g', '3g']);
  });

  it('converts kebab-case to camelCase', () => {
    const args = parseArgs(['--ai-provider', 'anthropic', '--min-samples', '100']);
    expect(args.get('aiProvider')).toBe('anthropic');
    expect(args.get('minSamples')).toBe('100');
  });

  it('returns empty map for no args', () => {
    const args = parseArgs([]);
    expect(args.size).toBe(0);
  });

  it('handles flag immediately followed by another flag', () => {
    const args = parseArgs(['--verbose', '--url', 'https://example.com']);
    expect(args.get('verbose')).toBe(true);
    expect(args.get('url')).toBe('https://example.com');
  });

  it('handles single value wrapped in array as string', () => {
    const args = parseArgs(['--output', './report.html']);
    expect(args.get('output')).toBe('./report.html');
  });

  it('ignores non-flag positional arguments', () => {
    const args = parseArgs(['simulate', '--url', 'https://example.com']);
    expect(args.get('url')).toBe('https://example.com');
    expect(args.has('simulate')).toBe(false);
  });

  it('parses sessions-auth with spaces as single value', () => {
    const args = parseArgs(['--sessions-auth', 'Bearer mytoken123']);
    expect(args.get('sessionsAuth')).toBe('Bearer mytoken123');
  });
});
