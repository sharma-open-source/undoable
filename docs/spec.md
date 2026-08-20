# `undoable` — implementation spec

A runtime that owns the mechanism of optimistic, undoable mutations. The
application owns the data and the presentation. Scope is deliberately one
primitive.

---

## 0. Phase 0 — validation gate (do this before writing the runtime)

Pick **three structurally different** existing optimistic mutations in the
codebase. Suggested shapes:

1. A removal (archive / delete a row)
2. A reorder (persist a new position)
3. A bulk action over a multi-selection

Write out how each would express itself using the API in §2. **Do not
implement the runtime until all three fit without adding a key to
`ActionDef`.** If the third one needs an extra parameter, the abstraction is
at the wrong level — stop and report which parameter was needed and why.

---

## 1. Non-goals

Explicitly out of scope. Do not implement these, and do not add extension
points anticipating them.

- Redo
- A multi-level undo stack (only one action is undoable at a time)
- Any built-in visual UI (toast, snackbar, banner)
- Per-action configuration of window duration, copy, or placement
- Anything requiring layout measurement
- Server-side conflict resolution

---

## 2. Public API

```ts
type Revert = () => void;

type ActionDef<A> = {
  /** Synchronous. Mutates local state. Returns the inverse. */
  apply: (arg: A) => Revert;
  /** Persists the change. Resolves on success, rejects on failure. */
  commit: (arg: A) => Promise<void>;
};

function defineAction<A>(name: string, def: ActionDef<A>): void;

function runAction<A>(
  name: string,
  arg: A,
  opts?: { trigger?: Element }
): void;

function flushPending(): void;

function configure(opts: { window?: number }): void; // default window: 5000ms
```

### Constraints on the seam

- `ActionDef` accepts **exactly** the keys `apply` and `commit`.
  `defineAction` must **throw** on any unknown key. This is load-bearing —
  it is the mechanism that prevents config growth. Do not soften it to a
  warning.
- `apply` must be synchronous. If it returns a Promise, throw.
- `configure` is global. There is no per-action override.

---

## 3. Markup binding

```html
<li data-undoable="archiveItem"
    data-undoable-arg="42"
    data-undoable-label="Item archived">
  <button data-undoable-trigger>Archive</button>
</li>
```

| Attribute | Required | Meaning |
|---|---|---|
| `data-undoable` | yes | Registered action name |
| `data-undoable-arg` | no | Passed to `apply`/`commit` **as a raw string** |
| `data-undoable-label` | no | Announcement text; defaults to trigger's accessible name |
| `data-undoable-trigger` | yes | Element whose activation fires the action |

`data-undoable-arg` is not parsed or coerced. Applications needing structured
arguments pass an id and look it up inside `apply`. Adding JSON parsing here
is config creep — do not.

Binding is delegated from `document`, so dynamically inserted markup works
with no registration step. Trigger activation = `click` plus keyboard
activation via native button semantics. If `data-undoable-trigger` is not a
`<button>`, log a warning; do not synthesize key handling.

---

## 4. Lifecycle

```
idle → pending → committing → committed
                            ↘ failed (reverted)
       pending → reverted        (user pressed undo)
       pending → committing → failed (NOT reverted → desync)
```

**Sequence on trigger activation:**

1. If an action is already pending, **flush it** (§5) — synchronously begin
   its commit, transitioning it to `committing`.
2. Record focus fallback (§6) — *before* `apply`, while the DOM is intact.
3. Call `apply(arg)`. Store the returned `Revert`.
4. If `apply` throws: emit `undoable:failed` with `reverted: false`, rethrow.
   Do not enter `pending`.
5. Enter `pending`. Start the window timer.
6. Emit `undoable:pending`.
7. Announce the label (§7).
8. Restore focus (§6).

**On window expiry:** transition to `committing`, call `commit(arg)`.

**On commit resolve:** emit `undoable:committed`.

**On commit reject:**
- If this action's `Revert` is still valid (no subsequent `apply` has run),
  call it, then emit `undoable:failed` with `reverted: true`.
- If it is **not** valid, do **not** call it. Emit `undoable:desync`. See §5.

**On undo (before expiry):** cancel timer, call `Revert`, emit
`undoable:reverted`. `commit` is never called. Undo is idempotent — a second
call is a no-op.

---

## 5. Concurrency and revert validity

**This is the section most likely to be implemented incorrectly. Read it
twice.**

A `Revert` thunk is only valid while no subsequent `apply` has mutated
overlapping state. The runtime cannot know what "overlapping" means for a
given application, so it takes the conservative position:

> A `Revert` becomes **stale** the moment any later action's `apply` runs.

Therefore:

- **At most one action may be `pending` at a time.** A new action flushes the
  previous one first.
