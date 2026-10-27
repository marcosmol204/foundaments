/*
 * Interactive WiredTiger-style cache simulator (teaching model, not the real algorithm).
 *
 * Usage:
 *   <div id="sim"></div>
 *   <script src="../assets/cache-sim.js"></script>
 *   <script>CacheSim.mount('#sim', { capacity: 20, diskPages: 60 });</script>
 *
 * Model:
 *   - The cache holds `capacity` pages. Each page is clean or dirty.
 *   - Read/write a page: hit if cached, otherwise a miss reads it in from disk.
 *   - Background eviction workers run after every step. Above `target` (or `dirtyTarget`)
 *     they evict least-recently-used pages, earning `workerBudget` units per step.
 *     Clean eviction costs 1 unit (free the memory); dirty costs 2 (reconcile + write first).
 *   - At `trigger` (or `dirtyTrigger` before a write) the application thread must evict
 *     before it can continue: that is the latency your query pays.
 *   Real WiredTiger uses an approximate LRU (oldest third of sampled candidates).
 * Styles: .cs-* classes in assets/style.css.
 */
(function () {
  const DEFAULTS = { capacity: 20, diskPages: 60, target: 0.80, trigger: 0.95, dirtyTarget: 0.05, dirtyTrigger: 0.20, workerBudget: 1 };

  function mount(selector, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    const root = document.querySelector(selector);
    root.classList.add('cs-widget');
    const lim = {
      target: Math.floor(cfg.capacity * cfg.target), trigger: Math.floor(cfg.capacity * cfg.trigger),
      dTarget: Math.max(1, Math.floor(cfg.capacity * cfg.dirtyTarget)), dTrigger: Math.max(1, Math.floor(cfg.capacity * cfg.dirtyTrigger))
    };
    let cache, clock, stats, log, timer = null;

    function reset() {
      stop();
      cache = new Map(); // page -> { dirty, used }
      clock = 0; credit = 0;
      stats = { hits: 0, misses: 0, workerEvict: 0, appEvict: 0, diskWrites: 0 };
      log = [];
      render();
    }

    const dirtyCount = () => [...cache.values()].filter(p => p.dirty).length;
    function lru(onlyDirty) {
      let best = null;
      for (const [id, p] of cache) if ((!onlyDirty || p.dirty) && (!best || p.used < cache.get(best).used)) best = id;
      return best;
    }
    function evict(id, who) {
      const p = cache.get(id);
      if (p.dirty) stats.diskWrites++;
      cache.delete(id);
      stats[who === 'app' ? 'appEvict' : 'workerEvict']++;
      return p.dirty ? 2 : 1;
    }

    function access(id, write) {
      clock++;
      const notes = [];
      // Writers are throttled when dirty data hits the dirty trigger.
      if (write && dirtyCount() >= lim.dTrigger) {
        const v = lru(true); evict(v, 'app');
        notes.push(`dirty trigger: your thread reconciled page ${v} first`);
      }
      const hit = cache.has(id);
      if (hit) {
        stats.hits++;
      } else {
        stats.misses++;
        if (cache.size >= lim.trigger) {
          const v = lru(false), dirty = cache.get(v).dirty; evict(v, 'app');
          notes.push(`cache at trigger: your thread evicted page ${v}${dirty ? ' (dirty: write first)' : ''}`);
        }
        cache.set(id, { dirty: false, used: 0 });
      }
      const p = cache.get(id);
      p.used = clock;
      if (write) p.dirty = true;
      log.unshift(`${write ? 'write' : 'read'} ${id} · ${hit ? 'hit' : 'miss: read from disk'}${notes.length ? ' · ' + notes.join('; ') : ''}`);
      workers();
      render(id);
    }

    // Workers earn `workerBudget` units per step; unspent credit carries over while there is work.
    let credit = 0;
    function workers() {
      credit += cfg.workerBudget;
      for (;;) {
        const v = dirtyCount() > lim.dTarget ? lru(true) : cache.size > lim.target ? lru(false) : null;
        if (v === null) { credit = 0; return; }
        const cost = cache.get(v).dirty ? 2 : 1;
        if (credit < cost) return;
        credit -= evict(v, 'worker');
      }
    }

    const step = access;

    // Scenarios: each yields a list of [page, write] steps, played on a timer.
    const rnd = n => Math.floor(Math.random() * n);
    const SCENARIOS = {
      'Hot set fits (reads 0–9)': () => Array.from({ length: 60 }, () => [rnd(10), false]),
      'Scan bigger than cache ×2': () => [...Array(cfg.diskPages).keys(), ...Array(cfg.diskPages).keys()].map(i => [i, false]),
      'Write burst (0–39)': () => Array.from({ length: 60 }, () => [rnd(40), true])
    };
    function play(name) {
      stop();
      const steps = SCENARIOS[name]();
      let i = 0;
      timer = setInterval(() => { if (i >= steps.length) return stop(); step(...steps[i++]); }, 120);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    root.innerHTML = `
      <div class="bt-controls">
        <input type="number" min="0" max="${cfg.diskPages - 1}" value="7" aria-label="page number">
        <button type="button" data-act="read">Read page</button>
        <button type="button" data-act="write">Write page</button>
        <select aria-label="scenario" data-role="scenario">${Object.keys(SCENARIOS).map(s => `<option>${s}</option>`).join('')}</select>
        <select aria-label="eviction worker speed" data-role="speed"><option value="1">workers keep up</option><option value="0.5">workers too slow</option></select>
        <button type="button" data-act="play">▶ Play</button>
        <button type="button" data-act="reset">Reset</button>
      </div>
      <div class="cs-bar" aria-hidden="true">
        <div class="cs-fill"></div><div class="cs-dirty"></div>
        <span class="cs-mark" style="left:${100 * lim.target / cfg.capacity}%">target</span>
        <span class="cs-mark" style="left:${100 * lim.trigger / cfg.capacity}%">trigger</span>
      </div>
      <div class="cs-grid"></div>
      <div class="cs-legend"><span></span>clean<span class="d"></span>dirty · cached pages, oldest use first · amber bar = dirty share</div>
      <div class="bt-stats"></div>
      <ol class="bt-log" reversed></ol>`;
    const input = root.querySelector('input');
    root.querySelector('[data-act=read]').onclick = () => step(+input.value % cfg.diskPages, false);
    root.querySelector('[data-act=write]').onclick = () => step(+input.value % cfg.diskPages, true);
    root.querySelector('[data-role=speed]').onchange = e => { cfg.workerBudget = +e.target.value; };
    root.querySelector('[data-act=play]').onclick = () => { reset(); play(root.querySelector('[data-role=scenario]').value); };
    root.querySelector('[data-act=reset]').onclick = reset;

    function render(touched) {
      const order = [...cache.entries()].sort((a, b) => a[1].used - b[1].used); // oldest first
      const cells = order.map(([id, p], i) =>
        `<div class="cs-page${p.dirty ? ' dirty' : ''}${id === touched ? ' touched' : ''}" title="page ${id}${p.dirty ? ', dirty' : ', clean'}">${id}${i === 0 ? '<small>LRU</small>' : ''}</div>`);
      for (let i = cache.size; i < cfg.capacity; i++) cells.push('<div class="cs-page empty"></div>');
      root.querySelector('.cs-grid').innerHTML = cells.join('');
      root.querySelector('.cs-fill').style.width = `${100 * cache.size / cfg.capacity}%`;
      root.querySelector('.cs-dirty').style.width = `${100 * dirtyCount() / cfg.capacity}%`;
      const total = stats.hits + stats.misses;
      root.querySelector('.bt-stats').innerHTML =
        `cache ${cache.size}/${cfg.capacity} pages · dirty ${dirtyCount()} (trigger ${lim.dTrigger}) · ` +
        `hits ${stats.hits}/${total}${total ? ` (${Math.round(100 * stats.hits / total)}%)` : ''} · ` +
        `evicted by workers ${stats.workerEvict} · <strong>by your thread ${stats.appEvict}</strong> · disk writes ${stats.diskWrites}`;
      root.querySelector('.bt-log').innerHTML = log.slice(0, 6).map(l => `<li>${l}</li>`).join('');
    }

    reset();
  }

  window.CacheSim = { mount };
})();
