import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, runAction } from '../src/index.js';
import { capture, setup, teardown } from './helpers.js';

describe('the seam', () => {
  beforeEach(setup);
  afterEach(teardown);

  // Row 14
  it('throws on an unknown ActionDef key', () => {
    expect(() =>
      defineAction('a', {
        apply: () => () => {},
        commit: () => Promise.resolve(),
        // The whole point of the constraint: this must be a hard failure,
        // never a warning.
        window: 3000,
      } as never),
    ).toThrow(/unknown key/i);
  });

  it('names the offending key and the allowed set', () => {
    expect(() =>
      defineAction('a', {
        apply: () => () => {},
        commit: () => Promise.resolve(),
        onUndo: () => {},
      } as never),
    ).toThrow(/onUndo/);
  });

  it('accepts exactly apply and commit', () => {
    expect(() =>
      defineAction('a', { apply: () => () => {}, commit: () => Promise.resolve() }),
    ).not.toThrow();
  });

  it('throws when apply or commit is missing', () => {
    expect(() => defineAction('a', { commit: () => Promise.resolve() } as never)).toThrow(/apply/);
    expect(() => defineAction('a', { apply: () => () => {} } as never)).toThrow(/commit/);
  });

  it('throws on a symbol key', () => {
    const def = { apply: () => () => {}, commit: () => Promise.resolve() };
    Object.defineProperty(def, Symbol('sneaky'), { value: 1, enumerable: true });
    expect(() => defineAction('a', def as never)).toThrow(/unknown key/i);
  });

  // Row 15
  it('throws when apply returns a Promise', () => {
    defineAction('async', {
      apply: (() => Promise.resolve(() => {})) as never,
      commit: () => Promise.resolve(),
    });

    const cap = capture();
    expect(() => runAction('async', 'x')).toThrow(/synchronous/i);
    expect(cap.of('pending')).toHaveLength(0);
    cap.stop();
  });

  it('throws when apply returns something that is not a function', () => {
    defineAction('bad', {
      apply: (() => undefined) as never,
      commit: () => Promise.resolve(),
    });

    expect(() => runAction('bad', 'x')).toThrow(/Revert function/i);
  });

  it('throws for an unregistered action', () => {
    expect(() => runAction('nope', 'x')).toThrow(/no action registered/i);
  });

  it('keeps configure to exactly one option', () => {
    expect(() => configure({ window: 1000 })).not.toThrow();
    expect(() => configure({ placement: 'top' } as never)).toThrow(/unknown option/i);
    expect(() => configure({ window: -1 })).toThrow(/non-negative/i);
    expect(() => configure({ window: 'soon' } as never)).toThrow(/number/i);
  });

  it('has no per-action window override', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    configure({ window: 50 });
    defineAction('a', { apply: () => () => {}, commit });

    runAction('a', 'x');
    await vi.advanceTimersByTimeAsync(40);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(commit).toHaveBeenCalledOnce();
  });
});
