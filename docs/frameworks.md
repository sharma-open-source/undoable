# Framework integration

The runtime knows nothing about your framework. It owns one thing: the window
between "the user acted" and "the server agreed", and the focus and
announcement behaviour around it.

Everything framework-specific reduces to one question:

> **How do I mutate my state, and how do I express the inverse?**

`apply` does the first and returns the second. That is the whole seam.

| | mutate | inverse |
|---|---|---|
| Vue, Svelte 5 | mutate the reactive value in place | mutate it back |
| React, Angular signals | set the next value | set the captured previous value |

The immutable frameworks are actually the easier case: the inverse is just
"set it back to the object I already had".

`apply` must be **synchronous**, but it does not have to be *rendered*
synchronously. React batching, Vue's microtask flush and Angular's change
detection all update the DOM later — which is exactly why focus restoration
waits a frame (spec §6).

---

## React

Verified end to end: markup binding, optimistic removal, focus after
re-render, undo, rollback on failure, and flush on unmount. See
"Verification" at the end.

```jsx
import { useState, useRef, useEffect } from 'react';
import { defineAction } from '@sharma/undoable';

function ItemList({ initial }) {
  const [items, setItems] = useState(initial);

  // apply must read the CURRENT state. A closure built once captures the
  // first render's value, so keep a ref alongside.
  const ref = useRef(items);
  ref.current = items;

  useEffect(() => {
    defineAction('archiveItem', {
      apply: (id) => {
        const prev = ref.current;
        setItems(prev.filter((i) => i.id !== id));
        return () => setItems(prev);      // the inverse is one setState
      },
      commit: (id) => fetch(`/items/${id}/archive`, { method: 'POST' }).then(assertOk),
    });
  }, []);

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}
            data-undoable="archiveItem"
            data-undoable-arg={item.id}
            data-undoable-label={`${item.title} archived`}>
          <span>{item.title}</span>
          <button data-undoable-trigger>Archive</button>
        </li>
      ))}
    </ul>
  );
}
```

Notes specific to React:

- **StrictMode double-invokes effects.** `defineAction` overwrites an existing
  registration rather than throwing, deliberately, so this is harmless. The
  same property makes hot reload work.
- **No synthetic-event conflict.** The runtime listens on `document`; React 17+
  attaches its own listeners to the root container. Native clicks bubble past
  React to the runtime, and `setState` from a native listener is batched
  normally in React 18.
- **`useSyncExternalStore` is not needed.** Nothing here is external state —
  your component still owns the data.

Showing the undo affordance:

```jsx
useEffect(() => {
  const onPending = (e) => showToast(e.detail.label, e.detail.undo, e.detail.expiresAt);
  document.addEventListener('undoable:pending', onPending);
  return () => document.removeEventListener('undoable:pending', onPending);
}, []);
```

## Vue

The most natural fit — reactive arrays are mutable, so `apply` and its inverse
are symmetrical.

```vue
<script setup>
import { reactive } from 'vue';
import { defineAction } from '@sharma/undoable';

const items = reactive([...]);

defineAction('archiveItem', {
  apply: (id) => {
    const index = items.findIndex((i) => i.id === id);
    const [item] = items.splice(index, 1);
    return () => items.splice(index, 0, item);   // put it back where it was
  },
  commit: (id) => api.archive(id),
});
</script>

<template>
  <ul>
    <li v-for="item in items" :key="item.id"
        data-undoable="archiveItem"
        :data-undoable-arg="item.id"
        :data-undoable-label="`${item.title} archived`">
      {{ item.title }}
      <button data-undoable-trigger>Archive</button>
    </li>
  </ul>
</template>
```

## Angular

Signals behave like React state — capture the previous value, set the next.