- A flushed action is in `committing` with a stale `Revert`. If its commit
  rejects, the runtime **must not** call that `Revert` — doing so would
  discard the newer action's change.
- Instead it emits `undoable:desync`. The application is expected to
  resynchronise (typically a refetch). This is a real, observable outcome,
  not an error to be swallowed.
- **Undo restores validity.** If the pending action is undone, its `apply`
  has been provably reversed and local state is back at the point an earlier
  in-flight action's `Revert` expects. That earlier `Revert` is valid again,
  and a subsequent commit rejection is a plain `failed`, not a `desync`.
  Treating it as stale would force an unnecessary refetch and inflate the one
  metric §11 wants at zero.

Rapid activation (N triggers within one window) must produce N commits in
trigger order, and exactly one `pending` action at any instant.

---

## 6. Focus

Optimistic removal detaches the focused element. Unhandled, focus falls to
`<body>` and keyboard/screen-reader users lose their place. This is the most
common defect in hand-rolled implementations and is non-optional here.

Throughout this section, **usable** means: connected, not `disabled`, not
`hidden`, and not inside `[inert]`. Connectedness alone is not enough —
browsers blur an element the moment it is disabled, so a trigger that
survives in the DOM but is switched off has taken the user's focus with it.

**Before `apply`**, compute a fallback in this order:

1. Nearest following sibling of the `data-undoable` element containing a
   usable `[data-undoable-trigger]` → that element
2. Nearest following sibling containing any usable focusable element → that
   element
3. Nearest preceding sibling, rules 1 then 2
4. The parent container → apply `tabindex="-1"` and use it

Rules 1 and 3 exist because taking the *first* focusable descendant lands the
user on whatever happens to come first in the row — usually a checkbox — and
makes repeated actions cost several Tab presses each. Matching on
`data-undoable-trigger` is not a heuristic: the application has already
declared which control plays that role.

**After `apply`**, on the next `requestAnimationFrame` (the DOM may be
updated asynchronously by the view layer), check whether
`document.activeElement` is `null`, `<body>`, or no longer usable. If so,
focus the fallback.

If the captured fallback is itself no longer usable — a view layer that
rebuilds nodes rather than mutating them destroys it — fall through to the
parent container. Without this step, every framework integration silently
loses focus.

The condition is "did focus survive", not "did the trigger survive". An
action that leaves the user on a usable trigger needs no restoration; an
action that disables its own trigger is indistinguishable from one that
removes it, which is the intent.

---

## 7. Announcement

- One lazily-created `aria-live` region, appended to `<body>`, visually
  hidden. Reused across all actions.
- `polite` for pending and reverted.
- `assertive` for failed and desync.
- Base text: `data-undoable-label`, else the trigger's accessible name, else
  the action name.
- **The announcement states the outcome, not the attempt.** The base text
  describes what was tried; announcing it unchanged on failure tells a
  screen-reader user the opposite of what happened — "Item archived",
  assertively, at the moment the row reappears. Fixed suffixes:

  | State | Text |
  |---|---|
  | pending | *base* |
  | reverted | *base* — undone |
  | failed | *base* — could not be saved, change undone |
  | desync | *base* — could not be saved, refresh to see the current state |

  The suffixes are hardcoded. Per-action copy is a non-goal (§1) and a global
  message table would be a second `configure` option (§12). See the open
  boundary question in §13.
- Clear the region before writing to guarantee re-announcement of identical
  consecutive messages.

---

## 8. Page lifecycle

Pending work must not be silently dropped.

- `pagehide` and `visibilitychange` → `hidden`: call `flushPending()`.
- Do **not** register a `beforeunload` prompt. Commits are fire-and-forget at
  this point; blocking navigation for a 5-second convenience window is the
  wrong trade.
- SPA route changes are invisible to the runtime. The application must call
  `flushPending()` in its router's navigation hook. Document this
  prominently — it is the one integration obligation on the host app.

---

## 9. Events — the single escape hatch

All dispatched on `document`, bubbling, with `detail`:

| Event | `detail` |
|---|---|
| `undoable:pending` | `{ name, arg, label, undo(), expiresAt }` |
| `undoable:committed` | `{ name, arg }` |
| `undoable:reverted` | `{ name, arg }` |
| `undoable:failed` | `{ name, arg, error, reverted: boolean }` |
| `undoable:desync` | `{ name, arg, error }` |

The runtime ships **no** default UI. If nothing listens to
`undoable:pending`, the action still works — it is simply silent visually
(the aria-live announcement still fires). A default toast may ship as a
separate, optional module that is itself just a listener.

When a new requirement appears that the API does not cover, the correct
response is an event listener or a second named action — **never** a new key
on `ActionDef`.

---

