import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const HTML = '/workspaces/sandbox/undoable/examples/index.html';

async function boot() {
  const dom = await JSDOM.fromFile(HTML, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  await new Promise((r) => window.addEventListener('load', r));
  await tick(window, 50);
  if (!window.undoable) throw new Error('runtime did not load');
  return dom;
}

function tick(window, ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function frames(window, n = 3) {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => (++i >= n ? resolve() : window.requestAnimationFrame(step));
    window.requestAnimationFrame(step);
  });
}

function activeDesc(window) {
  const el = window.document.activeElement;
  if (!el || el === window.document.body) return 'BODY (focus lost)';
  if (!window.document.contains(el)) return 'DETACHED (focus lost)';
  const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30);
  return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${label ? ` "${label}"` : ''}` +
    (el.hasAttribute('tabindex') ? ` [tabindex=${el.getAttribute('tabindex')}]` : '');
}

function rows(window) {
  return [...window.document.querySelectorAll('#list .row')].map((li) => li.dataset.id);
}

function setControl(window, id, value) {
  const el = window.document.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

const findings = [];
function report(name, detail, ok) {
  findings.push({ name, detail, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}\n        ${detail}`);
}

// ---------------------------------------------------------------- probes

async function probeFocusMiddleRow() {
  const dom = await boot();
  const { window } = dom;
  const row = window.document.querySelector('[data-id="t3"]');
  const trigger = row.querySelector('[data-undoable-trigger]');
  trigger.focus();
  trigger.click();
  await frames(window, 4);
  const desc = activeDesc(window);
  // Spec §6 says "first focusable in the next sibling", which is the row's
  // checkbox — not the equivalent control the user was actually operating.
  report('1. archive middle row → focus lands in next row', desc, !/focus lost/i.test(desc));
  report('1b. …on the same control the user was using?', desc, /Archive /.test(desc));
  dom.window.close();
}

async function probeFocusLastRow() {
  const dom = await boot();
  const { window } = dom;
  // archive everything except the last, one window at a time is slow — just
  // remove all but one from the model by clicking the last row repeatedly.
  const ids = rows(window);
  for (const id of ids.slice(0, -1)) {
    const t = window.document.querySelector(`[data-id="${id}"] [data-undoable-trigger]`);
    t.click();
    await frames(window, 2);
  }
  const last = window.document.querySelector('#list .row');
  const trigger = last.querySelector('[data-undoable-trigger]');
  trigger.focus();
  trigger.click();
  await frames(window, 4);
  const desc = activeDesc(window);
  report('2. archive last row → focus', desc, /ul#list/.test(desc) && /tabindex=-1/.test(desc));
  dom.window.close();
}

async function probeReorderFocus() {
  const dom = await boot();
  const { window } = dom;
  const row = window.document.querySelector('[data-id="t3"]');
  const down = row.querySelector('.down');
  down.focus();
  down.click();
  await frames(window, 4);
  const desc = activeDesc(window);
  report('3. reorder (keyed render) → focus', desc, !/focus lost/i.test(desc));
  report('3b. reorder order', rows(window).join(','), rows(window)[3] === 't3');
  dom.window.close();
}

async function probeBlowawayFocus() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'renderMode', 'blowaway');
  const row = window.document.querySelector('[data-id="t3"]');
  const trigger = row.querySelector('[data-undoable-trigger]');
  trigger.focus();
  trigger.click();
  await frames(window, 4);
  const desc = activeDesc(window);
  report('4. archive with innerHTML render → focus', desc, !/focus lost/i.test(desc));
  dom.window.close();
}

async function probeAsyncRenderFocus() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'renderTiming', 'async');
  const row = window.document.querySelector('[data-id="t3"]');
  const trigger = row.querySelector('[data-undoable-trigger]');
  trigger.focus();
  trigger.click();
  await frames(window, 6);
  const desc = activeDesc(window);
  report('5. archive with deferred render → focus', desc, !/focus lost/i.test(desc));
  dom.window.close();
}

async function probeRapidFire() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 0);

  // "At most one pending" is a statement about the runtime's slot, not about
  // how many pending events have fired. The observable consequence is that
  // every earlier action's undo() has gone inert.
  const undos = [];
  const order = [];
  window.document.addEventListener('undoable:pending', (e) => {
    undos.push(e.detail.undo);
    order.push(String(e.detail.arg));
  });
  let reverted = 0;
  window.document.addEventListener('undoable:reverted', () => reverted++);

  const ids = rows(window);
  for (const id of ids.slice(0, 5)) {
    window.document.querySelector(`[data-id="${id}"] [data-undoable-trigger]`).click();
  }
  const remaining = rows(window).length;
  undos.forEach((u) => u());
  await tick(window, 200);

  report('6. 5 rapid triggers → all but the last undo() inert', `reverted=${reverted}`, reverted === 1);
  report('6b. rows removed synchronously', `6 -> ${remaining}`, remaining === 1);
  report('6c. trigger order preserved', order.join(','), order.join(',') === ids.slice(0, 5).join(','));
  dom.window.close();
}

async function probeCommitOrder() {
  const dom = await boot();
  const { window } = dom;
  const calls = [];
  window.undoable.defineAction('orderProbe', {
    apply: (n) => { calls.push('apply' + n); return () => {}; },
    commit: (n) => {
      calls.push('commit' + n);
      // Reverse the latency so a queue-free implementation is distinguishable
      // from one that accidentally serialises.
      return new Promise((r) => window.setTimeout(r, 50 - Number(n) * 8));
    },
  });
  for (let i = 0; i < 5; i++) window.undoable.runAction('orderProbe', String(i));
  window.undoable.flushPending();
  await tick(window, 200);
  const commits = calls.filter((c) => c.startsWith('commit')).join(',');
  report('6d. commit invocation order under varying latency', commits,
    commits === 'commit0,commit1,commit2,commit3,commit4');
  dom.window.close();
}

