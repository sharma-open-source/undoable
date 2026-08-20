/* Integration harness for `undoable`.
 *
 * Loaded as a plain <script> after dist/undoable.global.js — no bundler, no
 * init call. Everything visual in this file is an event listener; the
 * runtime itself renders nothing.
 */
(function () {
  'use strict';

  var U = window.undoable;
  if (!U) throw new Error('undoable global build did not load. Run: npm run build');

  // ---------------------------------------------------------------- data

  var SEED = [
    { id: 't1', title: 'Draft the migration note' },
    { id: 't2', title: 'Review focus fallback order' },
    { id: 't3', title: 'Delete the hand-rolled toast queue' },
    { id: 't4', title: 'Measure time_to_apply on the list view' },
    { id: 't5', title: 'Ask design about the undo copy' },
    { id: 't6', title: 'Wire flushPending into the router' },
  ];

  var tasks = SEED.slice();
  var selection = new Set();

  var settings = { latency: 600, failureRate: 0, renderMode: 'keyed', renderTiming: 'sync' };

  // A stand-in server. Rejects at the configured rate so desync and failed
  // are reachable by hand rather than only in tests.
  function fakeApi(what) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (Math.random() * 100 < settings.failureRate) {
          reject(new Error('server rejected: ' + what));
        } else {
          resolve();
        }
      }, settings.latency);
    });
  }

  function move(arr, from, to) {
    var item = arr.splice(from, 1)[0];
    arr.splice(to, 0, item);
  }

  // ------------------------------------------------------------- actions

  // 1. Removal — markup-driven, argument is a raw id string.
  U.defineAction('archiveTask', {
    apply: function (id) {
      var index = tasks.findIndex(function (t) { return t.id === id; });
      if (index === -1) return function () {};
      var task = tasks.splice(index, 1)[0];
      selection.delete(id);
      scheduleRender();
      return function () {
        tasks.splice(index, 0, task);
        scheduleRender();
      };
    },
    commit: function (id) { return fakeApi('archive ' + id); },
  });

  // 2. Reorder — programmatic, argument is structured. Never reaches the
  //    markup path, so the raw-string constraint on data-undoable-arg
  //    never binds it.
  U.defineAction('reorderTask', {
    apply: function (a) {
      move(tasks, a.from, a.to);
      scheduleRender();
      return function () {
        move(tasks, a.to, a.from);
        scheduleRender();
      };
    },
    commit: function (a) { return fakeApi('reorder ' + a.id + ' -> ' + a.to); },
  });

  // 3. Bulk over a multi-selection — one action, one commit, composite revert.
  U.defineAction('archiveSelected', {
    apply: function (ids) {
      var removed = ids
        .map(function (id) {
          var index = tasks.findIndex(function (t) { return t.id === id; });
          return index === -1 ? null : { index: index, task: tasks[index] };
        })
        .filter(Boolean)
        .sort(function (a, b) { return b.index - a.index; });

      removed.forEach(function (r) { tasks.splice(r.index, 1); });
      ids.forEach(function (id) { selection.delete(id); });
      scheduleRender();

      return function () {
        removed
          .slice()
          .reverse()
          .forEach(function (r) { tasks.splice(r.index, 0, r.task); });
        scheduleRender();
      };
    },
    commit: function (ids) { return fakeApi('bulk archive ' + ids.length); },
  });

  // -------------------------------------------------------------- render

  var list = document.getElementById('list');

  function createRow(task) {
    var li = document.createElement('li');
    li.className = 'row';
    li.dataset.id = task.id;
    li.setAttribute('data-undoable', 'archiveTask');
    li.setAttribute('data-undoable-arg', task.id);

    var check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'sel';

    var ord = document.createElement('span');
    ord.className = 'ord';

    var title = document.createElement('span');
    title.className = 'title';

    var up = document.createElement('button');
    up.type = 'button';
    up.className = 'up';
    up.textContent = '↑';

    var down = document.createElement('button');
    down.type = 'button';
    down.className = 'down';
    down.textContent = '↓';

    var archive = document.createElement('button');
    archive.type = 'button';
    archive.setAttribute('data-undoable-trigger', '');
    archive.textContent = 'Archive';

    li.append(check, ord, title, up, down, archive);
    return li;
  }

  function updateRow(li, task, index) {
    li.setAttribute('data-undoable-arg', task.id);
    li.setAttribute('data-undoable-label', '“' + task.title + '” archived');

    var check = li.querySelector('.sel');
    check.checked = selection.has(task.id);
    check.setAttribute('aria-label', 'Select ' + task.title);

    li.querySelector('.ord').textContent = String(index + 1);
    li.querySelector('.title').textContent = task.title;

    var up = li.querySelector('.up');
    up.disabled = index === 0;
    up.setAttribute('aria-label', 'Move ' + task.title + ' up');

    var down = li.querySelector('.down');
    down.disabled = index === tasks.length - 1;
    down.setAttribute('aria-label', 'Move ' + task.title + ' down');

    li.querySelector('[data-undoable-trigger]').setAttribute(
      'aria-label', 'Archive ' + task.title,
    );
  }

  function render() {
    if (settings.renderMode === 'blowaway') {
      // The naive strategy: every node is thrown away and rebuilt. Included
      // because plenty of real apps do exactly this.
      list.replaceChildren();
    }

    var existing = new Map();
    Array.prototype.forEach.call(list.children, function (li) {
      if (li.dataset.id) existing.set(li.dataset.id, li);
    });

    var next = tasks.map(function (task, index) {
      var li = existing.get(task.id) || createRow(task);
      existing.delete(task.id);
      updateRow(li, task, index);
      return li;
    });

    existing.forEach(function (li) { li.remove(); });

    // Insert in place rather than replaceChildren(): the latter detaches
    // every surviving node, which blurs whatever the user was focused on.
    var cursor = list.firstElementChild;
    next.forEach(function (li) {
      if (cursor === li) {
        cursor = cursor.nextElementSibling;
        return;
      }
      list.insertBefore(li, cursor);
    });

    Array.prototype.slice.call(list.querySelectorAll('.empty')).forEach(function (el) {
      el.remove();
    });
    if (tasks.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing left. Undo, or reset the data.';
      list.append(empty);
    }

    document.getElementById('archiveSelected').disabled = selection.size === 0;
  }

  var renderQueued = false;
  function scheduleRender() {
    if (settings.renderTiming === 'sync') {
      render();
      return;
    }
    // React-like: state changes now, DOM catches up a frame later. This is
    // the case spec §6 exists for.
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  // ---------------------------------------------------- app interactions

  list.addEventListener('change', function (event) {
    var check = event.target.closest('.sel');
    if (!check) return;
    var id = check.closest('.row').dataset.id;
    if (check.checked) selection.add(id); else selection.delete(id);
    render();
  });

  list.addEventListener('click', function (event) {
    var button = event.target.closest('.up, .down');
    if (!button) return;
    var id = button.closest('.row').dataset.id;
    var from = tasks.findIndex(function (t) { return t.id === id; });
    var to = button.classList.contains('up') ? from - 1 : from + 1;
    if (to < 0 || to >= tasks.length) return;
    U.runAction('reorderTask', { id: id, from: from, to: to }, { trigger: button });
  });

  document.getElementById('archiveSelected').addEventListener('click', function (event) {
    if (selection.size === 0) return;
    U.runAction('archiveSelected', Array.from(selection), { trigger: event.currentTarget });
  });

  document.getElementById('selectAll').addEventListener('click', function () {
    tasks.forEach(function (t) { selection.add(t.id); });
    render();
  });

  document.getElementById('reset').addEventListener('click', function () {
    tasks = SEED.slice();
    selection.clear();
    render();
  });

  // ------------------------------------------------------------- toast UI
  //
  // The entire undo affordance is a listener on undoable:pending. Delete
  // this block and the actions still work — they are just silent.

  var toasts = document.getElementById('toasts');
  var undoToast = null;

  function clearUndoToast() {
    if (undoToast) {
      undoToast.remove();
      undoToast = null;
    }
  }

  document.addEventListener('undoable:pending', function (event) {
    var detail = event.detail;
    clearUndoToast();

    var el = document.createElement('div');
    el.className = 'toast';

    var msg = document.createElement('div');
    msg.className = 'msg';
    var text = document.createElement('div');
    text.textContent = detail.label;
    var bar = document.createElement('div');
    bar.className = 'bar';
    msg.append(text, bar);

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Undo';
    button.addEventListener('click', function () { detail.undo(); });

    el.append(msg, button);
    toasts.append(el);
    undoToast = el;

    var started = Date.now();
    var total = Math.max(1, detail.expiresAt - started);
    (function tick() {
      if (undoToast !== el) return;
      var left = Math.max(0, detail.expiresAt - Date.now());
      bar.style.width = (left / total) * 100 + '%';
      if (left > 0) requestAnimationFrame(tick);
    })();
  });

  ['committed', 'reverted'].forEach(function (type) {
    document.addEventListener('undoable:' + type, clearUndoToast);
  });

  ['failed', 'desync'].forEach(function (type) {
    document.addEventListener('undoable:' + type, function (event) {
      clearUndoToast();
      var el = document.createElement('div');
      el.className = 'toast is-error';
      var msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent =
        type === 'desync'
          ? 'Out of sync — refetch needed. ' + String(event.detail.error)
          : 'Failed' + (event.detail.reverted ? ' (change undone). ' : '. ') +
            String(event.detail.error);
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', function () { el.remove(); });
      el.append(msg, dismiss);
      toasts.append(el);
      setTimeout(function () { el.remove(); }, 6000);
    });
  });

  // ---------------------------------------------------------------- log

  var log = document.getElementById('log');

  function describe(type, detail) {
    if (type === 'pending') return detail.name + ' — ' + JSON.stringify(detail.arg);
    if (type === 'failed') return detail.name + ' reverted=' + detail.reverted + ' ' + detail.error;
    if (type === 'desync') return detail.name + ' STALE REVERT NOT CALLED — ' + detail.error;
    return detail.name + ' — ' + JSON.stringify(detail.arg);
  }

  ['pending', 'committed', 'reverted', 'failed', 'desync'].forEach(function (type) {
    document.addEventListener('undoable:' + type, function (event) {
      var li = document.createElement('li');
      var time = document.createElement('span');
      time.className = 't';
      time.textContent = new Date().toISOString().slice(14, 23);
      var kind = document.createElement('span');
      kind.className = 'k k-' + type;
      kind.textContent = type;
      var body = document.createElement('span');
      body.textContent = describe(type, event.detail);
      li.append(time, kind, body);
      log.prepend(li);
      while (log.children.length > 200) log.lastElementChild.remove();
    });
  });

  // ------------------------------------------------------- focus + metrics

  function describeActive() {
    var el = document.activeElement;
    if (!el || el === document.body) return 'body — FOCUS LOST';
    if (!document.contains(el)) return 'detached — FOCUS LOST';
    var name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 32);
    return el.tagName.toLowerCase() + (name ? ' “' + name + '”' : '') +
      (el.id ? '#' + el.id : '');
  }

  document.addEventListener('undoable:pending', function () {
    // Two frames out: one for the app's render, one for the runtime's
    // focus restoration.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var out = document.getElementById('focusNow');
        out.textContent = describeActive();
        out.style.color = /FOCUS LOST/.test(out.textContent) ? 'var(--danger)' : '';
      });
    });
  });

  var METRIC_ROWS = [
    ['total actions', function (m) { return m.total; }],
    ['committed', function (m) { return m.committed; }],
    ['reverted', function (m) { return m.reverted; }],
    ['failed', function (m) { return m.failed; }],
    ['desync', function (m) { return m.desync; }],
    ['orphaned_commits', function (m) { return m.orphanedCommits; }],
    ['undo_rate', function (m) { return (m.undoRate * 100).toFixed(1) + ' %'; }, function (m) { return m.undoRate > 0.15; }],
    ['desync_rate', function (m) { return (m.desyncRate * 100).toFixed(1) + ' %'; }, function (m) { return m.desyncRate > 0; }],
    ['commit_failure_rate', function (m) { return (m.commitFailureRate * 100).toFixed(1) + ' %'; }],
    ['time_to_apply p99', function (m) { return m.timeToApply.p99.toFixed(2) + ' ms'; }, function (m) { return m.timeToApply.p99 > 16; }],
    ['time_to_apply max', function (m) { return m.timeToApply.max.toFixed(2) + ' ms'; }],
  ];

  var metricsBody = document.getElementById('metrics');
  setInterval(function () {
    var m = U.getMetrics();
    metricsBody.replaceChildren.apply(
      metricsBody,
      METRIC_ROWS.map(function (row) {
        var tr = document.createElement('tr');
        if (row[2] && row[2](m)) tr.className = 'bad';
        var label = document.createElement('td');
        label.textContent = row[0];
        var value = document.createElement('td');
        value.textContent = String(row[1](m));
        tr.append(label, value);
        return tr;
      }),
    );
    document.getElementById('focusLoss').textContent = String(m.focusLoss);
    document.getElementById('focusLossRow').className = m.focusLoss > 0 ? 'bad' : '';
  }, 250);

  // ------------------------------------------------------------ controls

  function wireRange(id, outId, unit, onChange) {
    var input = document.getElementById(id);
    var out = document.getElementById(outId);
    function sync() {
      out.textContent = input.value + ' ' + unit;
      onChange(Number(input.value));
    }
    input.addEventListener('input', sync);
    sync();
  }

  wireRange('latency', 'latencyOut', 'ms', function (v) { settings.latency = v; });
  wireRange('failure', 'failureOut', '%', function (v) { settings.failureRate = v; });
  wireRange('window', 'windowOut', 'ms', function (v) { U.configure({ window: v }); });

  document.getElementById('renderMode').addEventListener('change', function (event) {
    settings.renderMode = event.target.value;
  });
  document.getElementById('renderTiming').addEventListener('change', function (event) {
    settings.renderTiming = event.target.value;
  });

  render();
})();
