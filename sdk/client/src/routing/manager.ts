import type { RouteConfig, RouteContext } from '@vitalsage/types';
import { generateId } from '../utils/id.js';
import { matchRoute } from './matcher.js';

export class RouteContextManager {
  private routes: RouteConfig[];
  private context: RouteContext;
  private index = 0;

  constructor(routes: RouteConfig[]) {
    this.routes = routes;
    this.context = this.build(location.pathname);
  }

  navigate(path: string): RouteContext {
    this.index++;
    this.context = this.build(path);
    return this.context;
  }

  current(): RouteContext { return this.context; }

  matchedConfig(): RouteConfig | undefined {
    return matchRoute(this.context.path, this.routes);
  }

  private build(path: string): RouteContext {
    const matched = matchRoute(path, this.routes);
    return {
      pattern:         matched?.pattern ?? '/**',
      ...(matched?.label ? { label: matched.label } : {}),
      path,
      visitId:         generateId(),
      navigationIndex: this.index,
    };
  }
}
