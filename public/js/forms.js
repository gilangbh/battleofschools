// Small behaviours for the staff pages: confirm prompts, auto-submitting selects,
// show/hide panels, and the score steppers on the scoring desk.
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
document.querySelectorAll('select[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

// Pills that open a panel. Opening one closes the others in the same card.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const panel = document.getElementById(btn.dataset.toggle);
  if (!panel) return;
  const open = panel.hidden;
  const card = btn.closest('.dm') || document;
  card.querySelectorAll('.dm-panel').forEach((p) => { p.hidden = true; });
  card.querySelectorAll('[data-toggle]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) { const first = panel.querySelector('select, input:not([type=hidden]), button'); if (first) first.focus({ preventScroll: true }); }
});

// Score steppers. On a match that is on court, every change is saved as the live score.
document.querySelectorAll('.dm').forEach((card) => {
  const form = card.querySelector('form.dm-actions');
  if (!form) return;
  const inputs = [...card.querySelectorAll('.stepper input')];
  if (inputs.length !== 2) return;
  const hint = card.querySelector('[data-hint]');
  const note = card.querySelector('.autosave');
  const total = Number(card.dataset.total) || null;
  const target = Number(card.dataset.target) || null;
  let timer = null;

  const values = () => inputs.map((i) => Math.max(0, Number(i.value) || 0));
  const complete = () => {
    const [a, b] = values();
    if (total) return a + b === total;
    return (a === target || b === target) && a !== b;
  };
  const paint = () => {
    const [a, b] = values();
    const done = complete();
    card.classList.toggle('is-complete', done);
    if (hint) hint.textContent = done ? `${a}–${b} is a full match. Save it as the final score.` : hint.dataset.rule;
  };
  const save = async () => {
    const [a, b] = values();
    if (note) note.textContent = 'Saving…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ a, b, mode: 'running' }),
      });
      const data = await res.json();
      if (note) { note.textContent = data.text; note.classList.toggle('is-error', !data.ok); }
    } catch {
      if (note) { note.textContent = 'Not saved. Check the connection and tap again.'; note.classList.add('is-error'); }
    }
  };
  const changed = () => {
    paint();
    if (!form.hasAttribute('data-live')) return;
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };

  card.querySelectorAll('.stepper').forEach((st) => {
    const input = st.querySelector('input');
    st.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const next = Math.min(Number(input.max) || 99, Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step)));
      if (String(next) === input.value) return;
      input.value = next;
      changed();
    }));
    input.addEventListener('input', changed);
    input.addEventListener('focus', () => input.select());
  });
  paint();
});

// Admin fixtures: fill times and courts in bulk, and track unsaved changes.
(() => {
  const form = document.querySelector('[data-dirty-form]');
  if (!form) return;
  const bar = form.querySelector('.save-bar');
  const note = form.querySelector('[data-dirty-note]');
  const fields = [...form.querySelectorAll('[name]')];
  const read = (f) => (f.type === 'checkbox' || f.type === 'radio' ? String(f.checked) : f.value);
  const initial = new Map(fields.map((f) => [f, read(f)]));
  let saving = false;
  const review = () => {
    let n = 0;
    fields.forEach((f) => { const changed = read(f) !== initial.get(f); (f.closest('.seg label, .tick') || f).classList.toggle('is-touched', changed); if (changed && !(f.type === 'radio' && !f.checked)) n++; });
    bar.classList.toggle('is-dirty', n > 0);
    note.textContent = n ? n + ' unsaved change' + (n === 1 ? '' : 's') + '. Press Save.' : 'No unsaved changes.';
    return n;
  };
  form.addEventListener('input', review);
  form.addEventListener('change', review);
  form.addEventListener('submit', () => { saving = true; });
  window.addEventListener('beforeunload', (e) => { if (!saving && review() > 0) e.preventDefault(); });

  const set = (el, value) => { if (el && el.value !== value) el.value = value; };
  form.querySelectorAll('[data-round-time]').forEach((input) => input.addEventListener('change', () => {
    if (!input.value) return;
    input.closest('tbody').querySelectorAll('[data-fx=time]').forEach((t) => set(t, input.value));
    review();
  }));

  const box = document.querySelector('[data-autofill]');
  if (!box || !bar) return;
  const af = (k) => box.querySelector('[data-af=' + k + ']');
  af('go').addEventListener('click', () => {
    const [hh, mm] = (af('start').value || '09:00').split(':').map(Number);
    const gap = Math.max(5, Number(af('gap').value) || 45);
    const first = Number(af('first').value) || 0;
    const courts = [...af('first').options].map((o) => o.textContent);
    form.querySelectorAll('tbody[data-round]').forEach((round, r) => {
      const mins = hh * 60 + mm + r * gap;
      const time = String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
      round.querySelectorAll('[data-fx=time]').forEach((t) => set(t, time));
      round.querySelectorAll('[data-fx=court]').forEach((c, i) => set(c, courts[(first + i) % courts.length]));
    });
    const n = review();
    af('note').textContent = n ? 'Table filled. Adjust anything by hand, then press Save all.' : 'The table already had these times and courts.';
  });
})();

