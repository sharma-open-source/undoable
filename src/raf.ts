/**
 * The view layer may update the DOM asynchronously, so focus restoration and
 * announcement both wait a frame. Falls back to a macrotask where rAF is
 * unavailable (non-visual jsdom, SSR).
 */
export function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => cb());
    return;
  }
  setTimeout(cb, 0);
}
