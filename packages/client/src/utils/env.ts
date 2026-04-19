export const isBrowser = typeof window !== 'undefined';
export const isSSR     = !isBrowser;

export function isDev(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((globalThis as any).process?.env?.['NODE_ENV'] === 'development') {
      return true;
    }
  } catch { /* ignore */ }
  return isBrowser && (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname.endsWith('.local')
  );
}