// Admin players: the pencil swaps a name for its text box.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rename]');
  if (!btn) return;
  const cell = btn.closest('.name-cell');
  const input = cell.querySelector('.name-input');
  cell.querySelector('.name-text').hidden = true;
  btn.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
});

// Admin players: the small portrait opens a card to upload or remove the photo.
(() => {
  const closeAll = (except) => document.querySelectorAll('.ph-pop').forEach((pop) => {
    if (pop === except) return;
    pop.hidden = true;
    pop.parentNode.querySelector('[data-photo-open]').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-photo-open]');
    if (open) {
      const pop = open.parentNode.querySelector('.ph-pop');
      closeAll(pop);
      pop.hidden = !pop.hidden;
      open.setAttribute('aria-expanded', String(!pop.hidden));
      return;
    }
    if (!e.target.closest('.ph-pop')) closeAll(null);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null); });

  // Shrinks any picture to a 480 x 600 portrait, keeping the top of the frame where the face usually is.
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const W = 480; const H = 600;
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * scale; const h = img.naturalHeight * scale;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) * 0.2, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });

  const FACE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M3.5 22c.6-5 4-7.5 8.5-7.5s7.9 2.5 8.5 7.5Z"/></svg>';
  const paint = (box, src) => {
    const btn = box.querySelector('[data-photo-open]');
    const big = box.querySelector('.ph-big');
    btn.classList.toggle('is-empty', !src);
    big.classList.toggle('is-empty', !src);
    btn.innerHTML = src ? '<img src="' + src + '" alt="" width="48" height="60">' : FACE;
    big.innerHTML = src ? '<img src="' + src + '" alt="" width="480" height="600">' : FACE;
    box.querySelector('[data-photo-remove]').hidden = !src;
    box.querySelector('.ph-upload').firstChild.textContent = src ? 'Replace photo' : 'Upload photo';
  };
  const send = async (box, body, working) => {
    const note = box.querySelector('[data-photo-note]');
    note.classList.remove('is-error');
    note.textContent = working;
    box.classList.add('is-busy');
    try {
      const res = await fetch('/admin/player/' + box.dataset.photo + '/photo', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.text);
      paint(box, data.photo);
      note.textContent = data.text + ' The scoreboards use it straight away.';
    } catch (err) {
      note.classList.add('is-error');
      note.textContent = err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Not saved. Check the connection and try again.';
    }
    box.classList.remove('is-busy');
  };
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-photo-file]');
    if (!input || !input.files[0]) return;
    const box = input.closest('[data-photo]');
    try {
      const image = await shrink(input.files[0]);
      await send(box, { image }, 'Uploading…');
    } catch {
      const note = box.querySelector('[data-photo-note]');
      note.classList.add('is-error');
      note.textContent = 'That file is not a picture this browser can read. Try a JPEG or PNG.';
    }
    input.value = '';
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-photo-remove]');
    if (!btn) return;
    const box = btn.closest('[data-photo]');
    if (btn.dataset.sure !== '1') {
      btn.dataset.sure = '1';
      btn.textContent = 'Tap again to remove';
      setTimeout(() => { btn.dataset.sure = ''; btn.textContent = 'Remove photo'; }, 4000);
      return;
    }
    btn.dataset.sure = '';
    btn.textContent = 'Remove photo';
    send(box, { remove: true }, 'Removing…');
  });
})();

// School Yard overview: highlight a row, and its Save button, once a cell in it has been changed.
document.addEventListener('input', (e) => {
  const cell = e.target.closest('.yq-cell');
  if (!cell || !e.target.form) return;
  const row = cell.closest('tr');
  row.classList.add('is-dirty');
  const save = row.querySelector('.yq-save .button');
  if (save) save.classList.add('is-dirty');
});
