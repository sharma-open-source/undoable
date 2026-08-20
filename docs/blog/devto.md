---
title: "The undo button is the easy part"
published: false
description: "A 4 KB runtime for optimistic, undoable mutations — and the five defects that only showed up when a keyboard used it."
tags: javascript, webdev, accessibility, typescript
canonical_url: https://sharma-open-source.github.io/undoable/
---

*Introducing `undoable` — a 4 KB runtime for optimistic, undoable mutations,
and the five defects that only showed up when a keyboard used it.*

---

Every product eventually grows the same feature. The user archives a row, the
row disappears immediately, a toast says *"Item archived — Undo"*, and five
seconds later the change is really persisted. Gmail shipped it in 2009.
Everyone copied it.

And nearly everyone reimplements it per feature, badly, three times in the
same codebase — because the actual mechanism (the timer, the rollback, the
one-at-a-time rule, the flush on navigation, the focus, the screen-reader
announcement) is tangled together with the thing that varies: your data and
your UI.

[`undoable`](https://github.com/sharma-open-source/undoable) is that mechanism
extracted. One primitive, no UI, no dependencies, ~4 KB gzipped.

```sh
npm install @sharma/undoable
```

## The whole API is two functions on a definition

You describe an action once. `apply` mutates your local state **synchronously**
and returns its inverse. `commit` persists it and returns a promise.

```js
import { defineAction } from '@sharma/undoable';

defineAction('archiveItem', {
  apply: (id) => {
    const index = items.findIndex((i) => i.id === id);
    const [item] = items.splice(index, 1);
    render();
    return () => {                      // ← the inverse, returned inline
      items.splice(index, 0, item);
      render();
    };
  },
  commit: (id) => fetch(`/items/${id}/archive`, { method: 'POST' }).then(assertOk),
});
```

Then you bind it in markup. Binding is delegated from `document`, so rows
inserted later just work — there is no registration step, no init call, no
component wrapper:

```html
<li data-undoable="archiveItem"
    data-undoable-arg="42"
    data-undoable-label="Item archived">
  <button data-undoable-trigger>Archive</button>
</li>
```

That is the entire integration. The runtime handles the undo window, the
rollback on failure, the commit on timeout, the commit on `pagehide`, the
focus, and the `aria-live` announcement.

It ships **no UI at all**. The undo affordance is a listener:

```js
document.addEventListener('undoable:pending', (e) => {
  const { label, undo, expiresAt } = e.detail;
  showToast(label, undo, expiresAt);
});
```

If nothing listens, actions still work — they are just visually silent. The
accessibility announcement still fires.

## Two constraints that look arbitrary and are not

**`ActionDef` accepts exactly `apply` and `commit`. Any other key throws.**
Not a warning — a throw. **`configure()` has exactly one option**
(`window`, default 5000ms, global, no per-action override).

This is the load-bearing part of the design. Optimistic-UI libraries die by
configuration growth: `onSuccess`, `retries`, `toastPosition`, `label`,
`priority`, `mergeStrategy`. Each one is individually reasonable and
collectively fatal, because every key added is a decision moved from the
application into a library that has less context than the application does.

So when a new requirement appears, the answer here is always one of two
things: **an event listener, or a second named action.** Never a new key.

Whether that holds is an empirical claim, and it was tested before the runtime
was written — three structurally different mutations (a removal, a reorder,
a bulk action over a multi-selection) had to fit the API without adding a key,
or the abstraction was at the wrong level.

## The concurrency model is one integer

At most one action is pending at a time. Triggering a new one flushes the
previous into `committing` immediately — no queue, no stack, no redo.

A revert is valid **iff** no later `apply` has run since. That is literally a
generation counter:

```js
applyGeneration += 1;      // before every apply, including ones that throw
// …later, if the commit rejects:
if (rec.generation === applyGeneration) rec.revert();   // still valid
else emit('desync', …);                                 // stale — do not touch state
```

`desync` is the interesting event. It means: *a commit failed, and the revert
that would undo it is no longer safe to call, because a newer change is
sitting on top of it.* Calling it would silently discard the newer change.
So the runtime refuses, and tells you. **Handle it by refetching.** A
sustained desync rate means the one-at-a-time flush model is wrong for your
app — which is information worth having.

## The part I did not expect: the spec was right and the behaviour was wrong

The runtime was built to a written spec with a 16-row acceptance matrix. It
passed. Then I built an integration harness and drove it headlessly, checking
things the matrix did not think to check — mostly focus and the accessibility
tree.

First run: **19 of 22.** All three failures were the runtime implementing the
spec *correctly*, and the spec being wrong.

**The fallback was position-correct and role-blind.** After a row is removed,
focus has to go somewhere. The spec said "the nearest following sibling
containing a focusable element". In a row shaped
`[checkbox] [↑] [↓] [Archive]`, that resolves to the **checkbox** — so a
keyboard user archiving three rows pays three Tab presses each time to get
back to the button they were actually using. The spec test said *"focus on
next row's focusable element"*, which this satisfies. The matrix passes; the
interaction is bad. The fix turned out not to be a heuristic: the app has
already declared which control plays that role by putting
`data-undoable-trigger` on it. There was nothing to guess and nothing to
configure.

**"Still connected" is not "still focusable".** The spec ended focus handling
with *"if the trigger is still connected after the frame, leave focus alone."*
Bulk-archive a selection and the trigger *is* still connected — and then the
app disables it, because nothing is selected any more. Browsers blur a focused
element the moment it becomes disabled, so focus drops to `<body>`. The
early-return meant restoration never ran **and the `focus_loss` metric was
never incremented.** The instrumentation read 0 while focus was being lost on
every bulk action. That one is worth sitting with: a metric that is wrong in
the same direction as the bug is worse than no metric.

The fix collapsed the whole check into one predicate — connected, not
`disabled`, not `hidden`, not inside `[inert]` — asking *"did focus survive"*
rather than *"did the trigger survive"*.

**The announcement said the opposite of what happened.** The spec fixed the
announcement text as the label, with no variation by state. So a failed commit
announced, assertively:

> "Buy milk" archived

…at the exact moment the row visibly came back. The politeness level changed;
the words did not. Screen-reader users were told the inverse of the truth.
Fixed by appending fixed wording per outcome — "— undone", "— could not be
saved, change undone".

**And that fix has a cost I could not design away: those strings are
hardcoded English.** The runtime cannot know the host application's language,
and all three escape routes are blocked by the design — per-action copy is a
declared non-goal, a global message table is a second `configure` option, and
going back to the bare label reintroduces the defect. That is the first
genuine pressure on "exactly one option", and it came from accessibility
rather than feature creep. It is recorded as an open question rather than
quietly resolved.

All of it is written up, defect by defect, in
[examples/FINDINGS.md](https://github.com/sharma-open-source/undoable/blob/main/examples/FINDINGS.md)
— including the one finding that is **not fixed**, because it is not fixable
inside the runtime's scope: the undo toast lives at the bottom of the page,
outside the list, and vanishes after five seconds, so reaching it by keyboard
is genuinely awkward. Shipping `undoable` does not by itself give you an
accessible undo. Whoever ships the toast still has that problem.

## What it does not do

Deliberately, and permanently: no redo, no multi-level undo stack, no built-in
toast, no per-action config, nothing requiring layout measurement, no
server-side conflict resolution.

## The one thing you must do

SPA route changes are invisible to the runtime. Call `flushPending()` in your
router hook, or a pending change is silently dropped when the view unmounts:

```js
router.beforeEach(() => undoable.flushPending());
```

`pagehide` and tab-hide are already handled.

## Status

`@sharma/undoable@0.1.1` — MIT, zero dependencies, TypeScript types included,
Node ≥ 20, works with React, Vue, Angular and Svelte 5
([framework guide](https://github.com/sharma-open-source/undoable/blob/main/docs/frameworks.md)).
51 tests in jsdom, a 22-assertion integration probe, and 11 checks driven
through real Chromium via Playwright — because jsdom structurally cannot
answer questions about focus and the accessibility tree, and those turned out
to be exactly the questions that mattered.

One question is still open and needs a human: **do NVDA, JAWS and VoiceOver
actually re-announce when `aria-live` politeness flips on a region that
already exists?** Chromium confirms the accessibility tree updates correctly.
That is necessary and not sufficient. If real screen readers ignore the
switch, the design needs two regions instead of one. If you have a screen
reader and ten minutes,
[that issue](https://github.com/sharma-open-source/undoable/issues) is the
most useful thing anyone could contribute right now.

```sh
npm install @sharma/undoable
```

- **npm** — <https://www.npmjs.com/package/@sharma/undoable>
- **GitHub** — <https://github.com/sharma-open-source/undoable>
- **Design spec** — [docs/spec.md](https://github.com/sharma-open-source/undoable/blob/main/docs/spec.md)
- **The findings** — [examples/FINDINGS.md](https://github.com/sharma-open-source/undoable/blob/main/examples/FINDINGS.md)

*Written by Sharma Sathananthan. MIT licensed.*
