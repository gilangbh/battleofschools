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