```ts
import { Component, signal } from '@angular/core';
import { defineAction } from '@sharma/undoable';

@Component({
  selector: 'item-list',
  template: `
    <ul>
      @for (item of items(); track item.id) {
        <li [attr.data-undoable]="'archiveItem'"
            [attr.data-undoable-arg]="item.id"
            [attr.data-undoable-label]="item.title + ' archived'">
          {{ item.title }}
          <button data-undoable-trigger>Archive</button>
        </li>
      }
    </ul>`,
})
export class ItemList {
  items = signal<Item[]>([]);

  constructor(private api: ApiService) {
    defineAction<string>('archiveItem', {
      apply: (id) => {
        const prev = this.items();
        this.items.set(prev.filter((i) => i.id !== id));
        return () => this.items.set(prev);
      },
      commit: (id) => firstValueFrom(this.api.archive(id)),
    });
  }
}
```

Change detection works in both modes. Under zone.js the runtime's `document`
listener is patched like any other, so a click triggers a cycle. Zoneless
applications are fine too, because `signal.set()` schedules the update itself.

Use `[attr.data-*]` rather than plain attributes — Angular needs the attribute
binding form for `data-` attributes carrying interpolated values.

## Svelte 5

```svelte
<script>
  import { defineAction } from '@sharma/undoable';

  let items = $state([...]);

  defineAction('archiveItem', {
    apply: (id) => {
      const index = items.findIndex((i) => i.id === id);
      const [item] = items.splice(index, 1);
      return () => items.splice(index, 0, item);
    },
    commit: (id) => api.archive(id),
  });
</script>
```

`$state` is deeply reactive and mutable, so it behaves like Vue.

---

## The parts that are the same everywhere

### 1. Router integration — the one obligation

SPA route changes are invisible to the runtime. Without this, a pending change
is silently dropped when the view unmounts.

```js
// Vue Router
router.beforeEach(() => { flushPending(); });

// Angular Router
router.events.pipe(filter((e) => e instanceof NavigationStart))
  .subscribe(() => flushPending());

// React Router — flush when the path changes
const { pathname } = useLocation();
useEffect(() => () => flushPending(), [pathname]);
```

`pagehide` and tab-hide are already handled by the runtime.

### 2. Unmounting with work pending

If a component unmounts while an action is pending, its revert closure points
at a tree that no longer exists. Flush on the way out:

```js
useEffect(() => () => flushPending(), []);
```

### 3. Server-side rendering

Safe to import from Next.js, Nuxt, SvelteKit or Angular Universal. The module
binds on import, but the binding is guarded on `typeof document` and no-ops on
the server. `defineAction` and `configure` work server-side; `runAction`
belongs in the browser.

### 4. Focus and asynchronous rendering

Because the view layer may update the DOM a frame after `apply`, focus
restoration waits for `requestAnimationFrame`. Two consequences:

- **Keyed rendering is strongly preferred.** A strategy that rebuilds nodes
  (`innerHTML =`, `replaceChildren()`) destroys the element focus was headed
  for. The runtime falls through to the container with `tabindex="-1"`, so
  focus is not lost — but the user lands somewhere blunter.
- **Avoid `replaceChildren()` for list updates.** It detaches every surviving
  node, which blurs whatever the user was on even when the content is
  unchanged. React, Vue, Angular and Svelte all reconcile in place already.

### 5. Structured arguments

`data-undoable-arg` is a raw string and is never parsed. Anything structured
goes through the programmatic path, which is fully typed:

```ts
runAction('reorderItem', { id, from, to }, { trigger: dragHandle });
```

---

## Verification

The React example is executed, not illustrative. Eight checks run against
React 18 with jsdom: markup binding drives `setState`, focus lands on the
equivalent control in the next row after React re-renders, `focus_loss` is 0,
undo restores the previous state object, a rejected commit rolls the UI back,
and `flushPending()` before `unmount()` still commits.

The Vue, Angular and Svelte examples follow the same two rules and are
type-correct, but have not been executed. If you hit a problem with one, it is
worth reporting — the shape of the failure is evidence about the seam, which
is what spec §12 asks for.
