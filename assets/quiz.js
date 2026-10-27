/*
 * Reusable quiz widget.
 *
 * Usage:
 *   <link rel="stylesheet" href="../assets/quiz.css">
 *   <div id="quiz"></div>
 *   <script src="../assets/quiz.js"></script>
 *   <script>
 *     Quiz.mount('#quiz', {
 *       id: 'lesson-0001',            // used for the results summary
 *       allowSkip: true,              // shows a "Don't know" button (diagnostics)
 *       questions: [{
 *         tier: 1,                    // optional 1..3 difficulty
 *         layer: 'engine',            // optional topic tag
 *         q: 'Question HTML',
 *         options: ['A', 'B', 'C', 'D'],
 *         answer: 2,                  // index into options
 *         explain: 'Explanation HTML, with citations'
 *       }]
 *     });
 *   </script>
 *
 * Feedback is immediate: on answer, the correct option is revealed with the explanation.
 * At the end, a plain-text summary is produced for pasting back to the teacher.
 */
(function () {
  const TIER_NAMES = { 1: 'Basics', 2: 'Intermediate', 3: 'Hard' };

  function el(tag, attrs = {}, html = '') {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    return n;
  }

  function mount(selector, cfg) {
    const root = document.querySelector(selector);
    const results = new Array(cfg.questions.length).fill(null); // 'ok' | 'bad' | 'skip'
    const progress = el('div', { class: 'quiz-progress' });
    root.appendChild(progress);

    cfg.questions.forEach((item, qi) => {
      const card = el('section', { class: 'quiz-card', id: `q${qi + 1}` });
      const meta = el('div', { class: 'quiz-meta' });
      meta.innerHTML = `<span class="quiz-num">Q${qi + 1}</span>` +
        (item.tier ? `<span class="tag t${item.tier}">${TIER_NAMES[item.tier]}</span>` : '') +
        (item.layer ? `<span class="tag layer">${item.layer}</span>` : '');
      card.appendChild(meta);
      card.appendChild(el('div', { class: 'quiz-q' }, item.q));

      const list = el('div', { class: 'quiz-options', role: 'group' });
      const buttons = item.options.map((opt, oi) => {
        const b = el('button', { type: 'button', class: 'quiz-opt' },
          `<span class="quiz-letter">${'ABCD'[oi]}</span><span>${opt}</span>`);
        b.addEventListener('click', () => answer(oi));
        list.appendChild(b);
        return b;
      });
      card.appendChild(list);

      let skipBtn = null;
      if (cfg.allowSkip) {
        skipBtn = el('button', { type: 'button', class: 'quiz-skip' }, "Don't know: show me");
        skipBtn.addEventListener('click', () => answer(-1));
        card.appendChild(skipBtn);
      }

      const fb = el('div', { class: 'quiz-feedback', hidden: '' });
      card.appendChild(fb);
      root.appendChild(card);

      function answer(oi) {
        if (results[qi] !== null) return;
        const correct = oi === item.answer;
        results[qi] = oi === -1 ? 'skip' : correct ? 'ok' : 'bad';
        buttons.forEach((b, i) => {
          b.disabled = true;
          if (i === item.answer) b.classList.add('is-correct');
          else if (i === oi) b.classList.add('is-wrong');
        });
        if (skipBtn) skipBtn.remove();
        const verdict = results[qi] === 'ok' ? 'Correct.' : results[qi] === 'skip' ? 'Here is the answer.' : 'Not quite.';
        fb.className = `quiz-feedback ${results[qi]}`;
        fb.innerHTML = `<strong>${verdict}</strong> ${item.explain}`;
        fb.hidden = false;
        update();
      }
    });

    const summary = el('section', { class: 'quiz-summary', hidden: '' });
    root.appendChild(summary);

    function update() {
      const done = results.filter(r => r !== null).length;
      const ok = results.filter(r => r === 'ok').length;
      progress.textContent = `${done} / ${cfg.questions.length} answered · ${ok} correct`;
      if (done === cfg.questions.length) renderSummary();
    }

    function renderSummary() {
      const byTier = {}, byLayer = {};
      cfg.questions.forEach((item, i) => {
        for (const [bucket, key] of [[byTier, item.tier], [byLayer, item.layer]]) {
          if (key == null) continue;
          bucket[key] = bucket[key] || { ok: 0, n: 0 };
          bucket[key].n++;
          if (results[i] === 'ok') bucket[key].ok++;
        }
      });
      const line = (k, v) => `${k}: ${v.ok}/${v.n}`;
      const sym = { ok: '✓', bad: '✗', skip: '?' };
      const lines = [`[${cfg.id}] results`];
      if (Object.keys(byTier).length) lines.push('By tier: ' + Object.entries(byTier).map(([k, v]) => line(TIER_NAMES[k], v)).join(' · '));
      if (Object.keys(byLayer).length) lines.push('By layer: ' + Object.entries(byLayer).map(([k, v]) => line(k, v)).join(' · '));
      lines.push('Per question: ' + results.map((r, i) => `Q${i + 1}${sym[r]}`).join(' '));
      const text = lines.join('\n');

      summary.innerHTML = `<h3>Your results</h3>
        <p>Copy this and paste it to your teacher in the terminal so the next lessons fit your level.</p>
        <pre class="quiz-result-text"></pre>
        <button type="button" class="quiz-copy">Copy results</button>`;
      summary.querySelector('pre').textContent = text;
      summary.querySelector('.quiz-copy').addEventListener('click', e => {
        navigator.clipboard?.writeText(text).then(() => { e.target.textContent = 'Copied ✓'; });
      });
      summary.hidden = false;
    }

    update();
  }

  window.Quiz = { mount };
})();
