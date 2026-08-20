import { nextFrame } from './raf.js';

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (region && document.body.contains(region)) return region;

  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('data-undoable-live-region', '');
  // Visually hidden without leaving the accessibility tree. No layout reads.
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(el);
  region = el;
  return el;
}

/**
 * One region, reused (spec §7). Politeness is switched per message rather
 * than kept in two regions.
 *
 * The region is cleared synchronously and written on the next frame so that
 * two identical consecutive messages are both announced — assistive tech
 * ignores a write that does not change the node's text.
 */
/**
 * The label alone describes what was *attempted*. Announcing it unchanged on
 * failure tells a screen-reader user the opposite of what happened — "Item
 * archived", assertively, at the moment the row comes back. The suffixes are
 * fixed: per-action copy is a non-goal, and a global message table would be
 * a second `configure` option.
 */
export function outcomeText(
  state: 'pending' | 'reverted' | 'failed' | 'desync',
  label: string,
): string {
  switch (state) {
    case 'pending':
      return label;
    case 'reverted':
      return `${label} — undone`;
    case 'failed':
      return `${label} — could not be saved, change undone`;
    case 'desync':
      return `${label} — could not be saved, refresh to see the current state`;
  }
}

export function announce(text: string, politeness: 'polite' | 'assertive'): void {
  const el = ensureRegion();
  if (!el || !text) return;

  el.setAttribute('aria-live', politeness);
  el.textContent = '';
  nextFrame(() => {
    el.textContent = text;
  });
}

/** Test seam. Not part of the public API. */
export function resetAnnouncer(): void {
  region?.remove();
  region = null;
}
