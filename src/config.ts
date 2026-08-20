const DEFAULT_WINDOW = 5000;

const state = { window: DEFAULT_WINDOW };

/**
 * The complete set of configurable options. Kept at one deliberately — see
 * spec §12. Growth here is the failure mode this project exists to avoid.
 */
const ALLOWED = ['window'];

export function configure(opts: { window?: number }): void {
  if (opts === null || typeof opts !== 'object') {
    throw new TypeError('undoable: configure() expects an options object.');
  }

  for (const key of Reflect.ownKeys(opts)) {
    if (typeof key !== 'string' || !ALLOWED.includes(key)) {
      throw new Error(
        `undoable: configure() received unknown option ${String(key)}. ` +
          `Allowed options: ${ALLOWED.join(', ')}.`,
      );
    }
  }

  if (opts.window !== undefined) {
    if (typeof opts.window !== 'number' || !Number.isFinite(opts.window) || opts.window < 0) {
      throw new TypeError('undoable: configure({ window }) expects a non-negative finite number.');
    }
    state.window = opts.window;
  }
}

export function getWindow(): number {
  return state.window;
}

/** Test seam. Not part of the public API. */
export function resetConfig(): void {
  state.window = DEFAULT_WINDOW;
}
