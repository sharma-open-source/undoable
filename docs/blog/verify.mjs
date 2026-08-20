import { createRequire } from 'node:module';
const { chromium } = createRequire('/workspaces/sandbox/undoable/')('playwright');

const dir = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const url = process.argv[2] || 'file://' + dir + '/site/index.html';
const errors = [];

const browser = await chromium.launch();

async function open(scheme, theme) {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1000, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${scheme}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${scheme}] pageerror: ${e.message}`));
  await page.goto(url);
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return page;
}

const page = await open('light');
await page.waitForTimeout(300);

const rows0 = await page.locator('#list .row').count();

// 1. archive → optimistic removal + toast + pending event
await page.locator('.row').first().locator('button').click();
await page.waitForTimeout(120);
const rows1 = await page.locator('#list .row').count();
const toastVisible = await page.locator('#toast').isVisible();
const firstLog = (await page.locator('#log li').first().innerText()).replace(/\n/g, ' ');
const focused = await page.evaluate(() => {
  const a = document.activeElement;
  return a ? a.tagName + (a.textContent ? ':' + a.textContent.trim().slice(0, 12) : '') : 'none';
});

// 2. undo → restored
await page.locator('#toast-undo').click();
await page.waitForTimeout(120);
const rows2 = await page.locator('#list .row').count();
const afterUndo = (await page.locator('#log li').first().innerText()).replace(/\n/g, ' ');

// 3. commit success
await page.locator('.row').first().locator('button').click();
await page.waitForTimeout(5600);
const committed = (await page.locator('#log li').first().innerText()).replace(/\n/g, ' ');
const rows3 = await page.locator('#list .row').count();

// 4. failure path → rollback
await page.locator('#fail').check();
await page.locator('.row').first().locator('button').click();
await page.waitForTimeout(5800);
const failed = (await page.locator('#log li').first().innerText()).replace(/\n/g, ' ');
const rows4 = await page.locator('#list .row').count();

// 5. runtime instrumentation agrees
const metrics = await page.evaluate(() => window.undoable.getMetrics());

// 6. no horizontal overflow at narrow width
await page.setViewportSize({ width: 380, height: 800 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

await page.setViewportSize({ width: 1000, height: 900 });
await page.screenshot({ path: dir + '/shot-light.png', fullPage: false });

const dark = await open('dark', 'dark');
await dark.waitForTimeout(300);
await dark.locator('.row').first().locator('button').click();
await dark.waitForTimeout(200);
await dark.screenshot({ path: dir + '/shot-dark.png', fullPage: false });

// live region present and switched to assertive on the failure
const liveRegions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-undoable-live-region]')].map((e) => ({
    live: e.getAttribute('aria-live'), text: e.textContent })));

console.log(JSON.stringify({
  rows: { start: rows0, afterArchive: rows1, afterUndo: rows2, afterCommit: rows3, afterFailure: rows4 },
  toastVisible, focused,
  log: { pending: firstLog, reverted: afterUndo, committed, failed },
  metrics, liveRegions, horizontalOverflowPx: overflow, errors,
}, null, 2));

await browser.close();
