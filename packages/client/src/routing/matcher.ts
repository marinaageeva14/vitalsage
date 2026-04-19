import type { RouteConfig } from '@vitalsage/types';

// Supports:
//   Exact:      '/home'
//   Wildcard:   '/blog/*'     (single segment)
//   Deep wild:  '/admin/**'   (any depth, including zero extra segments)
//   Param:      '/post/:id'   (single segment, named)
//   Combined:   '/shop/:cat/**'

export function compilePattern(pattern: string): (path: string) => boolean {
  const normalised = normaliseTrailingSlash(pattern);

  const regexStr = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (not * or :)
    .replace(/\*\*/g, '(.+)?')             // ** = any depth, including zero
    .replace(/\*/g,   '([^/]+)')           // *  = one segment (no slashes)
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '([^/]+)'); // :param = one segment

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
