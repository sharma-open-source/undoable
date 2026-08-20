import { announce, outcomeText } from './announce.js';
import { getWindow } from './config.js';
import { emit } from './events.js';
import { computeFallback, restoreFocus, type FocusFallback } from './focus.js';
import { counters, recordApply } from './metrics.js';
import { getAction } from './registry.js';
import type { ActionDef, Revert } from './types.js';

type Record = {
  name: string;
  arg: unknown;
  label: string;
  def: ActionDef<never>;
  revert: Revert;
  /** Value of `applyGeneration` at the moment this action's apply ran. */
  generation: number;
  state: 'pending' | 'committing' | 'settled';
  timer: ReturnType<typeof setTimeout> | null;
  expiresAt: number;
};

/** At most one action is pending at any instant (spec §5). */
let pending: Record | null = null;

/**
 * Incremented immediately before every `apply`, including ones that throw —
 * a partially applied mutation invalidates its predecessors exactly as much
 * as a successful one does.
 *
 * A Revert is valid iff its record's generation still equals this. That is a
 * literal encoding of "a Revert becomes stale the moment any later action's
 * apply runs", and it is the whole of the concurrency model.
 */
let applyGeneration = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function settleFailure(rec: Record, error: unknown): void {
  if (rec.generation === applyGeneration) {
    // No later apply has run. The revert still describes a real inverse.
    try {
      rec.revert();
    } catch (revertError) {
      console.error(`undoable: revert for "${rec.name}" threw during failure handling.`, revertError);
    }
    counters.failed += 1;
    emit('failed', { name: rec.name, arg: rec.arg, error, reverted: true });
    announce(outcomeText('failed', rec.label), 'assertive');
    return;
  }

  // Stale. Calling the revert here would discard a newer action's change.
  counters.desync += 1;
  emit('desync', { name: rec.name, arg: rec.arg, error });
  announce(outcomeText('desync', rec.label), 'assertive');
}

function startCommit(rec: Record): void {
  let result: Promise<void>;
  try {
    result = (rec.def as ActionDef<unknown>).commit(rec.arg);
  } catch (error) {
    settleFailure(rec, error);
    return;
  }

  Promise.resolve(result).then(
    () => {
      counters.committed += 1;
      emit('committed', { name: rec.name, arg: rec.arg });
    },
    (error: unknown) => settleFailure(rec, error),
  );
}

/**
 * Synchronously begins the pending action's commit. Public, and also called
 * on every new trigger and by the page lifecycle listeners.
 *
 * `commit` is intentionally not awaited before the next one starts —
 * awaiting would serialise network calls. Invocation order matches trigger
 * order because this runs synchronously as step 1 of every activation.
 */
export function flushPending(fromLifecycle = false): void {
  const rec = pending;
  if (!rec) return;

  pending = null;
  if (rec.timer !== null) clearTimeout(rec.timer);
  rec.timer = null;
  rec.state = 'committing';

  if (fromLifecycle) counters.orphanedCommits += 1;

  startCommit(rec);
}

function undo(rec: Record): void {
  // Idempotent, and inert once the action has left `pending` — by then the
  // commit is already in flight and the revert is stale.
  if (rec.state !== 'pending' || pending !== rec) return;

  if (rec.timer !== null) clearTimeout(rec.timer);
  rec.timer = null;
  rec.state = 'settled';
  pending = null;

  rec.revert();

  // The revert returned local state to exactly the point before this
  // action's apply. Any earlier action still in flight therefore has a valid
  // Revert again, so give back the generation this action consumed — the
  // pending record always carries the current generation, so this can only
  // ever undo its own increment.
  if (rec.generation === applyGeneration) applyGeneration -= 1;

  counters.reverted += 1;
  emit('reverted', { name: rec.name, arg: rec.arg });
  announce(outcomeText('reverted', rec.label), 'polite');
}

export type RunOptions = {
  trigger?: Element;
  /** Internal: label already resolved from markup by the binding layer. */
  label?: string;
  /** Internal: the `[data-undoable]` element, for focus fallback. */
  host?: Element;
};

export function runAction<A>(name: string, arg: A, opts?: RunOptions): void {
  const t0 = now();
  const def = getAction(name);

  // 1. Flush any in-flight action before touching the DOM.
  flushPending();

  const trigger = opts?.trigger ?? null;
  const host = opts?.host ?? trigger?.closest('[data-undoable]') ?? trigger ?? null;
  const label = opts?.label ?? name;

  // 2. Focus fallback, computed while the DOM is intact.
  const fallback: FocusFallback = computeFallback(host, trigger);

  // 3. Apply.
  applyGeneration += 1;
  counters.total += 1;

  let revert: Revert;
  try {
    revert = (def as ActionDef<A>).apply(arg);
  } catch (error) {
    counters.failed += 1;
    emit('failed', { name, arg, error, reverted: false });
    announce(outcomeText('failed', label), 'assertive');
    throw error;
  }

  if (isThenable(revert)) {
    throw new TypeError(
      `undoable: apply for "${name}" returned a Promise. apply must be synchronous — ` +
        `it mutates local state and returns the inverse. Put the async work in commit.`,
    );
  }
  if (typeof revert !== 'function') {
    throw new TypeError(
      `undoable: apply for "${name}" must return a Revert function, got ${typeof revert}.`,
    );
  }

  // 4. Enter pending, start the window.
  const windowMs = getWindow();
  const rec: Record = {
    name,
    arg,
    label,
    def,
    revert,
    generation: applyGeneration,
    state: 'pending',
    timer: null,
    expiresAt: Date.now() + windowMs,
  };
  rec.timer = setTimeout(() => {
    if (pending === rec) flushPending();
  }, windowMs);
  pending = rec;

  // 5. Announce the window to whoever is listening. No default UI ships.
  emit('pending', {
    name,
    arg,
    label,
    undo: () => undo(rec),
    expiresAt: rec.expiresAt,
  });
  recordApply(now() - t0);

  announce(outcomeText('pending', label), 'polite');
  restoreFocus(fallback);
}

/** Test seam. Not part of the public API. */
export function resetRuntime(): void {
  if (pending?.timer != null) clearTimeout(pending.timer);
  pending = null;
  applyGeneration = 0;
}

/** Test seam. Not part of the public API. */
export function inspect(): { pending: string | null; generation: number } {
  return { pending: pending ? pending.name : null, generation: applyGeneration };
}
