import { bind } from './binding.js';
import { flushPending as flushInternal, runAction as runInternal, type RunOptions } from './runtime.js';

export { configure } from './config.js';
export { defineAction } from './registry.js';
export { getMetrics, type Metrics } from './metrics.js';
export type {
  ActionDef,
  Revert,
  PendingDetail,
  CommittedDetail,
  RevertedDetail,
  FailedDetail,
  DesyncDetail,
} from './types.js';

export function runAction<A>(name: string, arg: A, opts?: { trigger?: Element }): void {
  runInternal(name, arg, opts as RunOptions | undefined);
}

/**
 * Synchronously begins the pending action's commit, if any.
 *
 * SPA route changes are invisible to the runtime. Call this from your
 * router's navigation hook — it is the one integration obligation on the
 * host application.
 */
export function flushPending(): void {
  flushInternal(false);
}

// Binding is a load-time side effect so that a plain <script> tag is a
// complete integration: no init call, no registration for dynamic markup.
bind();