## 10. Test matrix

Each row is a required test.

| # | Scenario | Expected |
|---|---|---|
| 1 | Commit resolves after window | `committed`; `Revert` never called |
| 2 | Undo before expiry | `reverted`; `commit` never called |
| 3 | Undo pressed twice | Single revert; no error |
| 4 | Commit rejects, revert valid | `Revert` called once; `failed{reverted:true}` |
| 5 | Second action during window | First transitions to `committing` before second's `apply` |
| 6 | Flushed action's commit rejects | `desync` emitted; stale `Revert` **not** called |
| 7 | 5 triggers in <100ms | 5 commits in order; never >1 `pending` |
| 8 | `pagehide` while pending | `commit` called before unload |
| 9 | `apply` throws | `failed{reverted:false}`; no `pending`; error rethrown |
| 10 | Focus after removing middle row | Focus on next row's focusable element |
| 11 | Focus after removing last row | Focus on container with `tabindex="-1"` |
| 12 | Focus after non-removing action | Focus unchanged on trigger |
| 13 | Two identical consecutive announcements | Both announced (region cleared between) |
| 14 | `defineAction` with unknown key | Throws |
| 15 | `apply` returns a Promise | Throws |
| 16 | Trigger inside dynamically inserted markup | Works with no registration |
| 17 | Removed row whose successor has an equivalent trigger | Focus on that trigger, not the row's first focusable |
| 18 | Action disables its own trigger | Focus restored off it; `focus_loss` 0 |
| 19 | Fallback node destroyed by a rebuilding view layer | Focus falls through to the container |
| 20 | Undo of newer action, then older commit rejects | `failed{reverted:true}`, **not** `desync` |
| 21 | Commit failure announcement | Text states the rollback, not the attempt |

Rows 17–21 were added after the integration harness showed rows 1–16 passing
while the behaviour was wrong. Each corresponds to a finding in
`examples/FINDINGS.md`.

---

## 11. Instrumentation

Emit these as counters/timings from the runtime itself.

| Metric | Definition | Target |
|---|---|---|
| `desync_rate` | `desync` ÷ total actions | ~0. Anything sustained means the flush model is wrong for this app |
| `undo_rate` | `reverted` ÷ total actions | <15%. Higher suggests accidental triggering or an unclear label |
| `commit_failure_rate` | `failed` + `desync` ÷ total | Baseline against existing API error rate |
| `time_to_apply` | Trigger activation → `pending` emitted | <16ms (p99). `apply` is synchronous; a regression here means someone made it async |
| `orphaned_commits` | Commits initiated from `pagehide` | Track only. A spike indicates a missing router `flushPending()` |
| `focus_loss` | Post-apply frames where `activeElement` is body/detached after restoration | 0. Assert in tests, not just production |

**Project-level:** count hand-rolled optimistic updates remaining in the
codebase. The number should reach zero. Track net lines changed — this
should be strongly negative, and if it is not, the runtime is doing too
little to justify the dependency.

---

## 12. Acceptance

Ship when:

- All 21 tests pass.
- Three real call sites are migrated, with the previous hand-rolled code
  deleted.
- `ActionDef` still has exactly two keys.
- `configure` still has exactly one option.

If the third migration required an option, do not add it. Report the
requirement instead — it is evidence about where the abstraction boundary
actually falls, and it is more valuable than the shipped runtime.

---

## 13. Open boundary questions

Reported rather than solved, per §12.

**Announcement copy is hardcoded English.** §7 now specifies outcome wording,
which the runtime cannot express in the host application's language. The
three obvious answers are all bad: per-action copy is a §1 non-goal, a global
message table is a second `configure` option, and leaving the text as the
bare label is the defect §7 was amended to fix. This is the first real
pressure on "exactly one option" and it comes from accessibility, not from
feature creep. Unresolved.

**The undo affordance is hard to reach by keyboard.** The runtime correctly
moves focus into the list after a removal; a toast at the edge of the
viewport is then several Tab presses away and disappears in five seconds.
Nothing in §1 permits the runtime to help — no built-in UI, no layout
measurement. Whoever ships the optional toast module inherits this whole
problem, and it is not obviously solvable there either.

---

## Amendment log

Everything above is the original specification except the following, added
after building the runtime and driving it through `examples/`:

| Section | Change | Finding |
|---|---|---|
| §5 | Undo restores an earlier `Revert`'s validity | F4 |
| §6 | "Usable" replaces "connected"; equivalent-control preference; fallback-of-the-fallback | F1, F2, F3 |
| §7 | Announcement states the outcome, not the attempt | F5 |
| §10 | Rows 17–21 | all |
| §12 | 16 tests → 21 | — |
| §13 | New: i18n and toast reachability | F5, F6 |