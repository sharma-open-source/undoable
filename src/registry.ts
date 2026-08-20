import type { ActionDef } from './types.js';

const actions = new Map<string, ActionDef<never>>();

/**
 * The only keys an action may declare. `defineAction` throws on anything
 * else — this is the mechanism that prevents config growth (spec §2). It is
 * not a warning, and must not be softened into one.
 */
const ALLOWED_KEYS = ['apply', 'commit'];

export function defineAction<A>(name: string, def: ActionDef<A>): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('undoable: defineAction() requires a non-empty action name.');
  }
  if (def === null || typeof def !== 'object') {
    throw new TypeError(`undoable: defineAction("${name}") requires a definition object.`);
  }

  for (const key of Reflect.ownKeys(def)) {
    if (typeof key !== 'string' || !ALLOWED_KEYS.includes(key)) {
      throw new Error(
        `undoable: defineAction("${name}") received unknown key ${String(key)}. ` +
          `ActionDef accepts exactly: ${ALLOWED_KEYS.join(', ')}. ` +
          `If you need behaviour this does not cover, listen for an undoable:* ` +
          `event or define a second action.`,
      );
    }
  }

  if (typeof def.apply !== 'function') {
    throw new TypeError(`undoable: defineAction("${name}") requires apply to be a function.`);
  }
  if (typeof def.commit !== 'function') {
    throw new TypeError(`undoable: defineAction("${name}") requires commit to be a function.`);
  }

  actions.set(name, { apply: def.apply, commit: def.commit } as ActionDef<never>);
}

export function getAction(name: string): ActionDef<never> {
  const def = actions.get(name);
  if (!def) {
    throw new Error(`undoable: no action registered under the name "${name}".`);
  }
  return def;
}

export function hasAction(name: string): boolean {
  return actions.has(name);
}

/** Test seam. Not part of the public API. */
export function resetRegistry(): void {
  actions.clear();
}