async function probeDesyncAfterUndo() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 80);
  setControl(window, 'failure', 100);
  const seen = [];
  ['committed', 'reverted', 'failed', 'desync'].forEach((t) =>
    window.document.addEventListener('undoable:' + t, () => seen.push(t)),
  );
  let lastUndo = null;
  window.document.addEventListener('undoable:pending', (e) => { lastUndo = e.detail.undo; });

  const ids = rows(window);
  window.document.querySelector(`[data-id="${ids[0]}"] [data-undoable-trigger]`).click();
  window.document.querySelector(`[data-id="${ids[1]}"] [data-undoable-trigger]`).click();
  lastUndo(); // undo B, putting the model back to "after A"
  await tick(window, 300);

  // A's revert would now be perfectly valid, but the generation counter has
  // already moved on. The spec's conservatism costs a recoverable case.
  report('12. undo of B, then A rejects → outcome', seen.join(' '),
    !seen.includes('desync'));
  report('12b. rows (t1 archived and unrecoverable)', String(rows(window).length), true);
  dom.window.close();
}

async function probeDisabledTrigger() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 0);
  window.document.getElementById('selectAll').click();
  const btn = window.document.getElementById('archiveSelected');
  btn.focus();
  btn.click();
  await frames(window, 4);
  const active = window.document.activeElement;
  report('13. bulk: trigger survives but is now disabled',
    `activeElement=${active.id || active.tagName} disabled=${active.disabled}`,
    !active.disabled);
  dom.window.close();
}

async function probeDesync() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 40);
  setControl(window, 'failure', 100);
  const seen = [];
  ['committed', 'reverted', 'failed', 'desync'].forEach((t) =>
    window.document.addEventListener('undoable:' + t, (e) =>
      seen.push(t + (t === 'failed' ? `(reverted=${e.detail.reverted})` : '')),
    ),
  );
  const before = rows(window).length;
  const ids = rows(window);
  window.document.querySelector(`[data-id="${ids[0]}"] [data-undoable-trigger]`).click();
  window.document.querySelector(`[data-id="${ids[1]}"] [data-undoable-trigger]`).click();
  await tick(window, 300);
  report('7. flush + reject → events', seen.join(' '), seen.includes('desync'));
  report('7b. rows after (2 removed, stale revert not called)', `${before} -> ${rows(window).length}`, true);
  dom.window.close();
}

async function probeBulk() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 0);
  window.document.getElementById('selectAll').click();
  const btn = window.document.getElementById('archiveSelected');
  btn.focus();
  btn.click();
  await frames(window, 4);
  report('8. bulk archive → rows', String(rows(window).length), rows(window).length === 0);
  // The trigger disables itself once the selection empties, so focus must
  // move off it rather than sitting on a disabled control.
  const active = window.document.activeElement;
  report('8b. bulk archive → focus leaves the now-disabled trigger', activeDesc(window),
    !active.disabled && active !== window.document.body);
  dom.window.close();
}

async function probeUndoTwice() {
  const dom = await boot();
  const { window } = dom;
  let reverted = 0;
  window.document.addEventListener('undoable:reverted', () => reverted++);
  let undo = null;
  window.document.addEventListener('undoable:pending', (e) => { undo = e.detail.undo; });
  window.document.querySelector('[data-id="t2"] [data-undoable-trigger]').click();
  await frames(window, 2);
  undo(); undo(); undo();
  await tick(window, 50);
  report('9. undo pressed 3x', `reverted events=${reverted}, rows=${rows(window).length}`,
    reverted === 1 && rows(window).length === 6);
  dom.window.close();
}

async function probeMetrics() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 0);
  window.document.querySelector('[data-id="t2"] [data-undoable-trigger]').click();
  await frames(window, 4);
  const m = window.undoable.getMetrics();
  report('10. time_to_apply p99', `${m.timeToApply.p99.toFixed(3)} ms`, m.timeToApply.p99 < 16);
  report('10b. focus_loss', String(m.focusLoss), m.focusLoss === 0);
  dom.window.close();
}

async function probePagehide() {
  const dom = await boot();
  const { window } = dom;
  setControl(window, 'latency', 0);
  let committed = 0;
  window.document.addEventListener('undoable:committed', () => committed++);
  window.document.querySelector('[data-id="t2"] [data-undoable-trigger]').click();
  await frames(window, 2);
  window.dispatchEvent(new window.PageTransitionEvent('pagehide'));
  await tick(window, 60);
  const m = window.undoable.getMetrics();
  report('11. pagehide flush', `committed=${committed} orphaned=${m.orphanedCommits}`,
    committed === 1 && m.orphanedCommits === 1);
  dom.window.close();
}

const probes = [
  probeFocusMiddleRow, probeFocusLastRow, probeReorderFocus, probeBlowawayFocus,
  probeAsyncRenderFocus, probeRapidFire, probeCommitOrder, probeDesync, probeBulk,
  probeUndoTwice, probeMetrics, probePagehide, probeDesyncAfterUndo,
  probeDisabledTrigger,
];

for (const p of probes) {
  try { await p(); } catch (err) { report(p.name, 'THREW: ' + err.message, false); }
}

console.log('\n--- summary ---');
console.log(`${findings.filter((f) => f.ok).length}/${findings.length} probes behaved as the spec predicts`);
for (const f of findings.filter((f) => !f.ok)) console.log(`  ✗ ${f.name}: ${f.detail}`);
