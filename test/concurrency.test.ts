import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, runAction } from '../src/index.js';
import { capture, frames, setup, teardown } from './helpers.js';

describe('concurrency and revert validity', () => {
  beforeEach(() => {
    setup();
    configure({ window: 100 });
  });
  afterEach(teardown);

  // Row 5
  it('flushes the first action to committing before the second applies', async () => {
    const log: string[] = [];
    defineAction('a', {
      apply: (arg: string) => {
        log.push(`apply:${arg}`);
        return () => log.push(`revert:${arg}`);
      },
      commit: (arg: string) => {
        log.push(`commit:${arg}`);
        return Promise.resolve();
      },
    });

    runAction('a', '1');
    runAction('a', '2');

    expect(log).toEqual(['apply:1', 'commit:1', 'apply:2']);

    await frames(10);
    expect(log).toEqual(['apply:1', 'commit:1', 'apply:2', 'commit:2']);
  });

  // Row 6
  it('emits desync and does not call a stale Revert', async () => {
    const cap = capture();
    const revertFirst = vi.fn();
    const revertSecond = vi.fn();
    const error = new Error('server said no');

    defineAction('a', {
      apply: (arg: string) => (arg === '1' ? revertFirst : revertSecond),
      commit: (arg: string) => (arg === '1' ? Promise.reject(error) : Promise.resolve()),
    });

    runAction('a', '1');
    runAction('a', '2'); // flushes '1' — its Revert is now stale

    await frames(10);

    expect(cap.of('desync')).toHaveLength(1);
    expect(cap.last('desync')!.detail).toMatchObject({ name: 'a', arg: '1', error });
    expect(revertFirst).not.toHaveBeenCalled();
    expect(cap.of('failed')).toHaveLength(0);
    cap.stop();
  });

  // Row 7
  it('produces N commits in trigger order with never more than one pending', async () => {
    const cap = capture();
    const commits: string[] = [];

    defineAction('a', {
      apply: () => () => {},
      commit: (arg: string) => {
        commits.push(arg);
        // Inverted latency: a queue-free implementation must still preserve
        // invocation order, and a serialising one would be caught here.
        return new Promise<void>((resolve) => setTimeout(resolve, 50 - Number(arg) * 8));
      },
    });

    for (let i = 0; i < 5; i += 1) runAction('a', String(i));

    // Four are already committing; only the last is still undoable. Calling
    // every undo() must therefore produce exactly one revert.
    const undos = cap.of('pending').map((e) => e.detail.undo);
    expect(undos).toHaveLength(5);
    undos.forEach((undo) => undo());
    expect(cap.of('reverted')).toHaveLength(1);
    expect(cap.last('reverted')!.detail.arg).toBe('4');

    await frames(10);

    expect(commits).toEqual(['0', '1', '2', '3']);
    cap.stop();
  });

  it('re-validates an earlier Revert when the newer action is undone', async () => {
    const cap = capture();
    const revertFirst = vi.fn();
    const error = new Error('server said no');

    defineAction('a', {
      apply: (arg: string) => (arg === '1' ? revertFirst : () => {}),
      commit: (arg: string) => (arg === '1' ? Promise.reject(error) : Promise.resolve()),
    });

    runAction('a', '1');
    runAction('a', '2'); // flushes '1'
    cap.last('pending')!.detail.undo(); // '2' reverted — state is back to "after 1"

    await frames(10);

    // '1' is recoverable again, so this is a plain failure, not a desync.
    expect(cap.of('desync')).toHaveLength(0);
    expect(cap.of('failed')).toHaveLength(1);
    expect(cap.last('failed')!.detail).toMatchObject({ arg: '1', reverted: true });
    expect(revertFirst).toHaveBeenCalledOnce();
    cap.stop();
  });

  it('still desyncs when the newer action was not undone', async () => {
    const cap = capture();
    const revertFirst = vi.fn();

    defineAction('a', {
      apply: (arg: string) => (arg === '1' ? revertFirst : () => {}),
      commit: (arg: string) =>
        arg === '1' ? Promise.reject(new Error('no')) : Promise.resolve(),
    });

    runAction('a', '1');
    runAction('a', '2');
    await frames(10);

    expect(cap.of('desync')).toHaveLength(1);
    expect(revertFirst).not.toHaveBeenCalled();
    cap.stop();
  });

  it('keeps commit order when the window expires naturally', async () => {
    const commits: string[] = [];
    defineAction('a', {
      apply: () => () => {},
      commit: (arg: string) => {
        commits.push(arg);
        return Promise.resolve();
      },
    });

    for (let i = 0; i < 5; i += 1) runAction('a', String(i));
    await frames(10);

    expect(commits).toEqual(['0', '1', '2', '3', '4']);
  });
});
