// ==========================================
// PHONE KEYBOARD FIX (Daily / Unlimited / Timed)
// When the on-screen keyboard opens, the visible area shrinks and the browser
// scrolls the page so the input shows - which pushes the Pokémon image out of view.
// While a guess box is focused on a touch device we:
//   - scale the image down to fit above the keyboard (scale, not resize, so the blur
//     looks identical and the difficulty doesn't change)
//   - let the fixed top bar scroll away instead of eating screen space
//   - cap the suggestion list to the space that is actually visible
// Everything is driven by CSS classes/variables set here (see "KEYBOARD" in style.css).
// ==========================================
(function () {
  'use strict';
  const vv = window.visualViewport;
  const isTouch = window.Settings && typeof window.Settings.touch === 'boolean' ? window.Settings.touch : (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (!vv || !isTouch) return;

  const root = document.documentElement;
  const SEL = '#guess-input, #unlimited-guess-input, #timed-guess-input';
  let active = null, base = window.innerHeight, raf = 0, blurTimer = 0, wantScroll = false;
  const WANT_SUG_PX = 110, MIN_SCALE = 0.3;   // room kept under the box for suggestions (about 3 rows) / smallest the picture may shrink to

  const acc = () => (window.Settings && window.Settings.kbAccessory) || 0;   // iOS 26 keyboard toolbar that covers the page above the keys
  const kbOpen = () => base - vv.height > 100 && (vv.scale || 1) < 1.05;   // pinch-zoom also shrinks vv.height - that is not a keyboard

  function apply() {
    raf = 0;
    if (!active) return;
    if (window.Settings && !window.Settings.get('kbfit')) { root.classList.remove('kb-open'); return; }   // turned off in Settings
    if (!kbOpen()) { root.classList.remove('kb-open'); return; }
    const view = active.closest('#daily-view, #unlimited-view, #timed-view');
    const wrap = view && view.querySelector('.image-wrapper');
    if (!wrap) return;

    const doScroll = wantScroll; wantScroll = false;   // only move the page when the keyboard opens / the box gets focus, never while the person is swiping
    // Natural (unscaled) height of the image box
    const h = wrap.offsetHeight || 250;
    root.style.setProperty('--kb-h', h + 'px');
    root.style.setProperty('--kb-pad', Math.max(0, base - vv.height) + 'px');   // extra scroll room so the picture can be brought to the top
    root.classList.add('kb-open');
    const head = view.querySelector('.game-header') || wrap;
    // How big may the picture be? Measured at FULL size, so the answer does not depend on where the page happens to be scrolled.
    // (The old loop measured the room left under the box while the page was scrolled somewhere random and kept shrinking the
    //  picture to its minimum - that was the "image gets really tiny" bug.)
    let k = 1;
    if (wrap.offsetHeight) {
      root.style.setProperty('--kb-scale', '1');
      const fixed = active.getBoundingClientRect().bottom - head.getBoundingClientRect().top - h;   // everything that is not the picture
      k = (vv.height - acc() - 14 - WANT_SUG_PX - fixed) / h;
      k = Math.round(Math.max(MIN_SCALE, Math.min(1, k)) * 100) / 100;
    }
    root.style.setProperty('--kb-scale', k.toFixed(2));

    requestAnimationFrame(() => {
      if (!active) return;
      if (doScroll) window.scrollTo(0, Math.max(0, head.getBoundingClientRect().top + window.scrollY - 6));
      // The suggestion list may only use the space between the input and the keyboard
      const roomBelow = vv.offsetTop + vv.height - acc() - active.getBoundingClientRect().bottom - 8;
      root.style.setProperty('--sug-max', Math.max(96, Math.min(240, roomBelow)) + 'px');
    });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  document.addEventListener('focusin', e => {
    if (!e.target.matches || !e.target.matches(SEL)) return;
    clearTimeout(blurTimer);
    active = e.target;
    wantScroll = true;
    schedule();
    setTimeout(() => { wantScroll = true; schedule(); }, 300);   // keyboard animation finishes after focus
  });
  document.addEventListener('focusout', e => {
    if (!e.target.matches || !e.target.matches(SEL)) return;
    // Small delay so tapping a suggestion isn't cancelled by the layout changing under the finger
    blurTimer = setTimeout(() => {
      active = null;
      root.classList.remove('kb-open');
    }, 250);
  });
  vv.addEventListener('resize', () => {
    if (!active) base = Math.max(base, window.innerHeight);
    schedule();
  });
  window.addEventListener('resize', () => { if (!active) base = window.innerHeight; });   // toolbar collapse / split view / rotation
  window.addEventListener('orientationchange', () => { setTimeout(() => { base = window.innerHeight; schedule(); }, 350); });
})();