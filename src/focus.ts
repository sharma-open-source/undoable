import { counters } from './metrics.js';
import { nextFrame } from './raf.js';

/**
 * Deliberately no visibility filtering. Spec §1 rules out layout
 * measurement, and every reliable visibility test (`offsetParent`,
 * `getClientRects`) forces layout.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type FocusFallback = {
  element: HTMLElement | null;
  container: HTMLElement | null;
};

/**
 * "Still there" is not the same as "still focusable". An element that has
 * been disabled, made inert, or hidden is gone as far as the user is
 * concerned — browsers blur it — so it must not satisfy any of the checks
 * below.
 */
export function isUsable(el: Element | null): el is HTMLElement {
  if (!el || !document.contains(el)) return false;
  if ((el as HTMLElement & { disabled?: boolean }).disabled) return false;
  if (el.hasAttribute('disabled')) return false;
  if ((el as HTMLElement).hidden) return false;
  if (el.closest('[inert]')) return false;
  return true;
}

function focusableIn(el: Element): HTMLElement | null {
  if (el.matches(FOCUSABLE) && isUsable(el)) return el as HTMLElement;
  for (const candidate of el.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (isUsable(candidate)) return candidate;
  }
  return null;
}

/**
 * Prefer the control that plays the same role as the one the user just
 * activated. Taking the first focusable descendant instead lands the user on
 * whatever happens to come first in the row — typically a checkbox — and
 * makes repeated actions cost several Tab presses each.
 *
 * The match is on `data-undoable-trigger`, which the application has already
 * declared. No heuristics, and nothing to configure.
 */
function matchingTriggerIn(el: Element, trigger: Element | null): HTMLElement | null {
  if (!trigger?.hasAttribute('data-undoable-trigger')) return null;
  const candidate = el.matches('[data-undoable-trigger]')
    ? (el as HTMLElement)
    : el.querySelector<HTMLElement>('[data-undoable-trigger]');
  return candidate && isUsable(candidate) ? candidate : null;
}

function pick(el: Element, trigger: Element | null): HTMLElement | null {
  return matchingTriggerIn(el, trigger) ?? focusableIn(el);
}

/**
 * Computed *before* apply, while the DOM is still intact (spec §6).
 * Following sibling, then preceding sibling, then the parent container.
 */
export function computeFallback(
  host: Element | null,
  trigger: Element | null = null,
): FocusFallback {
  if (!host) return { element: null, container: null };

  for (let el = host.nextElementSibling; el; el = el.nextElementSibling) {
    const found = pick(el, trigger);
    if (found) return { element: found, container: host.parentElement };
  }

  for (let el = host.previousElementSibling; el; el = el.previousElementSibling) {
    const found = pick(el, trigger);
    if (found) return { element: found, container: host.parentElement };
  }

  return { element: null, container: host.parentElement };
}

function isLost(active: Element | null): boolean {
  return !isUsable(active) || active === document.body;
}

/**
 * Runs a frame after apply, because the view layer may not have updated the
 * DOM yet.
 *
 * The condition is entirely "did focus survive", not "did the trigger
 * survive". A non-removing action leaves the user focused on a usable
 * trigger and nothing happens; an action that disables its own trigger looks
 * identical to one that removes it, which is the point.
 */
export function restoreFocus(fallback: FocusFallback): void {
  nextFrame(() => {
    if (typeof document === 'undefined') return;
    if (!isLost(document.activeElement)) return;

    let target: HTMLElement | null = null;

    // The captured element can itself be destroyed by a view layer that
    // rebuilds nodes rather than mutating them, so the container is a
    // fallback for the fallback.
    if (isUsable(fallback.element)) {
      target = fallback.element;
    } else if (isUsable(fallback.container)) {
      target = fallback.container;
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
      }
    }

    target?.focus();

    if (isLost(document.activeElement)) {
      counters.focusLoss += 1;
    }
  });
}
