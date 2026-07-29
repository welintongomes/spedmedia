/* =========================================================
   speedrun.js — categories, live timer, ghost comparison, history
   ========================================================= */
const Speedrun = (() => {

  let games = [];       // cache of all games
  let runsByGame = {};  // gameId -> [runs]
  let editingGameId = null;
  let formSegments = []; // array of strings while editing the category form

  // ---- Live timer state ----
  const Timer = {
    game: null,
    pbRun: null,
    running: false,
    finished: false,
    startTs: 0,
    pausedAccum: 0,
    splitTimes: [],     // cumulative ms, one per completed segment
    segDeltas: [],      // frozen segment delta (ms) per completed segment
    rafId: null,
    rowEls: [],
    rowDeltaEls: [],
    rowPbEls: [],
  };

  function getElapsed() {
    if (!Timer.running) return 0;
    return performance.now() - Timer.startTs - Timer.pausedAccum;
  }

  // =========================================================
  // Data loading
  // =========================================================
  async function loadAll() {
    games = await DB.getAll('games');
    const allRuns = await DB.getAll('runs');
    runsByGame = {};
    for (const r of allRuns) {
      (runsByGame[r.gameId] ||= []).push(r);
    }
  }

  function pbFor(gameId) {
    const runs = runsByGame[gameId] || [];
    if (!runs.length) return null;
    return runs.reduce((min, r) => (r.totalTime < min.totalTime ? r : min));
  }

  // =========================================================
  // Home list
  // =========================================================
  async function renderHome() {
    await loadAll();
    const wrap = document.getElementById('speedrun-game-list');
    const empty = document.getElementById('speedrun-empty');

    if (!games.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    wrap.innerHTML = games.map(g => {
      const runs = runsByGame[g.id] || [];
      const pb = pbFor(g.id);
      const pbBadge = pb
        ? `<span class="badge badge-gold">${formatClock(pb.totalTime)}</span>`
        : `<span class="badge badge-neutral">sem recorde</span>`;
      return `
        <div class="card" data-game-id="${g.id}">
          <div class="card-top">
            <div>
              <div class="card-title">${escapeHtml(g.name)}</div>
              <div class="card-sub">${g.segments.length} área${g.segments.length === 1 ? '' : 's'} · ${runs.length} tentativa${runs.length === 1 ? '' : 's'}</div>
            </div>
            ${pbBadge}
          </div>
          <div class="form-actions" style="margin-top:2px;">
            <button type="button" class="btn-ghost btn-small" data-action="edit">Editar</button>
            <button type="button" class="btn-ghost btn-small" data-action="history">Histórico</button>
            <button type="button" class="btn-primary btn-small" data-action="start">Iniciar</button>
          </div>
        </div>`;
    }).join('');
  }

  function wireHomeList() {
    document.getElementById('speedrun-game-list').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const gameId = card.dataset.gameId;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'edit') openGameForm(gameId);
      else if (action === 'history') openHistory(gameId);
      else openTimer(gameId); // tapping the card body, or the "Iniciar" button
    });
    document.getElementById('btn-new-game').addEventListener('click', () => openGameForm(null));
  }

  // =========================================================
  // Category (game) form
  // =========================================================
  function renderSegmentRows() {
    const wrap = document.getElementById('segment-list');
    wrap.innerHTML = formSegments.map((name, i) => `
      <div class="segment-row" data-idx="${i}">
        <span class="seg-index">${i + 1}</span>
        <input type="text" value="${escapeHtml(name)}" placeholder="Nome da área" data-seg-input maxlength="60">
        <button type="button" class="seg-remove" data-seg-remove aria-label="Remover área">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`).join('');
  }

  function openGameForm(gameId) {
    editingGameId = gameId;
    const deleteBtn = document.getElementById('btn-delete-game');
    const warning = document.getElementById('segment-edit-warning');

    if (gameId) {
      const g = games.find(x => x.id === gameId);
      document.getElementById('game-name').value = g.name;
      formSegments = [...g.segments];
      deleteBtn.hidden = false;
      warning.hidden = !(runsByGame[gameId] && runsByGame[gameId].length);
      App.go('screen-speedrun-form', 'Editar categoria');
    } else {
      document.getElementById('game-name').value = '';
      formSegments = ['', ''];
      deleteBtn.hidden = true;
      warning.hidden = true;
      App.go('screen-speedrun-form', 'Nova categoria');
    }
    renderSegmentRows();
  }

  function wireGameForm() {
    const segList = document.getElementById('segment-list');
    segList.addEventListener('input', (e) => {
      const input = e.target.closest('[data-seg-input]');
      if (!input) return;
      const idx = Number(input.closest('.segment-row').dataset.idx);
      formSegments[idx] = input.value;
    });
    segList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-seg-remove]');
      if (!btn) return;
      const idx = Number(btn.closest('.segment-row').dataset.idx);
      if (formSegments.length <= 1) { toast('Precisa de pelo menos 1 área'); return; }
      formSegments.splice(idx, 1);
      renderSegmentRows();
    });

    document.getElementById('btn-add-segment').addEventListener('click', () => {
      formSegments.push('');
      renderSegmentRows();
      const inputs = segList.querySelectorAll('[data-seg-input]');
      inputs[inputs.length - 1]?.focus();
    });

    document.getElementById('btn-cancel-game').addEventListener('click', () => App.back());

    document.getElementById('form-speedrun-game').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('game-name').value.trim();
      const segments = formSegments.map(s => s.trim()).filter(Boolean);
      if (!name) { toast('Dá um nome pra essa categoria'); return; }
      if (!segments.length) { toast('Adiciona pelo menos 1 área'); return; }

      if (editingGameId) {
        const g = games.find(x => x.id === editingGameId);
        g.name = name;
        g.segments = segments;
        await DB.put('games', g);
        toast('Categoria atualizada');
      } else {
        const g = { id: uuid(), name, segments, createdAt: new Date().toISOString() };
        await DB.put('games', g);
        toast('Categoria criada');
      }
      await renderHome();
      App.back();
    });

    document.getElementById('btn-delete-game').addEventListener('click', async () => {
      if (!editingGameId) return;
      if (!confirm('Excluir esta categoria e todo o histórico de corridas dela? Essa ação não pode ser desfeita.')) return;
      await DB.delete('games', editingGameId);
      await DB.deleteWhere('runs', 'gameId', editingGameId);
      toast('Categoria excluída');
      await renderHome();
      App.replaceRoot('screen-speedrun-home');
    });
  }

  // =========================================================
  // Live timer screen
  // =========================================================
  function resetTimerState(game, pbRun) {
    Timer.game = game;
    Timer.pbRun = pbRun;
    Timer.running = false;
    Timer.finished = false;
    Timer.startTs = 0;
    Timer.pausedAccum = 0;
    Timer.splitTimes = [];
    Timer.segDeltas = [];
    if (Timer.rafId) cancelAnimationFrame(Timer.rafId);
    Timer.rafId = null;
  }

  function openTimer(gameId) {
    const g = games.find(x => x.id === gameId);
    const pb = pbFor(gameId);
    resetTimerState(g, pb);

    document.getElementById('run-summary').hidden = true;
    document.getElementById('pb-line').innerHTML = pb
      ? `Recorde: <span class="pb-time">${formatClock(pb.totalTime)}</span>`
      : 'Sem recorde ainda — essa tentativa já entra pro histórico';
    document.getElementById('clock-display').textContent = '0:00.00';
    document.getElementById('live-delta').textContent = '';
    document.getElementById('live-delta').className = 'live-delta';
    document.getElementById('clock-box').className = 'clock-box';

    const mainBtn = document.getElementById('btn-timer-main');
    mainBtn.textContent = 'Iniciar';
    mainBtn.className = 'btn-timer-main';
    document.getElementById('btn-undo-split').disabled = true;
    document.getElementById('btn-reset-run').disabled = true;

    renderSplitRows();

    App.go('screen-speedrun-timer', g.name);
    const ctxBtn = document.getElementById('btn-context');
    ctxBtn.hidden = false;
    ctxBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><path d="M8.5 14L6 22l6-3 6 3-2.5-8"/></svg>`;
    ctxBtn.onclick = () => openHistory(gameId);
  }

  function renderSplitRows() {
    const wrap = document.getElementById('splits-list');
    wrap.innerHTML = Timer.game.segments.map((name, i) => `
      <div class="split-row" data-idx="${i}">
        <span class="split-name">${escapeHtml(name)}</span>
        <span class="split-pb"></span>
        <span class="split-delta">—</span>
      </div>`).join('');
    Timer.rowEls = [...wrap.querySelectorAll('.split-row')];
    Timer.rowDeltaEls = [...wrap.querySelectorAll('.split-delta')];
    Timer.rowPbEls = [...wrap.querySelectorAll('.split-pb')];

    Timer.rowPbEls.forEach((el, i) => {
      if (Timer.pbRun && i < Timer.pbRun.segmentTimes.length) {
        const dur = Timer.pbRun.segmentTimes[i] - (i > 0 ? Timer.pbRun.segmentTimes[i - 1] : 0);
        el.textContent = formatClock(dur);
      } else {
        el.textContent = '—';
      }
    });
    highlightCurrentRow();
  }

  function highlightCurrentRow() {
    const idx = Timer.splitTimes.length;
    Timer.rowEls.forEach((row, i) => {
      row.classList.toggle('is-current', i === idx && Timer.running && !Timer.finished);
      row.querySelector('.split-name').classList.toggle('is-current', i === idx && Timer.running && !Timer.finished);
    });
  }

  function pbSegmentDuration(idx) {
    if (!Timer.pbRun || idx >= Timer.pbRun.segmentTimes.length) return null;
    return Timer.pbRun.segmentTimes[idx] - (idx > 0 ? Timer.pbRun.segmentTimes[idx - 1] : 0);
  }

  function tick() {
    if (!Timer.running || Timer.finished) return;
    const elapsed = getElapsed();
    document.getElementById('clock-display').textContent = formatClock(elapsed);

    const idx = Timer.splitTimes.length;
    const pbDur = pbSegmentDuration(idx);
    const liveDeltaEl = document.getElementById('live-delta');
    const clockBox = document.getElementById('clock-box');

    if (pbDur !== null && idx < Timer.game.segments.length) {
      const liveSegElapsed = elapsed - (idx > 0 ? Timer.splitTimes[idx - 1] : 0);
      const delta = liveSegElapsed - pbDur;
      const cls = delta < 0 ? 'is-ahead' : 'is-behind';
      const text = formatDelta(delta);
      liveDeltaEl.textContent = text;
      liveDeltaEl.className = 'live-delta ' + cls;
      clockBox.className = 'clock-box ' + cls;
      if (Timer.rowDeltaEls[idx]) {
        Timer.rowDeltaEls[idx].textContent = text;
        Timer.rowDeltaEls[idx].className = 'split-delta ' + cls;
      }
    } else {
      liveDeltaEl.textContent = '';
      liveDeltaEl.className = 'live-delta';
      clockBox.className = 'clock-box';
    }

    Timer.rafId = requestAnimationFrame(tick);
  }

  function startOrSplit() {
    if (!Timer.running) {
      Timer.running = true;
      Timer.finished = false;
      Timer.startTs = performance.now();
      Timer.pausedAccum = 0;
      Timer.splitTimes = [];
      Timer.segDeltas = [];
      const mainBtn = document.getElementById('btn-timer-main');
      mainBtn.textContent = 'Split';
      mainBtn.className = 'btn-timer-main is-running';
      document.getElementById('btn-reset-run').disabled = false;
      highlightCurrentRow();
      tick();
      return;
    }

    const elapsed = getElapsed();
    const idx = Timer.splitTimes.length;
    Timer.splitTimes.push(elapsed);

    const pbDur = pbSegmentDuration(idx);
    const segStart = idx > 0 ? Timer.splitTimes[idx - 1] : 0;
    const segDuration = elapsed - segStart;
    const delta = pbDur !== null ? segDuration - pbDur : null;
    Timer.segDeltas.push(delta);

    if (Timer.rowEls[idx]) {
      const cell = Timer.rowDeltaEls[idx];
      if (delta !== null) {
        const cls = delta < 0 ? 'is-ahead' : 'is-behind';
        cell.textContent = formatDelta(delta);
        cell.className = 'split-delta ' + cls;
      }
    }

    document.getElementById('btn-undo-split').disabled = false;

    if (idx === Timer.game.segments.length - 1) {
      finishRun(elapsed);
    } else {
      highlightCurrentRow();
    }
  }

  function undoLastSplit() {
    if (!Timer.running || Timer.finished || !Timer.splitTimes.length) return;
    const idx = Timer.splitTimes.length - 1;
    Timer.splitTimes.pop();
    Timer.segDeltas.pop();
    if (Timer.rowDeltaEls[idx]) {
      Timer.rowDeltaEls[idx].textContent = '—';
      Timer.rowDeltaEls[idx].className = 'split-delta';
    }
    document.getElementById('btn-undo-split').disabled = Timer.splitTimes.length === 0;
    highlightCurrentRow();
  }

  async function finishRun(totalTime) {
    Timer.finished = true;
    Timer.running = false;
    if (Timer.rafId) cancelAnimationFrame(Timer.rafId);
    document.getElementById('clock-display').textContent = formatClock(totalTime);
    document.getElementById('live-delta').textContent = '';
    document.getElementById('clock-box').className = 'clock-box';

    const isNewPB = !Timer.pbRun || totalTime < Timer.pbRun.totalTime;
    const run = {
      id: uuid(),
      gameId: Timer.game.id,
      date: new Date().toISOString(),
      segmentTimes: [...Timer.splitTimes],
      totalTime,
    };
    await DB.put('runs', run);
    (runsByGame[Timer.game.id] ||= []).push(run);
    if (isNewPB) Timer.pbRun = run;

    document.getElementById('btn-timer-main').className = 'btn-timer-main';
    document.getElementById('btn-timer-main').textContent = 'Iniciar';
    document.getElementById('btn-undo-split').disabled = true;

    const flag = document.getElementById('run-summary-flag');
    const sub = document.getElementById('run-summary-sub');
    flag.textContent = isNewPB ? '🏆 Novo recorde!' : 'Corrida salva';
    document.getElementById('run-summary-time').textContent = formatClock(totalTime);
    if (!isNewPB) {
      const prevPb = runsByGame[Timer.game.id].reduce((min, r) => r.totalTime < min.totalTime ? r : min);
      const diff = totalTime - prevPb.totalTime;
      sub.textContent = `${formatDelta(diff)} em relação ao recorde (${formatClock(prevPb.totalTime)})`;
    } else {
      sub.textContent = 'Essa é a nova marca a bater da próxima vez.';
    }
    document.getElementById('run-summary').hidden = false;
  }

  function closeSummary() {
    document.getElementById('run-summary').hidden = true;
    const pb = pbFor(Timer.game.id);
    resetTimerState(Timer.game, pb);
    document.getElementById('pb-line').innerHTML = pb
      ? `Recorde: <span class="pb-time">${formatClock(pb.totalTime)}</span>`
      : 'Sem recorde ainda — essa tentativa já entra pro histórico';
    document.getElementById('clock-display').textContent = '0:00.00';
    document.getElementById('btn-timer-main').textContent = 'Iniciar';
    document.getElementById('btn-timer-main').className = 'btn-timer-main';
    document.getElementById('btn-reset-run').disabled = true;
    renderSplitRows();
  }

  function resetRun() {
    if (Timer.running && Timer.splitTimes.length && !confirm('Resetar essa tentativa? O progresso atual será perdido.')) return;
    const pb = pbFor(Timer.game.id);
    resetTimerState(Timer.game, pb);
    document.getElementById('clock-display').textContent = '0:00.00';
    document.getElementById('live-delta').textContent = '';
    document.getElementById('live-delta').className = 'live-delta';
    document.getElementById('clock-box').className = 'clock-box';
    document.getElementById('btn-timer-main').textContent = 'Iniciar';
    document.getElementById('btn-timer-main').className = 'btn-timer-main';
    document.getElementById('btn-undo-split').disabled = true;
    document.getElementById('btn-reset-run').disabled = true;
    renderSplitRows();
  }

  function wireTimer() {
    document.getElementById('btn-timer-main').addEventListener('click', startOrSplit);
    document.getElementById('btn-undo-split').addEventListener('click', undoLastSplit);
    document.getElementById('btn-reset-run').addEventListener('click', resetRun);
    document.getElementById('btn-summary-close').addEventListener('click', closeSummary);
  }

  // =========================================================
  // History screen
  // =========================================================
  function openHistory(gameId) {
    const g = games.find(x => x.id === gameId);
    const runs = [...(runsByGame[gameId] || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pb = pbFor(gameId);

    const wrap = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    if (!runs.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      wrap.innerHTML = runs.map(r => `
        <div class="card">
          <div class="history-row">
            <div>
              <div class="history-time">${formatClock(r.totalTime)}</div>
              <div class="history-date">${formatDateBR(r.date)}</div>
            </div>
            ${pb && r.id === pb.id ? '<span class="badge badge-gold">recorde</span>' : ''}
          </div>
        </div>`).join('');
    }
    App.go('screen-speedrun-history', `Histórico — ${g.name}`);
  }

  // =========================================================
  // Public
  // =========================================================
  async function init() {
    wireHomeList();
    wireGameForm();
    wireTimer();
    await renderHome();
  }

  return { init, renderHome, openGameForm, openTimer, openHistory, startOrSplit, undoLastSplit, resetRun };
})();