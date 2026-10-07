// ==========================================
// SETTINGS
// Small settings panel (gear button in the header). Saved in localStorage only.
// Other files read values with Settings.get('sound' | 'celebrate' | 'kbfit').
// Load this BEFORE game.js / keyboard.js / pokedex.js.
// ==========================================
(function () {
  'use strict';
  const KEY = 'pokeblur-settings';
  const DEFAULTS = { sound: true, celebrate: true, kbfit: true };
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

  window.Settings = { get, set, silentCtx };

  // ---------- panel ----------
  const $ = id => document.getElementById(id);
  const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  let panel = null, lastOpener = null, resetTimer = null;

  const ROWS = [
    { key: 'sound', title: 'Sound effects', desc: 'Correct / wrong sounds, Versus sounds and Pokédex dings.' },
    { key: 'celebrate', title: 'Celebrations', desc: 'Confetti and the Pokédex catch animation.' },
    { key: 'kbfit', title: 'Fit image above keyboard', desc: 'Shrinks the Pokémon while you type on a phone so it stays visible.', touchOnly: true }
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
            <div class="settings-text"><b>Transfer your data</b><span>Move your Pokédex and stats to another phone or browser with a code.</span></div>
            <button type="button" class="action-btn" id="settings-transfer-btn" style="flex:none">Transfer</button>
          </div>
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
      if (e.target.closest('#settings-transfer-btn')) { if (window.PBTransfer) window.PBTransfer.open(); return; }   // transfer.js
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