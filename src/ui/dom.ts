// Minimal DOM helpers — the app renders straight to the DOM, no framework.

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'style') {
      node.setAttribute('style', String(v));
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** The design's uppercase small label style (used on every card). */
export const LABEL_STYLE = 'font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:var(--color-neutral-600)';

/** The design's card container style. */
export const CARD_STYLE = 'border:1px solid var(--color-divider); border-radius:var(--radius-md,4px); padding:16px 20px; display:flex; flex-direction:column; gap:10px';

/** Segmented-control button style from the design (active/inactive). */
export function segStyle(active: boolean): string {
  return `padding:4px 14px; font-size:13px; font-family:var(--font-body); cursor:pointer; border:none;` +
    `background:${active ? 'var(--color-accent-100)' : 'transparent'};` +
    `color:${active ? 'var(--color-accent-800)' : 'var(--color-neutral-600)'};` +
    `border-bottom:${active ? '2px solid var(--color-accent)' : '2px solid transparent'}`;
}

export function segWrap(...buttons: HTMLElement[]): HTMLElement {
  return el('div', { style: 'display:flex; border:1px solid var(--color-divider); border-radius:4px; overflow:hidden' }, ...buttons);
}
