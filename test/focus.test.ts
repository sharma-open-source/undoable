import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineAction, getMetrics, runAction } from '../src/index.js';
import { buildList, frames, rowCheckbox, rowTrigger, setup, teardown } from './helpers.js';

describe('focus', () => {
  beforeEach(() => {
    setup();
    configure({ window: 5000 });
  });
  afterEach(teardown);

  function defineRemove() {
    defineAction('remove', {
      apply: (id: string) => {
        const row = document.querySelector(`[data-id="${id}"]`)!;
        const parent = row.parentElement!;
        const next = row.nextElementSibling;
        row.remove();
        return () => parent.insertBefore(row, next);
      },
      commit: () => Promise.resolve(),
    });
  }

  // Row 10
  it('moves focus to the next row after removing a middle row', async () => {
    defineRemove();
    buildList(3);

    const trigger = rowTrigger(1);
    trigger.focus();
    trigger.click();

    await frames(3);

    // The equivalent control, not the row's first focusable — which is the
    // checkbox, and would cost three Tab presses to get back from.
    expect(document.activeElement).toBe(rowTrigger(2));
    expect(document.activeElement).not.toBe(rowCheckbox(2));
    expect(getMetrics().focusLoss).toBe(0);
  });

  it('falls back to the first focusable when no equivalent control exists', async () => {
    defineRemove();
    const list = buildList(2);
    // Strip the marker from the surviving row: nothing plays the trigger's
    // role any more, so the generic rule applies.
    rowTrigger(1).removeAttribute('data-undoable-trigger');

    const trigger = rowTrigger(0);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(document.activeElement).toBe(rowCheckbox(1));
    expect(list.contains(document.activeElement)).toBe(true);
    expect(getMetrics().focusLoss).toBe(0);
  });

  it('restores focus when the action disables its own trigger', async () => {
    // "Still connected" is not "still focusable": a bulk action that empties
    // its own selection disables the toolbar button the user is standing on.
    // Under the connectedness rule this returned early, leaving focus on a
    // disabled element and never incrementing focus_loss.
    defineAction('bulk', {
      apply: () => {
        const button = document.getElementById('bulk') as HTMLButtonElement;
        button.disabled = true;
        return () => {
          button.disabled = false;
        };
      },
      commit: () => Promise.resolve(),
    });

    buildList(2);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-undoable="bulk"><button id="bulk" data-undoable-trigger>Archive selected</button></div>`,
    );

    const trigger = document.getElementById('bulk') as HTMLButtonElement;
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(trigger.disabled).toBe(true);
    expect(document.activeElement).toBe(rowTrigger(0));
    expect(getMetrics().focusLoss).toBe(0);
  });

  // Row 11
  it('moves focus to the container after removing the last row', async () => {
    defineRemove();
    const list = buildList(1);

    const trigger = rowTrigger(0);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(document.activeElement).toBe(list);
    expect(list.getAttribute('tabindex')).toBe('-1');
    expect(getMetrics().focusLoss).toBe(0);
  });

  it('falls back to the preceding row when removing the last of several', async () => {
    defineRemove();
    buildList(3);

    const trigger = rowTrigger(2);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(document.activeElement).toBe(rowTrigger(1));
    expect(getMetrics().focusLoss).toBe(0);
  });

  // Row 12
  it('leaves focus alone when the action removes nothing', async () => {
    defineAction('remove', { apply: () => () => {}, commit: () => Promise.resolve() });
    buildList(3);

    const trigger = rowTrigger(1);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(document.activeElement).toBe(trigger);
    expect(getMetrics().focusLoss).toBe(0);
  });

  // Guard beyond spec §6: the captured fallback can itself be destroyed by a
  // view layer that rebuilds nodes rather than mutating them.
  it('falls through to the container when the fallback node is rebuilt away', async () => {
    defineAction('remove', {
      apply: (id: string) => {
        const list = document.getElementById('list')!;
        const html = list.innerHTML;
        const rows = [...list.children].filter((li) => (li as HTMLElement).dataset.id !== id);
        list.innerHTML = '';
        rows.forEach((li) => list.append(li.cloneNode(true)));
        return () => {
          list.innerHTML = html;
        };
      },
      commit: () => Promise.resolve(),
    });
    const list = buildList(3);

    const trigger = rowTrigger(1);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(document.activeElement).toBe(list);
    expect(getMetrics().focusLoss).toBe(0);
  });

  it('restores focus when the view updates a frame after apply', async () => {
    defineAction('remove', {
      apply: (id: string) => {
        const row = document.querySelector(`[data-id="${id}"]`)!;
        const parent = row.parentElement!;
        const next = row.nextElementSibling;
        requestAnimationFrame(() => row.remove());
        return () => parent.insertBefore(row, next);
      },
      commit: () => Promise.resolve(),
    });
    buildList(3);

    const trigger = rowTrigger(1);
    trigger.focus();
    trigger.click();

    await frames(4);

    expect(document.activeElement).toBe(rowTrigger(2));
    expect(getMetrics().focusLoss).toBe(0);
  });

  it('counts focus_loss when nothing focusable survives', async () => {
    defineAction('wipe', {
      apply: () => {
        const list = document.getElementById('list')!;
        const html = list.outerHTML;
        list.remove();
        return () => {
          document.body.insertAdjacentHTML('beforeend', html);
        };
      },
      commit: () => Promise.resolve(),
    });

    const list = buildList(1);
    list.querySelector('[data-undoable]')!.setAttribute('data-undoable', 'wipe');

    const trigger = rowTrigger(0);
    trigger.focus();
    trigger.click();

    await frames(3);

    expect(getMetrics().focusLoss).toBe(1);
  });
});
