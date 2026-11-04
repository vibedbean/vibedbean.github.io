// ==========================================
// SETTINGS
// Small settings panel (gear button in the header). Saved in localStorage only.
// Other files read values with Settings.get('sound' | 'celebrate' | 'kbfit' | 'autopick' | 'pbkb').
// Load this BEFORE game.js / keyboard.js / pokedex.js.
// ==========================================
(function () {
  'use strict';
  const KEY = 'pokeblur-settings';
  const DEFAULTS = { sound: true, celebrate: true, kbfit: true, autopick: true, pbkb: true };
  let values = Object.assign({}, DEFAULTS);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') Object.keys(DEFAULTS).forEach(k => { if (typeof raw[k] === 'boolean') values[k] = raw[k]; });
  } catch (e) {}

  function get(k) { return values[k] !== false; }
  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    values[k] = !!v;
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('settingschange', { detail: { key: k, value: values[k] } }));
  }

  // When sound is off, game/versus sounds are pointed at an offline audio context: it accepts
  // the same oscillator/gain calls but never plays anything, so no other sound code has to change.
  let silent = null;
  function silentCtx() {
    if (!silent) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      silent = new OAC(1, 1, 44100);
    }
    return silent;
  }

  // ONE place that decides "is this a phone / tablet?" (everything else reads Settings.touch or the html.touch-ui class).
  // Only the PRIMARY pointer counts. The old check also used any-pointer: coarse, which is true on any laptop that
  // merely has a touchscreen - that is why a laptop got the phone options.
  const touch = (function () {
    try {
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;   // iPadOS pretends to be a Mac
      if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
      if (window.matchMedia && matchMedia('(pointer: coarse)').matches) return true;         // main input is a finger
    } catch (e) {}
    return false;
  })();
  document.documentElement.classList.toggle('touch-ui', touch);

  // iOS 26+ Safari floats a toolbar (gear / arrows / tick) ABOVE the keys. It covers the page but is not part of the visual viewport,
  // so the code thought there was room for the suggestion list when that area was really hidden behind the toolbar.
  // Set this to 0 if suggestions ever look too far from the box on an iPhone.
  const kbAccessory = (function () {
    try {
      const ua = navigator.userAgent || '';
      const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const v = /Version\/(\d+)/.exec(ua);
      return ios && !navigator.standalone && v && +v[1] >= 26 ? 52 : 0;
    } catch (e) { return 0; }
  })();

  window.Settings = { get, set, silentCtx, touch, kbAccessory };

  // ---------- panel ----------
  const $ = id => document.getElementById(id);
  // (`touch` is worked out near the top of this file)
  let panel = null, lastOpener = null, resetTimer = null;

  const ROWS = [
    { key: 'sound', title: 'Sound effects', desc: 'Correct / wrong sounds, Versus sounds and Pokédex dings.' },
    { key: 'celebrate', title: 'Celebrations', desc: 'Confetti and the Pokédex catch animation.' },
    { key: 'pbkb', title: 'Built-in keyboard', desc: 'Use the game\'s own keyboard on a phone or tablet instead of the system one (no autocorrect, always fits). Turn off to use the system keyboard.', touchOnly: true },
    { key: 'kbfit', title: 'Fit image above keyboard', desc: 'Shrinks the Pokémon while you type on a phone so it stays visible.', touchOnly: true },
    { key: 'autopick', title: 'Auto-pick single match', desc: 'Versus on a phone or tablet: when only one Pokémon matches what you typed, it is guessed for you.', touchOnly: true }
  ];

  function build() {
    panel = document.createElement('div');
    panel.id = 'settings-modal';
    panel.className = 'settings-modal hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Settings');
    panel.innerHTML = `
      <div class="settings-backdrop" data-close></div>
      <div class="settings-card">
        <div class="settings-head">
          <h2>Settings</h2>
          <button type="button" class="settings-x" data-close aria-label="Close settings">&#10005;</button>
        </div>
        <div class="settings-list">
          ${ROWS.filter(r => !r.touchOnly || touch).map(r => `
          <div class="settings-row">
            <div class="settings-text"><b>${r.title}</b><span>${r.desc}</span></div>
            <button type="button" class="settings-switch" role="switch" data-key="${r.key}" aria-label="${r.title}"><i></i></button>
          </div>`).join('')}
          <div class="settings-row">
            <div class="settings-text"><b>Save code</b><span>One permanent code that loads your Pokédex and stats on any device.</span></div>
            <button type="button" class="action-btn" id="settings-save-btn" style="flex:none">Open</button>
          </div>
          <div class="settings-row">
            <div class="settings-text"><b>Transfer your data</b><span>Move your Pokédex and stats to another phone or browser with a code.</span></div>
            <button type="button" class="action-btn" id="settings-transfer-btn" style="flex:none">Transfer</button>
          </div>
          <div class="settings-row">
            <div class="settings-text"><b>Privacy &amp; about</b><span>Fan-project disclaimer and how your data is handled.</span></div>
            <button type="button" class="action-btn" id="settings-privacy-btn" style="flex:none">View</button>
          </div>
          <div id="settings-privacy" hidden style="max-height:38vh;overflow:auto;padding:8px 2px 4px;border-top:1px solid rgba(255,255,255,.08);font-size:.74rem;line-height:1.55;color:#9ba8b0;text-align:left"></div>
        </div>
        <div class="settings-danger">
          <button type="button" class="settings-reset" id="settings-reset-dex">Reset Pokédex</button>
          <span>Clears every catch, border and form pick. Your scores and streaks are kept.</span>
        </div>
      </div>`;
    document.body.appendChild(panel);

    panel.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const sw = e.target.closest('.settings-switch');
      if (sw) {
        set(sw.dataset.key, !get(sw.dataset.key));
        paint();
        return;
      }
      if (e.target.closest('#settings-save-btn')) { if (window.PBSave) window.PBSave.open(); return; }   // savecode.js
      if (e.target.closest('#settings-transfer-btn')) { if (window.PBTransfer) window.PBTransfer.open(); return; }   // transfer.js
      if (e.target.closest('#settings-privacy-btn')) { togglePrivacy(); return; }
      if (e.target.closest('#settings-reset-dex')) resetDex();
    });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter') e.stopPropagation();   // keep game shortcuts (Enter = next) from firing behind the panel
    });
  }

  function paint() {
    panel.querySelectorAll('.settings-switch').forEach(sw => {
      const on = get(sw.dataset.key);
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // The fan disclaimer + privacy text lives in index.html's hidden <footer>; this shows a copy of it here (so it is only edited in one place)
  function togglePrivacy() {
    const box = $('settings-privacy'), btn = $('settings-privacy-btn');
    if (!box) return;
    const show = box.hidden;
    if (show && !box.dataset.filled) {
      const f = document.querySelector('.site-footer');
      box.innerHTML = f ? f.innerHTML : '<p>PokeBlur is a free, unofficial fan-made project.</p>';
      box.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; a.style.color = '#6cb4ff'; });
      box.querySelectorAll('strong').forEach(b => { b.style.color = '#fff'; });
      box.querySelectorAll('p').forEach(q => { q.style.margin = '0 0 8px'; });
      box.dataset.filled = '1';
    }
    box.hidden = !show;
    btn.textContent = show ? 'Hide' : 'View';
    if (show) box.scrollTop = 0;
  }

  // Two taps to reset, no pop-up dialog
  function resetDex() {
    const b = $('settings-reset-dex');
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.textContent = 'Tap again to confirm';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(resetLabel, 4000);
      return;
    }
    if (window.Pokedex && window.Pokedex.reset) window.Pokedex.reset();
    resetLabel();
    b.textContent = 'Pokédex reset';
    setTimeout(() => { if (b.textContent === 'Pokédex reset') b.textContent = 'Reset Pokédex'; }, 1800);
  }
  function resetLabel() {
    const b = $('settings-reset-dex');
    if (!b) return;
    clearTimeout(resetTimer);
    b.classList.remove('confirm');
    b.textContent = 'Reset Pokédex';
  }

  function open(opener) {
    if (!panel) build();
    lastOpener = opener || document.activeElement;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // drops the phone keyboard
    paint();
    resetLabel();
    panel.classList.remove('hidden');
    document.documentElement.classList.add('settings-lock');
    const x = panel.querySelector('.settings-x');
    if (x) setTimeout(() => x.focus({ preventScroll: true }), 30);
  }
  function close() {
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    document.documentElement.classList.remove('settings-lock');
    resetLabel();
    if (lastOpener && lastOpener.focus && document.contains(lastOpener)) {
      try { lastOpener.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-open-settings]');
    if (b) { e.preventDefault(); open(b); }
  });
})();