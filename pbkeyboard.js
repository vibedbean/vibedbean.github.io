// ==========================================
// PokéBlur built-in keyboard (phones and tablets only)
// Replaces the iPhone / iPad / Samsung keyboard for the answer boxes with our own, docked at the bottom, so we
// know exactly how tall it is and the Pokémon, the box and the dropdown always fit above it.
//
// HOW IT FITS IN: it does not rewrite any layout code. It reports its height through window.visualViewport
// (a small stand-in that behaves like the real one, minus our keyboard's height). keyboard.js (Daily / Unlimited / Timed),
// versus.js (Versus) and puffer.js (Voltorb's Vengeance) already shrink / pin themselves to the visual viewport, so they
// react to our keyboard the same way they react to a real one. Reverse Mode (no fitting code of its own) gets a small
// scroll-into-view + dropdown cap from this file.
//
// Load order in index.html: settings.js, THIS FILE, game.js, keyboard.js, ... (it must come before the files that read visualViewport).
// Desktop / laptop: does nothing. Settings > "Built-in keyboard" off: does nothing (system keyboard, old behaviour).
// ==========================================
(function () {
  'use strict';
  const S = window.Settings;
  if (!S || !S.touch) return;                       // phones / tablets only (same check as everything else: settings.js)

  const root = document.documentElement;
  const SEL = '#guess-input, #unlimited-guess-input, #timed-guess-input, #reverse-guess-input, #vs-guess-input, .vp-input';
  const MANAGED = '#daily-view, #unlimited-view, #timed-view, #vs-gameplay-screen, .vp-screen';   // views that already fit themselves to the visual viewport
  const isTarget = n => !!(n && n.matches && n.matches(SEL));
  let physical = false;                               // a real hardware keyboard is being used (iPad + Magic Keyboard): step aside
  const enabled = () => S.get('pbkb') && !physical;

  // keyboard.js / versus.js / puffer.js subtract this when the iOS 26 toolbar floats over the native keyboard. Ours has none.
  const origAcc = S.kbAccessory || 0;
  try { Object.defineProperty(S, 'kbAccessory', { get: () => (enabled() ? 0 : origAcc), configurable: true }); } catch (e) {}

  // ---------- visualViewport stand-in ----------
  const real = window.visualViewport || null;
  const et = new EventTarget();
  let kbH = 0;                                        // how many px our keyboard covers right now
  const shim = {
    get width() { return real ? real.width : window.innerWidth; },
    get height() { return (real ? real.height : window.innerHeight) - kbH; },
    get offsetTop() { return real ? real.offsetTop : 0; },
    get offsetLeft() { return real ? real.offsetLeft : 0; },
    get pageTop() { return real ? real.pageTop : window.scrollY; },
    get pageLeft() { return real ? real.pageLeft : window.scrollX; },
    get scale() { return real ? real.scale : 1; },
    addEventListener: et.addEventListener.bind(et),
    removeEventListener: et.removeEventListener.bind(et),
    dispatchEvent: et.dispatchEvent.bind(et)
  };
  if (real) { real.addEventListener('resize', () => et.dispatchEvent(new Event('resize'))); real.addEventListener('scroll', () => et.dispatchEvent(new Event('scroll'))); }
  try { Object.defineProperty(window, 'visualViewport', { get: () => shim, configurable: true }); } catch (e) {}

  // ---------- keep the system keyboard from opening ----------
  // inputmode="none" = focus + caret, but no system keyboard. versus.js and puffer.js set inputmode="text" themselves, and
  // puffer.js builds its box later, so a MutationObserver puts "none" back / onto new boxes before anyone can tap them.
  const setMode = el => { const want = enabled() ? 'none' : 'text'; if (el.getAttribute('inputmode') !== want) el.setAttribute('inputmode', want); };
  const setAll = () => document.querySelectorAll(SEL).forEach(setMode);
  setAll();
  new MutationObserver(muts => {
    if (!enabled()) return;
    for (const m of muts) {
      if (m.type === 'attributes') { if (isTarget(m.target)) setMode(m.target); }
      else m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (isTarget(n)) setMode(n); n.querySelectorAll && n.querySelectorAll(SEL).forEach(setMode); } });
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['inputmode'] });

  // ---------- the keyboard ----------
  const W = (label, k, w, cls, aria) => ({ label, k, w: w || 1, cls: cls || '', aria: aria || label });
  const SP = w => ({ sp: w });
  const letters = r => r.split('').map(c => W(c, c));
  const LAYERS = {
    abc: [
      letters('qwertyuiop'),
      [SP(.5)].concat(letters('asdfghjkl'), [SP(.5)]),
      [W('123', 'layer', 1.5, 'fn', 'Numbers and symbols')].concat(letters('zxcvbnm'), [W('\u232B', 'bs', 1.5, 'fn', 'Backspace')]),
      [W('-', '-'), W("'", "'"), W('.', '.'), W('space', ' ', 5, 'fn', 'Space'), W('go', 'go', 2, 'go', 'Go')]
    ],
    sym: [
      letters('1234567890'),
      [SP(3)].concat([':', '\u00E9', '\u2640', '\u2642'].map(c => W(c, c)), [SP(3)]),
      [W('ABC', 'layer', 1.5, 'fn', 'Letters'), SP(2), W('-', '-'), W("'", "'"), W('.', '.'), SP(2), W('\u232B', 'bs', 1.5, 'fn', 'Backspace')],
      [W('space', ' ', 8, 'fn', 'Space'), W('go', 'go', 2, 'go', 'Go')]
    ]
  };

  const css = document.createElement('style');
  css.textContent =
    '#pbkb{--pbk:min(46px,max(30px,6vh));--pbk:min(46px,max(30px,6dvh));position:fixed;left:0;right:0;bottom:0;z-index:10010;display:none;background:#12191d;border-top:1px solid #2a373d;' +
    'padding:8px 4px calc(8px + env(safe-area-inset-bottom,0px));box-sizing:border-box;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
    '@media (min-width:700px) and (min-height:700px){#pbkb{--pbk:min(58px,max(40px,5vh));--pbk:min(58px,max(40px,5dvh))}}' +
    '#pbkb.on{display:block}' +
    '#pbkb .in{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:6px}' +
    '#pbkb .r{display:flex;gap:5px;height:var(--pbk)}' +
    '#pbkb button{flex:var(--w,1) 1 0;min-width:0;border:0;border-radius:7px;background:#2b3a42;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:600;' +
    'font-size:calc(var(--pbk)*.46);line-height:1;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 0 #0b1013;cursor:pointer}' +
    '#pbkb button.fn{background:#1e2b31;color:#cfd8dc;font-size:calc(var(--pbk)*.34)}' +
    '#pbkb button.go{background:#3b82f6;color:#fff}' +
    '#pbkb button.down{background:#3b82f6;color:#fff}' +
    '#pbkb i{flex:var(--w,1) 1 0}' +
    'html.pb-kb-pad body{padding-bottom:var(--pb-kb-h,0px)}' +
    'html.pb-kb-pad #reverse-suggestions{max-height:var(--pb-sug-max,200px)!important}' +
    /* Reverse Mode with our keyboard up: squeeze the six hint tiles so they + the box + the dropdown fit */
    'html.pb-kb-open #reverse-view .game-header h2,html.pb-kb-open #reverse-view .reward-hint-subtext{display:none!important}' +
    'html.pb-kb-open #reverse-view .hints-grid{gap:4px;margin:6px 0}' +
    'html.pb-kb-open #reverse-view .hint-tile{padding:5px 12px}' +
    'html.pb-kb-open #reverse-view .tile-label{font-size:.7rem;margin:0}' +
    'html.pb-kb-open #reverse-view .tile-value{font-size:.9rem}' +
    'html.pb-kb-open #reverse-view .reverse-status{margin:6px 0;min-height:0;font-size:.85rem}' +
    'html.pb-kb-open #reverse-view #reverse-search-wrapper{margin:8px auto}';
  document.head.appendChild(css);

  let kbEl = null, shown = false, cur = null, layer = 'abc', rep = 0, repT = 0;

  function build() {
    kbEl = document.createElement('div');
    kbEl.id = 'pbkb';
    kbEl.setAttribute('role', 'group');
    kbEl.setAttribute('aria-label', 'Keyboard');
    kbEl.innerHTML = '<div class="in"></div>';
    document.body.appendChild(kbEl);
    paintLayer();
    // pointerdown does the typing (fast); preventDefault on pointer / mouse / touch start keeps focus in the answer box
    kbEl.addEventListener('pointerdown', e => {
      const b = e.target.closest && e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      b.classList.add('down');
      press(b.dataset.k);
    });
    ['mousedown', 'touchstart'].forEach(t => kbEl.addEventListener(t, e => e.preventDefault(), { passive: false }));
    const up = () => { stopRepeat(); kbEl.querySelectorAll('.down').forEach(b => b.classList.remove('down')); };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => kbEl.addEventListener(t, up));
    window.addEventListener('blur', up);
    if (window.ResizeObserver) new ResizeObserver(() => { if (shown) setKb(kbEl.offsetHeight); }).observe(kbEl);
  }

  function paintLayer() {
    const host = kbEl.firstChild;
    host.innerHTML = '';
    LAYERS[layer].forEach(row => {
      const r = document.createElement('div'); r.className = 'r';
      row.forEach(k => {
        if (k.sp) { const i = document.createElement('i'); i.style.setProperty('--w', k.sp); r.appendChild(i); return; }
        const b = document.createElement('button');
        b.type = 'button'; b.tabIndex = -1; b.textContent = k.label; b.dataset.k = k.k;
        b.setAttribute('aria-label', k.aria);
        if (k.cls) b.className = k.cls;
        b.style.setProperty('--w', k.w);
        r.appendChild(b);
      });
      host.appendChild(r);
    });
  }

  function setKb(h) {
    kbH = h;
    root.style.setProperty('--pb-kb-h', h + 'px');
    et.dispatchEvent(new Event('resize'));
  }

  function show(el) {
    cur = el;
    if (!kbEl) build();
    if (!shown) { shown = true; kbEl.classList.add('on'); root.classList.add('pb-kb-open'); watch(true); }
    setKb(kbEl.offsetHeight);
    ensureVisible(el);
  }
  function hide() {
    if (!shown) return;
    shown = false;
    kbEl.classList.remove('on');
    root.classList.remove('pb-kb-open', 'pb-kb-pad');
    root.style.removeProperty('--pb-sug-max');
    watch(false);
    setKb(0);
  }

  // Reverse Mode (and anything else with no fitting code of its own): keep the box + dropdown above the keyboard
  function ensureVisible(el) {
    const managed = !!el.closest(MANAGED);
    root.classList.toggle('pb-kb-pad', !managed);
    if (managed) { root.style.removeProperty('--pb-sug-max'); return; }
    requestAnimationFrame(() => {
      const bottom = shim.offsetTop + shim.height;
      const need = el.getBoundingClientRect().bottom + 120 - bottom;
      if (need > 0) window.scrollBy(0, need);
      root.style.setProperty('--pb-sug-max', Math.max(96, Math.min(240, bottom - el.getBoundingClientRect().bottom - 8)) + 'px');
    });
  }

  // typing
  function target() {
    const a = document.activeElement;
    if (isTarget(a)) return a;
    if (cur && document.contains(cur) && !cur.disabled) { try { cur.focus({ preventScroll: true }); } catch (e) { cur.focus(); } return cur; }
    return null;
  }
  function fire(el, type, data) { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type, data: data == null ? null : data })); }
  function insert(ch) {
    const el = target(); if (!el || el.disabled) return;
    if (el.maxLength > 0 && el.value.length >= el.maxLength) return;
    const s = el.selectionStart == null ? el.value.length : el.selectionStart, e = el.selectionEnd == null ? s : el.selectionEnd;
    el.setRangeText(ch, s, e, 'end');
    fire(el, 'insertText', ch);
  }
  function backspace() {
    const el = target(); if (!el || el.disabled) return false;
    const s = el.selectionStart == null ? el.value.length : el.selectionStart, e = el.selectionEnd == null ? s : el.selectionEnd;
    if (s === e && s === 0) return false;
    if (s !== e) el.setRangeText('', s, e, 'end'); else el.setRangeText('', s - 1, s, 'end');
    fire(el, 'deleteContentBackward');
    return true;
  }
  function enter() {
    const el = target(); if (!el) return;
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }
  function stopRepeat() { clearTimeout(repT); clearInterval(rep); repT = rep = 0; }
  function press(k) {
    if (k === 'layer') { layer = layer === 'abc' ? 'sym' : 'abc'; paintLayer(); return; }
    if (k === 'go') { enter(); return; }
    if (k === 'bs') {
      stopRepeat();
      if (backspace()) repT = setTimeout(() => { rep = setInterval(() => { if (!backspace()) stopRepeat(); }, 55); }, 380);
      return;
    }
    insert(k);
  }

  // ---------- when it shows / hides ----------
  let watchT = 0;
  function watch(on) {
    clearInterval(watchT);
    if (on) watchT = setInterval(() => {      // box got disabled / hidden / left behind (game over, mode switched, panel opened)
      const a = document.activeElement;
      if (!(enabled() && isTarget(a) && !a.disabled && a.getClientRects().length)) hide();
    }, 400);
  }
  document.addEventListener('focusin', e => { if (isTarget(e.target)) { setMode(e.target); if (enabled() && !e.target.disabled) show(e.target); } });
  document.addEventListener('focusout', e => {
    if (!isTarget(e.target)) return;
    setTimeout(() => { if (!isTarget(document.activeElement)) hide(); }, 150);
  });
  document.addEventListener('input', e => { if (shown && e.target === cur) ensureVisible(cur); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && shown) { const a = document.activeElement; if (a && a.blur) a.blur(); hide(); } }, true);

  // a real keyboard (iPad + Magic Keyboard): step aside until the screen is touched again
  document.addEventListener('keydown', e => {
    if (!e.isTrusted || !shown || !isTarget(e.target) || e.keyCode === 229 || e.key === 'Unidentified') return;
    physical = true; setAll(); hide();
  }, true);
  document.addEventListener('pointerdown', e => {
    if (!physical || e.pointerType !== 'touch') return;
    physical = false; setAll();
    if (isTarget(document.activeElement) && !document.activeElement.disabled) show(document.activeElement);
  }, true);

  // Settings > Built-in keyboard
  document.addEventListener('settingschange', e => {
    if (!e.detail || e.detail.key !== 'pbkb') return;
    setAll();
    if (!enabled()) hide(); else if (isTarget(document.activeElement)) show(document.activeElement);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => { if (shown) setKb(kbEl.offsetHeight); }, 250));

  window.PBKeyboard = { show, hide, get shown() { return shown; }, get height() { return kbH; } };
})();