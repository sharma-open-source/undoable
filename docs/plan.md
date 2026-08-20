# `undoable` — implementation plan

Companion to [spec.md](spec.md). Where this document and the spec disagree,
the spec wins and the disagreement is recorded in §9 below as evidence.

---

## 1. Scope decision

`undoable` ships as a **standalone, zero-dependency runtime** that any HTML
application can adopt. There is no host codebase to migrate.

Consequences for the spec's own gates:

| Spec clause | Status | Resolution |
|---|---|---|
| §0 — three *existing* optimistic mutations | Cannot be met | Dry-run against three constructed call sites (§2). Recorded as weaker evidence than the spec intends. |
| §12 — three real call sites migrated, hand-rolled code deleted | Cannot be met | Three reference implementations in `examples/`, one per shape. |
| §11 project-level — net lines strongly negative | Not applicable | No prior code to delete. Dropped, not faked. |
| §10 — all 16 tests pass | Applies unchanged | Acceptance gate. |
| §12 — `ActionDef` has exactly two keys, `configure` exactly one option | Applies unchanged | Acceptance gate. |

The two structural gates and the test matrix survive intact, so the parts of
§12 that actually constrain the design still bind. What is lost is the
migration evidence — we do not learn where the abstraction boundary falls
under real pressure until someone integrates it.

---

## 2. Phase 0 dry run

Three structurally different mutations, expressed in the §2 API. None
required a key on `ActionDef`.

**1. Removal**

```ts
defineAction<string>('archiveItem', {
  apply: (id) => {
    const { list, index, item } = spliceById(id);
    return () => list.splice(index, 0, item);
  },
  commit: (id) => api.archive(id),
});
```

Markup-driven. `data-undoable-arg="42"` passes the raw id string.

**2. Reorder**

```ts
defineAction<{ id: string; from: number; to: number }>('reorderItem', {
  apply: ({ id, from, to }) => {
    move(list, from, to);
    return () => move(list, to, from);
  },
  commit: ({ id, to }) => api.setPosition(id, to),
});

runAction('reorderItem', { id, from, to }, { trigger: dragHandle });
```

**3. Bulk over a multi-selection**

```ts
defineAction<string[]>('archiveSelected', {
  apply: (ids) => {
    const reverts = ids.map((id) => archiveOne(id));
    return () => reverts.reverse().forEach((r) => r());
  },
  commit: (ids) => api.archiveMany(ids),
});
```

### The load-bearing observation

`data-undoable-arg` is string-only, but `runAction<A>` is generic and takes
`arg: A` directly. Reorder and bulk are drag- and selection-driven — they
never originate from a `data-undoable-trigger` activation, so the string
constraint never binds them. The markup path stays deliberately dumb; the
programmatic path carries structure.

If a future case needs a structured argument *from markup*, that is the
report §12 asks for — not a JSON-parsing option on the attribute.

---

## 3. Module layout

```
undoable/
  src/
    types.ts       ActionDef, Revert, event detail types
    config.ts      configure(), window default 5000ms
    registry.ts    defineAction() + key validation
    runtime.ts     state machine: pending slot, generation counter, flush
    binding.ts     delegated document listener, label + accname resolution
    focus.ts       fallback computation, rAF restoration
    announce.ts    single aria-live region
    events.ts      typed dispatch on document
    metrics.ts     counters, exported read-only
    index.ts       public surface
  test/            one block per row of spec §10
  examples/        three reference call sites + focus fixtures
  docs/
```

No runtime dependencies. TypeScript source, Vitest + jsdom for tests.

---

## 4. Distribution

"Any HTML app" means adoption must not require a build step.

| Target | Form | Consumer |
|---|---|---|
| `dist/undoable.js` | ESM | bundlers, `<script type="module">` |
| `dist/undoable.cjs` | CJS | Node tooling, legacy bundlers |
| `dist/undoable.global.js` | IIFE, `window.undoable` | plain `<script src>` |
| `dist/undoable.d.ts` | types | TypeScript consumers |

Built with `tsup`. The IIFE build is the one that makes §3's markup binding
usable from a bare HTML page: drop the script in, call `defineAction`, add
the attributes. Because binding is delegated from `document`, no
initialisation call is needed and dynamically inserted markup works
immediately (test 16).

---

## 5. The four parts most likely to be got wrong

### 5.1 Revert staleness (spec §5)

A module-level `applyGeneration` counter, incremented immediately **before**
every `apply()` call. Each pending record captures the generation current at
its own apply. A record's `Revert` is valid iff
`record.generation === applyGeneration`.

This is a literal encoding of "a Revert becomes stale the moment any later
action's apply runs", and it makes test 6 fall out of the design rather than
requiring bespoke flush bookkeeping.

The counter is incremented even when `apply` **throws** — a partially applied
mutation invalidates its predecessors exactly as much as a successful one
does.

### 5.2 Commit ordering (test 7)

No queue, no serialisation. Because flush is synchronous and runs as step 1
of every trigger activation, `commit()` invocations happen in trigger order
by construction.

The previous commit is deliberately **not** awaited before the next begins —
awaiting would serialise network calls and contradicts §5's "synchronously
begin its commit". Rejection handlers may therefore settle out of order, but
they only emit events and consult the generation counter, so ordering is
irrelevant to correctness there.

