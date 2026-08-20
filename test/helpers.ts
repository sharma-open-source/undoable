import { vi } from 'vitest';
import { resetAnnouncer } from '../src/announce.js';
import { bind, unbind } from '../src/binding.js';
import { resetConfig } from '../src/config.js';
import { resetMetrics } from '../src/metrics.js';
import { resetRegistry } from '../src/registry.js';
import { resetRuntime } from '../src/runtime.js';

export function setup(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  document.body.innerHTML = '';
  resetRuntime();
  resetRegistry();
  resetConfig();
  resetMetrics();
  resetAnnouncer();
  unbind();
  bind();
}

export function teardown(): void {
  unbind();
  vi.useRealTimers();
}

/** Advances past n animation frames, flushing promise jobs between each. */
export async function frames(n = 1): Promise<void> {
  for (let i = 0; i < n; i += 1) await vi.advanceTimersByTimeAsync(20);
}

export type Captured = { type: string; detail: any };

export function capture() {
  const events: Captured[] = [];
  const types = ['pending', 'committed', 'reverted', 'failed', 'desync'];
  const handlers: Array<[string, EventListener]> = types.map((type) => {
    const handler = ((event: CustomEvent) => {
      events.push({ type, detail: event.detail });
    }) as EventListener;
    document.addEventListener(`undoable:${type}`, handler);
    return [type, handler];
  });

  return {
    events,
    of(type: string) {
      return events.filter((e) => e.type === type);
    },
    last(type: string) {
      return events.filter((e) => e.type === type).at(-1);
    },
    types() {
      return events.map((e) => e.type);
    },
    stop() {
      handlers.forEach(([type, handler]) =>
        document.removeEventListener(`undoable:${type}`, handler),
      );
    },
  };
}

/**
 * A list of rows, each with a checkbox *before* the archive trigger. The
 * ordering matters: it is what distinguishes "first focusable in the next
 * row" from "the same control in the next row".
 */
export function buildList(count = 3): HTMLUListElement {
  const list = document.createElement('ul');
  list.id = 'list';
  for (let i = 0; i < count; i += 1) {
    const li = document.createElement('li');
    li.dataset.id = `r${i}`;
    li.setAttribute('data-undoable', 'remove');
    li.setAttribute('data-undoable-arg', `r${i}`);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `Select ${i}`);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('data-undoable-trigger', '');
    trigger.textContent = `Archive ${i}`;

    li.append(check, trigger);
    list.append(li);
  }
  document.body.append(list);
  return list;
}

export function rowCheckbox(index: number): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`[data-id="r${index}"] input`);
  if (!el) throw new Error(`no checkbox for row ${index}`);
  return el;
}

export function rowTrigger(index: number): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(
    `[data-id="r${index}"] [data-undoable-trigger]`,
  );
  if (!el) throw new Error(`no trigger for row ${index}`);
  return el;
}
