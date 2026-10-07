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
  if (!vv || !window.matchMedia || !matchMedia('(pointer: coarse)').matches) return;

  const root = document.documentElement;
  const SEL = '#guess-input, #unlimited-guess-input, #timed-guess-input';
  let active = null, base = window.innerHeight, raf = 0, blurTimer = 0;

  const kbOpen = () => base - vv.height > 100;

  function apply() {
    raf = 0;
    if (!active) return;
    if (window.Settings && !window.Settings.get('kbfit')) { root.classList.remove('kb-open'); return; }   // turned off in Settings
    if (!kbOpen()) { root.classList.remove('kb-open'); return; }
    const view = active.closest('#daily-view, #unlimited-view, #timed-view');
    const wrap = view && view.querySelector('.image-wrapper');
    if (!wrap) return;

    // Natural (unscaled) height of the image box
    const h = wrap.offsetHeight || 250;
    // Room for: round/stage labels + input + a few suggestions + margins
    const k = Math.max(0.45, Math.min(1, (vv.height - 250) / h));
    root.style.setProperty('--kb-h', h + 'px');
    root.style.setProperty('--kb-scale', k.toFixed(3));
    root.classList.add('kb-open');

    requestAnimationFrame(() => {
      if (!active) return;
      // Suggestion list may only use the space between the input and the keyboard
      const ib = active.getBoundingClientRect().bottom;
      const room = vv.offsetTop + vv.height - ib - 8;
      root.style.setProperty('--sug-max', Math.max(72, Math.min(220, room)) + 'px');
      // Bring the round labels + image to the top of the visible area
      const head = view.querySelector('.game-header') || wrap;
      const y = head.getBoundingClientRect().top + window.scrollY - 6;
      window.scrollTo(0, Math.max(0, y));
    });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  document.addEventListener('focusin', e => {
    if (!e.target.matches || !e.target.matches(SEL)) return;
    clearTimeout(blurTimer);
    active = e.target;
    schedule();
    setTimeout(schedule, 300);   // keyboard animation finishes after focus
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
  window.addEventListener('orientationchange', () => { base = window.innerHeight; });
})();