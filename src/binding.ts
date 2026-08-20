import { flushPending, runAction } from './runtime.js';

let bound = false;
const warned = new WeakSet<Element>();

/**
 * A pragmatic subset of the accessible name computation: aria-label,
 * aria-labelledby, text content, title. The full algorithm is
 * disproportionate for picking announcement text.
 */
function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  const text = el.textContent?.trim();
  if (text) return text;

  return el.getAttribute('title')?.trim() ?? '';
}

function isNativeButton(el: Element): boolean {
  if (el.tagName === 'BUTTON') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type === 'button' || type === 'submit' || type === 'reset';
  }
  return false;
}

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const trigger = target.closest('[data-undoable-trigger]');
  if (!trigger) return;

  const host = trigger.closest('[data-undoable]');
  if (!host) {
    console.warn(
      'undoable: [data-undoable-trigger] has no [data-undoable] ancestor. Ignoring.',
      trigger,
    );
    return;
  }

  if (!isNativeButton(trigger) && !warned.has(trigger)) {
    warned.add(trigger);
    console.warn(
      'undoable: [data-undoable-trigger] is not a <button>, so keyboard activation ' +
        'will not work. The runtime does not synthesize key handling — use a <button>.',
      trigger,
    );
  }

  const name = host.getAttribute('data-undoable');
  if (!name) return;

  // Raw string, never parsed or coerced. Structured arguments go through
  // runAction() instead — adding JSON parsing here is config creep.
  const arg = host.hasAttribute('data-undoable-arg')
    ? host.getAttribute('data-undoable-arg')
    : undefined;

  const label =
    host.getAttribute('data-undoable-label')?.trim() || accessibleName(trigger) || name;

  runAction(name, arg, { trigger, host, label });
}

function onPageHide(): void {
  flushPending(true);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushPending(true);
}

/**
 * Delegated from `document`, so dynamically inserted markup works with no
 * registration step. Native buttons already emit `click` for Enter and
 * Space, so one listener covers pointer and keyboard both.
 */
export function bind(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;

  document.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
  }
}

/** Test seam. Not part of the public API. */
export function unbind(): void {
  if (!bound) return;
  bound = false;
  document.removeEventListener('click', onClick);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide);
  }
}
