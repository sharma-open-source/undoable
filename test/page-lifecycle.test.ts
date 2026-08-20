import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, flushPending, getMetrics, runAction } from '../src/index.js';
import { capture, frames, setup, teardown } from './helpers.js';

describe('page lifecycle', () => {
  beforeEach(() => {
    setup();
    configure({ window: 5000 });
  });
  afterEach(teardown);

  // Row 8
  it('commits on pagehide while pending', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => () => {}, commit });

    runAction('a', 'x');
    expect(commit).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));

    // Synchronously, before the page can go away.
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('x');
    expect(getMetrics().orphanedCommits).toBe(1);

    await frames(2);
  });

  it('commits when the document becomes hidden', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => () => {}, commit });

    runAction('a', 'x');
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(commit).toHaveBeenCalledOnce();
    expect(getMetrics().orphanedCommits).toBe(1);

    spy.mockRestore();
    await frames(2);
  });

  it('does not commit when the document becomes visible', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => () => {}, commit });

    runAction('a', 'x');
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(commit).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('flushPending is the router hook and is safe to call when idle', async () => {
    const cap = capture();
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => () => {}, commit });

    expect(() => flushPending()).not.toThrow();

    runAction('a', 'x');
    flushPending();
    expect(commit).toHaveBeenCalledOnce();

    // Not counted as orphaned — an explicit route change is not an unload.
    expect(getMetrics().orphanedCommits).toBe(0);

    flushPending();
    expect(commit).toHaveBeenCalledOnce();

    await frames(2);
    expect(cap.of('committed')).toHaveLength(1);
    cap.stop();
  });
});
