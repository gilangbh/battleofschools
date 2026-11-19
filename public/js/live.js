// Keeps a scoreboard up to date: the server sends an event whenever anything changes,
// and the page re-fetches its live region. A slow timer covers dropped connections.
(() => {
  const region = document.getElementById('live-region');
  if (!region) return;
  const conn = document.getElementById('conn');
  const filter = document.getElementById('team-filter');
  const userOpen = {};
  let timer = null;
  let busy = false;
  let again = false;

  const setConn = (state, text) => { if (conn) { conn.dataset.state = state; conn.textContent = text; } };

  function applyFilter() {
    if (!filter) return;
    const team = filter.value;
    region.querySelectorAll('li[data-teams]').forEach((el) => {
      el.classList.toggle('is-hidden', Boolean(team) && !el.dataset.teams.split(' ').includes(team));
    });
    region.querySelectorAll('tr[data-teams]').forEach((el) => el.classList.toggle('is-mine', Boolean(team) && el.dataset.teams === team));
  }

  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const res = await fetch(region.dataset.src, { cache: 'no-store' });
      if (res.ok) {
        const html = await res.text();
        const before = {};
        region.querySelectorAll('[data-k]').forEach((el) => { before[el.dataset.k] = el.textContent; });
        region.innerHTML = html;
        region.querySelectorAll('[data-k]').forEach((el) => { if (el.dataset.k in before && before[el.dataset.k] !== el.textContent) el.classList.add('is-changed'); });
        region.querySelectorAll('details[data-key]').forEach((d) => { if (d.dataset.key in userOpen) d.open = userOpen[d.dataset.key]; });
        applyFilter();
      }
    } catch { /* offline: the next event or timer tries again */ }
    busy = false;
    if (again) { again = false; refresh(); }
  }

  // Remember which rounds the viewer opened or closed so a refresh does not undo it.
  region.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.key) userOpen[d.dataset.key] = d.open;
  }, true);

  if (filter) {
    try { filter.value = localStorage.getItem('bos-team') || ''; } catch { /* storage unavailable */ }
    filter.addEventListener('change', () => {
      try { localStorage.setItem('bos-team', filter.value); } catch { /* storage unavailable */ }
      applyFilter();
    });
    applyFilter();
  }

  function connect() {
    const es = new EventSource('/events');
    es.onopen = () => { setConn('live', 'Live'); refresh(); };
    es.onmessage = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
    es.onerror = () => setConn('down', 'Reconnecting…');
  }
  connect();
  setInterval(refresh, 10000);

  const clock = document.getElementById('clock');
  if (clock) {
    const tick = () => { clock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
    tick();
    setInterval(tick, 10000);
  }
})();
