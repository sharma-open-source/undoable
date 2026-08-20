/**
 * Instrumentation (spec §11).
 *
 * Exposed as a pull-based snapshot rather than a `configure({ onMetric })`
 * sink, because `configure` must keep exactly one option. Four of the six
 * metrics are derivable from the public events; `time_to_apply` and
 * `focus_loss` are not, which is the whole reason this module exists.
 */

const TIMING_CAP = 1000;

export const counters = {
  /** Actions whose `apply` was invoked, successful or not. */
  total: 0,
  committed: 0,
  reverted: 0,
  failed: 0,
  desync: 0,
  /** Commits initiated from pagehide/visibilitychange rather than the timer. */
  orphanedCommits: 0,
  /** Post-restoration frames where focus was still body/detached. */
  focusLoss: 0,
};

let applyTimings: number[] = [];

export function recordApply(ms: number): void {
  applyTimings.push(ms);
  if (applyTimings.length > TIMING_CAP) applyTimings = applyTimings.slice(-TIMING_CAP);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export type Metrics = {
  total: number;
  committed: number;
  reverted: number;
  failed: number;
  desync: number;
  orphanedCommits: number;
  focusLoss: number;
  desyncRate: number;
  undoRate: number;
  commitFailureRate: number;
  timeToApply: { count: number; p50: number; p99: number; max: number };
};

export function getMetrics(): Metrics {
  const sorted = [...applyTimings].sort((a, b) => a - b);
  return {
    ...counters,
    desyncRate: ratio(counters.desync, counters.total),
    undoRate: ratio(counters.reverted, counters.total),
    commitFailureRate: ratio(counters.failed + counters.desync, counters.total),
    timeToApply: {
      count: sorted.length,
      p50: percentile(sorted, 50),
      p99: percentile(sorted, 99),
      max: sorted.length ? (sorted[sorted.length - 1] ?? 0) : 0,
    },
  };
}

/** Test seam. Not part of the public API. */
export function resetMetrics(): void {
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) {
    counters[key] = 0;
  }
  applyTimings = [];
}
