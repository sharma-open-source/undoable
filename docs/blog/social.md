# Where to post, and one-click submit links

Two links are already live:

| Where | Link | State |
|---|---|---|
| Hosted page (with a live demo of the real build) | https://claude.ai/code/artifact/3cada59b-7fe6-4353-a055-66bb0623180a | Private until you share it |
| Public GitHub gist | https://gist.github.com/sharma-open-source/b5da4f81d36c1445e62b4ec66cd3f8b3 | Public now |

Everything below needs your own login, so paste the matching draft in this folder.

## Developer blogging platforms

| Platform | Where to paste | File to use |
|---|---|---|
| dev.to | https://dev.to/new | `devto.md` (front matter has `published: false` — flip to `true`) |
| Hashnode | https://hashnode.com/create/story | `hashnode.md` |
| Medium | https://medium.com/p/import (import keeps canonical) or https://medium.com/new-story | `medium.md` |
| Your repo | commit `docs/blog/the-undo-button-is-the-easy-part.md` | already written, uncommitted |

Post to **one** of these first, then set that URL as the `canonical_url` in the others so search engines credit a single page.

## Aggregators — prefilled submit links

- **Hacker News** (use the Show HN title): https://news.ycombinator.com/submitlink?u=https%3A%2F%2Fgithub.com%2Fsharma-open-source%2Fundoable&t=Show%20HN%3A%20Undoable%20%E2%80%93%20a%204%20KB%20runtime%20for%20optimistic%2C%20undoable%20mutations
- **Lobsters** (needs an invite): https://lobste.rs/stories/new?url=https%3A%2F%2Fgist.github.com%2Fsharma-open-source%2Fb5da4f81d36c1445e62b4ec66cd3f8b3
- **r/javascript**: https://www.reddit.com/r/javascript/submit?url=https%3A%2F%2Fgist.github.com%2Fsharma-open-source%2Fb5da4f81d36c1445e62b4ec66cd3f8b3&title=The%20undo%20button%20is%20the%20easy%20part%3A%20a%204%20KB%20runtime%20for%20optimistic%2C%20undoable%20mutations
- **r/webdev** (self-promo belongs in Showoff Saturday): https://www.reddit.com/r/webdev/submit?url=https%3A%2F%2Fgist.github.com%2Fsharma-open-source%2Fb5da4f81d36c1445e62b4ec66cd3f8b3&title=The%20undo%20button%20is%20the%20easy%20part%3A%20a%204%20KB%20runtime%20for%20optimistic%2C%20undoable%20mutations
- **r/reactjs** (lead with the framework guide): https://www.reddit.com/r/reactjs/submit?url=https%3A%2F%2Fgithub.com%2Fsharma-open-source%2Fundoable%2Fblob%2Fmain%2Fdocs%2Fframeworks.md&title=Optimistic%20undo%20in%20React%20without%20a%20state%20library%20%E2%80%94%20apply()%20returns%20its%20own%20inverse
- **r/accessibility** (lead with the findings, not the package): https://www.reddit.com/r/accessibility/submit?url=https%3A%2F%2Fgithub.com%2Fsharma-open-source%2Fundoable%2Fblob%2Fmain%2Fexamples%2FFINDINGS.md&title=Three%20focus%20defects%20my%20acceptance%20matrix%20passed%20straight%20through

For Show HN, point the URL at the repo, not the post — HN prefers the source. Put the post link in the first comment.

## Short-form copy

**X / Mastodon / Bluesky (~270 chars)**

> Shipped `@sharma/undoable` — a 4 KB runtime for optimistic, undoable mutations. apply() mutates local state and returns its own inverse; commit() persists it. No UI, no deps.
>
> The write-up is mostly about the three focus defects my test matrix passed straight through.
>
> https://github.com/sharma-open-source/undoable

**LinkedIn**

> I extracted the "archive → toast → Undo → persist" mechanism every product ends up reimplementing, and published it as `@sharma/undoable` (MIT, zero dependencies, ~4 KB).
>
> The interesting part was not the runtime. I built it to a written spec with a 16-row acceptance matrix, and it passed. Then I drove a real integration headlessly and scored 19 of 22 — all three failures being the runtime implementing the spec correctly, and the spec being wrong. Every one of them was a focus or screen-reader defect that the matrix could not see.
>
> One of them mattered more than the rest: the focus_loss metric read zero the whole time focus was being lost. A metric that is wrong in the same direction as the bug is worse than no metric.
>
> Write-up and source: https://github.com/sharma-open-source/undoable

**Reddit / HN first comment**

> Author here. The short version: one primitive, `apply` returns its inverse and `commit` persists it. `ActionDef` throws on any key other than those two, and `configure()` has exactly one option — that constraint is the whole design, because the failure mode of libraries in this space is config growth.
>
> The part I would actually like feedback on is in FINDINGS.md. Three of five defects were focus behaviour that my acceptance matrix passed, and the one I could not fix cleanly is that the outcome announcements are hardcoded English — every escape route is blocked by a non-goal. If someone has solved that without adding a config key, I want to hear it.

## Still open, and worth asking for directly

Whether NVDA, JAWS and VoiceOver re-announce when `aria-live` politeness flips on an existing region. Chromium says the a11y tree updates; that is necessary, not sufficient. Ask for it explicitly in the a11y communities — it is a better hook than "I made a library".
