import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regenerates site/index.html (GitHub Pages) and post.html from one template.
const dir = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://sharma-open-source.github.io/undoable/';
const REPO = 'https://github.com/sharma-open-source/undoable';
const TITLE = 'The undo button is the easy part';
// What a search result shows. The essay title is the hook; the tail carries
// the words someone actually types when they have this problem.
const PAGE_TITLE = 'The undo button is the easy part — optimistic UI undo in 4 KB';
// Kept under ~155 characters so search results do not truncate it.
const DESC =
  'A 4 KB, dependency-free runtime for optimistic UI with undo. ' +
  'apply() returns its inverse, commit() persists it — plus the window, rollback and focus.';
// Social cards have more room than a search result does.
const SOCIAL_DESC =
  'A 4 KB runtime for optimistic, undoable mutations — and the five defects ' +
  'that only showed up once a keyboard used it. Works with React, Vue, Angular and Svelte.';
const PUBLISHED = '2026-08-20';

// Answers already written in the page, restated for structured data. Keep the
// text in sync with the "Common questions" section — mismatched FAQ markup is
// worse than none.
const faq = [
  [
    'Does it work with React, Vue, Angular or Svelte?',
    'All four. The runtime knows nothing about your framework — apply() mutates your state and returns the inverse, which is a setState call in React and Angular signals, and a plain mutation in Vue and Svelte 5. The React path is executed end to end in the test suite; the other three are type-correct but not executed.',
  ],
  [
    'How is this different from optimistic updates in TanStack Query or SWR?',
    'Different layer, and they compose. Those libraries fire the request immediately and roll the cache back if it rejects. undoable owns the window before the request is sent: it holds the commit for five seconds, hands you an undo(), moves focus, and announces the outcome. If you already have a mutation hook, it becomes the body of commit.',
  ],
  [
    'Does it support multi-level undo, or redo?',
    'No, and it will not. One action is undoable at a time; starting a second one flushes the first into its commit. Redo, an undo stack, and per-action configuration are all declared non-goals.',
  ],
  [
    'Is it accessible out of the box?',
    'Partly. The runtime manages focus after the DOM changes and announces every outcome through a single aria-live region, with the politeness switched per state. What it does not give you is a reachable undo control — the toast is yours. The announcement strings are also English-only.',
  ],
  [
    'How big is it, and what does it depend on?',
    'The ESM build is about 13 KB unminified and just over 4 KB gzipped, with zero runtime dependencies. TypeScript types ship with it. Node 20 or newer for the tooling; any modern browser at runtime.',
  ],
  [
    'Do I need a build step or a bundler?',
    'No. One script tag is a complete integration, because binding is delegated from document and there is no init call. Use the /dist/undoable.global.js path — the bare package URL resolves to the CommonJS build and throws "module is not defined" in a browser.',
  ],
  [
    'Is it safe to import in a server-rendered app?',
    'Yes. Next.js, Nuxt, SvelteKit and Angular Universal are all fine. The module binds on import, but the binding is guarded on typeof document and no-ops on the server.',
  ],
];

const runtime = readFileSync(dir + '/../../dist/undoable.global.js', 'utf8');
if (runtime.includes('</script')) throw new Error('runtime contains a script close tag');

const template = readFileSync(dir + '/page.template.html', 'utf8');
const page = template.replace('/*RUNTIME*/', runtime);

// 1. Artifact build — the host supplies doctype, head and a CSS reset.
writeFileSync(dir + '/post.html', page);

// 2. Standalone build for GitHub Pages — same body, own head, own reset.
const body = page.replace(/^<title>.*<\/title>\n\n/, '');
const favicon =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>↩️</text></svg>";

const jsonld = [
  {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: TITLE,
    alternativeHeadline: PAGE_TITLE,
    description: DESC,
    inLanguage: 'en',
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    mainEntityOfPage: { '@type': 'WebPage', '@id': SITE },
    image: SITE + 'og.png',
    author: { '@type': 'Person', name: 'Sharma Sathananthan' },
    publisher: { '@type': 'Person', name: 'Sharma Sathananthan' },
    about: {
      '@type': 'SoftwareSourceCode',
      name: '@sharma/undoable',
      description:
        'A runtime for optimistic, undoable mutations. One primitive, no UI, no dependencies.',
      codeRepository: REPO,
      programmingLanguage: ['TypeScript', 'JavaScript'],
      runtimePlatform: ['Browser', 'Node.js'],
      license: 'https://opensource.org/licenses/MIT',
      version: '0.1.1',
      downloadUrl: 'https://www.npmjs.com/package/@sharma/undoable',
      keywords:
        'optimistic ui, undo, optimistic updates, rollback, accessibility, focus management, aria-live, javascript, typescript',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(([question, answer]) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  },
];

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE_TITLE}</title>
<meta name="description" content="${DESC}">
<meta name="author" content="Sharma Sathananthan">
<link rel="canonical" href="${SITE}">
<link rel="icon" href="${favicon.replace(/"/g, '&quot;')}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="@sharma/undoable">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${SOCIAL_DESC}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The undo button is the easy part — @sharma/undoable 0.1.1">
<meta property="article:published_time" content="${PUBLISHED}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${SOCIAL_DESC}">
<meta name="twitter:image" content="${SITE}og.png">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
  /* The artifact host ships a reset; standing on our own here. */
  body { margin: 0; }
  h1, h2, h3, p, pre, blockquote, ul, ol, figure { margin: 0; }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}</body>
</html>
`;

mkdirSync(dir + '/site', { recursive: true });
writeFileSync(dir + '/site/index.html', standalone);
writeFileSync(dir + '/site/.nojekyll', '');

// A sitemap in a project subdirectory is valid for URLs under that path, which
// is all this site has. /robots.txt belongs to the sharma-open-source.github.io
// root repo and cannot be set from here.
writeFileSync(
  dir + '/site/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${PUBLISHED}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
);

// 3. Local preview of the artifact build, for parity checks.
writeFileSync(
  dir + '/preview.html',
  '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>' +
    page +
    '</body></html>',
);

console.log('post.html', page.length, '· site/index.html', standalone.length);
