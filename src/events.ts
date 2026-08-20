export function emit(type: string, detail: unknown): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent(`undoable:${type}`, { bubbles: true, detail }),
  );
}
