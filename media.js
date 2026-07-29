/* =========================================================
   media.js — games/movies/books backlog with cost-per-hour
   ========================================================= */
const Media = (() => {

  let currentFilter = 'all';
  let currentSort = 'recent';
  let editingId = null;
  let editingRecordCache = null;
  let formType = 'game';

  const TYPE_EMOJI = { game: '🎮', movie: '🎬', book: '📖' };
  const TYPE_LABEL = { game: 'Jogo', movie: 'Filme', book: 'Livro' };
  const STATUS_LABEL = { queue: 'Na fila', doing: 'Em andamento', done: 'Completo', dropped: 'Abandonado' };

  function valuePerHour(price, hours) {
    if (!hours || hours <= 0) return null;
    return (price || 0) / hours;
  }

  // =========================================================
  // List
  // =========================================================
  function sortItems(items, sort) {
    const arr = [...items];
    const vph = (m) => valuePerHour(m.price, m.hours);
    if (sort === 'rating') return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === 'title') return arr.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    if (sort === 'value-asc' || sort === 'value-desc') {
      return arr.sort((a, b) => {
        const va = vph(a), vb = vph(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return sort === 'value-asc' ? va - vb : vb - va;
      });
    }
    return arr.sort((a, b) => new Date(b.updatedAt || b.dateAdded || 0) - new Date(a.updatedAt || a.dateAdded || 0));
  }

  function cardHTML(m) {
    const ratingBadge = m.rating > 0
      ? `<span class="badge badge-gold">★ ${Number(m.rating).toFixed(1).replace(/\.0$/, '')}</span>`
      : '';
    const vph = valuePerHour(m.price, m.hours);
    let valueBadge = '';
    if (vph !== null) {
      const cls = vph <= 3 ? 'badge-teal' : (vph <= 8 ? 'badge-neutral' : 'badge-coral');
      valueBadge = `<span class="badge ${cls}">${formatBRL(vph)}/h</span>`;
    }
    const meta = [TYPE_LABEL[m.type], STATUS_LABEL[m.status]];
    if (m.hours > 0) meta.push(`${m.hours}h`);
    if (m.price > 0) meta.push(formatBRL(m.price));

    return `
      <div class="card" data-id="${m.id}">
        <div class="card-top">
          <div>
            <div class="card-title">${TYPE_EMOJI[m.type]} ${escapeHtml(m.title)}</div>
            <div class="card-sub">${meta.join(' · ')}</div>
          </div>
          ${ratingBadge}
        </div>
        ${valueBadge ? `<div>${valueBadge}</div>` : ''}
      </div>`;
  }

  async function renderList() {
    let items = await DB.getAll('media');
    if (currentFilter !== 'all') items = items.filter(m => m.type === currentFilter);
    items = sortItems(items, currentSort);

    const wrap = document.getElementById('media-list');
    const empty = document.getElementById('media-empty');
    if (!items.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    wrap.innerHTML = items.map(cardHTML).join('');
  }

  function wireList() {
    document.getElementById('type-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      document.querySelectorAll('#type-filter .chip').forEach(c => c.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentFilter = btn.dataset.type;
      renderList();
    });
    document.getElementById('sort-select').addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderList();
    });
    document.getElementById('media-list').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      openForm(card.dataset.id);
    });
    document.getElementById('btn-new-media').addEventListener('click', () => openForm(null));
  }

  // =========================================================
  // Form
  // =========================================================
  function setSegmented(type) {
    document.querySelectorAll('#media-type-segmented .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.type === type);
    });
  }

  function updateValueBox() {
    const price = parseFloat(document.getElementById('media-price').value) || 0;
    const hours = parseFloat(document.getElementById('media-hours').value) || 0;
    const box = document.getElementById('value-per-hour-box');
    const amountEl = document.getElementById('value-per-hour-amount');
    const labelEl = document.getElementById('value-per-hour-label');
    if (hours > 0) {
      const vph = price / hours;
      box.hidden = false;
      amountEl.textContent = formatBRL(vph) + '/h';
      box.classList.toggle('is-bad', vph > 8);
      labelEl.textContent = vph <= 3
        ? 'Valor da hora — ótimo custo-benefício'
        : (vph <= 8 ? 'Valor da hora' : 'Valor da hora — caro');
    } else {
      box.hidden = true;
    }
  }

  function updateRatingLabel() {
    const v = parseFloat(document.getElementById('media-rating').value);
    document.getElementById('rating-value').textContent = v > 0 ? String(v).replace(/\.0$/, '') : '—';
  }

  async function openForm(id) {
    editingId = id;
    editingRecordCache = null;
    const deleteBtn = document.getElementById('btn-delete-media');
    document.getElementById('form-media').reset();

    if (id) {
      const m = await DB.get('media', id);
      editingRecordCache = m;
      formType = m.type;
      setSegmented(m.type);
      document.getElementById('media-title').value = m.title;
      document.getElementById('media-status').value = m.status;
      document.getElementById('media-rating').value = m.rating || 0;
      document.getElementById('media-price').value = m.price || '';
      document.getElementById('media-hours').value = m.hours || '';
      document.getElementById('media-date').value = m.dateFinished || '';
      document.getElementById('media-review').value = m.review || '';
      deleteBtn.hidden = false;
      App.go('screen-media-form', escapeHtml(m.title) ? m.title : 'Editar');
    } else {
      formType = 'game';
      setSegmented('game');
      document.getElementById('media-status').value = 'queue';
      document.getElementById('media-rating').value = 0;
      deleteBtn.hidden = true;
      App.go('screen-media-form', 'Adicionar mídia');
    }
    updateRatingLabel();
    updateValueBox();
  }

  function wireForm() {
    document.getElementById('media-type-segmented').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      formType = btn.dataset.type;
      setSegmented(formType);
    });
    document.getElementById('media-rating').addEventListener('input', updateRatingLabel);
    document.getElementById('media-price').addEventListener('input', updateValueBox);
    document.getElementById('media-hours').addEventListener('input', updateValueBox);
    document.getElementById('btn-cancel-media').addEventListener('click', () => App.back());

    document.getElementById('form-media').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('media-title').value.trim();
      if (!title) { toast('Dá um título'); return; }
      const now = new Date().toISOString();
      const record = {
        id: editingId || uuid(),
        type: formType,
        title,
        status: document.getElementById('media-status').value,
        rating: parseFloat(document.getElementById('media-rating').value) || 0,
        price: parseFloat(document.getElementById('media-price').value) || 0,
        hours: parseFloat(document.getElementById('media-hours').value) || 0,
        dateFinished: document.getElementById('media-date').value || null,
        review: document.getElementById('media-review').value.trim(),
        dateAdded: editingRecordCache?.dateAdded || now,
        updatedAt: now,
      };
      await DB.put('media', record);
      toast(editingId ? 'Atualizado' : 'Adicionado');
      await renderList();
      App.back();
    });

    document.getElementById('btn-delete-media').addEventListener('click', async () => {
      if (!editingId) return;
      if (!confirm('Excluir este item do backlog?')) return;
      await DB.delete('media', editingId);
      toast('Excluído');
      await renderList();
      App.back();
    });
  }

  // =========================================================
  // Public
  // =========================================================
  async function init() {
    wireList();
    wireForm();
    await renderList();
  }

  return { init, renderList };
})();