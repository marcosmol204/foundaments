/*
 * Interactive B-tree visualizer (classic CLRS B-tree, same algorithm as lessons/code/btree.c).
 *
 * Usage:
 *   <div id="viz"></div>
 *   <script src="../assets/btree-viz.js"></script>
 *   <script>BTreeViz.mount('#viz', { t: 2, preset: [10, 20, 30] });</script>
 *
 * Insert keys, search (highlights the path and counts pages visited), and watch splits.
 * Styles: .bt-* classes in assets/style.css.
 */
(function () {
  class BTree {
    constructor(t) { this.t = t; this.root = { keys: [], children: [], leaf: true }; this.log = []; }
    get maxKeys() { return 2 * this.t - 1; }

    search(k) {
      const path = [];
      let x = this.root;
      while (x) {
        path.push(x);
        let i = 0;
        while (i < x.keys.length && k > x.keys[i]) i++;
        if (i < x.keys.length && k === x.keys[i]) return { found: true, path };
        if (x.leaf) return { found: false, path };
        x = x.children[i];
      }
    }

    splitChild(parent, i) {
      const t = this.t, full = parent.children[i];
      const median = full.keys[t - 1];
      const right = { keys: full.keys.slice(t), children: full.leaf ? [] : full.children.slice(t), leaf: full.leaf };
      full.keys = full.keys.slice(0, t - 1);
      if (!full.leaf) full.children = full.children.slice(0, t);
      parent.children.splice(i + 1, 0, right);
      parent.keys.splice(i, 0, median);
      this.log.push(`split: page [${[...full.keys, median, ...right.keys].join(' ')}] was full → median ${median} moved up`);
    }

    insert(k) {
      this.log = [];
      if (this.search(k).found) { this.log.push(`${k} already present (keys are unique here)`); return; }
      let r = this.root;
      if (r.keys.length === this.maxKeys) {
        const s = { keys: [], children: [r], leaf: false };
        this.root = s;
        this.splitChild(s, 0);
        this.log.push('root split → tree grew one level taller');
        r = s;
      }
      let x = r;
      while (!x.leaf) {
        let i = 0;
        while (i < x.keys.length && k > x.keys[i]) i++;
        if (x.children[i].keys.length === this.maxKeys) {
          this.splitChild(x, i);
          if (k > x.keys[i]) i++;
        }
        x = x.children[i];
      }
      let i = 0;
      while (i < x.keys.length && k > x.keys[i]) i++;
      x.keys.splice(i, 0, k);
      this.log.push(`inserted ${k} into leaf`);
    }

    height() { let h = 1, x = this.root; while (!x.leaf) { x = x.children[0]; h++; } return h; }
  }

  const NS = 'http://www.w3.org/2000/svg';
  const KEY_W = 30, PAD = 6, NODE_H = 28, GAP_X = 14, GAP_Y = 56;

  function render(svg, tree, highlight = new Set()) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    let cursor = 0;
    const width = n => Math.max(n.keys.length, 1) * KEY_W + PAD * 2;
    function layout(n, depth) {          // leaves left to right; parents centered over children
      n._y = depth * (NODE_H + GAP_Y) + 10;
      if (n.leaf) { n._x = cursor; cursor += width(n) + GAP_X; }
      else {
        n.children.forEach(c => layout(c, depth + 1));
        const first = n.children[0], last = n.children[n.children.length - 1];
        n._x = (first._x + last._x + width(last)) / 2 - width(n) / 2;
      }
    }
    layout(tree.root, 0);
    const totalW = Math.max(cursor, 200), totalH = tree.height() * (NODE_H + GAP_Y);
    svg.setAttribute('viewBox', `-10 0 ${totalW + 20} ${totalH}`);

    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    (function edges(n) {
      if (n.leaf) return;
      n.children.forEach((c, i) => {
        const x1 = n._x + PAD + i * KEY_W, y1 = n._y + NODE_H;
        mk('path', { d: `M${x1} ${y1} L${c._x + width(c) / 2} ${c._y}`, class: highlight.has(c) ? 'edge-accent' : 'edge' });
        edges(c);
      });
    })(tree.root);
    (function nodes(n) {
      mk('rect', { x: n._x, y: n._y, width: width(n), height: NODE_H, rx: 4, class: highlight.has(n) ? 'box-accent' : 'box' });
      n.keys.forEach((k, i) => {
        const t = mk('text', { x: n._x + PAD + i * KEY_W + KEY_W / 2, y: n._y + 18, class: 'lbl', 'text-anchor': 'middle' });
        t.textContent = k;
        if (i > 0) mk('line', { x1: n._x + PAD + i * KEY_W, y1: n._y + 6, x2: n._x + PAD + i * KEY_W, y2: n._y + NODE_H - 6, class: 'edge' });
      });
      if (!n.leaf) n.children.forEach(c => nodes(c));
    })(tree.root);
  }

  function mount(selector, opts = {}) {
    const root = document.querySelector(selector);
    root.classList.add('bt-widget');
    root.innerHTML = `
      <div class="bt-controls">
        <input type="number" class="bt-input" placeholder="key" aria-label="key">
        <button type="button" data-act="insert">Insert</button>
        <button type="button" data-act="search">Search</button>
        <button type="button" data-act="random">+5 random</button>
        <button type="button" data-act="preset">Load C example</button>
        <button type="button" data-act="reset">Reset</button>
        <label class="bt-t">max keys/page
          <select><option value="2">3</option><option value="3">5</option><option value="4">7</option></select>
        </label>
      </div>
      <div class="bt-stats"></div>
      <svg class="bt-svg" role="img" aria-label="B-tree diagram"></svg>
      <ol class="bt-log"></ol>`;
    const svg = root.querySelector('svg'), input = root.querySelector('input');
    const stats = root.querySelector('.bt-stats'), logEl = root.querySelector('.bt-log'), select = root.querySelector('select');
    select.value = String(opts.t || 2);
    let tree = new BTree(+select.value);

    function show(lines, highlight) {
      render(svg, tree, highlight);
      let count = 0; (function c(n) { count += n.keys.length; n.children.forEach(c); })(tree.root);
      stats.textContent = `${count} keys · height ${tree.height()} · max ${tree.maxKeys} keys per page`;
      logEl.innerHTML = lines.map(l => `<li>${l}</li>`).join('');
    }
    const insertKeys = ks => { const all = []; ks.forEach(k => { tree.insert(k); all.push(...tree.log); }); show(all.slice(-8)); };

    root.addEventListener('click', e => {
      const act = e.target.dataset?.act; if (!act) return;
      const k = parseInt(input.value, 10);
      if (act === 'insert' && !isNaN(k)) { insertKeys([k]); input.select(); }
      if (act === 'search' && !isNaN(k)) {
        const r = tree.search(k);
        show([`search ${k}: ${r.found ? 'found' : 'not found'}, <strong>${r.path.length} page${r.path.length > 1 ? 's' : ''} visited</strong> (tree height ${tree.height()})`], new Set(r.path));
      }
      if (act === 'random') insertKeys(Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 99)));
      if (act === 'preset') { tree = new BTree(+select.value); insertKeys(opts.preset || []); }
      if (act === 'reset') { tree = new BTree(+select.value); show(['empty tree: a single empty leaf (which is also the root)']); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') root.querySelector('[data-act=insert]').click(); });
    select.addEventListener('change', () => { tree = new BTree(+select.value); show([`new empty tree, max ${tree.maxKeys} keys per page`]); });
    show(['empty tree: type a key and press Insert, or load the C example']);
  }

  window.BTreeViz = { mount, BTree };
})();
