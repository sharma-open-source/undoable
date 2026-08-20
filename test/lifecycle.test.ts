import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, runAction } from '../src/index.js';
import { capture, frames, setup, teardown } from './helpers.js';

describe('lifecycle', () => {
  beforeEach(() => {
    setup();
    configure({ window: 100 });
  });
  afterEach(teardown);

  // Row 1
  it('commits after the window and never calls Revert', async () => {
    const cap = capture();
    const revert = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => revert, commit });

    runAction('a', 'x');
    expect(commit).not.toHaveBeenCalled();

    await frames(10);

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('x');
    expect(revert).not.toHaveBeenCalled();
    expect(cap.of('committed')).toHaveLength(1);
    expect(cap.last('committed')!.detail).toMatchObject({ name: 'a', arg: 'x' });
    cap.stop();
  });

  // Row 2
  it('undo before expiry reverts and never commits', async () => {
    const cap = capture();
    const revert = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => revert, commit });

    runAction('a', 'x');
    cap.last('pending')!.detail.undo();

    expect(revert).toHaveBeenCalledOnce();
    expect(cap.of('reverted')).toHaveLength(1);

    await frames(10);

    expect(commit).not.toHaveBeenCalled();
    expect(cap.of('committed')).toHaveLength(0);
    cap.stop();
  });

  // Row 3
  it('undo is idempotent', async () => {
    const cap = capture();
    const revert = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', { apply: () => revert, commit });

    runAction('a', 'x');
    const { undo } = cap.last('pending')!.detail;

    expect(() => {
      undo();
      undo();
      undo();
    }).not.toThrow();

    expect(revert).toHaveBeenCalledOnce();
    expect(cap.of('reverted')).toHaveLength(1);

    await frames(10);
    expect(commit).not.toHaveBeenCalled();
    cap.stop();
  });

  // Row 4
  it('reverts when commit rejects and the Revert is still valid', async () => {
    const cap = capture();
    const revert = vi.fn();
    const error = new Error('nope');
    defineAction('a', { apply: () => revert, commit: () => Promise.reject(error) });

    runAction('a', 'x');
    await frames(10);

    expect(revert).toHaveBeenCalledOnce();
    expect(cap.of('failed')).toHaveLength(1);
    expect(cap.last('failed')!.detail).toMatchObject({ name: 'a', arg: 'x', error, reverted: true });
    expect(cap.of('desync')).toHaveLength(0);
    cap.stop();
  });

  // Row 9
  it('rethrows when apply throws, without entering pending', async () => {
    const cap = capture();
    const error = new Error('apply exploded');
    const commit = vi.fn().mockResolvedValue(undefined);
    defineAction('a', {
      apply: () => {
        throw error;
      },
      commit,
    });

    expect(() => runAction('a', 'x')).toThrow(error);

    expect(cap.of('pending')).toHaveLength(0);
    expect(cap.of('failed')).toHaveLength(1);
    expect(cap.last('failed')!.detail).toMatchObject({ reverted: false, error });

    await frames(10);
    expect(commit).not.toHaveBeenCalled();
    cap.stop();
  });
});
