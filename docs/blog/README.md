# The launch post

The post lives at <https://sharma-open-source.github.io/undoable/>, served from
the `gh-pages` branch. This directory holds everything it is built from.

| File | What it is |
|---|---|
| [the-undo-button-is-the-easy-part.md](the-undo-button-is-the-easy-part.md) | The post, in Markdown. The canonical text. |
| [page.template.html](page.template.html) | The page: styles, copy, and the demo harness. Edit this. |
| [build.mjs](build.mjs) | Inlines `dist/undoable.global.js` into the template and writes `site/` and `post.html`. |
| [og.html](og.html) | The 1200×630 social card, screenshotted to `site/og.png`. |
| [verify.mjs](verify.mjs) | Drives the built page through Chromium and asserts the demo actually works. |
| [devto.md](devto.md), [hashnode.md](hashnode.md), [medium.md](medium.md) | The same post with each platform's front matter. |
| [social.md](social.md) | Prefilled submission links and short-form copy. |

`site/` is generated output. It is not committed on `main` — it is the payload
of the `gh-pages` branch.

## Rebuilding

```sh
npm run build            # the page inlines dist/, so build the package first
node docs/blog/build.mjs
node docs/blog/verify.mjs
```

`verify.mjs` needs `npx playwright install chromium` once. It checks the things
that are easy to break silently: the optimistic removal, undo, rollback on a
rejected commit, `focus_loss` staying 0, focus landing on the next row's
trigger, the live region carrying the right outcome wording, and no horizontal
overflow at 380px. Pass a URL to run it against the deployed site instead of
the local build:

```sh
node docs/blog/verify.mjs https://sharma-open-source.github.io/undoable/
```

## Deploying

The page **inlines the published build**, which is what makes the demo real
rather than a mock — and also means the site holds a copy of `dist/`. Rebuild
and redeploy it whenever a new version is published, or the demo will quietly
be running old code.

```sh
git worktree add /tmp/undoable-site gh-pages
cp docs/blog/site/index.html docs/blog/site/sitemap.xml /tmp/undoable-site/
cd /tmp/undoable-site && git commit -am "Redeploy the post" && git push origin gh-pages
```

Keep `.nojekyll` and the IndexNow key file (`*.txt` at the site root) in place —
removing the key stops search-engine submissions from validating.

## Search

The build emits `TechArticle` and `FAQPage` JSON-LD, a canonical link, Open
Graph and Twitter card tags, and `sitemap.xml`. Two things it cannot do from
here:

- **`/robots.txt`** belongs to the `sharma-open-source.github.io` root repo, not
  this one. A project site cannot set it.
- **Google Search Console** needs an account login to verify ownership and
  submit the sitemap. Bing, Yandex, Seznam and Naver are already covered by the
  IndexNow key, which needs no account.

Keep the answers in `build.mjs`'s `faq` array in sync with the "Common
questions" section of the page. FAQ markup that disagrees with the visible text
is worse than none.
