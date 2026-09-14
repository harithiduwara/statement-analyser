import { useEffect, useState } from 'react';

/**
 * Hash routing.
 *
 * Deliberately hash-based and dependency-free: the app is a static build that
 * has to work from a repository subpath, a custom domain or a local file://
 * copy, and a history router needs a server that rewrites unknown paths to
 * index.html. There is no server here, by design.
 */

export const ROUTES = [
  'upload',
  'overview',
  'cycles',
  'instalments',
  'forward',
  'categories',
  'transactions',
] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = 'upload';

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE;
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (next: Route): void => {
    window.location.hash = `#/${next}`;
  };

  return [route, navigate];
}

export function href(route: Route): string {
  return `#/${route}`;
}
