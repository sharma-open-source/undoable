/* Real-browser probe. Answers the questions jsdom structurally cannot:
 * whether focus survives a DOM move, and whether the engine blurs an element
 * when it is disabled.
 *
 *   npm run probe:browser
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5199;
const URL = `http://localhost:${PORT}/examples/index.html`;

const findings = [];
function report(name, detail, ok) {
  findings.push({ name, detail, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}\n        ${detail}`);
}

const server = spawn(process.execPath, ['examples/serve.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch();

/** Two frames: one for the app's render, one for the runtime's restoration. */
const SETTLE = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;

async function fresh() {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction('!!window.undoable');
  return page;
}

function describeActive(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY (focus lost)';
    if (!document.contains(el)) return 'DETACHED (focus lost)';
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 34);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${label ? ` "${label}"` : ''}` +
      (el.hasAttribute('tabindex') ? ` [tabindex=${el.getAttribute('tabindex')}]` : '') +
      (el.disabled ? ' DISABLED' : '');
  });
}

// ---------------------------------------------------------------- Q1: DOM move

{
  const page = await fresh();
  const before = await page.evaluate(async () => {
    const button = document.querySelector('[data-id="t3"] .down');
    button.focus();
    const wasFocused = document.activeElement === button;
    button.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { wasFocused, stillFocused: document.activeElement === button };
  });
  report('Q1. focus survives insertBefore move of the focused node',
    `focused before=${before.wasFocused}, after=${before.stillFocused} → ${await describeActive(page)}`,
    before.stillFocused);

  const loss = await page.evaluate(() => window.undoable.getMetrics().focusLoss);
  report('Q1b. focus_loss after reorder', String(loss), loss === 0);
  await page.close();
}

// ------------------------------------------------------- Q2: blur on disable

{
  const page = await fresh();
  const result = await page.evaluate(async () => {
    const button = document.getElementById('reset');
    button.focus();
    const before = document.activeElement === button;
    button.disabled = true;
    await new Promise((r) => requestAnimationFrame(r));
    return { before, afterIsBody: document.activeElement === document.body };
  });
  report('Q2. engine blurs an element when it is disabled',
    `focused=${result.before}, activeElement became body=${result.afterIsBody}`,
    result.afterIsBody);
  await page.close();
}

// --------------------------------------------- the F1/F2/F3 fixes, for real

{
  const page = await fresh();
  await page.evaluate(async () => {
    const t = document.querySelector('[data-id="t3"] [data-undoable-trigger]');
    t.focus();
    t.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const desc = await describeActive(page);
  report('F1. archive middle row → equivalent control in next row', desc, /^button "Archive /.test(desc));
  await page.close();
}

{
  const page = await fresh();
  await page.selectOption('#renderMode', 'blowaway');
  await page.evaluate(async () => {
    const t = document.querySelector('[data-id="t3"] [data-undoable-trigger]');
    t.focus();
    t.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const desc = await describeActive(page);
  report('F2. innerHTML rebuild → container fallback', desc, !/focus lost/i.test(desc));
  await page.close();
}

{
  const page = await fresh();
  await page.evaluate(async () => {
    document.getElementById('selectAll').click();
    const b = document.getElementById('archiveSelected');
    b.focus();
    b.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const desc = await describeActive(page);
  const loss = await page.evaluate(() => window.undoable.getMetrics().focusLoss);
  report('F3. bulk disables its own trigger → focus moves off it', desc,
    !/focus lost|DISABLED/.test(desc));
  report('F3b. focus_loss', String(loss), loss === 0);
  await page.close();
}

{
  const page = await fresh();
  await page.evaluate(async () => {
    const t = document.querySelector('#list .row:last-child [data-undoable-trigger]');
    t.focus();
    t.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const desc = await describeActive(page);
  report('F1b. archive last row → preceding row, not the container', desc,
    !/focus lost/i.test(desc));
  await page.close();
}

// ------------------------------------- Q3: what the a11y tree actually shows

{
  const page = await fresh();

  const polite = await page.evaluate(async () => {
    const region = () => document.querySelector('[data-undoable-live-region]');
    document.querySelector('[data-id="t1"] [data-undoable-trigger]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return `aria-live=${region().getAttribute('aria-live')} text="${region().textContent}"`;
  });
  report('Q3. pending announces politely', polite, /aria-live=polite/.test(polite));

  const assertive = await page.evaluate(async () => {
    const region = () => document.querySelector('[data-undoable-live-region]');
    for (const [id, value] of [['failure', '100'], ['latency', '0']]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.undoable.configure({ window: 30 });

    document.querySelector('[data-id="t2"] [data-undoable-trigger]').click();
    await new Promise((r) => setTimeout(r, 400));
    return `aria-live=${region().getAttribute('aria-live')} text="${region().textContent}"`;
  });
  report('Q3b. failure flips the same region to assertive with outcome wording',
    assertive,
    /aria-live=assertive/.test(assertive) && /could not be saved/.test(assertive));

  // What the engine exposes to assistive tech, rather than what the DOM says.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');

  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-undoable-live-region]',
  });
  const partial = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const ours = partial.nodes.find((n) => n.properties?.some((p) => p.name === 'live'));
  const ourLive = ours?.properties.find((p) => p.name === 'live')?.value?.value;
  report('Q3c. the runtime region is exposed to AT as assertive',
    `live=${ourLive ?? 'NOT EXPOSED'} role=${ours?.role?.value ?? '?'}`,
    ourLive === 'assertive');

  // Not a pass/fail on the runtime — an integration hazard worth seeing.
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const allLive = nodes.filter((n) =>
    n.properties?.some((p) => p.name === 'live' && p.value?.value && p.value.value !== 'off'),
  );
  console.log(`note  page has ${allLive.length} live regions total ` +
    `(${allLive.length - 1} belong to the host app, not the runtime)`);

  await page.close();
}

await browser.close();
server.kill();

console.log('\n--- summary ---');
console.log(`${findings.filter((f) => f.ok).length}/${findings.length} checks passed in real Chromium`);
for (const f of findings.filter((f) => !f.ok)) console.log(`  ✗ ${f.name}: ${f.detail}`);
process.exit(findings.every((f) => f.ok) ? 0 : 1);
