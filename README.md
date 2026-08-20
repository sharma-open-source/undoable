# undoable

A runtime that owns the mechanism of optimistic, undoable mutations. Your app
owns the data and the presentation. One primitive, no UI, no dependencies.

See [docs/spec.md](docs/spec.md) for the design contract and
[docs/plan.md](docs/plan.md) for how it was built.

---

## Install

No build step required. Drop in the global build and you are done:

```html
<script src="dist/undoable.global.js"></script>
```

Or import it:

```js
import { defineAction, runAction, flushPending, configure } from '@sharma/undoable';
```

The package is scoped because the unscoped `undoable` name is held on npm by
an abandoned 2018 placeholder. The import binding and the `<script>` global
are both still `undoable`.

## Use

Define the action once. `apply` mutates local state synchronously and returns
its inverse; `commit` persists it.

```js
undoable.defineAction('archiveItem', {
  apply: (id) => {
    const index = items.findIndex((i) => i.id === id);
    const [item] = items.splice(index, 1);
    render();
    return () => {
      items.splice(index, 0, item);
      render();
    };
  },
  commit: (id) => fetch(`/items/${id}/archive`, { method: 'POST' }).then(assertOk),
});
```

Bind it in markup. Binding is delegated from `document`, so dynamically
inserted rows work with no registration step:

```html
<li data-undoable="archiveItem"
    data-undoable-arg="42"
    data-undoable-label="Item archived">
  <button data-undoable-trigger>Archive</button>
</li>
```

`data-undoable-arg` is passed through as a **raw string** — never parsed or
coerced. For structured arguments, use the programmatic path:

```js
undoable.runAction('reorderItem', { id, from, to }, { trigger: dragHandle });
```

## The one thing you must do

SPA route changes are invisible to the runtime. Call `flushPending()` in your
router's navigation hook, or a pending change will be silently dropped when
the view unmounts:

```js
router.beforeEach(() => undoable.flushPending());
```

`pagehide` and tab-hide are already handled.

## Showing an undo affordance

The runtime ships no UI. Everything visible is a listener:

```js
document.addEventListener('undoable:pending', (e) => {
  const { label, undo, expiresAt } = e.detail;
  showToast(label, undo, expiresAt);
});
```

If nothing listens, actions still work — they are just silent visually. The
`aria-live` announcement still fires.

| Event | `detail` |
|---|---|
| `undoable:pending` | `{ name, arg, label, undo(), expiresAt }` |
| `undoable:committed` | `{ name, arg }` |
| `undoable:reverted` | `{ name, arg }` |
| `undoable:failed` | `{ name, arg, error, reverted }` |
| `undoable:desync` | `{ name, arg, error }` |

### `undoable:desync` is not an error to swallow

At most one action is pending at a time; starting a new one flushes the
previous into `committing`. A flushed action's revert is stale — calling it
would discard the newer change — so if its commit rejects, the runtime emits
`desync` instead of reverting. **Handle it by refetching.** A sustained
desync rate means the flush model is wrong for your app.

## API

```ts
defineAction<A>(name: string, def: { apply: (a: A) => Revert; commit: (a: A) => Promise<void> }): void
runAction<A>(name: string, arg: A, opts?: { trigger?: Element }): void
flushPending(): void
configure(opts: { window?: number }): void   // default 5000ms, global
getMetrics(): Metrics
```

`ActionDef` accepts **exactly** `apply` and `commit`; anything else throws.
`configure` has exactly one option. Both constraints are deliberate — when a
new requirement appears, the answer is an event listener or a second named
action, never a new key.

## Try it

```sh
npm install
npm run example        # harness at http://localhost:5173
npm test               # the 21-row acceptance suite (jsdom)
npm run probe          # drives the harness headlessly (jsdom)
npm run probe:browser  # drives it through real Chromium (Playwright)
```

`probe:browser` needs a one-off `npx playwright install chromium`. It exists
because jsdom cannot answer questions about focus and the accessibility tree
— it was what established that Chromium blurs an element when it is disabled,
which is the defect behind F3.

The [harness](examples/index.html) runs all three action shapes with
adjustable commit latency, failure rate, undo window, and render strategy.

[examples/FINDINGS.md](examples/FINDINGS.md) is worth reading before changing
anything: it records five places where the original spec produced the wrong
behaviour — three of them focus defects that the first test matrix passed
straight through — what each fix was, and the one cost that could not be
avoided.
