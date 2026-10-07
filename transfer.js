// ==========================================
// TRANSFER YOUR DATA (code you can copy to another device / browser)
// Adds a "Transfer your data" row to the Settings window. "Get my code" packs everything PokéBlur saved on this
// device (Pokédex, stats, streaks, records, settings, daily progress) into one text code or a file.
// "Use a code" on the other device replaces its data with it. No account or password involved.
// Anyone with your code has your data, so treat it like a save file.
// ==========================================
(function () {
  'use strict';
  const SKIP = ['pokeblur-pokemon-list'];                 // big cache that just re-downloads
  const mine = k => k.indexOf('pokeblur') === 0 && SKIP.indexOf(k) === -1;

  function collect() {
    const d = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (mine(k)) d[k] = localStorage.getItem(k); }
    return d;
  }
  const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64 = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  async function pipe(bytes, stream) { const r = new Response(new Blob([bytes]).stream().pipeThrough(stream)); return new Uint8Array(await r.arrayBuffer()); }

  async function makeCode() {
    const bytes = new TextEncoder().encode(JSON.stringify({ app: 'pokeblur', v: 1, t: Date.now(), d: collect() }));
    if (window.CompressionStream) return 'PB1.z.' + toB64(await pipe(bytes, new CompressionStream('gzip')));
    return 'PB1.r.' + toB64(bytes);
  }
  async function readCode(code) {
    const m = /^PB1\.([zr])\.([A-Za-z0-9_-]+)$/.exec(String(code).replace(/\s+/g, ''));
    if (!m) throw new Error('That does not look like a PokéBlur code.');
    let bytes = fromB64(m[2]);
    if (m[1] === 'z') { if (!window.DecompressionStream) throw new Error('This browser cannot read compressed codes.'); bytes = await pipe(bytes, new DecompressionStream('gzip')); }
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || o.app !== 'pokeblur' || !o.d) throw new Error('That code is not valid.');
    return o;
  }
  async function applyCode(code) {
    const o = await readCode(code);
    const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (mine(k)) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
    Object.keys(o.d).forEach(k => { if (mine(k)) localStorage.setItem(k, o.d[k]); });
    return Object.keys(o.d).length;
  }

  // ---------- window ----------
  const css = `#pbt-ov{position:fixed;inset:0;z-index:10050;background:rgba(10,16,19,.8);display:flex;align-items:center;justify-content:center;padding:14px}
  #pbt-ov.hidden{display:none}.pbt-box{background:#1a262c;border:2px solid #3a4b52;border-radius:18px;color:#fff;width:min(440px,100%);max-height:100%;overflow:auto;padding:18px;scrollbar-width:none}
  .pbt-box::-webkit-scrollbar{display:none}.pbt-box h3{margin:0 0 4px;font-size:20px}.pbt-box p{margin:4px 0 10px;color:#9ba8b0;font-size:13px;line-height:1.4}
  .pbt-tabs{display:flex;gap:6px;margin:10px 0}.pbt-tabs button{flex:1}.pbt-box textarea{width:100%;height:110px;box-sizing:border-box;background:#222e35;color:#fff;border:2px solid #3a4b52;border-radius:10px;padding:8px;font:12px monospace;resize:none}
  .pbt-row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.pbt-row button{flex:1;min-width:120px}.pbt-msg{margin-top:10px;font-size:13px;min-height:18px}.pbt-ok{color:#2ecc71}.pbt-err{color:#ff7a78}
  .pbt-tabs button.on{background:#ffcb05;color:#1a262c;border-color:#ffcb05}`;
  let ov, ta, msg, mode = 'get';
  const say = (t, ok) => { msg.textContent = t; msg.className = 'pbt-msg ' + (ok ? 'pbt-ok' : 'pbt-err'); };
  async function setMode(m) {
    mode = m; msg.textContent = ''; ta.value = '';
    ov.querySelectorAll('.pbt-tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    ov.querySelector('.pbt-get').style.display = m === 'get' ? '' : 'none'; ov.querySelector('.pbt-use').style.display = m === 'use' ? '' : 'none';
    ta.readOnly = m === 'get';
    if (m === 'get') { try { ta.value = await makeCode(); ta.dataset.ready = '1'; } catch (e) { say('Could not make a code: ' + e.message); } }
  }
  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    ov = document.createElement('div'); ov.id = 'pbt-ov'; ov.className = 'hidden';
    ov.innerHTML = `<div class="pbt-box" role="dialog" aria-label="Transfer your data"><h3>Transfer your data</h3>
      <p>Move your Pokédex, stats and streaks to another phone or browser. Anyone with your code has your data, so keep it private.</p>
      <div class="pbt-tabs"><button class="action-btn" data-m="get" type="button">Get my code</button><button class="action-btn" data-m="use" type="button">Use a code</button></div>
      <textarea spellcheck="false" autocomplete="off" aria-label="Transfer code"></textarea>
      <div class="pbt-row pbt-get"><button class="action-btn" data-a="copy" type="button">Copy code</button><button class="action-btn" data-a="save" type="button">Save as file</button></div>
      <div class="pbt-row pbt-use"><button class="action-btn" data-a="load" type="button">Load this code</button><button class="action-btn" data-a="file" type="button">Choose a file</button></div>
      <div class="pbt-msg"></div><div class="pbt-row"><button class="action-btn" data-a="close" type="button">Close</button></div>
      <input type="file" accept=".txt,.pokeblur,text/plain" hidden></div>`;
    document.body.appendChild(ov);
    ta = ov.querySelector('textarea'); msg = ov.querySelector('.pbt-msg');
    const fi = ov.querySelector('input[type=file]');
    ov.addEventListener('click', async e => {
      if (e.target === ov) return close();
      const m = e.target.dataset && e.target.dataset.m; if (m) return setMode(m);
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') close();
      else if (a === 'copy') { try { await navigator.clipboard.writeText(ta.value); say('Copied! Paste it into "Use a code" on your other device.', true); } catch (er) { ta.select(); say('Press and hold, then Copy.', false); } }
      else if (a === 'save') { const b = new Blob([ta.value], { type: 'text/plain' }), l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = 'pokeblur-data.pokeblur'; document.body.appendChild(l); l.click(); l.remove(); say('Saved as pokeblur-data.pokeblur', true); }
      else if (a === 'file') fi.click();
      else if (a === 'load') {
        try { const o = await readCode(ta.value);
          if (!confirm('This will REPLACE the PokéBlur data on this device with the data from the code. Continue?')) return;
          const n = await applyCode(ta.value); say('Done! Loaded ' + n + ' saved items. Reloading...', true); setTimeout(() => location.reload(), 900);
        } catch (er) { say(er.message || 'That code did not work.'); }
      }
    });
    fi.addEventListener('change', async () => { const f = fi.files[0]; if (f) { ta.value = (await f.text()).trim(); say('File loaded. Press "Load this code".', true); } fi.value = ''; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.classList.contains('hidden')) close(); });
  }
  function open() { if (!ov) build(); ov.classList.remove('hidden'); setMode('get'); }
  function close() { if (ov) ov.classList.add('hidden'); }

  // ---------- put a row into the Settings window ----------
  function inject() {
    const m = document.querySelector('.settings-modal');
    if (!m || m.querySelector('#pbt-row') || m.querySelector('#settings-transfer-btn')) return;   // settings.js already has the button
    const row = document.createElement('div'); row.className = 'settings-row'; row.id = 'pbt-row';
    row.innerHTML = '<div><div>Transfer your data</div><div style="font-size:12px;opacity:.65;margin-top:2px">Move your Pokédex and stats to another device with a code</div></div><button class="action-btn" type="button" style="flex:none">Transfer</button>';
    row.querySelector('button').addEventListener('click', open);
    const rows = m.querySelectorAll('.settings-row');
    if (rows.length) rows[rows.length - 1].after(row); else (m.firstElementChild || m).appendChild(row);
  }
  let t = 0; const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(inject, 50); });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true }); inject(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.PBTransfer = { open, makeCode, applyCode, readCode };
})();