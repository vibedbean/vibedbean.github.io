// ==========================================
// SAVE CODE (one permanent code that loads your progress on any device)
// - "Create my code" makes a random code (PB-XXXX-XXXX-XXXX-XXXX) and saves your progress to the PokéBlur save server
//   (a small Cloudflare Worker, see worker.js / SETUP.md). The code never changes.
// - On another device: Settings > Save code > "Use this code". Progress from both devices is COMBINED, never replaced:
//   more caught, higher scores, longer streaks win, so devices can't wipe each other.
// - Linked devices push their changes automatically (about every 30 seconds, only when something changed).
// - Anyone with the code can load and overwrite that save, so it works like a password. No accounts, no emails.
// The old Transfer code (transfer.js) still works as an offline backup.
// ==========================================
(function () {
  'use strict';

  // >>> PASTE YOUR WORKER URL HERE after following SETUP.md, e.g. 'https://pokeblur-save.yourname.workers.dev' (no trailing slash).
  // Leave it empty to hide the feature.
  const PB_SAVE_URL = 'https://pokeblur-save.salanitrinicholas.workers.dev';

  // Keys that follow the player between devices. (Not: daily puzzle state, caches, per-device settings.)
  const SYNC_KEYS = [
    'pokeblur-pokedex', 'pokeblur-stats', 'pokeblur-streak', 'pokeblur-timed-records',
    'pokeblur-reverse-highscore', 'pokeblur-vs-name', 'pokeblur-vs-avatar'
  ];
  const CODE_KEY = 'pbsave-code';          // NOT prefixed "pokeblur", so Transfer codes never carry it to another device
  const RELOAD_FLAG = 'pbsave-reloaded';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1 (32 symbols x 16 = 80 bits)
  const CODE_RE = /^[A-HJ-NP-Z2-9]{16}$/;
  const configured = !!PB_SAVE_URL;

  let busy = false, lastSnap = '', status = '', shown = false, deleteTimer = null;

  // ---------- code helpers ----------
  function genCode() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, x => ALPHA[x & 31]).join('');
  }
  const fmt = c => 'PB-' + c.match(/.{4}/g).join('-');
  const mask = () => 'PB-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022';
  function normalize(input) {
    let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length === 18 && s.indexOf('PB') === 0) s = s.slice(2);
    return CODE_RE.test(s) ? s : '';
  }
  function getCode() { try { const c = localStorage.getItem(CODE_KEY); return CODE_RE.test(c || '') ? c : ''; } catch (e) { return ''; } }
  function setCode(c) { try { if (c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); } catch (e) {} }

  // ---------- server ----------
  async function api(path, body) {
    let r;
    try {
      // text/plain keeps this a "simple" request (no CORS pre-flight); the server parses it as JSON anyway
      r = await fetch(PB_SAVE_URL + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    } catch (e) { const er = new Error('offline'); er.code = 'offline'; throw er; }
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const er = new Error((j && j.error) || 'http' + r.status); er.code = (j && j.error) || 'http'; throw er; }
    return j || {};
  }
  function errText(e) {
    switch (e && e.code) {
      case 'offline': return "Couldn't reach the save server. Check your connection.";
      case 'notfound': return "That code has no online save (check for typos, or it was deleted).";
      case 'busy': return 'The save server is busy right now. Try again later.';
      case 'too_big': return 'Your save is too big to upload.';
      default: return 'Something went wrong (' + ((e && e.code) || 'error') + '). Try again.';
    }
  }

  // ---------- merge helpers (strings in, string out) ----------
  const parse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function canon(s) { if (s == null) return ''; const o = parse(s); return o === undefined ? String(s) : stable(o); }
  function deepMax(x, y) {
    if (typeof x === 'number' && typeof y === 'number') return Math.max(x, y);
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(x) && isObj(y)) {
      const o = {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach(k => { o[k] = k in x ? (k in y ? deepMax(x[k], y[k]) : x[k]) : y[k]; });
      return o;
    }
    return x !== undefined ? x : y;
  }
  // Pokedex entry layer = [seen, caught, bestStage, firstCaughtTs, lastTs, modeMask, chosenBorder]
  const pad = a => { const r = Array.isArray(a) ? a.slice(0, 7) : []; while (r.length < 7) r.push(0); return r.map(n => +n || 0); };
  function mergeLayer(x, y) {
    x = pad(x); y = pad(y);
    const lowest = (a, b) => (a && b) ? Math.min(a, b) : (a || b);   // 0 = "never", so ignore it
    const newer = y[4] > x[4] ? y : x;
    return [Math.max(x[0], y[0]), Math.max(x[1], y[1]), lowest(x[2], y[2]), lowest(x[3], y[3]), Math.max(x[4], y[4]), x[5] | y[5], newer[6]];
  }
  function mergeEntry(x, y) {
    x = x || {}; y = y || {};
    const o = Object.assign({}, y, x);
    ['n', 's'].forEach(L => { if (x[L] || y[L]) o[L] = mergeLayer(x[L], y[L]); });
    if (x.forms || y.forms) {
      o.forms = {};
      ['n', 's'].forEach(L => {
        const u = ((x.forms && x.forms[L]) || []).slice();
        ((y.forms && y.forms[L]) || []).forEach(v => { if (u.indexOf(v) === -1) u.push(v); });
        o.forms[L] = u;
      });
    }
    if (x.pick || y.pick) o.pick = Object.assign({}, y.pick, x.pick);
    return o;
  }
  function mergeDex(a, b) {
    const x = parse(a), y = parse(b);
    if (!x || !x.e) return b;
    if (!y || !y.e) return a;
    const out = Object.assign({}, y, x, { e: {} });
    new Set(Object.keys(x.e).concat(Object.keys(y.e))).forEach(id => { out.e[id] = mergeEntry(x.e[id], y.e[id]); });
    return JSON.stringify(out);
  }
  function mergeStreak(a, b) {
    const x = parse(a), y = parse(b);
    if (!x || !y) return a;
    const lx = x.lastDate || '', ly = y.lastDate || '';     // YYYY-MM-DD, so plain string compare works
    const base = ly > lx ? y : x;
    return JSON.stringify(Object.assign({}, base, {
      best: Math.max(x.best || 0, y.best || 0),
      current: lx === ly ? Math.max(x.current || 0, y.current || 0) : (base.current || 0)
    }));
  }
  const MERGERS = {
    'pokeblur-pokedex': mergeDex,
    'pokeblur-stats': (a, b) => JSON.stringify(deepMax(parse(a), parse(b))),
    'pokeblur-streak': mergeStreak,
    'pokeblur-timed-records': (a, b) => JSON.stringify(deepMax(parse(a), parse(b))),
    'pokeblur-reverse-highscore': (a, b) => String(Math.max(parseInt(a, 10) || 0, parseInt(b, 10) || 0))
  };
  function mergeKey(k, l, r) {
    if (l == null) return r;
    if (r == null) return l;
    const f = MERGERS[k];
    if (!f) return l;                       // name / avatar: this device's choice wins
    try { const out = f(l, r); return typeof out === 'string' ? out : l; } catch (e) { return l; }
  }
  function snapshotLocal() {
    const o = {};
    SYNC_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v !== null) o[k] = v; } catch (e) {} });
    return o;
  }
  function cleanRemote(d) {
    const o = {};
    SYNC_KEYS.forEach(k => { if (d && typeof d[k] === 'string') o[k] = d[k]; });
    return o;
  }
  const localCanon = () => { const l = snapshotLocal(); return SYNC_KEYS.map(k => k + '=' + canon(l[k])).join('|'); };

  // ---------- sync ----------
  // get -> merge -> put (the server rejects a put if somebody else saved in between, and we simply retry)
  async function syncNow(applyToDevice) {
    const code = getCode();
    if (!configured || !code || busy) return;
    busy = true;
    const before = localCanon();
    let reloading = false;
    try {
      let merged = null, local = null;
      for (let i = 0; i < 3 && !merged; i++) {
        const g = await api('/get', { code });
        const remote = cleanRemote(g.data);
        local = snapshotLocal();
        const m = {};
        SYNC_KEYS.forEach(k => { const v = mergeKey(k, local[k], remote[k]); if (v != null) m[k] = v; });
        if (SYNC_KEYS.some(k => canon(m[k]) !== canon(remote[k]))) {
          try { await api('/put', { code, data: m, ver: g.ver }); }
          catch (e) { if (e.code === 'conflict' && i < 2) continue; throw e; }
        }
        merged = m;
      }
      if (!merged) { const er = new Error('busy'); er.code = 'busy'; throw er; }
      status = 'Saved online at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.';
      lastSnap = before;

      if (applyToDevice) {
        let changed = false;
        SYNC_KEYS.forEach(k => {
          if (merged[k] != null && canon(merged[k]) !== canon(local[k])) { try { localStorage.setItem(k, merged[k]); changed = true; } catch (e) {} }
        });
        if (changed) {
          // pokedex.js keeps its data in memory, so a quick reload is the safe way to pick the merged data up
          let already = false;
          try { already = !!sessionStorage.getItem(RELOAD_FLAG); sessionStorage.setItem(RELOAD_FLAG, '1'); } catch (e) {}
          if (!already) { reloading = true; status = 'Loaded your saved progress. Reloading...'; setTimeout(() => location.reload(), 700); }
        } else {
          try { sessionStorage.removeItem(RELOAD_FLAG); } catch (e) {}
        }
        if (!reloading) lastSnap = localCanon();
      }
    } catch (e) {
      status = errText(e);
    } finally {
      busy = false;
      refresh();
    }
  }

  async function createCode() {
    const code = genCode();
    await api('/put', { code, data: snapshotLocal(), create: true });
    setCode(code);
    lastSnap = localCanon();
    status = 'Saved online.';
    return code;
  }

  // push changes (cheap local check; only talks to the server when something changed)
  setInterval(() => { if (getCode() && !document.hidden && localCanon() !== lastSnap) syncNow(false); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && getCode() && localCanon() !== lastSnap) syncNow(false); });

  // Reset Pokedex must clear the online copy too, otherwise the next merge would bring it back
  async function forceKey(k) {
    const code = getCode();
    if (!code || !configured) return;
    try {
      for (let i = 0; i < 3; i++) {
        const g = await api('/get', { code });
        const data = cleanRemote(g.data), v = localStorage.getItem(k);
        if (v == null) delete data[k]; else data[k] = v;
        try { await api('/put', { code, data, ver: g.ver }); lastSnap = localCanon(); return; }
        catch (e) { if (e.code !== 'conflict') return; }
      }
    } catch (e) {}
  }
  function hookReset() {
    try {
      const P = window.Pokedex;
      if (!P || P.__pbSave || typeof P.reset !== 'function') return;
      const orig = P.reset;
      P.reset = function () { const r = orig.apply(this, arguments); forceKey('pokeblur-pokedex'); return r; };
      P.__pbSave = true;
    } catch (e) {}
  }

  // ---------- window ----------
  const css = `#pbs-ov{position:fixed;inset:0;z-index:10050;background:rgba(10,16,19,.8);display:flex;align-items:center;justify-content:center;padding:14px}
  #pbs-ov.hidden{display:none}.pbs-box{background:#1a262c;border:2px solid #3a4b52;border-radius:18px;color:#fff;width:min(440px,100%);max-height:100%;overflow:auto;padding:18px;text-align:left;scrollbar-width:none}
  .pbs-box::-webkit-scrollbar{display:none}.pbs-box h3{margin:0 0 6px;font-size:20px}.pbs-box p{margin:6px 0 10px;color:#9ba8b0;font-size:13px;line-height:1.4}
  .pbs-code{font:700 18px/1.3 monospace;letter-spacing:.04em;text-align:center;background:#222e35;border:2px solid #3a4b52;border-radius:10px;padding:12px 8px;margin:8px 0;user-select:all;-webkit-user-select:all;word-break:break-all}
  .pbs-in{width:100%;box-sizing:border-box;background:#222e35;color:#fff;border:2px solid #3a4b52;border-radius:10px;padding:10px;font:15px monospace;text-transform:uppercase}
  .pbs-row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.pbs-row button{flex:1;min-width:120px}.pbs-msg{margin-top:10px;font-size:13px;min-height:18px}.pbs-ok{color:#2ecc71}.pbs-err{color:#ff7a78}
  .pbs-warn{color:#ffcb05!important}.pbs-danger{border-color:#7a3b42!important;color:#ff7a87!important}.pbs-danger.confirm{background:#7a3b42!important;color:#fff!important}`;
  let ov = null, msg = null;
  const say = (t, ok) => { if (msg) { msg.textContent = t || ''; msg.className = 'pbs-msg ' + (ok ? 'pbs-ok' : 'pbs-err'); } };
  const setBusyUI = b => { if (ov) ov.querySelectorAll('button').forEach(x => { x.disabled = b; }); };

  function refresh() {   // called after background syncs
    if (ov && !ov.classList.contains('hidden')) { const keep = msg && msg.textContent; render(); if (!keep && status) say(status, /^Saved|^Loaded/.test(status)); }
  }
  function render() {
    const body = ov.querySelector('.pbs-body'), code = getCode();
    if (!configured) { body.innerHTML = '<p>Save codes are not switched on yet.</p><div class="pbs-row"><button class="action-btn" data-a="close" type="button">Close</button></div><div class="pbs-msg"></div>'; msg = body.querySelector('.pbs-msg'); return; }
    if (!code) {
      body.innerHTML = `<p>Get one personal code that never changes. Type it into any phone or browser to load your latest Pokédex, stats and streaks. No account, email or password.</p>
        <div class="pbs-row"><button class="action-btn" data-a="create" type="button">Create my code</button></div>
        <p style="margin-top:16px">Already have a code?</p>
        <input class="pbs-in" placeholder="PB-XXXX-XXXX-XXXX-XXXX" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Save code">
        <div class="pbs-row"><button class="action-btn" data-a="use" type="button">Use this code</button></div>
        <div class="pbs-msg"></div><div class="pbs-row"><button class="action-btn" data-a="close" type="button">Close</button></div>`;
    } else {
      body.innerHTML = `<p>This is your save code. It's the same on every device, and progress from all of them combines automatically.</p>
        <div class="pbs-code" id="pbs-code">${shown ? fmt(code) : mask()}</div>
        <div class="pbs-row"><button class="action-btn" data-a="copy" type="button">Copy code</button><button class="action-btn" data-a="toggle" type="button">${shown ? 'Hide' : 'Show'}</button></div>
        <p class="pbs-warn">Keep it private: anyone with this code can load and overwrite your progress. If you lose it, nobody can get it back.</p>
        <div class="pbs-row"><button class="action-btn" data-a="sync" type="button">Sync now</button><button class="action-btn" data-a="unlink" type="button">Unlink this device</button></div>
        <div class="pbs-row"><button class="action-btn pbs-danger" data-a="delete" type="button">Delete online save</button></div>
        <div class="pbs-msg"></div><div class="pbs-row"><button class="action-btn" data-a="close" type="button">Close</button></div>`;
    }
    msg = body.querySelector('.pbs-msg');
  }

  async function onAction(a) {
    const code = getCode();
    if (a === 'close') { close(); return; }
    if (a === 'toggle') { shown = !shown; render(); return; }
    if (a === 'copy' && code) {
      try { await navigator.clipboard.writeText(fmt(code)); say('Copied! Keep it somewhere safe.', true); }
      catch (e) { shown = true; render(); const el = $('pbs-code'); if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } say('Press and hold the code, then Copy.', false); }
      return;
    }
    if (a === 'create') {
      setBusyUI(true);
      try { await createCode(); shown = true; render(); say('Code created and saved! Copy it somewhere safe.', true); }
      catch (e) { render(); say(errText(e)); }
      return;
    }
    if (a === 'use') {
      const c = normalize(ov.querySelector('.pbs-in').value);
      if (!c) { say("That doesn't look like a save code (PB- then 16 letters/numbers)."); return; }
      setBusyUI(true);
      try {
        await api('/get', { code: c });
        if (!confirm("Combine this device's progress with the saved progress for this code?")) { render(); return; }
        setCode(c); shown = false; status = '';
        await syncNow(true);
        render(); say(status, /^Saved|^Loaded/.test(status));
      } catch (e) { render(); say(errText(e)); }
      return;
    }
    if (a === 'sync') { setBusyUI(true); await syncNow(true); render(); say(status, /^Saved|^Loaded/.test(status)); return; }
    if (a === 'unlink') {
      if (!confirm('Unlink this device? Your online save stays safe, and you can reconnect any time with the code.')) return;
      setCode(''); shown = false; status = ''; render(); say('This device is unlinked.', true); return;
    }
    if (a === 'delete') {
      const b = ov.querySelector('[data-a="delete"]');
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm'); b.textContent = 'Tap again to delete';
        clearTimeout(deleteTimer); deleteTimer = setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = 'Delete online save'; } }, 4000);
        return;
      }
      clearTimeout(deleteTimer); setBusyUI(true);
      try { await api('/delete', { code }); setCode(''); shown = false; status = ''; render(); say('Online save deleted. Progress on this device is kept.', true); }
      catch (e) { render(); say(errText(e)); }
    }
  }
  const $ = id => document.getElementById(id);

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    ov = document.createElement('div'); ov.id = 'pbs-ov'; ov.className = 'hidden';
    ov.innerHTML = '<div class="pbs-box" role="dialog" aria-modal="true" aria-label="Save code"><h3>Save code</h3><div class="pbs-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      if (e.target === ov) { close(); return; }
      const b = e.target.closest('button[data-a]');
      if (b && !b.disabled) onAction(b.dataset.a);
    });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter') { e.stopPropagation(); if (e.target.classList && e.target.classList.contains('pbs-in')) onAction('use'); }
    });
  }
  function open() {
    if (!ov) build();
    render();
    ov.classList.remove('hidden');
    if (configured && getCode() && !busy) syncNow(false);
  }
  function close() { if (ov) ov.classList.add('hidden'); }

  window.PBSave = { open, close, syncNow, configured };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookReset); else hookReset();
  // a linked device quietly merges the online save in each time the game opens
  if (configured && getCode()) {
    const go = () => setTimeout(() => syncNow(true), 1500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();