// ==========================================
// POKÉDEX
// Two layers on the same entry (Normal + Shiny), saved in localStorage only.
// game.js calls dexLog() when a round ends (Reverse and Versus do not count); everything else lives here.
// Entries are per SPECIES (1-1025): guessing "Mega Charizard X" counts for Charizard.
// ==========================================
(function () {
  'use strict';

  const KEY = 'pokeblur-pokedex';
  const MUTE_KEY = 'pokeblur-dex-muted';
  const TOTAL = 1025;
  const STAGES = 6;
  const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const ART = SPRITE + 'other/official-artwork/';
  const MILESTONES_N = [100, 250, 500, 750, 1000, 1025];
  const MILESTONES_S = [10, 25, 50, 100, 250, 500, 1000, 1025];

  // Game modes that count toward the Pokédex (Versus does not). Order = border rarity, rarest last.
  // Reverse and Versus are their own thing and don't count.
  const MODES = ['unlimited', 'timed', 'daily'];
  const MODE_BIT = { unlimited: 0, timed: 1, reverse: 2, daily: 3 };   // fixed bit slots (2 is retired) so saved data never shifts
  const MODE_NAME = { unlimited: 'Unlimited', timed: 'Timed', daily: 'Daily' };
  const MODE_NOTE = {
    unlimited: 'Caught in Unlimited',
    timed: 'Caught under the clock',
    daily: 'Caught in the Daily puzzle'
  };
  function modeOf(raw) {
    const m = String(raw || '').toLowerCase();
    return MODES.find(x => m.indexOf(x) !== -1) || '';
  }
  // Tier = how early (how blurry) you got it. Stage 0 = a mode with no blur stages (Reverse).
  function tierOf(stage) {
    if (stage >= 1 && stage <= 2) return 'sharp';
    if (stage >= 3 && stage <= 4) return 'good';
    return 'clear';
  }
  const TIER_NAME = { sharp: 'Sharp catch', good: 'Good catch', clear: 'Clear catch' };

  // ---------- storage ----------
  // store.e[id] = { n: [seen, caught, bestStage, firstCaughtTs, lastTs, modeMask, chosenBorder], s: [...same, shiny layer] }
  // modeMask: bit i set = caught in MODES[i]. chosenBorder: 1 + index into MODES (0 = automatic / rarest).
  // Older saves only have the first 5 slots; the missing ones read as 0.
  let store = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.e && typeof raw.e === 'object') return raw;
    } catch (e) {}
    return { v: 1, e: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }
  function layerKey(shiny) { return shiny ? 's' : 'n'; }
  function rec(id, shiny) {
    const e = store.e[id];
    const r = (e && e[layerKey(shiny)]) || [0, 0, 0, 0, 0, 0, 0];
    return r;
  }
  function ownedModes(id, shiny) {
    const mask = rec(id, shiny)[5] | 0;
    return MODES.filter(m => mask & (1 << MODE_BIT[m]));
  }
  function borderFor(id, shiny) {
    const owned = ownedModes(id, shiny);
    if (!owned.length) return '';
    const pick = (rec(id, shiny)[6] | 0) - 1;
    if (pick >= 0 && owned.indexOf(MODES[pick]) !== -1) return MODES[pick];
    return owned[owned.length - 1];   // rarest owned
  }
  function ensure(id, shiny) {
    if (!store.e[id]) store.e[id] = {};
    const k = layerKey(shiny);
    if (!store.e[id][k]) store.e[id][k] = [0, 0, 0, 0, 0, 0, 0];
    while (store.e[id][k].length < 7) store.e[id][k].push(0);
    return store.e[id][k];
  }
  function stateOf(id, shiny) {
    const r = rec(id, shiny);
    return r[1] > 0 ? 'caught' : (r[0] > 0 ? 'missed' : 'unseen');
  }
  function stats(shiny) {
    let caught = 0, seen = 0, rounds = 0, wins = 0, sharp = 0;
    for (let id = 1; id <= TOTAL; id++) {
      const r = rec(id, shiny);
      if (r[0] > 0) seen++;
      if (r[1] > 0) caught++;
      if (r[1] > 0 && r[2] > 0 && tierOf(r[2]) === 'sharp') sharp++;
      rounds += r[0];
      wins += r[1];
    }
    return { caught, seen, rounds, wins, sharp, acc: rounds ? Math.round((wins / rounds) * 100) : null };
  }

  // ---------- species lookup ----------
  let nameMap = null, nameMapSize = -1;
  function listReady() {
    return typeof allPokemonList !== 'undefined' && allPokemonList.length >= TOTAL;
  }
  function dexIdFor(rawName) {
    if (!listReady()) return null;
    if (!nameMap || nameMapSize !== allPokemonList.length) {
      nameMap = new Map();
      allPokemonList.forEach(p => nameMap.set(p.rawName, p.dexId));
      nameMapSize = allPokemonList.length;
    }
    const id = nameMap.get(rawName);
    return id && id <= TOTAL ? id : null;
  }
  function entryFor(id) {
    if (!listReady()) return null;
    const p = allPokemonList[id - 1];
    return p && p.id === id ? p : null;
  }
  // ---------- forms ----------
  // Slots stay per SPECIES (1-1025). Every form you catch is remembered, and you pick which one the card shows.
  // store.e[id].forms = { n: [rawName...], s: [...] }   store.e[id].pick = { n: rawName, s: rawName }
  // Forms the game excludes (they look the same as the base) are never caught, and are filtered here too.
  let formMap = null, formMapSize = -1;
  function formEntry(rawName) {
    if (!listReady() || !rawName) return null;
    if (!formMap || formMapSize !== allPokemonList.length) {
      formMap = new Map();
      allPokemonList.forEach(p => formMap.set(p.rawName, p));
      formMapSize = allPokemonList.length;
    }
    return formMap.get(rawName) || null;
  }
  function formsOf(id, shiny) {
    const e = store.e[id];
    const raw = (e && e.forms && e.forms[layerKey(shiny)]) || [];
    const out = [];
    raw.forEach(n => { const f = formEntry(n); if (f && !f.excluded) out.push(f); });
    return out;
  }
  // The form a caught card displays: your pick, else the base form if you have it, else the first one you caught
  function shownEntry(id, shiny) {
    const base = entryFor(id);
    if (stateOf(id, shiny) !== 'caught') return base;
    const forms = formsOf(id, shiny);
    if (!forms.length) return base;
    const e = store.e[id], pick = e.pick && e.pick[layerKey(shiny)];
    return forms.find(f => f.rawName === pick) || forms.find(f => f.id === id) || forms[0];
  }
  function homeFemale(f, shiny) { return SPRITE + 'other/home/' + (shiny ? 'shiny/' : '') + 'female/' + f.dexId + '.png'; }
  function formSprite(f, shiny) {
    if (f.synthetic) return homeFemale(f, shiny);
    return SPRITE + (shiny ? 'shiny/' : '') + (f.spriteId || f.id) + '.png';
  }
  function formArt(f, shiny) {
    if (f.synthetic) return homeFemale(f, shiny);
    return ART + (shiny ? 'shiny/' : '') + (f.spriteId || f.id) + '.png';
  }
  function rememberForm(id, shiny, rawName) {
    const f = formEntry(rawName);
    if (!f || f.excluded) return;
    const e = store.e[id];
    if (!e.forms) e.forms = { n: [], s: [] };
    const k = layerKey(shiny);
    if (!e.forms[k]) e.forms[k] = [];
    if (e.forms[k].indexOf(rawName) === -1) e.forms[k].push(rawName);
  }

  const pad = n => String(n).padStart(3, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const $ = id => document.getElementById(id);

  // ---------- sound (uses the game's audio context; own mute switch) ----------
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  function tone(freq, delay, dur, type, vol) {
    if (muted) return;
    try {
      const ctx = getGameAudioCtx();
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  const clickSound = () => tone(1400, 0, 0.04, 'triangle', 0.025);
  function shineSound() {
    [1318.5, 1568, 2093, 2637, 3136].forEach((f, i) => tone(f, i * 0.09, 0.28, 'sine', 0.06));
  }
  function dingSound() {
    tone(1046.5, 0, 0.12, 'sine', 0.05);
    tone(1568, 0.1, 0.2, 'sine', 0.05);
  }

  // ---------- header + chip counters ----------
  function refreshBadges() {
    const c = stats(false).caught;
    const hb = $('dex-header-count');
    if (hb) hb.textContent = c;
    document.querySelectorAll('[data-dex-count]').forEach(el => { el.textContent = `${c} / ${TOTAL}`; });
  }
  function pulseHeaderButton() {
    const b = $('dex-open-btn');
    if (!b || reduced()) return;
    b.classList.remove('dex-pulse');
    void b.offsetWidth;
    b.classList.add('dex-pulse');
  }

  // ---------- catch moment ----------
  function newTag(shiny) {
    const b = $('dex-open-btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const tag = document.createElement('div');
    tag.className = 'dex-new-tag' + (shiny ? ' shiny' : '');
    tag.textContent = shiny ? 'NEW SHINY!' : 'NEW!';
    tag.style.left = (r.left + r.width / 2) + 'px';
    tag.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(tag);
    setTimeout(() => tag.remove(), 1900);
  }

  function sparkle(x, y) {
    const s = document.createElement('div');
    s.className = 'dex-spark';
    s.textContent = '\u2726';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    document.body.appendChild(s);
    const dx = (Math.random() - 0.5) * 40, dy = (Math.random() - 0.5) * 40;
    const a = s.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(90deg)`, opacity: 0 }
    ], { duration: 600, easing: 'ease-out' });
    a.onfinish = () => s.remove();
  }

  // The catch fly-in is short and never gets in the way: any tap/key (Next, Skip, typing...)
  // or a results panel appearing ends it on the spot, and it still gives the NEW tag / pulse.
  const flies = new Set();
  function cancelFlies() {
    flies.forEach(f => f.end());
  }
  function anyResultsVisible() {
    return ['game-over-panel', 'unlimited-game-over-panel', 'daily-review'].some(id => {
      const p = $(id);
      // Must be on screen, not just missing the 'hidden' class: a finished Daily's panel stays un-hidden inside the hidden Daily view,
      // which used to make every catch in Unlimited skip its fly-in animation.
      return p && !p.classList.contains('hidden') && p.getClientRects().length > 0;
    });
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, cancelFlies, true));

  function fly(el, shiny, first, done) {
    const btn = $('dex-open-btn');
    if (!el || !btn || !el.src || reduced() || !el.animate) { done(); return; }
    const r = el.getBoundingClientRect(), t = btn.getBoundingClientRect();
    if (!r.width || !r.height || !t.width) { done(); return; }

    const clone = document.createElement('img');
    clone.className = 'dex-fly';
    clone.alt = '';
    clone.src = el.currentSrc || el.src;
    clone.style.left = r.left + 'px';
    clone.style.top = r.top + 'px';
    clone.style.width = r.width + 'px';
    clone.style.height = r.height + 'px';
    document.body.appendChild(clone);

    const dx = (t.left + t.width / 2) - (r.left + r.width / 2);
    const dy = (t.top + t.height / 2) - (r.top + r.height / 2);
    const scale = Math.max(0.06, 26 / Math.max(r.width, 1));
    const dur = first ? 600 : 380;

    const anim = clone.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.1}px, ${dy * 0.1 - 20}px) scale(1.05)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.85, offset: 1 }
    ], { duration: dur, easing: 'cubic-bezier(.45,0,.2,1)' });

    let trail = null;
    if (shiny) {
      trail = setInterval(() => {
        const b = clone.getBoundingClientRect();
        sparkle(b.left + b.width / 2, b.top + b.height / 2);
      }, 45);
    }
    let over = false;
    const handle = {
      end() {
        if (over) return;
        over = true;
        flies.delete(handle);
        clearInterval(trail);
        try { anim.cancel(); } catch (e) {}
        clone.remove();
        done();
      }
    };
    flies.add(handle);
    anim.onfinish = handle.end;
  }

  function toast(msg, gold) {
    let t = $('dex-global-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dex-global-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('gold', !!gold);
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function checkMilestone(shiny, before, after) {
    const list = shiny ? MILESTONES_S : MILESTONES_N;
    const hit = list.filter(m => before < m && after >= m).pop();
    if (!hit) return;
    setTimeout(() => {
      toast(`${hit} ${shiny ? 'shiny ' : ''}Pokémon caught!`, shiny);
      if (typeof launchConfetti === 'function' && !reduced()) launchConfetti();
    }, 700);
  }

  // ---------- Timed Mode: no fly-in, a summary at the end instead ----------
  // Timed rounds are seconds long, so a 1-second animation per catch gets in the way.
  // New catches pop the header button + "NEW!" tag instantly, and the Time's Up panel lists them.
  let timedNew = [];
  function renderTimedSummary() {
    const panelEl = $('timed-game-over-panel');
    if (!panelEl) return;
    let box = $('dex-timed-new');
    if (panelEl.classList.contains('hidden')) { if (box) box.remove(); return; }
    if (!timedNew.length) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'dex-timed-new';
      box.className = 'dex-timed-new';
      const actions = panelEl.querySelector('.timed-over-actions');
      panelEl.insertBefore(box, actions || null);
    }
    const shown = timedNew.slice(0, 10);
    const more = timedNew.length - shown.length;
    box.innerHTML = `<span class="dex-timed-new-title">${timedNew.length} new Pokédex ${timedNew.length === 1 ? 'entry' : 'entries'}</span>` +
      `<span class="dex-timed-new-row">${shown.map(n => `<img src="${formEntry(n.raw) ? formSprite(formEntry(n.raw), n.shiny) : spriteUrl(n.id, n.shiny)}" alt="" width="40" height="40">`).join('')}` +
      `${more > 0 ? `<b>+${more}</b>` : ''}</span>`;
  }
  function wireTimedSummary() {
    const panelEl = $('timed-game-over-panel');
    if (!panelEl || panelEl._dexWatched) return;
    panelEl._dexWatched = true;
    new MutationObserver(renderTimedSummary).observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    ['timed-start-btn', 'timed-play-again-btn'].forEach(id => {
      const b = $(id);
      if (b) b.addEventListener('click', () => { timedNew = []; });
    });
  }

  // ---------- public: log a finished round ----------
  // stage = 1-6 if the round used the blur stages, else 0
  // mode  = 'daily' | 'unlimited' | 'timed' ('reverse' and 'versus' are ignored)
  function log(opts) {
    try {
      const rawMode = String(opts.mode || '').toLowerCase();
      if (rawMode.indexOf('versus') !== -1 || rawMode.indexOf('reverse') !== -1) return;   // these modes have no Pokédex
      const id = dexIdFor(opts.rawName);
      if (!id) return;
      const shiny = !!opts.shiny;
      const mode = modeOf(opts.mode);
      const before = stats(shiny).caught;
      const r = ensure(id, shiny);
      const first = !!opts.caught && r[1] === 0;
      r[0]++;
      r[4] = Date.now();
      if (opts.caught) {
        r[1]++;
        if (opts.stage > 0 && (r[2] === 0 || opts.stage < r[2])) r[2] = opts.stage;
        if (!r[3]) r[3] = Date.now();
        if (mode) r[5] = (r[5] | 0) | (1 << MODE_BIT[mode]);
        rememberForm(id, shiny, opts.rawName);
      }
      save();
      refreshBadges();
      if (panelOpen) renderAll(false);

      if (!opts.caught) return;
      const after = before + (first ? 1 : 0);
      const finish = () => {
        pulseHeaderButton();
        if (first) {
          newTag(shiny);
          if (shiny) shineSound(); else dingSound();
          checkMilestone(shiny, before, after);
        }
      };
      if (mode === 'timed') {
        if (first) timedNew.push({ id, shiny, raw: opts.rawName });
        wireTimedSummary();
        finish();                                   // instant, no flight
      } else if (panelOpen || anyResultsVisible() || (window.Settings && !window.Settings.get('celebrate'))) {
        finish();                                   // Pokédex open, or a results panel is up: no flight over the buttons
      } else {
        fly(opts.el, shiny, first, finish);
      }
    } catch (e) { console.error('[Pokédex] log failed', e); }
  }

  // ==========================================
  // PANEL
  // ==========================================
  let panel = null, panelOpen = false, layerShiny = false, genFilter = 0, statusFilter = 'all', query = '', searchTimer = null;
  let visibleIds = [], io = null, detailId = null, lastOpener = null, pausedTimed = false, waitTimer = null;
  const RING_C = 2 * Math.PI * 52;
  const RING_C2 = 2 * Math.PI * 43;

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'dex-panel';
    panel.className = 'dex-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Pokédex');
    panel.inert = true;
    panel.innerHTML = `
      <div class="dex-topbar">
        <button type="button" class="dex-icon-btn" id="dex-close" aria-label="Close Pokédex">&#10005;</button>
        <h2>Pokédex</h2>
        <button type="button" class="dex-icon-btn" id="dex-sound" aria-label="Toggle Pokédex sounds"></button>
      </div>
      <div class="dex-scroll" id="dex-scroll">
        <div class="dex-toggle" id="dex-toggle" data-layer="n" role="group" aria-label="Pokédex layer">
          <span class="dex-toggle-thumb"></span>
          <button type="button" data-layer="n" class="active" aria-pressed="true">Normal</button>
          <button type="button" data-layer="s" aria-pressed="false">Shiny</button>
        </div>

        <div class="dex-summary">
          <div class="dex-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <defs>
                <linearGradient id="dex-grad-n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#4cd137"/></linearGradient>
                <linearGradient id="dex-grad-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f9e27d"/><stop offset="1" stop-color="#e1a100"/></linearGradient>
              </defs>
              <circle class="dex-ring-bg" cx="60" cy="60" r="52"/>
              <circle class="dex-ring-fg" id="dex-ring-fg" cx="60" cy="60" r="52" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
              <circle class="dex-ring-bg dex-ring-bg2" cx="60" cy="60" r="43"/>
              <circle class="dex-ring-fg2" id="dex-ring-fg2" cx="60" cy="60" r="43" stroke-dasharray="${RING_C2}" stroke-dashoffset="${RING_C2}"/>
            </svg>
            <div class="dex-ring-text">
              <b id="dex-ring-num">0</b>
              <span>/ ${TOTAL}</span>
              <em id="dex-ring-label">caught</em>
            </div>
            <div class="dex-ring-sharp"><i></i><span id="dex-sharp-num">0</span> sharp</div>
          </div>
          <div class="dex-tiles">
            <div class="dex-tile"><b id="dex-t-seen">0</b><span>Seen</span></div>
            <div class="dex-tile"><b id="dex-t-rounds">0</b><span>Rounds</span></div>
            <div class="dex-tile"><b id="dex-t-acc">-</b><span id="dex-t-acc-label">Accuracy</span></div>
          </div>
        </div>

        <div class="dex-gen-bars" id="dex-gen-bars" aria-label="Progress by generation"></div>

        <div class="dex-search">
          <input type="search" id="dex-search" placeholder="Search name or number..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search the Pokédex">
        </div>

        <div class="dex-row">
          <div class="dex-chips" id="dex-status-chips">
            <button type="button" class="dex-chip-btn active" data-status="all">All</button>
            <button type="button" class="dex-chip-btn" data-status="caught">Caught</button>
            <button type="button" class="dex-chip-btn" data-status="missed">Missed</button>
            <button type="button" class="dex-chip-btn" data-status="unseen">Unseen</button>
            <span class="dex-chip-sep" aria-hidden="true"></span>
            <button type="button" class="dex-chip-btn tier-chip t-sharp" data-status="sharp">Sharp</button>
            <button type="button" class="dex-chip-btn tier-chip t-good" data-status="good">Good</button>
            <button type="button" class="dex-chip-btn tier-chip t-clear" data-status="clear">Clear</button>
          </div>
          <button type="button" class="dex-random-btn" id="dex-random">Random unseen</button>
        </div>

        <div class="dex-gen-sticky" id="dex-gen-sticky">
          <div class="dex-chips dex-chips-scroll" id="dex-gen-chips">
            <button type="button" class="dex-chip-btn active" data-gen="0">All gens</button>
            ${[1,2,3,4,5,6,7,8,9].map(g => `<button type="button" class="dex-chip-btn" data-gen="${g}">Gen ${g}</button>`).join('')}
          </div>
        </div>

        <p class="dex-legend" aria-label="Catch tiers"><span class="lg-sharp"><i></i>Sharp <small>stage 1-2</small></span><span class="lg-good"><i></i>Good <small>3-4</small></span><span class="lg-clear"><i></i>Clear <small>5-6</small></span></p>

        <p class="dex-empty hidden" id="dex-empty"></p>
        <div class="dex-grid" id="dex-grid"></div>
        <p class="dex-note">Forms and regional variants count toward their base Pokémon. Reverse and Versus rounds don't count.</p>
      </div>

      <div class="dex-detail hidden" id="dex-detail" aria-hidden="true">
        <div class="dex-detail-backdrop" id="dex-detail-backdrop"></div>
        <div class="dex-detail-body">
          <div class="dex-tilt" id="dex-tilt">
            <div class="dex-flip" id="dex-flip" tabindex="0" role="button" aria-label="Flip card">
              <div class="dex-flip-inner" id="dex-flip-inner">
                <div class="dex-face dex-front" id="dex-front"></div>
                <div class="dex-face dex-back" id="dex-back"></div>
              </div>
            </div>
          </div>
          <div class="dex-detail-nav">
            <button type="button" class="dex-icon-btn" id="dex-prev" aria-label="Previous Pokémon">&#8249;</button>
            <button type="button" class="dex-icon-btn" id="dex-detail-close" aria-label="Close card">&#10005;</button>
            <button type="button" class="dex-icon-btn" id="dex-next" aria-label="Next Pokémon">&#8250;</button>
          </div>
          <p class="dex-hint">Tap the card to flip it and choose a border</p>
        </div>
      </div>
      <div class="dex-toast" id="dex-toast" role="status"></div>
    `;
    document.body.appendChild(panel);
    wirePanel();
    paintSoundButton();
  }

  function paintSoundButton() {
    const b = $('dex-sound');
    if (!b) return;
    b.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    b.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  function wirePanel() {
    $('dex-close').addEventListener('click', closePanel);
    $('dex-sound').addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      paintSoundButton();
      clickSound();
    });

    $('dex-toggle').addEventListener('click', e => {
      const b = e.target.closest('button[data-layer]');
      if (!b) return;
      setLayer(b.dataset.layer === 's');
    });

    $('dex-status-chips').addEventListener('click', e => {
      const b = e.target.closest('button[data-status]');
      if (!b) return;
      statusFilter = b.dataset.status;
      document.querySelectorAll('#dex-status-chips .dex-chip-btn').forEach(x => x.classList.toggle('active', x === b));
      clickSound();
      renderGrid();
    });

    $('dex-gen-chips').addEventListener('click', e => {
      const b = e.target.closest('button[data-gen]');
      if (!b) return;
      genFilter = parseInt(b.dataset.gen, 10);
      document.querySelectorAll('#dex-gen-chips .dex-chip-btn').forEach(x => x.classList.toggle('active', x === b));
      clickSound();
      renderGrid();
      $('dex-scroll').scrollTo({ top: Math.max(0, $('dex-grid').offsetTop - $('dex-gen-sticky').offsetHeight - 8), behavior: reduced() ? 'auto' : 'smooth' });
    });

    $('dex-random').addEventListener('click', randomUnseen);

    const search = $('dex-search');
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = search.value.trim().toLowerCase().replace(/^#/, '');
        renderGrid();
      }, 120);
    });
    search.addEventListener('keydown', e => { if (e.key === 'Enter') search.blur(); });   // closes the phone keyboard
    // Bring the search box to the top so the results are visible above the keyboard
    search.addEventListener('focus', () => {
      const sc = $('dex-scroll');
      sc.scrollTo({ top: Math.max(0, search.parentElement.offsetTop - 8), behavior: reduced() ? 'auto' : 'smooth' });
    });

    const grid = $('dex-grid');
    grid.addEventListener('click', e => {
      const c = e.target.closest('.dex-card');
      if (c) openDetail(parseInt(c.dataset.id, 10));
    });
    // Desktop: cards tilt slightly toward the cursor
    grid.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || reduced()) return;
      const c = e.target.closest('.dex-card');
      if (!c) return;
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty('--ry', (px * 14).toFixed(1) + 'deg');
      c.style.setProperty('--rx', (-py * 14).toFixed(1) + 'deg');
    });
    grid.addEventListener('pointerout', e => {
      const c = e.target.closest('.dex-card');
      if (!c) return;
      c.style.removeProperty('--rx');
      c.style.removeProperty('--ry');
    });

    // detail card
    $('dex-detail-backdrop').addEventListener('click', () => closeDetail());
    $('dex-detail-close').addEventListener('click', () => closeDetail());
    $('dex-prev').addEventListener('click', () => stepDetail(-1));
    $('dex-next').addEventListener('click', () => stepDetail(1));
    $('dex-flip').addEventListener('click', flipCard);
    $('dex-flip').addEventListener('keydown', e => {
      if (e.target !== $('dex-flip')) return;   // let the border buttons handle their own keys
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
    });
    // Border buttons live on the back of the card: choosing one must not flip it back
    $('dex-back').addEventListener('click', e => {
      const fb = e.target.closest('.dex-form-opt');
      if (fb) { e.stopPropagation(); chooseForm(fb.dataset.form); return; }
      const b = e.target.closest('.dex-bd-opt');
      if (!b) return;
      e.stopPropagation();
      if (!b.disabled) chooseBorder(b.dataset.border);
    });
    const tilt = $('dex-tilt');
    tilt.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || reduced()) return;
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty('--ry', (px * 12).toFixed(1) + 'deg');
      tilt.style.setProperty('--rx', (-py * 12).toFixed(1) + 'deg');
    });
    tilt.addEventListener('pointerleave', () => {
      tilt.style.removeProperty('--rx');
      tilt.style.removeProperty('--ry');
    });

    // Keep game shortcuts (Enter = next Pokémon) from firing behind the panel
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (detailId) closeDetail(); else closePanel();
        return;
      }
      if (detailId && e.key === 'ArrowLeft') stepDetail(-1);
      if (detailId && e.key === 'ArrowRight') stepDetail(1);
      if (e.key === 'Enter') e.stopPropagation();
    });
  }

  // ---------- open / close ----------
  function openPanel(opener) {
    if (!panel) buildPanel();
    if (panelOpen) return;
    lastOpener = opener || document.activeElement;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // drops the phone keyboard

    if (typeof timedActive !== 'undefined' && timedActive && typeof pauseTimedTimer === 'function') {
      pauseTimedTimer();
      pausedTimed = true;
    }

    panelOpen = true;
    panel.inert = false;
    panel.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('dex-lock');
    panel.classList.add('open');
    $('dex-scroll').scrollTop = 0;
    renderAll(true);
    setTimeout(() => { const c = $('dex-close'); if (c) c.focus({ preventScroll: true }); }, 60);
  }

  function closePanel() {
    if (!panelOpen) return;
    closeDetail(true);
    panelOpen = false;
    clearTimeout(waitTimer);
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    document.documentElement.classList.remove('dex-lock');
    if (pausedTimed) {
      pausedTimed = false;
      if (typeof resumeTimedTimerIfNeeded === 'function') resumeTimedTimerIfNeeded();
    }
    if (lastOpener && lastOpener.focus && document.contains(lastOpener)) {
      try { lastOpener.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function setLayer(shiny) {
    if (layerShiny === shiny) return;
    layerShiny = shiny;
    clickSound();
    renderAll(true);
  }

  // ---------- rendering ----------
  function roll(el, to, ms) {
    if (!el) return;
    if (reduced() || ms === 0) { el.textContent = to; return; }
    const from = parseInt(el.textContent, 10) || 0;
    if (from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = ms || 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderAll(animate) {
    if (!panel) return;
    panel.classList.toggle('shiny-layer', layerShiny);
    const tg = $('dex-toggle');
    tg.dataset.layer = layerShiny ? 's' : 'n';
    tg.querySelectorAll('button').forEach(b => {
      const on = (b.dataset.layer === 's') === layerShiny;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderSummary(animate);
    renderGenBars(animate);

    if (!listReady()) {
      $('dex-grid').innerHTML = '';
      const em = $('dex-empty');
      em.textContent = 'Loading the Pokémon list...';
      em.classList.remove('hidden');
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => { if (panelOpen) renderAll(false); }, 700);
      return;
    }
    renderGrid();
  }

  function renderSummary(animate) {
    const s = stats(layerShiny);
    $('dex-ring-fg').setAttribute('stroke', `url(#dex-grad-${layerShiny ? 's' : 'n'})`);
    $('dex-ring-label').textContent = layerShiny ? 'shiny' : 'caught';
    $('dex-t-acc-label').textContent = layerShiny ? 'Shiny accuracy' : 'Accuracy';

    const target = RING_C * (1 - s.caught / TOTAL);
    const fg = $('dex-ring-fg');
    if (animate && !reduced()) {
      fg.style.transition = 'none';
      fg.style.strokeDashoffset = RING_C;
      void fg.getBoundingClientRect();
      fg.style.transition = '';
      requestAnimationFrame(() => { fg.style.strokeDashoffset = target; });
    } else {
      fg.style.strokeDashoffset = target;
    }
    const fg2 = $('dex-ring-fg2');
    const target2 = RING_C2 * (1 - s.sharp / TOTAL);
    if (fg2) {
      if (animate && !reduced()) {
        fg2.style.transition = 'none';
        fg2.style.strokeDashoffset = RING_C2;
        void fg2.getBoundingClientRect();
        fg2.style.transition = '';
        requestAnimationFrame(() => { fg2.style.strokeDashoffset = target2; });
      } else {
        fg2.style.strokeDashoffset = target2;
      }
    }
    $('dex-sharp-num').textContent = s.sharp;
    const ms = animate ? 750 : 0;
    roll($('dex-ring-num'), s.caught, ms);
    roll($('dex-t-seen'), s.seen, ms);
    roll($('dex-t-rounds'), s.rounds, ms);
    $('dex-t-acc').textContent = s.acc === null ? '-' : s.acc + '%';
  }

  function renderGenBars(animate) {
    const wrap = $('dex-gen-bars');
    if (!listReady()) { wrap.innerHTML = ''; return; }
    const tot = Array(10).fill(0), got = Array(10).fill(0);
    for (let id = 1; id <= TOTAL; id++) {
      const p = entryFor(id);
      const g = p && p.gen ? p.gen : 0;
      if (!g) continue;
      tot[g]++;
      if (stateOf(id, layerShiny) === 'caught') got[g]++;
    }
    let html = '';
    for (let g = 1; g <= 9; g++) {
      const pct = tot[g] ? Math.round((got[g] / tot[g]) * 100) : 0;
      html += `<div class="dex-bar-row"><span class="dex-bar-label">Gen ${g}</span>
        <span class="dex-bar-track"><span class="dex-bar-fill" data-w="${pct}" style="transition-delay:${animate ? g * 60 : 0}ms"></span></span>
        <span class="dex-bar-num">${got[g]}/${tot[g]}</span></div>`;
    }
    wrap.innerHTML = html;
    const fills = wrap.querySelectorAll('.dex-bar-fill');
    if (animate && !reduced()) {
      requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(f => { f.style.width = f.dataset.w + '%'; })));
    } else {
      fills.forEach(f => { f.style.transition = 'none'; f.style.width = f.dataset.w + '%'; });
    }
  }

  function spriteUrl(id, shiny) { return SPRITE + (shiny ? 'shiny/' : '') + id + '.png'; }
  function artUrl(id, shiny) { return ART + (shiny ? 'shiny/' : '') + id + '.png'; }

  // Numbers always match. Names only match Pokémon you've already seen, so "???" entries stay a secret.
  function matchesQuery(id, p, st) {
    if (/^\d+$/.test(query)) return String(id).startsWith(query) || pad(id).startsWith(query);
    if (st === 'unseen') return false;
    return p.lc.includes(query) || formsOf(id, layerShiny).some(f => f.lc.includes(query));
  }

  function renderGrid() {
    const grid = $('dex-grid');
    if (io) { io.disconnect(); io = null; }
    visibleIds = [];
    const frag = document.createDocumentFragment();
    const showStar = !layerShiny;   // normal view shows a star when you've also caught the shiny

    for (let id = 1; id <= TOTAL; id++) {
      const p = entryFor(id);
      if (!p) continue;
      if (genFilter && p.gen !== genFilter) continue;
      const st = stateOf(id, layerShiny);
      if (statusFilter === 'sharp' || statusFilter === 'good' || statusFilter === 'clear') {
        if (st !== 'caught' || tierOf(rec(id, layerShiny)[2]) !== statusFilter) continue;
      } else if (statusFilter !== 'all' && st !== statusFilter) continue;
      if (query && !matchesQuery(id, p, st)) continue;
      visibleIds.push(id);

      const card = document.createElement('button');
      card.type = 'button';
      const r = rec(id, layerShiny);
      const tier = st === 'caught' ? tierOf(r[2]) : '';
      const bd = st === 'caught' ? borderFor(id, layerShiny) : '';
      card.className = `dex-card state-${st}` + (tier ? ` tier-${tier}` : '') + (bd ? ` bd-${bd}` : '') + (layerShiny && st === 'caught' ? ' foil' : '');
      card.dataset.id = id;
      const label = st === 'unseen' ? 'not seen yet' : (st === 'caught' ? `${TIER_NAME[tier].toLowerCase()}${bd ? ', ' + MODE_NAME[bd] : ''}` : 'seen, not caught');
      card.setAttribute('aria-label', `#${pad(id)} ${st === 'unseen' ? 'Unknown' : p.displayName}, ${label}`);
      const shown = shownEntry(id, layerShiny) || p;
      const nForms = st === 'caught' ? formsOf(id, layerShiny).length : 0;
      const badge = nForms > 1 ? `<span class="dex-forms-badge" title="${nForms} forms caught">+${nForms - 1}</span>` : '';
      const star = showStar && stateOf(id, true) === 'caught' ? '<span class="dex-star" title="Also caught as shiny">&#9733;</span>' : '';
      card.innerHTML = `<span class="dex-num">${pad(id)}</span><span class="dex-dot"></span>${star}` +
        `<span class="dex-img"><img data-src="${st === 'caught' ? formSprite(shown, layerShiny) : spriteUrl(id, layerShiny)}" data-fallback="${spriteUrl(id, layerShiny)}" alt="" decoding="async" width="96" height="96"${tier && r[2] ? ` data-stage="${r[2]}"` : ''}></span>${badge}` +
        `<span class="dex-name">${st === 'unseen' ? '???' : esc(st === 'caught' ? shown.displayName : p.displayName)}</span>`;
      frag.appendChild(card);
    }

    grid.innerHTML = '';
    grid.appendChild(frag);

    const em = $('dex-empty');
    if (!visibleIds.length) {
      em.textContent = query
        ? 'No match. Names only work for Pokémon you have seen; search by number to find the rest.'
        : 'Nothing here yet. Try another filter.';
      em.classList.remove('hidden');
    } else {
      em.classList.add('hidden');
    }

    // Only load the sprites that are near the screen
    const imgs = grid.querySelectorAll('img[data-src]');
    const load = img => {
      img.addEventListener('error', () => {
        const fb = img.dataset.fallback;
        if (fb && img.src !== fb && !img.dataset.triedFb) { img.dataset.triedFb = '1'; img.src = fb; }   // form art missing: show the base sprite
        else img.classList.add('broken');
      });
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    };
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (en.isIntersecting) { load(en.target); io.unobserve(en.target); }
        });
      }, { root: $('dex-scroll'), rootMargin: '700px 0px' });
      imgs.forEach(i => io.observe(i));
    } else {
      imgs.forEach(load);
    }
  }

  function randomUnseen() {
    clickSound();
    if (!listReady()) return;
    const pool = [];
    for (let id = 1; id <= TOTAL; id++) {
      const p = entryFor(id);
      if (!p) continue;
      if (genFilter && p.gen !== genFilter) continue;
      if (stateOf(id, layerShiny) === 'unseen') pool.push(id);
    }
    if (!pool.length) { showToast(genFilter ? 'You have met every Pokémon in this generation!' : 'You have met every Pokémon!'); return; }
    const id = pool[Math.floor(Math.random() * pool.length)];
    if (statusFilter !== 'all' || query) {
      statusFilter = 'all';
      query = '';
      $('dex-search').value = '';
      document.querySelectorAll('#dex-status-chips .dex-chip-btn').forEach(x => x.classList.toggle('active', x.dataset.status === 'all'));
      renderGrid();
    }
    const card = $('dex-grid').querySelector(`.dex-card[data-id="${id}"]`);
    if (!card) return;
    const sc = $('dex-scroll');
    const top = card.offsetTop - sc.clientHeight / 2 + card.offsetHeight / 2;
    sc.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    card.classList.remove('dex-found');
    void card.offsetWidth;
    card.classList.add('dex-found');
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function showToast(msg) {
    const t = $('dex-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- detail card ----------
  function fmtDate(ts) {
    if (!ts) return '-';
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return '-'; }
  }

  function recordBlock(id, shiny) {
    const r = rec(id, shiny), st = stateOf(id, shiny);
    const status = st === 'caught' ? 'Caught' : (st === 'missed' ? 'Missed' : 'Not seen yet');
    let body = '';
    if (st !== 'unseen') {
      body += `<li><span>Seen</span><b>${r[0]}&times;</b></li><li><span>Caught</span><b>${r[1]}&times;</b></li>`;
      if (r[2]) body += `<li><span>Best catch</span><b>Stage ${r[2]} of ${STAGES} (${tierOf(r[2])})</b></li>`;
      if (r[3]) body += `<li><span>First caught</span><b>${fmtDate(r[3])}</b></li>`;
    }
    return `<section class="dex-rec ${shiny ? 'is-shiny' : ''} st-${st}">
      <h4>${shiny ? 'Shiny &#9733;' : 'Normal'}<span class="dex-pill">${status}</span></h4>
      ${body ? `<ul>${body}</ul>` : ''}</section>`;
  }

  // Compact one-liner for the layer you are NOT looking at
  function otherLayerLine(id, shiny) {
    const st = stateOf(id, shiny), r = rec(id, shiny);
    const txt = st === 'caught' ? `Caught ${r[1]}&times;` : (st === 'missed' ? 'Seen, not caught' : 'Not seen yet');
    return `<p class="dex-other ${shiny ? 'is-shiny' : ''}"><span>${shiny ? 'Shiny &#9733;' : 'Normal'}</span><b>${txt}</b></p>`;
  }

  // Border picker: every mode you have caught this Pokémon in is selectable, the rest are locked
  function borderPicker(id, shiny) {
    if (stateOf(id, shiny) !== 'caught') return '';
    const owned = ownedModes(id, shiny), cur = borderFor(id, shiny);
    const opts = MODES.slice().reverse().map(m => {
      const has = owned.indexOf(m) !== -1;
      return `<button type="button" class="dex-bd-opt bd-${m}${m === cur ? ' on' : ''}${has ? '' : ' locked'}" data-border="${m}" ${has ? '' : 'disabled'} aria-pressed="${m === cur}" aria-label="${MODE_NAME[m]} border${has ? '' : ' (locked)'}">` +
        `<i></i><span>${MODE_NAME[m]}</span>${has ? '' : '<em>&#128274;</em>'}</button>`;
    }).join('');
    const hint = owned.length ? 'Pick the border for this card' : 'Catch it in a mode to unlock its border';
    return `<section class="dex-bd-picker"><h4>Border<span>${hint}</span></h4><div class="dex-bd-row">${opts}</div></section>`;
  }

  // Form picker: only shown when you have caught more than one form of this Pokémon
  function formPicker(id, shiny) {
    if (stateOf(id, shiny) !== 'caught') return '';
    const forms = formsOf(id, shiny);
    if (forms.length < 2) return '';
    const cur = shownEntry(id, shiny);
    const opts = forms.map(f => `<button type="button" class="dex-form-opt${f.rawName === cur.rawName ? ' on' : ''}" data-form="${esc(f.rawName)}" aria-pressed="${f.rawName === cur.rawName}">` +
      `<img src="${formSprite(f, shiny)}" alt="" width="40" height="40" loading="lazy"><span>${esc(f.displayName)}</span></button>`).join('');
    return `<section class="dex-form-picker"><h4>Form<span>${forms.length} caught</span></h4><div class="dex-form-row">${opts}</div></section>`;
  }

  function paintDetail(id) {
    const p = entryFor(id);
    if (!p) return;
    const shown = shownEntry(id, layerShiny) || p;
    const st = stateOf(id, layerShiny);
    const known = st !== 'unseen';
    const r = rec(id, layerShiny);
    const tier = st === 'caught' ? tierOf(r[2]) : '';
    const bd = st === 'caught' ? borderFor(id, layerShiny) : '';
    const owned = ownedModes(id, layerShiny);
    const front = $('dex-front'), back = $('dex-back');
    const foil = st === 'caught' ? (layerShiny ? 'foil-strong' : 'foil-soft') : '';
    front.className = `dex-face dex-front state-${st} ${foil} ${layerShiny ? 'shiny-face' : ''} ${tier ? 'tier-' + tier : ''} ${bd ? 'bd-' + bd : ''}`;
    back.className = `dex-face dex-back ${layerShiny ? 'shiny-face' : ''} ${(stateOf(id, true) === 'caught') ? 'foil-strong' : (stateOf(id, false) === 'caught' ? 'foil-soft' : '')}`;

    let sub;
    if (st === 'caught') sub = `${TIER_NAME[tier]}${layerShiny ? ' &middot; Shiny' : ''}`;
    else sub = st === 'missed' ? 'Seen, not caught yet' : 'Not seen yet';
    let modes = '';
    if (st === 'caught') {
      modes = owned.length
        ? `<div class="dex-modes" aria-label="Caught in">${owned.slice().reverse().map(m => `<span class="dex-mode-chip bd-${m}"><i></i>${MODE_NAME[m]}</span>`).join('')}</div>`
        : `<div class="dex-modes"><span class="dex-mode-chip none">Caught before modes were tracked</span></div>`;
    }
    const topNote = st === 'caught' && owned.length ? MODE_NOTE[bd] : '';
    front.innerHTML = `<span class="dex-front-num">#${pad(id)}</span>
      <div class="dex-front-art"><img src="${st === 'caught' ? formArt(shown, layerShiny) : artUrl(id, layerShiny)}" alt="${known ? esc(shown.displayName) : 'Unknown Pokémon'}" decoding="async"${tier && r[2] ? ` data-stage="${r[2]}"` : ''}></div>
      <h3>${known ? esc(st === 'caught' ? shown.displayName : p.displayName) : '???'}</h3>
      <p class="dex-front-sub">${sub}</p>${modes}${topNote ? `<p class="dex-front-note">${topNote}</p>` : ''}`;
    const img = front.querySelector('img');
    // art missing -> form sprite -> base species sprite
    let step = 0;
    img.addEventListener('error', () => {
      step++;
      if (step === 1) img.src = st === 'caught' ? formSprite(shown, layerShiny) : spriteUrl(id, layerShiny);
      else if (step === 2) img.src = spriteUrl(id, layerShiny);
    });
    back.innerHTML = `<span class="dex-front-num">#${pad(id)}</span>
      <h3>${known || stateOf(id, !layerShiny) !== 'unseen' ? esc(st === 'caught' ? shown.displayName : p.displayName) : '???'}</h3>
      ${formPicker(id, layerShiny)}${borderPicker(id, layerShiny)}${recordBlock(id, layerShiny)}${otherLayerLine(id, !layerShiny)}`;
  }

  function chooseForm(rawName) {
    if (!detailId) return;
    if (formsOf(detailId, layerShiny).every(f => f.rawName !== rawName)) return;
    const e = store.e[detailId];
    if (!e.pick) e.pick = { n: '', s: '' };
    e.pick[layerKey(layerShiny)] = rawName;
    save();
    paintDetail(detailId);
    $('dex-flip').classList.add('flipped');   // stay on the back so you can keep browsing forms
    clickSound();
    if (navigator.vibrate) navigator.vibrate(8);
    // update just this card in the grid
    const c = $('dex-grid').querySelector(`.dex-card[data-id="${detailId}"]`);
    const f = formEntry(rawName);
    if (c && f) {
      const im = c.querySelector('.dex-img img');
      if (im) { delete im.dataset.triedFb; im.classList.remove('broken'); im.src = formSprite(f, layerShiny); }
      const nm = c.querySelector('.dex-name');
      if (nm) nm.textContent = f.displayName;
    }
  }

  function chooseBorder(mode) {
    if (!detailId) return;
    const idx = MODES.indexOf(mode);
    if (idx < 0 || ownedModes(detailId, layerShiny).indexOf(mode) === -1) return;
    ensure(detailId, layerShiny)[6] = idx + 1;
    save();
    paintDetail(detailId);
    clickSound();
    if (navigator.vibrate) navigator.vibrate(8);
    const c = $('dex-grid').querySelector(`.dex-card[data-id="${detailId}"]`);
    if (c) {
      MODES.forEach(m => c.classList.remove('bd-' + m));
      c.classList.add('bd-' + mode);
    }
  }

  function openDetail(id) {
    detailId = id;
    const d = $('dex-detail');
    $('dex-flip').classList.remove('flipped');
    paintDetail(id);
    d.classList.remove('hidden');
    d.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => d.classList.add('open'));
    clickSound();
    setTimeout(() => { const f = $('dex-flip'); if (f) f.focus({ preventScroll: true }); }, 50);
  }

  function closeDetail(silent) {
    if (!detailId) return;
    const id = detailId;
    detailId = null;
    const d = $('dex-detail');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!detailId) d.classList.add('hidden'); }, reduced() ? 0 : 200);
    if (silent === true) return;
    const c = $('dex-grid').querySelector(`.dex-card[data-id="${id}"]`);
    if (c) c.focus({ preventScroll: true });
  }

  function flipCard() {
    const f = $('dex-flip');
    f.classList.toggle('flipped');
    if (navigator.vibrate) navigator.vibrate(10);
    clickSound();
  }

  function stepDetail(dir) {
    if (!detailId || !visibleIds.length) return;
    let i = visibleIds.indexOf(detailId);
    i = i === -1 ? 0 : (i + dir + visibleIds.length) % visibleIds.length;
    detailId = visibleIds[i];
    $('dex-flip').classList.remove('flipped');
    paintDetail(detailId);
    clickSound();
  }

  // ---------- wiring ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-open-dex]');
    if (b) { e.preventDefault(); openPanel(b); }
  });
  window.addEventListener('storage', e => {
    if (e.key === KEY) { store = load(); refreshBadges(); if (panelOpen) renderAll(false); }
  });
  refreshBadges();
  wireTimedSummary();
  ['game-over-panel', 'unlimited-game-over-panel', 'daily-review'].forEach(id => {
    const p = $(id);
    if (p) new MutationObserver(() => { if (anyResultsVisible()) cancelFlies(); }).observe(p, { attributes: true, attributeFilter: ['class'] });
  });

  // Settings > Reset Pokédex
  function reset() {
    store = { v: 1, e: {} };
    save();
    timedNew = [];
    renderTimedSummary();
    refreshBadges();
    if (panelOpen) { closeDetail(true); renderAll(false); }
  }

  window.Pokedex = { reset, log, open: () => openPanel(), close: closePanel, stats };
})();