// Tiny hash router + bottom navigation in the Classical design language.

import { el, clear } from './dom';

export type Route = 'home' | 'play' | 'puzzles' | 'stats' | 'settings';

export interface Screen {
  root: HTMLElement;
  mount?(): void;
  unmount?(): void;
}

const screens = new Map<Route, () => Screen>();
let current: Screen | null = null;
let currentRoute: Route = 'home';
let outlet: HTMLElement | null = null;
let navBar: HTMLElement | null = null;

export function registerScreen(route: Route, factory: () => Screen): void {
  screens.set(route, factory);
}

export function navigate(route: Route): void {
  if (location.hash !== '#' + route) {
    location.hash = route;
  } else {
    show(route);
  }
}

function show(route: Route): void {
  const factory = screens.get(route) ?? screens.get('home')!;
  current?.unmount?.();
  current = factory();
  currentRoute = route;
  if (outlet) {
    clear(outlet);
    outlet.append(current.root);
    outlet.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  current.mount?.();
  renderNav();
}

const NAV_ITEMS: Array<{ route: Route; label: string; icon: string }> = [
  { route: 'home', label: 'Home', icon: '⌂' },
  { route: 'play', label: 'Play', icon: '♞' },
  { route: 'puzzles', label: 'Puzzles', icon: '✦' },
  { route: 'stats', label: 'Insights', icon: '◔' },
  { route: 'settings', label: 'Settings', icon: '⚙' },
];

function renderNav(): void {
  if (!navBar) return;
  clear(navBar);
  for (const item of NAV_ITEMS) {
    const active = item.route === currentRoute;
    navBar.append(el('button', {
      style: 'flex:1; min-height:52px; border:none; background:transparent; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:1px; padding:6px 0;' +
        `color:${active ? 'var(--color-accent-700)' : 'var(--color-neutral-600)'};` +
        `border-top:${active ? '2px solid var(--color-accent)' : '2px solid transparent'}`,
      'aria-label': item.label,
      'aria-current': active ? 'page' : undefined,
      onclick: () => navigate(item.route),
    },
      el('span', { style: 'font-size:19px; line-height:1', 'aria-hidden': 'true' }, item.icon),
      el('span', { style: 'font-size:10px; letter-spacing:0.1em; text-transform:uppercase; font-family:var(--font-body)' }, item.label),
    ));
  }
}

export function initRouter(app: HTMLElement): void {
  outlet = el('div', { style: 'padding-bottom:0' });
  navBar = el('nav', {
    style: 'position:fixed; left:0; right:0; bottom:0; display:flex; background:color-mix(in srgb, var(--color-bg) 92%, transparent); backdrop-filter:blur(8px); border-top:1px solid var(--color-divider); z-index:40; padding-bottom:env(safe-area-inset-bottom)',
    'aria-label': 'Main navigation',
  });
  app.append(outlet, navBar);
  window.addEventListener('hashchange', () => {
    show((location.hash.slice(1) || 'home') as Route);
  });
  show((location.hash.slice(1) || 'home') as Route);
}