### 5.3 Focus (spec §6)

Spec §4 step 8 lists "restore focus" as a synchronous step; §6 places
restoration on the next `requestAnimationFrame`. Read step 8 as *scheduling*
the rAF check.

- Fallback is computed **before** `apply`, while the DOM is intact.
- `tabindex="-1"` is written only at restoration time, so non-removing
  actions never mutate the DOM (test 12).
- Focusable detection is a plain selector match with **no** visibility check.
  Spec §1 rules out layout measurement, and `offsetParent` is a layout read.
- Guard beyond the spec: if the captured fallback is itself detached by the
  time the rAF runs, fall through to the parent container, then to nothing.

### 5.4 Metrics without config growth (§11 vs §12)

`time_to_apply` and `focus_loss` are not derivable from the five public
events, so they need runtime instrumentation. Adding `configure({ onMetric })`
would break "configure still has exactly one option".

Resolution: export `getMetrics()` returning a snapshot of live counters. No
sixth event type, no second config key. Both structural gates hold.

---

## 6. Decisions taken where the spec is silent

| Case | Decision | Reasoning |
|---|---|---|
| `apply` returns a Promise (test 15) | Throw; emit **no** `undoable:failed` | Programming error, like test 14. `failed{reverted:false}` is reserved for a genuine throw from user code (test 9). |
| `configure` with an unknown key | Throw | Mirrors `defineAction`. Same anti-config-creep mechanism. |
| `undo()` called after its action was flushed | No-op | Commit is already in flight and the `Revert` is stale. The only safe behaviour. |
| Accessible name resolution | `aria-label` → `aria-labelledby` → `textContent` → `title` | Full accname algorithm is disproportionate. Documented subset. |
| Identical consecutive announcements (test 13) | Clear region synchronously, write on next rAF | Guarantees re-announcement without a second region. |
| `aria-live` politeness switching | Mutate the attribute on the single region before writing | §7 mandates one region; politeness varies by event. |

---

## 7. Test matrix mapping

All 16 rows of spec §10 are required. Environment: Vitest + jsdom, fake
timers including rAF.

All 16 rows are covered, in 44 tests across 7 files.

| Rows | File | Tests |
|---|---|---|
| 1, 2, 3, 4, 9 | `test/lifecycle.test.ts` | 5 |
| 5, 6, 7 | `test/concurrency.test.ts` | 4 |
| 8 | `test/page-lifecycle.test.ts` | 4 |
| 10, 11, 12 | `test/focus.test.ts` | 7 |
| 13 | `test/announce.test.ts` | 5 |
| 14, 15 | `test/api.test.ts` | 10 |
| 16 | `test/binding.test.ts` | 9 |

Row 7 is split: the primary test lets the window expire and asserts all five
commits in trigger order; a second asserts that under rapid fire only the
last action is still undoable, which is the observable form of "never more
than one pending".

`test/focus.test.ts` asserts `focus_loss === 0` on every path, per §11's
"assert in tests, not just production", plus one test that deliberately
destroys every focusable element and asserts the counter reaches 1.

jsdom notes: `document.visibilityState` is read-only and must be stubbed via
`Object.defineProperty`; rAF needs to be in the fake-timer set.

---

## 8. Sequencing

1. `types`, `config`, `registry`, `events` — tests 14, 15.
2. `runtime` state machine with the generation counter — tests 1–9.
3. `binding` — tests 3, 16.
4. `focus` — tests 10, 11, 12, plus the `focus_loss` assertion.
5. `announce` — test 13.
6. `metrics` and page-lifecycle listeners — test 8, `orphaned_commits`.
7. `examples/` reference call sites for all three Phase 0 shapes.
8. README: integration guide, and the §8 router `flushPending()` obligation
   stated prominently — it is the one thing a host app must do.

---

## 9. Status

Built and verified: all ten `src/` modules, the four dist targets, the 21-row
acceptance suite (51 tests, all passing), and the integration harness in
`examples/`. `npm test` runs the suite; `npm run probe` drives the harness
headlessly — 22 assertions, all 22 matching the spec.

Against §12: all 21 tests pass, `ActionDef` still has exactly two keys, and
`configure` still has exactly one option. The migration criterion is the
standalone substitution described in §1 above.

The harness found five defects that rows 1–16 passed straight through. All
five in-scope ones are fixed and the spec amended (§5, §6, §7, rows 17–21,
plus an amendment log); see [examples/FINDINGS.md](../examples/FINDINGS.md).
The sixth, toast reachability, is not fixable within §1's non-goals.

Two things remain unverifiable here, both recorded in FINDINGS: focus
preservation across `insertBefore`, and whether real screen readers honour a
politeness switch on a single reused live region. Both need Playwright and a
manual screen-reader pass.

## 10. Open items

- **Migration evidence is deferred.** The spec's most valuable output per §12
  is the report of what a third real migration demanded. Standalone shipping
  defers that until first integration. Revisit §12 then.
- **`desync_rate` cannot be baselined** without production traffic. The
  counter ships; the target ("~0, anything sustained means the flush model is
  wrong for this app") is unverifiable until adoption.
