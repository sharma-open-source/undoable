import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configure, defineAction, runAction } from '../src/index.js';
import { capture, frames, setup, teardown } from './helpers.js';

const region = () => document.querySelector<HTMLElement>('[data-undoable-live-region]');

describe('announcement', () => {
  beforeEach(() => {
    setup();
    configure({ window: 100 });
    defineAction('archive', { apply: () => () => {}, commit: () => Promise.resolve() });
  });
  afterEach(teardown);

  // Row 13
  it('announces two identical consecutive messages', async () => {
    const trigger = markupTrigger('Item archived');

    trigger.click();
    await frames(1);
    expect(region()!.textContent).toBe('Item archived');

    trigger.click();

    // Cleared synchronously — this is what guarantees the second identical
    // message is re-announced rather than ignored as an unchanged node.
    expect(region()!.textContent).toBe('');

    await frames(1);
    expect(region()!.textContent).toBe('Item archived');
  });

  it('reuses exactly one region', async () => {
    runAction('archive', 'x');
    await frames(1);
    runAction('archive', 'y');
    await frames(1);

    expect(document.querySelectorAll('[data-undoable-live-region]')).toHaveLength(1);
  });

  it('announces the outcome, not just the attempt', async () => {
    const cap = capture();
    const trigger = markupTrigger('Item archived');

    trigger.click();
    await frames(1);
    expect(region()!.textContent).toBe('Item archived');

    cap.last('pending')!.detail.undo();
    await frames(1);
    expect(region()!.textContent).toBe('Item archived — undone');
    cap.stop();
  });

  it('says the change was rolled back when a commit fails', async () => {
    defineAction('boom', {
      apply: () => () => {},
      commit: () => Promise.reject(new Error('no')),
    });
    runAction('boom', 'x');
    await frames(10);

    expect(region()!.textContent).toBe('boom — could not be saved, change undone');
  });

  it('tells the user to refresh on desync', async () => {
    defineAction('boom', {
      apply: () => () => {},
      commit: (arg: string) => (arg === '1' ? Promise.reject(new Error('no')) : Promise.resolve()),
    });
    runAction('boom', '1');
    runAction('boom', '2');
    await frames(10);

    expect(region()!.textContent).toBe(
      'boom — could not be saved, refresh to see the current state',
    );
  });

  it('is polite for pending and reverted, assertive for failure', async () => {
    const cap = capture();
    runAction('archive', 'x');
    expect(region()!.getAttribute('aria-live')).toBe('polite');

    cap.last('pending')!.detail.undo();
    expect(region()!.getAttribute('aria-live')).toBe('polite');

    defineAction('boom', {
      apply: () => () => {},
      commit: () => Promise.reject(new Error('no')),
    });
    runAction('boom', 'x');
    await frames(10);

    expect(region()!.getAttribute('aria-live')).toBe('assertive');
    cap.stop();
  });

  it('is visually hidden but present in the accessibility tree', async () => {
    runAction('archive', 'x');
    await frames(1);

    const el = region()!;
    expect(el.getAttribute('aria-hidden')).toBeNull();
    expect(el.style.position).toBe('absolute');
    expect(el.style.width).toBe('1px');
  });

  it('falls back from label to accessible name to action name', async () => {
    document.body.innerHTML = `
      <div data-undoable="archive" data-undoable-arg="1" data-undoable-label="Explicit label">
        <button data-undoable-trigger>Accessible name</button>
      </div>
      <div data-undoable="archive" data-undoable-arg="2">
        <button data-undoable-trigger>Accessible name</button>
      </div>
      <div data-undoable="archive" data-undoable-arg="3">
        <button data-undoable-trigger aria-label=""></button>
      </div>`;

    const triggers = document.querySelectorAll<HTMLButtonElement>('[data-undoable-trigger]');

    triggers[0]!.click();
    await frames(1);
    expect(region()!.textContent).toBe('Explicit label');

    triggers[1]!.click();
    await frames(1);
    expect(region()!.textContent).toBe('Accessible name');

    triggers[2]!.click();
    await frames(1);
    expect(region()!.textContent).toBe('archive');
  });
});

/** Label resolution lives in the binding layer, so this goes through markup. */
function markupTrigger(label: string): HTMLButtonElement {
  const host = document.createElement('div');
  host.setAttribute('data-undoable', 'archive');
  host.setAttribute('data-undoable-arg', 'x');
  host.setAttribute('data-undoable-label', label);
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-undoable-trigger', '');
  host.append(button);
  document.body.append(host);
  return button;
}
