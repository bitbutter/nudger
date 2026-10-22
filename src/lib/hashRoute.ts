import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'doc'; id: string }
  | { name: 'nudgerFiles'; id: string; nudgerId: string }
  | { name: 'settings' }
  | { name: 'templates' };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '');
  if (!raw) return { name: 'home' };
  const parts = raw.split('/');
  if (parts[0] === 'doc' && parts[1]) {
    try {
      const id = decodeURIComponent(parts[1]);
      if (parts[2] === 'nudger' && parts[3] && parts[4] === 'files' && parts.length === 5) {
        return { name: 'nudgerFiles', id, nudgerId: decodeURIComponent(parts[3]) };
      }
      return { name: 'doc', id };
    } catch {
      return { name: 'home' };
    }
  }
  if (parts[0] === 'settings' && parts.length === 1) return { name: 'settings' };
  if (parts[0] === 'templates' && parts.length === 1) return { name: 'templates' };
  return { name: 'home' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'doc':
      return `#/doc/${encodeURIComponent(route.id)}`;
    case 'nudgerFiles':
      return `#/doc/${encodeURIComponent(route.id)}/nudger/${encodeURIComponent(route.nudgerId)}/files`;
    case 'settings':
      return '#/settings';
    case 'templates':
      return '#/templates';
  }
}

export function navigate(route: Route): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const HASH_ROUTES = {
  home: () => navigate({ name: 'home' }),
  doc: (id: string) => navigate({ name: 'doc', id }),
  nudgerFiles: (id: string, nudgerId: string) =>
    navigate({ name: 'nudgerFiles', id, nudgerId }),
  settings: () => navigate({ name: 'settings' }),
  templates: () => navigate({ name: 'templates' }),
};
