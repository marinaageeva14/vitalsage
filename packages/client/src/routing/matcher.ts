import type { RouteConfig } from '@vitalsage/types';

// Supports:
//   Exact:      '/home'
//   Wildcard:   '/blog/*'     (single segment)
//   Deep wild:  '/admin/**'   (any depth, including zero extra segments)
//   Param:      '/post/:id'   (single segment, named)
//   Combined:   '/shop/:cat/**'

export function compilePattern(pattern: string): (path: string) => boolean {
  const normalised = normaliseTrailingSlash(pattern);

  // Use placeholders so * expansion doesn't corrupt the ** replacement strings
  const regexStr = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')           // escape regex special chars
    .replace(/\/\*\*/g, '\x00DEEPSLASH\x00')         // /** → placeholder
    .replace(/\*\*/g,   '\x00DEEP\x00')              // ** alone → placeholder
    .replace(/\*/g,     '[^/]+')                     // * = one segment
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '[^/]+') // :param = one segment
    .replace(/\x00DEEPSLASH\x00/g, '(?:/.*)?')       // restore /** → optional /anything
    .replace(/\x00DEEP\x00/g,      '.*');             // restore ** → anything

  const re = new RegExp(`^${regexStr}$`);
  return (path: string) => re.test(normaliseTrailingSlash(path));
}

function normaliseTrailingSlash(s: string): string {
  if (s === '/') return s;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// Returns the first matching RouteConfig or undefined (catch-all)
export function matchRoute(
  path: string,
  routes: RouteConfig[],
): RouteConfig | undefined {
  // Normalise hash routing (#/path → /path) and strip query string
  const normPath = path.startsWith('#/')
    ? path.slice(1)
    : (path.split('?')[0] ?? path);

  return routes.find(r => compilePattern(r.pattern)(normPath));
}
