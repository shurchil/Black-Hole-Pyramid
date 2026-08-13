/**
 * Tiny DOM helpers.
 *
 * The board is canvas; everything else (menus, HUD, overlays) is DOM, because
 * real text nodes give us crisp type at every DPI, screen-reader access and
 * native focus handling for free — none of which a canvas UI gets.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElOptions {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string | number | boolean | null>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
  dataset?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.style) Object.assign(node.style, options.style);

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === null || value === false) node.removeAttribute(key);
      else node.setAttribute(key, String(value));
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = value;
  }
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      node.addEventListener(event, handler as EventListener);
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A labelled button that also carries an accessible name. */
export function button(
  label: string,
  onClick: () => void,
  options: { class?: string; disabled?: boolean; sub?: string } = {},
): HTMLButtonElement {
  return el(
    'button',
    {
      class: `btn ${options.class ?? ''}`.trim(),
      attrs: { type: 'button', disabled: options.disabled ?? false, 'aria-label': label },
      on: { click: onClick },
    },
    el('span', { class: 'btn-label', text: label }),
    options.sub ? el('span', { class: 'btn-sub', text: options.sub }) : null,
  );
}

/** Animated number that counts toward a target; returns a setter. */
export function counter(initial = 0, format: (n: number) => string = (n) => String(Math.round(n))) {
  const node = el('span', { class: 'counter', text: format(initial) });
  let current = initial;
  let target = initial;
  let raf = 0;

  const step = () => {
    // Ease toward the target; snap when close so it always lands exactly.
    current += (target - current) * 0.18;
    if (Math.abs(target - current) < 0.5) {
      current = target;
      node.textContent = format(current);
      raf = 0;
      return;
    }
    node.textContent = format(current);
    raf = requestAnimationFrame(step);
  };

  return {
    node,
    set(value: number) {
      target = value;
      if (raf === 0) raf = requestAnimationFrame(step);
    },
    snap(value: number) {
      target = value;
      current = value;
      node.textContent = format(value);
    },
    stop() {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/** Horizontal progress bar with a fill you can animate via CSS. */
export function progressBar(progress: number, label?: string): { root: HTMLElement; set(p: number): void } {
  const fill = el('div', { class: 'bar-fill', style: { width: `${Math.round(progress * 100)}%` } });
  const root = el(
    'div',
    { class: 'bar', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 } },
    fill,
    label ? el('span', { class: 'bar-label', text: label }) : null,
  );
  return {
    root,
    set(p: number) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
      root.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    },
  };
}

/** Transient message that slides in and removes itself. */
export function toast(container: HTMLElement, message: string, variant: 'info' | 'good' | 'bad' = 'info'): void {
  const node = el('div', { class: `toast toast-${variant}`, text: message });
  container.appendChild(node);
  // Force a reflow so the entry transition actually plays.
  void node.offsetWidth;
  node.classList.add('toast-in');
  setTimeout(() => {
    node.classList.remove('toast-in');
    setTimeout(() => node.remove(), 320);
  }, 2200);
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
