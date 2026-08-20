/** The inverse of an `apply`. Synchronous, called at most once by the runtime. */
export type Revert = () => void;

/**
 * The entire configuration surface of an action. Exactly two keys — this is
 * load-bearing. `defineAction` throws on anything else.
 */
export type ActionDef<A> = {
  /** Synchronous. Mutates local state. Returns the inverse. */
  apply: (arg: A) => Revert;
  /** Persists the change. Resolves on success, rejects on failure. */
  commit: (arg: A) => Promise<void>;
};

export type PendingDetail<A = unknown> = {
  name: string;
  arg: A;
  label: string;
  /** Reverts the action and cancels its commit. Idempotent. */
  undo: () => void;
  /** Epoch milliseconds at which the window closes. */
  expiresAt: number;
};

export type CommittedDetail<A = unknown> = { name: string; arg: A };
export type RevertedDetail<A = unknown> = { name: string; arg: A };

export type FailedDetail<A = unknown> = {
  name: string;
  arg: A;
  error: unknown;
  reverted: boolean;
};

export type DesyncDetail<A = unknown> = {
  name: string;
  arg: A;
  error: unknown;
};

export type UndoableEventMap = {
  'undoable:pending': CustomEvent<PendingDetail>;
  'undoable:committed': CustomEvent<CommittedDetail>;
  'undoable:reverted': CustomEvent<RevertedDetail>;
  'undoable:failed': CustomEvent<FailedDetail>;
  'undoable:desync': CustomEvent<DesyncDetail>;
};

declare global {
  interface DocumentEventMap extends UndoableEventMap {}
}
