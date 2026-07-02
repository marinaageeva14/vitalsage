/**
 * Shared HTTP plumbing for AI providers.
 *
 * Every provider request goes through fetchWithTimeout so a hung connection
 * can never stall an audit indefinitely — without a timeout, fetch() waits
 * forever, the retry loop never advances, and Promise.allSettled in the
 * engine blocks until the process is killed.
 */

export const DEFAULT_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AITimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider}: request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'AITimeoutError';
  }
}

export async function fetchWithTimeout(
  provider:  string,
  url:       string,
  init:      RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AITimeoutError(provider, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Delay before the next attempt after a 429. Respects Retry-After (seconds
 * or HTTP-date) when present, otherwise exponential backoff with jitter.
 */
export function rateLimitDelay(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 30_000);
  }
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 10_000);
}

export { sleep };
