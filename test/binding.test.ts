import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, runAction } from '../src/index.js';
import { capture, frames, setup, teardown } from './helpers.js';

describe('markup binding', () => {
  beforeEach(() => {
    setup();
    configure({ window: 100 });
  });
  afterEach(teardown);

  // Row 16
  it('works for markup inserted after load, with no registration step', async () => {
    const apply = vi.fn(() => () => {});
    defineAction('archive', { apply, commit: () => Promise.resolve() });

    const cap = capture();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive" data-undoable-arg="42">
         <button data-undoable-trigger>Archive</button>
       </li>`,
    );

    document.querySelector<HTMLButtonElement>('[data-undoable-trigger]')!.click();

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith('42');
    expect(cap.of('pending')).toHaveLength(1);
    cap.stop();
  });

  it('passes data-undoable-arg through as a raw, uncoerced string', () => {
    const apply = vi.fn(() => () => {});
    defineAction('archive', { apply, commit: () => Promise.resolve() });

    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive" data-undoable-arg='{"id":7}'>
         <button data-undoable-trigger>Archive</button>
       </li>`,
    );
    document.querySelector<HTMLButtonElement>('[data-undoable-trigger]')!.click();

    expect(apply).toHaveBeenCalledWith('{"id":7}');
  });

  it('passes undefined when the arg attribute is absent', () => {
    const apply = vi.fn(() => () => {});
    defineAction('archive', { apply, commit: () => Promise.resolve() });

    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive"><button data-undoable-trigger>Go</button></li>`,
    );
    document.querySelector<HTMLButtonElement>('[data-undoable-trigger]')!.click();

    expect(apply).toHaveBeenCalledWith(undefined);
  });

  it('fires when a descendant of the trigger is clicked', () => {
    const apply = vi.fn(() => () => {});
    defineAction('archive', { apply, commit: () => Promise.resolve() });

    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive" data-undoable-arg="1">
         <button data-undoable-trigger><span>Archive</span></button>
       </li>`,
    );
    document.querySelector<HTMLSpanElement>('span')!.click();

    expect(apply).toHaveBeenCalledOnce();
  });

  it('warns once for a non-button trigger without synthesizing key handling', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineAction('archive', { apply: () => () => {}, commit: () => Promise.resolve() });

    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive" data-undoable-arg="1">
         <div data-undoable-trigger tabindex="0">Archive</div>
       </li>`,
    );
    const trigger = document.querySelector<HTMLElement>('[data-undoable-trigger]')!;

    trigger.click();
    trigger.click();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/not a <button>/);

    // No key handling is added: a keydown must do nothing.
    const apply = vi.fn();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(apply).not.toHaveBeenCalled();
  });

  it('warns when a trigger has no [data-undoable] ancestor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.insertAdjacentHTML('beforeend', `<button data-undoable-trigger>Go</button>`);
    document.querySelector<HTMLButtonElement>('button')!.click();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/no \[data-undoable\] ancestor/);
  });

  it('ignores clicks outside any trigger', () => {
    const apply = vi.fn(() => () => {});
    defineAction('archive', { apply, commit: () => Promise.resolve() });

    document.body.insertAdjacentHTML(
      'beforeend',
      `<li data-undoable="archive"><span>not a trigger</span></li>`,
    );
    document.querySelector<HTMLSpanElement>('span')!.click();

    expect(apply).not.toHaveBeenCalled();
  });

  it('emits pending with the documented detail shape', async () => {
    const cap = capture();
    defineAction('archive', { apply: () => () => {}, commit: () => Promise.resolve() });

    const before = Date.now();
    runAction('archive', 'x');

    const { detail } = cap.last('pending')!;
    expect(Object.keys(detail).sort()).toEqual(['arg', 'expiresAt', 'label', 'name', 'undo']);
    expect(detail.name).toBe('archive');
    expect(detail.arg).toBe('x');
    expect(typeof detail.undo).toBe('function');
    expect(detail.expiresAt).toBeGreaterThanOrEqual(before + 100);

    await frames(10);
    cap.stop();
  });

  it('bubbles events to window', async () => {
    defineAction('archive', { apply: () => () => {}, commit: () => Promise.resolve() });
    const seen = vi.fn();
    window.addEventListener('undoable:pending', seen);

    runAction('archive', 'x');

    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener('undoable:pending', seen);
    await frames(10);
  });
});
