# Integration findings

From driving [the harness](index.html) headlessly via [probe.mjs](probe.mjs)
(`npm run probe`) — 22 assertions across the three action shapes, two render
strategies, and two view-update timings.

The first run scored **19 of 22 — the three failures being the runtime
following the spec correctly and the spec being wrong**, none of them caught
by the original §10 matrix.

**All five in-scope findings are now fixed.** The probe scores 22/22, the
suite is 51 tests, and [spec.md](../docs/spec.md) has been amended (§5, §6,
§7, plus matrix rows 17–21) with an amendment log at its end. Each finding
below records what changed. F6 is not fixable inside the runtime's non-goals
and stands as an open boundary question in spec §13.

---

## F1 — §6's fallback rule is position-correct but role-blind

**Severity: medium. Affects every keyboard user who archives more than one row.
Fixed.**

A row in the harness is `[checkbox] [order] [title] [↑] [↓] [Archive]`. Spec §6
says the fallback is "the nearest following sibling containing a focusable
element → that element", which resolves to the **checkbox** — the next row's
first focusable, not the control the user was actually operating.

```
1. archive middle row → focus lands in next row
   input "Select Measure time_to_apply on the list view"     ← not the Archive button
```

Archiving three rows in sequence therefore costs the user three Tab presses
each time to get back to Archive. Spec test 10 says "Focus on next row's
focusable element" — which this satisfies, so the matrix passes while the
interaction is bad.

**Resolution.** `computeFallback` now prefers a sibling's usable
`[data-undoable-trigger]` and falls back to the first focusable only when no
equivalent control exists. This turned out not to be a heuristic after all —
the application has already declared which control plays that role, so there
is nothing to guess and nothing to configure. Spec §6 rules 1 and 3; matrix
row 17.

```
1b. …on the same control the user was using?
    button "Archive Measure time_to_apply on the list view"     ← now the trigger
```

## F2 — §6 captures a node reference before `apply`; re-rendering invalidates it

**Severity: high for any app that rebuilds DOM rather than mutating it.
Fixed.**

The fallback is computed before `apply` and held as an element reference. Any
view layer that recreates nodes — `innerHTML =`, `replaceChildren`, a keyed
list whose keys change — destroys that node, and focusing a detached element
is a no-op. Implemented exactly as §6 is written, focus is silently lost.

```
4. archive with innerHTML render → focus
   ul#list [tabindex=-1]     ← survived only because of a guard not in the spec
```

**Resolution.** `src/focus.ts` had already added a fallback-of-the-fallback —
if the captured element is unusable at rAF time, fall through to the parent
container — but it was an undocumented deviation. Spec §6 now mandates it,
and matrix row 19 pins it.

Related, and worth knowing: `replaceChildren()` detaches every surviving node,
which blurs whatever the user was on even when the list content is unchanged.
The harness uses `insertBefore` in place for exactly this reason
([app.js](app.js), `render()`).

## F3 — "trigger still connected" is not "trigger still focusable"

**Severity: high. The `focus_loss` metric read 0 while focus was being lost.
Fixed.**

§6 ends with "If the trigger is still connected after the rAF, leave focus
alone." Bulk-archiving the whole selection leaves the trigger connected — and
then the app disables it, because nothing is selected any more:

```
13. bulk: trigger survives but is now disabled
    activeElement=archiveSelected disabled=true
```

Browsers blur a focused element when it becomes disabled, so focus drops to
`body`. Because §6 returns early on the connected check, restoration never
runs **and the `focus_loss` counter is never incremented** — §11 says that
metric should be 0 and asserted in tests, and here it reports 0 while being
wrong.

**Resolution.** A single `isUsable()` predicate — connected, not `disabled`,
not `hidden`, not inside `[inert]` — now gates both the fallback search and
the lost-focus check. The trigger check disappeared entirely: the condition
is "did focus survive", not "did the trigger survive", which subsumes the old
early-return and fixes this case in one move. Spec §6; matrix row 18.

```
13. bulk: trigger survives but is now disabled
    activeElement=reset disabled=false     ← focus moved off it
```

Because the check tests the *element* rather than trusting `activeElement`,
this is correct on both engines: browsers blur the disabled button and jsdom
does not, and either way it is now recognised as lost.

## F4 — the conservative staleness rule costs a recoverable case

**Severity: medium. Produced a `desync` — the one outcome §11 wants at ~0.
Fixed.**

Sequence: A pending → B triggered (A flushes to `committing`) → user undoes B
→ A's commit rejects.

```
12. undo of B, then A rejects → outcome
    reverted desync
```

B's revert put the model back exactly where A's revert expects it, so A's
revert is provably valid again — but the generation counter has moved on and
the runtime reports desync, forcing a refetch that was not needed.

**Resolution.** `undo()` now gives back the generation it consumed. The
pending record always carries the current generation — every later
`runAction` flushes it first — so the decrement can only ever undo its own
increment, and an earlier in-flight `Revert` becomes valid again exactly when
it genuinely is.

