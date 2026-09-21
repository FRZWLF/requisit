import { isId } from '../ids.ts';
import type { Route } from './types.ts';

/**
 * The table router (D-012, D-023). A `:id` segment must be a UUID or the route simply does
 * not match — so a malformed id is answered by the one 404 mapping and never reaches a
 * repository or a statement. There is no `405`: an unknown `(method, path)` is `not_found`,
 * which is also the answer a cross-organisation id gets, so the router is no oracle.
 */

export interface RouteMatch {
  readonly route: Route;
  readonly params: Record<string, string>;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(path);
  if (expected.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] as string;
    const have = actual[index] as string;
    if (want.startsWith(':')) {
      if (!isId(have)) {
        return null;
      }
      params[want.slice(1)] = have;
      continue;
    }
    if (want !== have) {
      return null;
    }
  }
  return params;
}

export function matchRoute(
  routes: readonly Route[],
  method: string,
  path: string,
): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const params = matchPattern(route.pattern, path);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}