```
12. undo of B, then A rejects → outcome
    reverted failed          ← was: reverted desync
12b. rows
    6                        ← was: 5, with t1 unrecoverable
```

This narrows §5's conservatism rather than abandoning it: with the newer
action *not* undone, the stale revert is still refused and `desync` still
fires (`concurrency.test.ts` pins both directions). Spec §5; matrix row 20.

## F5 — announcement text contradicts the outcome

**Severity: medium. Screen-reader users were told the opposite of what
happened. Fixed, with a cost.**

§7 fixes the announcement text as "`data-undoable-label`, else the trigger's
accessible name, else the action name" — with no variation by state. So a
commit failure announces, assertively:

> "Buy milk" archived

when the change has just been rolled back and the row is visibly back. Same
text for `desync`.

The politeness level changed but the words did not.

**Resolution.** `outcomeText()` appends fixed wording per state — "— undone",
"— could not be saved, change undone", "— could not be saved, refresh to see
the current state". Spec §7; matrix row 21.

**The cost, stated plainly: those strings are hardcoded English.** The
runtime cannot know the host application's language, and all three ways out
are blocked — per-action copy is a §1 non-goal, a global message table is a
second `configure` option, and reverting to the bare label reintroduces the
defect. This is the first genuine pressure on "exactly one option", and it
comes from accessibility rather than feature creep, which makes it exactly
the kind of evidence §12 says to report rather than paper over. Recorded as
an open question in spec §13.

## F6 — the undo affordance is hard to reach by keyboard

**Severity: low for the runtime, high for whoever ships the toast. Not fixed —
not fixable within §1.**

The runtime correctly moves focus into the list after a removal. The Undo
control lives in a fixed-position toast at the bottom of the page, outside the
list, and disappears after 5s. A keyboard user must notice the announcement,
Tab out of the list, and reach the toast inside the window.

This is squarely outside the runtime — §1 rules out built-in UI and anything
needing layout. Recording it because it is the integration reality: shipping
`undoable` does not by itself give you an accessible undo, and the optional
toast module mentioned in §9 will have to solve it.

---

## Confirmed working

These held under fault injection and are worth keeping in the regression set:

| Behaviour | Evidence |
|---|---|
| Commit order matches trigger order under *inverted* latency | `commit0,commit1,commit2,commit3,commit4` |
| 5 rapid triggers → only the last is undoable, earlier `undo()`s inert | `reverted=1` |
| Flushed action's rejection → `desync`, stale revert never called | rows `6 → 4`, both removals stood |
| Undo pressed 3× → single revert, no error | `reverted events=1, rows=6` |
| `pagehide` while pending → commit runs, counted as orphaned | `committed=1 orphaned=1` |
| Removal of last row → container focused with `tabindex="-1"` | `ul#list [tabindex=-1]` |
| Deferred (React-like) render → focus still restored | rAF ordering holds |
| `time_to_apply` p99 | ~3ms, well under the 16ms target |

## F7 — the runtime's live region is not the only one on the page

**Severity: low, but invisible until you look. Not fixable in the runtime.**

The real-browser probe dumps the full accessibility tree, which showed:

```
note  page has 6 live regions total (5 belong to the host app, not the runtime)
```

The five are the harness's own `<output>` elements — `<output>` carries an
implicit `role="status"`, so every drag of the latency slider is a polite
announcement racing the runtime's. Nothing here is the runtime's fault and
there is nothing it can do about it, but §7's "one region, reused" reasoning
quietly assumes it is the only speaker on the page. It usually is not.

Worth checking with `npm run probe:browser` against a real integration before
blaming the runtime for a noisy or swallowed announcement.

---

## Verified in real Chromium

`npm run probe:browser` drives the same harness through Playwright — **11/11
passing**. This settles two of the three things jsdom structurally could not
answer.

| Question | Answer |
|---|---|
| Does focus survive an `insertBefore` move of the focused node? | **Yes.** `focused before=true, after=true`. Reorder needs no extra handling. |
| Does the engine blur an element when it is disabled? | **Yes.** `activeElement became body=true` — F3 was a real defect, not a theoretical one. |
| Is the region exposed to AT with the switched politeness? | **Yes.** `live=assertive` in the accessibility tree, carrying the outcome wording. |

The F1, F2 and F3 fixes were re-confirmed against a real engine rather than
jsdom, including the container fallback under `innerHTML` rebuild and focus
moving off a self-disabling trigger.

## What still cannot be verified here

**Whether NVDA, JAWS or VoiceOver actually re-announce when `aria-live`
flips on a region that already exists.** Chromium confirms the accessibility
tree updates correctly — necessary, but not sufficient. How a screen reader
treats a politeness change on a live region mid-session is implementation
behaviour that no browser API reports. If real screen readers ignore the
switch, spec §7 needs two regions instead of one.

That needs a human with a screen reader. It is the last open item on §7.
