// ==========================================
// VOLTORB'S VENGEANCE (hot potato) - the second Versus game type
// Everything around the game (room codes, avatars, public lobbies, kicks, ready check, the generation vote, idle handling,
// host migration, game-over podium) is reused from versus.js. versus.js only hands this file a small bridge (window.VSBridge).
//
// HOW IT WORKS
//  - A prompt is on screen ("Water type", "Name starts with S"...). Only the player holding the Voltorb can answer.
//    A correct answer nobody has said yet passes the Voltorb to the next living player.
//  - The HOST holds the hidden fuse (12-30s) and validates every answer. Passing does NOT reset the fuse, but whoever catches the
//    Voltorb always gets a minimum turn (host setting). When it blows you lose a heart; a new prompt starts.
//  - There is NO cooldown on wrong answers: a wrong / repeated answer just shakes the box and keeps focus.
//  - ONE serialisable snapshot (S) is broadcast on every change (VP_STATE). A promoted host resumes from its copy (and draws a fresh fuse).
//  - The fuse length is never sent. The host sends a "heat" value about 4 times a second (with a little noise added) so every
//    Voltorb swells in step with the real fuse.
// Messages: VP_STATE (host to all), VP_TICK (host to all), VP_ANS (guest to host), VP_NO (host to one guest).
// ==========================================
(function () {
  'use strict';

  // The fuse is hidden and RANDOM, and every correct answer (or a pop) draws a brand new one for the next holder, so a category can be
  // played through. Its length is the host's minimum turn (nobody is ever cut shorter, so slow phone typists are safe) PLUS a random
  // extra of up to FUSE_SPAN_MS. That extra shrinks as the category goes on, so the Voltorb gets more and more likely to blow.
  const FUSE_SPAN_MS = 10000, FUSE_SQUEEZE = 0.75;   // at the end of a category the random extra is only 25% as long
  // A category lasts a number of correct answers that SCALES with the players still alive (so everyone gets turns): about 2-3 laps of the
  // table for a list, 1-2 laps for pictures. At least 4 / 3 so a 2-player match still gets a proper category.
  const LIST_LAPS = [2, 3], IMG_LAPS = [1, 2];
  const CRIT_MS = 300;       // after the fuse runs out the holder still has this long to land an answer (network lag)
  const BOOM_MS = 2000;      // explosion + hit animation, nobody can answer meanwhile
  const READY_MS = 3200;     // "get ready" before the first prompt, so the phone keyboard has time to open
  const TICK_MS = 250;       // heat updates per second = 4
  const BANK_URL = 'puffer-data.json?v=2026-11-04s';
  // The small label above the prompt. Every kind the data bank can emit needs one, otherwise the label is blank.
  const KINDS = { gen: 'GENERATION', start: 'STARTS WITH', end: 'ENDS WITH', has: 'CONTAINS', len: 'NAME LENGTH', dbl: 'SPELLING', any: 'ANYTHING', identify: 'IDENTIFY',
    type: 'TYPE', mono: 'PURE TYPE', dual: 'DUAL TYPE', weak: 'MATCHUPS', stat: 'BASE STATS', move: 'MOVES', abil: 'ABILITY', evo: 'EVOLUTION',
    form: 'FORMS', misc: 'SPECIAL', color: 'COLOUR', size: 'SIZE', egg: 'EGG GROUP', list: 'FAVOURITES', pat: 'NAME PATTERN' };

  // Host-side pack switches (the ids are also stored in the lobby payload, so a promoted host keeps them).
  // Puffer.js falls back to its built-in Phase 1 lists if puffer-data.json cannot be fetched.
  const PACKS = [
    { id: 'basics', name: 'Types & generations', desc: 'Types, pure types, dual types and generation lists' },
    { id: 'dex', name: 'Pokédex facts', desc: 'Pokédex colour, Mega and regional forms, legendaries and other special groups' },
    { id: 'evo', name: 'Evolutions', desc: 'Evolution stages, stones, trade, friendship and levels' },
    { id: 'abilities', name: 'Abilities', desc: 'Can have the ability…', off: true },
    { id: 'moves', name: 'Moves', desc: 'Can learn… (in any game)', off: true },
    { id: 'battle', name: 'Battle stats', desc: 'Base stats, weaknesses, resistances and immunities', off: true },
    { id: 'names', name: 'Name patterns', desc: 'Letters, name length, double letters and word patterns' },
    // OFF by default: all correct and complete, but you really have to know the dex. Moves, abilities and battle lists are off too
    // (plain "weak to X" lists live in Types & generations); the host can still switch any of them on.
    { id: 'trivia', name: 'Deep cuts (hard)', desc: 'Egg groups, heights, weights and tricky stat cut-offs', off: true }
  ];
  const IDENTIFY_MODES = ['Classic Blur', 'Pixelation', 'Tile Reveal', 'Silhouette', 'Zoom Out', 'Scramble', 'Color Drain', 'Spotlight', 'Zoomed Crop'];

  // The question bank is fetched once (host only), and only when this mode is actually played.
  let BANK = null, bankPromise = null;
  function preload() {
    if (BANK) return Promise.resolve(BANK);
    if (bankPromise) return bankPromise;
    bankPromise = fetch(BANK_URL, { cache: 'force-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        BANK = (d && Array.isArray(d.prompts)) ? d : { prompts: [] };
        return BANK;
      })
      .catch(() => { BANK = { prompts: [] }; return BANK; });
    return bankPromise;
  }
  // The packs a fresh room starts with: everything except the ones flagged off (hard "deep cuts" are opt-in).
  function defaultPacks() { return PACKS.filter(x => !x.off).map(x => x.id); }
  function cleanPacks(list) {
    const ids = PACKS.map(x => x.id);
    if (!Array.isArray(list)) return defaultPacks();      // an older host sends none: that means the default packs
    const out = list.filter(x => ids.indexOf(x) >= 0);
    return out.length ? out : defaultPacks();
  }

  const B = () => window.VSBridge;
  const now = () => Date.now();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reduceQ && reduceQ.matches);

  let S = null;     // THE snapshot (same shape on every device)
  let H = null;     // host-only runtime: fuse, timers, prompt deck
  let ui = null, shown = false;
  let seen = null;  // what this device has already played effects for (so a late snapshot never replays an explosion)
  let heatTgt = 0, heatCur = 0, raf = 0, lastTs = 0, nextTickAt = 0, frameN = 0, lastTickK = -1;   // fuse-tick tracker (quiet tick per heat step)
  let blocked = true, pending = false, pendingTimer = 0, msgTimer = 0, leaveTimer = 0, newcatTimer = 0;
  let mset = new Set();
  let artStart = 0, artTurn = -1, artUrl = '', artImg = null, artReady = false, artMsg = '';
  const artCache = new Map();   // identify images are shown once per pass; keep a handful so a re-render never flashes
  let endedGid = '';   // a snapshot that arrives after the game was taken down must not bring the screen back
  let rdyCue = false;  // the GET READY overlay just appeared: cue the ready sound once

  // ---------------------------------------------------------------------------------------------
  // PROMPTS (first version: built from what game.js already knows; Phase 2 swaps in a big data bank)
  // ---------------------------------------------------------------------------------------------
  // PokeAPI's default form of some species carries a suffix in its list name ("deoxys-normal", "toxtricity-amped").
  // Players know them as plain "Deoxys" / "Toxtricity", so the suffix is dropped before any letter-based prompt looks at the name.
  const FORM_TAIL = { 386: 'normal', 413: 'plant', 487: 'altered', 492: 'land', 550: 'red-striped', 555: 'standard', 641: 'incarnate', 642: 'incarnate', 645: 'incarnate',
    647: 'ordinary', 648: 'aria', 678: 'male', 681: 'shield', 710: 'average', 711: 'average', 718: '50', 741: 'baile', 745: 'midday', 746: 'solo', 774: 'red-meteor',
    778: 'disguised', 849: 'amped', 875: 'ice', 876: 'male', 877: 'full-belly', 892: 'single-strike', 902: 'male', 905: 'incarnate', 916: 'male',
    925: 'family-of-four', 931: 'green-plumage', 964: 'zero', 978: 'curly', 982: 'two-segment' };
  let TABLE = null;
  function speciesTable() {
    const L = (typeof allPokemonList !== 'undefined' && allPokemonList) || [];
    if (TABLE && L.length >= 1025) return TABLE;   // the list only ever grows once loaded, so one pass is enough
    const out = [];
    for (let i = 0; i < Math.min(L.length, 1025); i++) {   // the first 1025 entries ARE the species, in dex order
      const p = L[i];
      if (!p || !p.gen) continue;
      let raw = String(p.rawName || '').toLowerCase();
      const tail = FORM_TAIL[i + 1];
      if (tail && raw.slice(-(tail.length + 1)) === '-' + tail) raw = raw.slice(0, -(tail.length + 1));
      const parts = raw.replace(/-(f|m)$/, '').split('-').map(s => s.replace(/[^a-z]/g, '')).filter(Boolean);
      out.push({ id: i + 1, name: parts.join(''), parts, gen: +p.gen, disp: typeof formatPokemonName === 'function' ? formatPokemonName(raw) : raw });
    }
    if (L.length >= 1025) TABLE = out;
    return out;
  }
  function dispOf(id) {
    const s = speciesTable().find(x => x.id === id);
    return s ? s.disp : '#' + id;
  }

  // Every list is filtered by the voted generation pool; lists with fewer than 6 members are skipped
  // (and very big ones too, they are not a challenge: 120 max, generation lists up to 200).
  function buildCandidates(gens) {
    const sp = speciesTable().filter(s => gens.has(s.gen));
    const out = [];
    const add = (id, kind, label, no, test, max) => {
      const m = [];
      for (const s of sp) if (test(s)) m.push(s.id);
      if (m.length >= 6 && m.length <= (max || 120)) out.push({ id, kind, label, no, m });
    };
    gens.forEach(g => add('gen' + g, 'gen', `Name a Pokémon from Generation ${g}`, `Not from Gen ${g}`, s => s.gen === g, 200));
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach(c => {
      const C = c.toUpperCase();
      add('s' + c, 'start', `Name a Pokémon whose name starts with ${C}`, `Doesn't start with ${C}`, s => s.name[0] === c);
      add('e' + c, 'end', `Name a Pokémon whose name ends with ${C}`, `Doesn't end in ${C}`, s => s.name[s.name.length - 1] === c);
      add('h' + c, 'has', `Name a Pokémon whose name contains the letter ${C}`, `No ${C} in that name`, s => s.name.indexOf(c) >= 0);
    });
    for (let n = 3; n <= 13; n++) add('l' + n, 'len', `Name a Pokémon whose name is exactly ${n} letters long`, 'Wrong number of letters', s => s.name.length === n);
    add('lmin12', 'len', 'Name a Pokémon whose name is 12 letters or longer', 'Not long enough', s => s.name.length >= 12);
    add('lmax4', 'len', 'Name a Pokémon whose name is 4 letters or shorter', 'Too long', s => s.name.length <= 4);
    add('dbl', 'dbl', 'Name a Pokémon whose name has two of the same letter in a row', 'No double letter', s => s.parts.some(p => /(.)\1/.test(p)));
    if (!out.length) out.push({ id: 'any', kind: 'any', label: 'Any Pokémon from this match', no: "Not in this match's generations", m: sp.map(s => s.id) });
    return out;
  }

  // The Phase 2 bank stores each list whole (up to 400) so the same prompt can be played in a 2-generation
  // match. Cut it down to the voted generations here, then keep only what the match can actually use:
  // 6-120 answers (generation lists may go up to 200, otherwise gen 1 would never be playable on its own).
  // Questions should read like questions. Some bank labels carry bracketed tails ("... (that can still
  // evolve)", "... (any stage)", "... (going by typing alone)", "... (Rock types)") that read like notes to
  // the writer. Fold them into the sentence instead of dropping them, so the displayed question still
  // matches its answer list.
  const cleanQ = l => {
    let s = String(l || '');
    s = s.replace(/\(any region\)/gi, ', from any region');
    s = s.replace(/\(any stage\)/gi, ', at any stage');
    s = s.replace(/\(half damage or less, going by typing alone\)/gi, ', taking half damage or less, going by typing alone');
    s = s.replace(/\(going by typing alone\)/gi, ', going by typing alone');
    s = s.replace(/\(one that can still evolve\)/gi, ' that can still evolve');
    s = s.replace(/\(that can still evolve\)/gi, ' that can still evolve');
    s = s.replace(/\(([A-Za-z]+) types\)/gi, (m, t) => ' that is ' + (/^[aeiou]/i.test(t) ? 'an' : 'a') + ' ' + t + '-type');
    s = s.replace(/\(([^)]*)\)/g, ', $1');
    s = s.replace(/\s*,\s*/g, ', ');
    s = s.replace(/\s+/g, ' ').trim();
    // avoid double comma / trailing comma
    s = s.replace(/,\s*,/g, ',').replace(/,\s*$/,'').trim();
    return s;
  };
  function bankCandidates(gens, packs) {
    if (!BANK || !BANK.prompts || !BANK.prompts.length) return null;
    const have = new Set(speciesTable().filter(s => gens.has(s.gen)).map(s => s.id));
    const seen = new Set(), out = [];
    for (const e of BANK.prompts) {
      if (!packs.has(e.p)) continue;
      const m = [];
      for (const id of e.m) if (have.has(id)) m.push(id);
      const max = e.k === 'gen' ? 200 : 120;
      // A category is only skipped when it is genuinely unplayable (fewer than 3 answers even after the generation
      // filter) - small name lists must not be silently dropped, they are the ones people expect most.
      if (m.length < 3 || m.length > max) continue;
      const sig = m.join(',');
      if (seen.has(sig)) continue;               // two prompts ended up with the same answers after filtering
      seen.add(sig);
      out.push({ id: e.i, kind: e.k, label: cleanQ(e.l), no: e.n || 'Not in that list', m, w: e.w, d: e.d || 2 });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------------------------------------
  // HOST
  // ---------------------------------------------------------------------------------------------
  function newHost(gens, packs) { return { gens: new Set(gens), packs: new Set(cleanPacks(packs)), cands: null, start: 0, fuseEnd: 0, deadline: 0, fz: 0, cz: 0, nz: 0, tk: 0, end: 0 }; }
  function stopHost() {
    if (!H) return;
    clearTimeout(H.fz); clearTimeout(H.cz); clearTimeout(H.nz); clearTimeout(H.end); clearInterval(H.tk);
    H = null;
  }
  function alive() { return S.order.filter(id => S.hp[id] > 0); }
  // The next living player after `id` (works even if `id` is dead or already gone from the order)
  function nextAliveAfter(id) {
    const o = S.order, i = o.indexOf(id);
    for (let k = 1; k <= o.length; k++) { const c = o[(i + k + o.length) % o.length]; if (c !== id && S.hp[c] > 0) return c; }
    return null;
  }
  function push() { S.seq++; B().broadcast({ type: 'VP_STATE', s: S }); render(); }

  // allPokemonList loads asynchronously at page start. A room can technically be created before that finishes,
  // so wait for it (a few seconds at most) instead of building empty prompts.
  function whenSpeciesReady() {
    return new Promise(resolve => {
      if (speciesTable().length >= 1000) { resolve(); return; }
      let n = 0;
      const iv = setInterval(() => {
        if (speciesTable().length >= 1000 || ++n > 80) { clearInterval(iv); resolve(); }
      }, 100);
    });
  }

  function hostStart(opts) {
    const P = B().players();
    const ids = Object.entries(P).sort((a, b) => a[1].slot - b[1].slot).map(e => e[0]);
    const hp = {}; ids.forEach(id => { hp[id] = opts.hearts; });
    stopHost();
    H = newHost(opts.gens, opts.packs);
    const hostRef = H;
    S = {
      v: 1, gid: Math.random().toString(36).slice(2, 8), seq: 0, ph: 'ready', order: ids, hp, maxhp: opts.hearts, minTurn: opts.minTurn,
      gens: opts.gens.slice(), packs: cleanPacks(opts.packs), holder: ids[Math.floor(Math.random() * ids.length)], turnId: 0, rnd: 0,
      pr: null, said: [], used: [], out: [], outAt: {}, pops: 0, boom: null, passes: 0, last: null, crit: false, note: null,
      imgEvery: opts.imgEvery == null ? 3 : clamp(parseInt(opts.imgEvery, 10) || 0, 0, 6), listSince: 0, imgUsed: [], imgN: 0,
      catNo: 0, catGoal: 5, cat: null, swap: null, lastTheme: '', bag: [], lf: '', rk: []
    };
    seen = null; heatCur = heatTgt = 0;
    B().showGame();
    push();   // the ready screen goes up straight away, even if the bank still has to download
    // Start once the species list and the question bank are in. A failed bank download just means the
    // built-in Phase 1 lists are used, so a match can always start.
    Promise.all([whenSpeciesReady(), preload()]).then(() => {
      if (H !== hostRef || !S) return;   // a newer match (or a leave) took over meanwhile
      nextPrompt();
      push();
      H.nz = setTimeout(() => { if (H !== hostRef || !S || S.ph !== 'ready') return; S.ph = 'playing'; S.turnId++; startFuse(); push(); }, READY_MS);
      startTicker();
    });
  }

  // Image rounds (Phase 3) are just another prompt kind inside the same deck. Each pass shows a fresh,
  // never-repeated Pokémon from the voted generation pool; the reveal progress is driven by time held.
  function imageUrl(id) { return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/' + id + '.png'; }
  const ri = r => r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
  // The species ids of the current picture category (puffer-data.json "images"). null = no theme, any Pokémon from the voted generations.
  function themePool() {
    if (!S.cat || !S.cat.th || !BANK || !Array.isArray(BANK.images)) return null;
    const t = BANK.images.find(x => x.i === S.cat.th);
    return t ? new Set(t.m) : null;
  }
  // A theme is only offered if the voted generations leave it enough unseen Pokémon (so "Generation 1" never shows up in a Gen 4 match).
  function pickImageCategory() {
    const list = (BANK && Array.isArray(BANK.images)) ? BANK.images : [];
    const used = new Set(S.imgUsed || []), inGens = new Set(speciesTable().filter(s => H.gens.has(s.gen)).map(s => s.id));
    const ok = list.filter(t => t.i !== S.lastTheme && t.m.filter(id => inGens.has(id) && !used.has(id)).length >= 8);
    const t = ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
    const modes = (B().revealModes && B().revealModes()) || IDENTIFY_MODES;
    S.lastTheme = t ? t.i : '';
    // one reveal style for the whole category (it reads as a category: "blurred Generation 1"), a new style next time
    return { th: t ? t.i : '', tl: t ? t.l : '', mode: modes[Math.floor(Math.random() * modes.length)] };
  }
  function pickImageTarget() {
    const used = new Set(S.imgUsed || []), th = themePool();
    const pool = speciesTable().filter(s => H.gens.has(s.gen) && !used.has(s.id) && (!th || th.has(s.id)));
    if (!pool.length) return 0;
    const s = pool[Math.floor(Math.random() * pool.length)];
    S.imgUsed.push(s.id);
    return s.id;
  }
  function startImagePrompt(target, n) {
    const modes = (B().revealModes && B().revealModes()) || IDENTIFY_MODES;
    const cat = S.cat || {};
    S.used.push('identify');   // do not let the list deck replay this same pseudo-id either
    S.rnd++; S.said = []; S.imgN = n; S.listSince = 0;
    S.pr = {
      id: 'identify', kind: 'identify', label: 'Who is this Pokémon?' + (cat.tl ? ' \u00b7 ' + cat.tl : ''), no: 'Not that Pokémon',
      m: [target], tgt: target, img: imageUrl(target), mode: cat.mode || modes[Math.floor(Math.random() * modes.length)]
    };
  }

  function nextPrompt(forceImage) {
    if (!H) return;
    if (!H.cands) H.cands = bankCandidates(H.gens, H.packs) || buildCandidates(H.gens);
    // Every call here starts a NEW CATEGORY (the first prompt, after a pop, after enough answers, or when a list runs dry).
    S.catNo = (S.catNo || 0) + 1;
    S.swap = { n: S.catNo, img: false };   // clients play the "NEW CATEGORY" banner when this number changes
    // "A list ran dry" (forceImage) always starts an identify round when image rounds are on.
    // Otherwise one comes up after every N list rounds, where N is the host setting.
    if (S.imgEvery > 0 && (forceImage || (S.listSince || 0) >= S.imgEvery)) {
      S.cat = pickImageCategory(); S.catGoal = clamp(alive().length * ri(IMG_LAPS), 3, 8);   // a picture round never runs past 8 images (a pop ends it sooner)
      const target = pickImageTarget();
      if (target) { S.swap.img = true; startImagePrompt(target, 1); return; }
      S.cat = null;   // nothing left to show: fall back to a list
    }
    S.cat = null;
    let pool = H.cands.filter(c => S.used.indexOf(c.id) < 0);
    if (!pool.length) { S.used = []; pool = H.cands.slice(); }
    const byId = {}; pool.forEach(c => { byId[c.id] = c; });
    const FAM = { start: 'name', end: 'name', has: 'name', len: 'name', dbl: 'name', pat: 'name', type: 'type', mono: 'type', dual: 'type', weak: 'type' };
    const famOf = c => FAM[c.kind] || c.kind;
    // Shuffle bag over CATEGORIES (one list = one category): every category is drawn once before any repeats, and the
    // same category never comes up twice in a row. The bag lives in S, so a promoted host keeps the same order for the
    // rest of the game and a fresh room gets a fresh random order.
    S.bag = (S.bag || []).filter(id => pool.some(c => c.id === id));
    if (!S.bag.length) { S.bag = pool.map(c => c.id); for (let i = S.bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = S.bag[i]; S.bag[i] = S.bag[j]; S.bag[j] = t; } }
    const recentKinds = S.rk || [];
    const freshIds = S.bag.filter(id => { const cc = byId[id]; return !cc || recentKinds.indexOf(cc.kind) < 0; });
    const bag = freshIds.length ? freshIds : S.bag;
    const prog = Math.min(1, (S.rnd || 0) / 10);
    const wtOf = id => { const cc = byId[id]; const d = cc ? cc.d : 2; return d === 1 ? 3 - 2 * prog : d === 3 ? 0.6 + 1.6 * prog : 2; };
    const totalW = bag.reduce((n, id) => n + wtOf(id), 0);
    let roll = Math.random() * totalW, cid = bag[bag.length - 1];
    for (const id of bag) { roll -= wtOf(id); if (roll <= 0) { cid = id; break; } }
    const ci = S.bag.indexOf(cid); if (ci >= 0) S.bag.splice(ci, 1);
    S.lf = cid;
    const c = byId[cid];   // the category (one list) the bag drew
    S.lk = c.kind;
    S.used.push(c.id); S.rnd++; S.said = []; S.imgN = 0;
    S.listSince = (S.listSince || 0) + 1;
    S.catGoal = Math.min(clamp(alive().length * ri(LIST_LAPS), 4, 14), c.m.length);
    S.pr = { id: c.id, kind: c.kind, label: c.label, no: c.no, m: c.m };   // the full member list goes out so clients can reject instantly
  }

  // A new random fuse: a start, a pop, a correct answer (the next holder), a holder who left, or a promoted host.
  function startFuse() {
    H.start = now();
    // how far through the category we are, 0..1 (a new category starts calm again)
    const done = S.pr && S.pr.kind === 'identify' ? Math.max(0, (S.imgN || 1) - 1) : (S.said ? S.said.length : 0);
    const esc = clamp(done / Math.max(1, S.catGoal || 5), 0, 1);
    H.fuseEnd = H.start + S.minTurn * 1000 + rand(0, FUSE_SPAN_MS) * (1 - FUSE_SQUEEZE * esc);
    H.deadline = H.fuseEnd;   // whoever holds it gets at least the minimum turn
    armFuse();
  }
  function armFuse() {
    clearTimeout(H.fz);
    H.fz = setTimeout(expire, Math.max(0, H.deadline - now()));
  }
  function expire() {
    if (!H || S.ph !== 'playing') return;
    if (now() < H.deadline - 5) { armFuse(); return; }   // the deadline moved (a pass gave the new holder their minimum turn)
    S.crit = true; push();   // "critical": max swell, but an answer in the next moment still counts
    H.cz = setTimeout(boom, CRIT_MS);
  }

  function boom() {
    if (!H || S.ph !== 'playing') return;
    const L = S.holder;
    S.crit = false; S.pops++;
    S.hp[L] = Math.max(0, S.hp[L] - 1);
    S.boom = { n: S.pops, who: L, dead: S.hp[L] === 0 };
    if (S.hp[L] === 0) { S.out.push(L); S.outAt[L] = S.pops - 1; }   // full rounds survived before the one that got them
    const left = alive();
    if (left.length <= 1) {
      S.ph = 'over'; push();
      H.end = setTimeout(() => finish(left[0]), BOOM_MS + 600);
      return;
    }
    S.ph = 'boom'; push();
    H.nz = setTimeout(() => {
      if (!H) return;
      S.holder = nextAliveAfter(L);   // the next living player after whoever just blew up gets the fresh prompt
      S.turnId++; S.ph = 'playing';
      nextPrompt(); startFuse(); push();
    }, BOOM_MS);
  }

  function reply(pid, msg) {
    if (pid === B().myId()) onNo(msg); else B().sendTo(pid, msg);
  }
  function hostAnswer(pid, sp, t) {
    if (!S || !H || S.ph !== 'playing' || pid !== S.holder || t !== S.turnId) { reply(pid, { type: 'VP_NO', r: 'late' }); return; }
    if (!S.pr) { reply(pid, { type: 'VP_NO', r: 'late' }); return; }
    const isImage = S.pr.kind === 'identify';
    if (!isImage && S.said.indexOf(sp) >= 0) { reply(pid, { type: 'VP_NO', r: 'Already said' }); return; }
    if (S.pr.m.indexOf(sp) < 0) { reply(pid, { type: 'VP_NO', r: S.pr.no }); return; }
    // good answer (also lands during the CRIT window, which is the ~300 ms "accepted after the pop" rule)
    clearTimeout(H.cz); S.crit = false;
    S.said.push(sp); S.last = { by: pid, sp }; S.passes++;
    const next = nextAliveAfter(pid);
    S.holder = next; S.turnId++;
    if (isImage) {
      // A correct picture guess passes the Voltorb and the new holder gets a fresh Pokémon from the same category.
      // After a few pictures the category ends and a NEW CATEGORY starts.
      const target = (S.imgN || 1) >= (S.catGoal || 4) ? 0 : pickImageTarget();
      if (target) startImagePrompt(target, (S.imgN || 1) + 1); else nextPrompt();
    } else if (S.said.length >= (S.catGoal || S.pr.m.length)) {
      const dry = S.said.length >= S.pr.m.length;
      if (dry) S.note = { n: (S.note ? S.note.n : 0) + 1, t: 'All answers found!' };
      nextPrompt(dry);   // a dry list goes to a picture category (if enabled); otherwise the normal deck picks
    }
    startFuse();   // a NEW random fuse for whoever has it now (a pass never carries the old one over)
    push();
  }

  function startTicker() {
    clearInterval(H.tk);
    H.tk = setInterval(() => {
      if (!H || !S || S.ph !== 'playing') return;
      let h = clamp((now() - H.start) / Math.max(1, H.deadline - H.start), 0, 1);
      h = S.crit ? 1 : clamp(h + (Math.random() - 0.5) * 0.05, 0, 0.98);   // noise + a cap so the number alone never gives the pop away
      h = Math.round(h * 100) / 100;
      if (!S.crit) { const tkk = Math.floor(h * 20); if (tkk !== lastTickK) { lastTickK = tkk; B().tone(1500, 0.03, 'sine', 0.012); } }   // soft fuse tick
      B().broadcast({ type: 'VP_TICK', g: S.gid, h });
      setHeat(h);
    }, TICK_MS);
  }

  // Anybody (not the host) who disappears: if they held the Voltorb it moves on with NO penalty
  function onPlayerLeft(pid) {
    if (!S || !H || S.ph === 'over' || !(pid in S.hp)) return;
    const wasHolder = S.holder === pid;
    const nxt = wasHolder ? nextAliveAfter(pid) : null;
    S.order = S.order.filter(id => id !== pid);
    delete S.hp[pid];
    S.out = S.out.filter(id => id !== pid);
    const left = alive();
    if (left.length < 2) { clearTimeout(H.fz); clearTimeout(H.cz); clearTimeout(H.nz); finish(left[0]); return; }
    if (wasHolder) {
      S.holder = (nxt && S.hp[nxt] > 0) ? nxt : left[0];
      S.crit = false; clearTimeout(H.cz);
      S.turnId++;
      if (S.ph === 'playing') startFuse();
    }
    push();
  }

  // New host after a host change: carry on from the last snapshot, with a FRESH fuse
  function resume() {
    if (!S || S.ph === 'over') return;
    const P = B().players();
    stopHost();
    H = newHost(S.gens, S.packs);
    S.packs = cleanPacks(S.packs);
    S.imgEvery = clamp(parseInt(S.imgEvery, 10) || 0, 0, 6);
    S.listSince = +S.listSince || 0;
    S.imgN = +S.imgN || 0;
    S.catNo = +S.catNo || 1; S.catGoal = +S.catGoal || 5;
    S.imgUsed = Array.isArray(S.imgUsed) ? S.imgUsed : [];
    S.order = S.order.filter(id => P[id]);
    Object.keys(S.hp).forEach(id => { if (!P[id]) delete S.hp[id]; });
    S.out = S.out.filter(id => P[id]);
    const left = alive();
    if (left.length < 2) { finish(left[0]); return; }
    const was = S.ph;
    if (was === 'boom' || was === 'ready' || !(S.hp[S.holder] > 0)) S.holder = was === 'boom' && S.boom ? nextAliveAfter(S.boom.who) : (S.hp[S.holder] > 0 ? S.holder : left[0]);
    if (was === 'boom' || was === 'ready') nextPrompt();
    S.crit = false; S.turnId++; S.ph = 'playing';
    startFuse(); push(); startTicker();
  }

  // Last one standing wins. Scores = how many players you outlasted, so the existing podium works unchanged.
  function finish(winner) {
    const P = B().players();
    const rank = S.out.slice(); if (winner) rank.push(winner);
    // Score = full rounds lasted (a pop ends a round). Each pop kills at most one player, so scores never tie except for 0.
    // A player who left mid-match has no outAt, so fall back to their place in the order.
    Object.keys(P).forEach(id => { P[id].score = S.outAt && S.outAt[id] != null ? S.outAt[id] : id === winner ? S.pops : Math.max(0, rank.indexOf(id)); });
    stopHost();
    S.ph = 'over';
    B().endMatch(winner ? '' : 'alone', 'beaten');
  }

  // ---------------------------------------------------------------------------------------------
  // MESSAGES
  // ---------------------------------------------------------------------------------------------
  function onMessage(d, conn) {
    const b = B();
    if (d.type === 'VP_ANS') {
      if (!b.isHost() || !conn || !conn._vsPeerId) return;   // trust the connection, not an id the client claims
      hostAnswer(conn._vsPeerId, +d.sp, +d.t);
    } else if (d.type === 'VP_STATE') {
      if (b.isHost() || !d.s || !Array.isArray(d.s.order) || d.s.gid === endedGid) return;
      if (S && S.gid === d.s.gid && d.s.seq <= S.seq) return;   // old / duplicate
      const newGame = !S || S.gid !== d.s.gid;
      S = d.s;
      if (newGame) { seen = null; heatCur = heatTgt = 0; b.showGame(); }
      render();
    } else if (d.type === 'VP_TICK') {
      if (b.isHost() || !S || d.g !== S.gid) return;
      setHeat(+d.h || 0);
    } else if (d.type === 'VP_NO') {
      onNo(d);
    }
  }
  function onNo(d) {
    pending = false; clearTimeout(pendingTimer);
    if (d.r && d.r !== 'late') reject(d.r);
    refreshInput();
  }

  // ---------------------------------------------------------------------------------------------
  // SCREEN
  // ---------------------------------------------------------------------------------------------
  // Pixel-art Voltorb on a 30x30 grid (shape-rendering: crispEdges keeps every pixel sharp at any size). The body, outline and cream
  // highlight arcs follow the reference sprite and its 4-colour palette; the FACE is drawn separately so it can move:
  //  - .vp-pupil: 2x3 pixel pupils that lookAt() hops around by whole pixels, clipped to the eye
  //  - .vp-brow: the angry lids; they drop about a pixel as the fuse burns (vp.css, --h)
  //  - .vp-mouth s / o: small grin that swaps for an open worried mouth late in the fuse
  //  - .vp-sweat (two drops) and .vp-crack fade in with heat. All of it is transform/opacity only, so it is cheap above the phone keyboard.
  const VOLTORB_SVG = `<svg class="vp-svg" viewBox="0 0 30 30" shape-rendering="crispEdges" aria-hidden="true"><defs><clipPath id="vpEL"><path d="M6 12h6v6h-6z M7 18h4v1h-4z"/></clipPath><clipPath id="vpER"><path d="M18 12h6v6h-6z M19 18h4v1h-4z"/></clipPath></defs><g class="vp-body"><path fill="#d64a31" d="M11 0h1v1h-1zM18 0h1v1h-1zM8 1h1v1h-1zM11 1h8v1h-8zM21 1h1v1h-1zM6 2h1v1h-1zM8 2h3v1h-3zM14 2h8v1h-8zM23 2h1v1h-1zM7 3h1v1h-1zM15 3h4v1h-4zM22 3h1v1h-1zM5 4h2v1h-2zM15 4h3v1h-3zM23 4h2v1h-2zM4 5h1v1h-1zM13 5h5v1h-5zM23 5h3v1h-3zM2 6h2v1h-2zM11 6h8v1h-8zM22 6h6v1h-6zM3 7h1v1h-1zM10 7h17v1h-17zM1 8h2v1h-2zM8 8h21v1h-21zM2 9h1v1h-1zM7 9h21v1h-21zM2 10h1v1h-1zM6 10h22v1h-22zM0 11h30v1h-30zM1 12h28v1h-28zM1 13h28v1h-28zM1 14h28v1h-28zM1 15h28v1h-28zM1 16h28v1h-28zM0 17h29v1h-29zM1 18h29v1h-29zM1 19h28v1h-28zM3 20h24v1h-24zM1 21h2v1h-2zM4 21h23v1h-23zM28 21h1v1h-1zM6 22h20v1h-20zM2 23h1v1h-1zM8 23h16v1h-16zM27 23h1v1h-1zM4 24h1v1h-1zM11 24h11v1h-11zM5 25h1v1h-1zM7 26h1v1h-1zM6 27h1v1h-1zM8 27h2v1h-2zM23 27h1v1h-1zM8 28h1v1h-1zM11 28h8v1h-8zM21 28h1v1h-1zM11 29h1v1h-1zM18 29h1v1h-1z"/><path fill="#ffff9c" d="M11 2h3v1h-3zM8 3h3v1h-3zM14 3h1v1h-1zM19 3h3v1h-3zM7 4h1v1h-1zM14 4h1v1h-1zM18 4h1v1h-1zM22 4h1v1h-1zM5 5h2v1h-2zM11 5h2v1h-2zM18 5h1v1h-1zM22 5h1v1h-1zM4 6h1v1h-1zM10 6h1v1h-1zM19 6h3v1h-3zM4 7h1v1h-1zM8 7h2v1h-2zM3 8h1v1h-1zM7 8h1v1h-1zM3 9h1v1h-1zM6 9h1v1h-1zM3 10h1v1h-1zM5 10h1v1h-1zM0 18h1v1h-1zM29 19h1v1h-1zM2 20h1v1h-1zM27 20h1v1h-1zM3 21h1v1h-1zM3 22h3v1h-3zM4 23h3v1h-3zM5 24h4v1h-4zM6 25h5v1h-5zM8 26h5v1h-5zM10 27h7v1h-7zM21 27h1v1h-1z"/><path fill="#fffff7" d="M11 3h3v1h-3zM8 4h6v1h-6zM19 4h3v1h-3zM7 5h4v1h-4zM19 5h3v1h-3zM5 6h5v1h-5zM5 7h3v1h-3zM4 8h3v1h-3zM4 9h2v1h-2zM4 10h1v1h-1zM27 21h1v1h-1zM26 22h1v1h-1zM7 23h1v1h-1zM24 23h3v1h-3zM9 24h2v1h-2zM22 24h4v1h-4zM11 25h14v1h-14zM13 26h10v1h-10zM17 27h4v1h-4z"/><path fill="#313131" d="M12 0h6v1h-6zM9 1h2v1h-2zM19 1h2v1h-2zM7 2h1v1h-1zM22 2h1v1h-1zM5 3h2v1h-2zM23 3h2v1h-2zM4 4h1v1h-1zM25 4h1v1h-1zM3 5h1v1h-1zM26 5h1v1h-1zM2 7h1v1h-1zM27 7h1v1h-1zM1 9h1v1h-1zM28 9h1v1h-1zM1 10h1v1h-1zM28 10h1v1h-1zM0 12h1v1h-1zM29 12h1v1h-1zM0 13h1v1h-1zM29 13h1v1h-1zM0 14h1v1h-1zM29 14h1v1h-1zM0 15h1v1h-1zM29 15h1v1h-1zM0 16h1v1h-1zM29 16h1v1h-1zM29 17h1v1h-1zM1 20h1v1h-1zM28 20h1v1h-1zM2 22h1v1h-1zM27 22h1v1h-1zM3 23h1v1h-1zM3 24h1v1h-1zM26 24h1v1h-1zM4 25h1v1h-1zM25 25h1v1h-1zM5 26h2v1h-2zM23 26h2v1h-2zM7 27h1v1h-1zM22 27h1v1h-1zM9 28h2v1h-2zM19 28h2v1h-2zM12 29h6v1h-6z"/></g><g class="vp-crack"><path fill="#ffff9c" d="M14 3h1v1h-1zM14 4h1v1h-1zM15 5h1v1h-1zM14 6h1v1h-1zM14 7h1v1h-1zM15 8h1v1h-1zM22 8h1v1h-1zM23 9h1v1h-1zM22 10h1v1h-1zM23 11h1v1h-1z"/></g><g class="vp-eye"><path fill="#fffff7" d="M6 12h1v1h-1zM7 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM6 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM11 13h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM10 15h1v1h-1zM11 15h1v1h-1zM6 16h1v1h-1zM7 16h1v1h-1zM8 16h1v1h-1zM9 16h1v1h-1zM10 16h1v1h-1zM11 16h1v1h-1zM6 17h1v1h-1zM7 17h1v1h-1zM8 17h1v1h-1zM9 17h1v1h-1zM10 17h1v1h-1zM11 17h1v1h-1zM7 18h1v1h-1zM8 18h1v1h-1zM9 18h1v1h-1zM10 18h1v1h-1z"/><path fill="#313131" d="M6 11h1v1h-1zM7 11h1v1h-1zM8 11h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM5 12h1v1h-1zM12 12h1v1h-1zM5 13h1v1h-1zM12 13h1v1h-1zM5 14h1v1h-1zM12 14h1v1h-1zM5 15h1v1h-1zM12 15h1v1h-1zM5 16h1v1h-1zM12 16h1v1h-1zM5 17h1v1h-1zM12 17h1v1h-1zM6 18h1v1h-1zM11 18h1v1h-1zM7 19h1v1h-1zM8 19h1v1h-1zM9 19h1v1h-1zM10 19h1v1h-1z"/><g clip-path="url(#vpEL)"><g class="vp-pupil"><path fill="#313131" d="M8 15h1v1h-1zM8 16h1v1h-1zM8 17h1v1h-1zM9 15h1v1h-1zM9 16h1v1h-1zM9 17h1v1h-1z"/><path fill="#fffff7" d="M9 15h1v1h-1z"/></g></g><g class="vp-brow l"><path fill="#d64a31" d="M7 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM9 13h1v1h-1zM10 12h1v1h-1zM10 13h1v1h-1zM11 12h1v1h-1zM11 13h1v1h-1zM11 14h1v1h-1z"/><path fill="#313131" d="M6 11h1v1h-1zM6 12h1v1h-1zM7 11h1v1h-1zM7 13h1v1h-1zM8 11h1v1h-1zM8 13h1v1h-1zM9 11h1v1h-1zM9 14h1v1h-1zM10 11h1v1h-1zM10 14h1v1h-1zM11 11h1v1h-1zM11 15h1v1h-1z"/></g></g><g class="vp-eye"><path fill="#fffff7" d="M23 12h1v1h-1zM22 12h1v1h-1zM21 12h1v1h-1zM20 12h1v1h-1zM19 12h1v1h-1zM18 12h1v1h-1zM23 13h1v1h-1zM22 13h1v1h-1zM21 13h1v1h-1zM20 13h1v1h-1zM19 13h1v1h-1zM18 13h1v1h-1zM23 14h1v1h-1zM22 14h1v1h-1zM21 14h1v1h-1zM20 14h1v1h-1zM19 14h1v1h-1zM18 14h1v1h-1zM23 15h1v1h-1zM22 15h1v1h-1zM21 15h1v1h-1zM20 15h1v1h-1zM19 15h1v1h-1zM18 15h1v1h-1zM23 16h1v1h-1zM22 16h1v1h-1zM21 16h1v1h-1zM20 16h1v1h-1zM19 16h1v1h-1zM18 16h1v1h-1zM23 17h1v1h-1zM22 17h1v1h-1zM21 17h1v1h-1zM20 17h1v1h-1zM19 17h1v1h-1zM18 17h1v1h-1zM22 18h1v1h-1zM21 18h1v1h-1zM20 18h1v1h-1zM19 18h1v1h-1z"/><path fill="#313131" d="M23 11h1v1h-1zM22 11h1v1h-1zM21 11h1v1h-1zM20 11h1v1h-1zM19 11h1v1h-1zM18 11h1v1h-1zM24 12h1v1h-1zM17 12h1v1h-1zM24 13h1v1h-1zM17 13h1v1h-1zM24 14h1v1h-1zM17 14h1v1h-1zM24 15h1v1h-1zM17 15h1v1h-1zM24 16h1v1h-1zM17 16h1v1h-1zM24 17h1v1h-1zM17 17h1v1h-1zM23 18h1v1h-1zM18 18h1v1h-1zM22 19h1v1h-1zM21 19h1v1h-1zM20 19h1v1h-1zM19 19h1v1h-1z"/><g clip-path="url(#vpER)"><g class="vp-pupil"><path fill="#313131" d="M21 15h1v1h-1zM21 16h1v1h-1zM21 17h1v1h-1zM20 15h1v1h-1zM20 16h1v1h-1zM20 17h1v1h-1z"/><path fill="#fffff7" d="M21 15h1v1h-1z"/></g></g><g class="vp-brow r"><path fill="#d64a31" d="M22 12h1v1h-1zM21 12h1v1h-1zM20 12h1v1h-1zM20 13h1v1h-1zM19 12h1v1h-1zM19 13h1v1h-1zM18 12h1v1h-1zM18 13h1v1h-1zM18 14h1v1h-1z"/><path fill="#313131" d="M23 11h1v1h-1zM23 12h1v1h-1zM22 11h1v1h-1zM22 13h1v1h-1zM21 11h1v1h-1zM21 13h1v1h-1zM20 11h1v1h-1zM20 14h1v1h-1zM19 11h1v1h-1zM19 14h1v1h-1zM18 11h1v1h-1zM18 15h1v1h-1z"/></g></g><g class="vp-mouth s"><path fill="#313131" d="M10 20h1v1h-1zM11 21h1v1h-1zM12 22h1v1h-1zM13 22h1v1h-1zM14 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM18 21h1v1h-1zM19 20h1v1h-1z"/></g><g class="vp-mouth o"><path fill="#313131" d="M10 21h1v1h-1zM11 21h1v1h-1zM12 21h1v1h-1zM13 21h1v1h-1zM14 21h1v1h-1zM15 21h1v1h-1zM16 21h1v1h-1zM17 21h1v1h-1zM18 21h1v1h-1zM19 21h1v1h-1zM11 22h1v1h-1zM12 22h1v1h-1zM13 22h1v1h-1zM14 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM18 22h1v1h-1zM13 23h1v1h-1zM14 23h1v1h-1zM15 23h1v1h-1zM16 23h1v1h-1z"/></g><g class="vp-sweat"><path fill="#313131" d="M2 13h1v1h-1z"/><path fill="#313131" d="M1 14h1v1h-1z"/><path fill="#7dd3fc" d="M2 14h1v1h-1z"/><path fill="#313131" d="M3 14h1v1h-1z"/><path fill="#313131" d="M1 15h1v1h-1z"/><path fill="#7dd3fc" d="M2 15h1v1h-1z"/><path fill="#313131" d="M3 15h1v1h-1z"/><path fill="#313131" d="M2 16h1v1h-1z"/><path fill="#e6f7ff" d="M2 14h1v1h-1z"/></g><g class="vp-sweat b"><path fill="#313131" d="M27 13h1v1h-1z"/><path fill="#313131" d="M26 14h1v1h-1z"/><path fill="#7dd3fc" d="M27 14h1v1h-1z"/><path fill="#313131" d="M28 14h1v1h-1z"/><path fill="#313131" d="M26 15h1v1h-1z"/><path fill="#7dd3fc" d="M27 15h1v1h-1z"/><path fill="#313131" d="M28 15h1v1h-1z"/><path fill="#313131" d="M27 16h1v1h-1z"/><path fill="#e6f7ff" d="M27 14h1v1h-1z"/></g></svg>`;

  function ensureUI() {
    if (ui) return;
    const el = document.createElement('div');
    el.id = 'vp-screen'; el.className = 'vp-screen hidden';
    el.innerHTML = `
      <div class="vp-bg" aria-hidden="true"></div>
      <div class="vp-edge" aria-hidden="true"></div>
      <button type="button" class="vp-leave" aria-label="Leave the game">&#10005;</button>
      <div class="vp-head"><b>VOLTORB'S VENGEANCE</b><span class="vp-round"></span></div>
      <div class="vp-prompt"><span class="vp-kind"></span><b class="vp-label"></b><div class="vp-newcat" aria-hidden="true"><b>NEW CATEGORY</b><span></span></div></div>
      <!-- fuse bar: in the normal column flow (not on the stage) so no seat can ever sit on top of it -->
      <div class="vp-arena">
        <div class="vp-seats"></div>
        <div class="vp-stage">
          <div class="vp-voltwrap"><div class="vp-volt">${VOLTORB_SVG}</div></div>
          <div class="vp-art hidden" aria-hidden="true">
            <canvas class="vp-art-cv" width="320" height="320"></canvas>
            <span class="vp-art-msg">Loading…</span>
            <span class="vp-art-bar"><i></i></span>
          </div>
          <div class="vp-burst" aria-hidden="true"></div>
          <div class="vp-said" aria-live="polite"></div>
        </div>
      </div>
      <div class="vp-msg" aria-live="polite"></div>
      <div class="vp-box">
        <input type="text" class="vp-input" placeholder="Name a Pokémon..." autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text" aria-label="Your answer" />
        <div class="vp-sug suggestions-container"></div>
      </div>
      <div class="vp-ready hidden"><div class="vp-ready-t">GET READY</div><div class="vp-ready-n"><span>3</span><span>2</span><span>1</span></div><div class="vp-ready-s"></div></div>`;
    document.body.appendChild(el);
    ui = {
      screen: el, round: el.querySelector('.vp-round'), kind: el.querySelector('.vp-kind'), label: el.querySelector('.vp-label'),
      prompt: el.querySelector('.vp-prompt'), arena: el.querySelector('.vp-arena'), seats: el.querySelector('.vp-seats'),
      stage: el.querySelector('.vp-stage'), wrap: el.querySelector('.vp-voltwrap'), volt: el.querySelector('.vp-volt'), burst: el.querySelector('.vp-burst'),
      said: el.querySelector('.vp-said'), newcat: el.querySelector('.vp-newcat'), msg: el.querySelector('.vp-msg'), box: el.querySelector('.vp-box'),
      input: el.querySelector('.vp-input'), sug: el.querySelector('.vp-sug'), pupils: Array.from(el.querySelectorAll('.vp-pupil')),
      art: el.querySelector('.vp-art'), artCanvas: el.querySelector('.vp-art-cv'), artMsg: el.querySelector('.vp-art-msg'), artBar: el.querySelector('.vp-art-bar i'),
      ready: el.querySelector('.vp-ready'), readySub: el.querySelector('.vp-ready-s'), leave: el.querySelector('.vp-leave'), seatEls: {}
    };

    // ---- the answer box: it is "blocked", never blurred, so the phone keyboard stays open between turns (same trick as Versus) ----
    ui.input.addEventListener('input', () => {
      if (blocked) { ui.input.value = ''; ui.sug.innerHTML = ''; return; }
      if (typeof setupAutocomplete !== 'function') return;
      // Suggestions stay hidden until 3 letters are typed: with "Name starts with P", typing "p" would otherwise list
      // every answer and the round would be a free pass. (The box itself is never disabled, so the keyboard stays open.)
      const typed = ui.input.value.trim();
      if (typed.length < 3) {
        ui.sug.innerHTML = typed ? '<div class="vp-sug-hint">Type 3 letters to see suggestions</div>' : '';
        return;
      }
      // NOT filtered by the prompt: that would give the answer away
      const matches = setupAutocomplete(ui.input, ui.sug, submit, { speciesOnly: true });   // species rows only, so "hisui" / "mega" can't list the form answers
      B().autoPick(ui.input, matches, () => !blocked && !!S && S.holder === B().myId(), submit);   // your own turn only
    });
    if (typeof attachAutocompleteKeyboardNav === 'function') attachAutocompleteKeyboardNav(ui.input, ui.sug);
    // Enter is how an answer is sent now (nothing fires by itself). The shared nav handler above sends the highlighted
    // or first suggestion; this covers the case where there is no row to pick (an exact name typed, or < 3 letters).
    // Pressing Enter before your turn does nothing at all - the text stays so you can send it when the Voltorb arrives.
    ui.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
      if (!S || blocked || S.holder !== B().myId()) return;
      const typed = ui.input.value.trim();
      if (!typed) return;
      const q = typed.toLowerCase();
      const flat = (typeof allPokemonList !== 'undefined' && allPokemonList) || [];
      const hit = flat.find(x => !x.excluded && !x.synthetic && x.id <= 1025 && (x.lc === q || String(x.displayName).toLowerCase() === q));
      if (!hit) return;
      e.preventDefault();
      submit(hit);
    });
    ui.input.addEventListener('focus', () => { if (ui.msg.textContent.indexOf('Tap anywhere') === 0) ui.msg.textContent = ''; });

    // any tap on the screen puts you back in the box (this is also what opens the keyboard on iOS: it must happen inside a tap)
    const tap = e => {
      if (!shown) return;
      if (e.target.closest && e.target.closest('button, a, input, .suggestion-item')) return;
      focusInput();
    };
    el.addEventListener('touchend', tap, { passive: true });
    el.addEventListener('click', tap);
    document.addEventListener('keydown', e => {   // desktop: just start typing
      if (!shown || e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1) return;
      const t = document.activeElement;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      focusInput();
    });
    ui.leave.addEventListener('click', () => {   // two taps, no pop-up
      if (!ui.leave.classList.contains('sure')) {
        ui.leave.classList.add('sure'); ui.leave.textContent = 'Leave?';
        clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { ui.leave.classList.remove('sure'); ui.leave.innerHTML = '&#10005;'; }, 3000);
        return;
      }
      B().leave();
    });

    // layout: compact whenever the screen is short (phone with the keyboard up, small window)
    if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe(el); ro.observe(ui.arena); }
    window.addEventListener('resize', layout);
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', vvSync); vv.addEventListener('scroll', vvSync); }
    el.addEventListener('focusin', vvSync); el.addEventListener('focusout', () => setTimeout(vvSync, 60));
    if (reduceQ && reduceQ.addEventListener) reduceQ.addEventListener('change', () => ui.screen.classList.toggle('reduce', reduced()));
  }

  function focusInput() {
    if (!ui || document.activeElement === ui.input) return;
    try { ui.input.focus({ preventScroll: true }); } catch (e) { ui.input.focus(); }
  }

  // Phones: the screen is pinned to the VISIBLE area (above the keyboard) so the prompt, Voltorb, box and suggestions always fit
  let baseH = window.innerHeight;
  function vvSync() {
    if (!ui || !shown) return;
    const vv = window.visualViewport, root = document.documentElement;
    if (!vv || !B().touch) { ui.screen.style.removeProperty('--vp-top'); ui.screen.style.removeProperty('--vp-h'); root.classList.remove('vp-kb-open'); return; }
    if (document.activeElement !== ui.input) baseH = Math.max(baseH, window.innerHeight);
    const open = baseH - vv.height > 100 && (vv.scale || 1) < 1.05;   // pinch-zoom also shrinks vv.height - that is not a keyboard
    root.classList.toggle('vp-kb-open', open);
    const acc = open ? ((window.Settings && window.Settings.kbAccessory) || 0) : 0;   // iOS 26 keyboard toolbar floats over the page
    ui.screen.style.setProperty('--vp-top', vv.offsetTop + 'px');
    ui.screen.style.setProperty('--vp-h', Math.max(200, vv.height - acc) + 'px');
    if (window.scrollY) window.scrollTo(0, 0);
    layout();
  }
  function layout() {
    if (!ui || !shown) return;
    const r = ui.screen.getBoundingClientRect();
    const compact = r.height < 560 || r.width < 330;
    const tight = r.height < 470 || r.width < 300;   // keyboard up on a phone: keep the seats, just smaller
    ui.screen.classList.toggle('compact', compact);
    ui.screen.classList.toggle('tight', tight);
    const a = ui.arena.getBoundingClientRect();
    const vsz = compact ? Math.min(a.height - 20, a.width * 0.46, 150) : Math.min(a.width * 0.44, a.height * 0.5, 230);
    ui.screen.style.setProperty('--vp-vsz', Math.max(64, vsz) + 'px');
    // Seats use the same six fixed places as the lobby chairs (2 at the front of the pad, 2 up the sides, 2 at the back),
    // scaled around the Voltorb. Sizes are in --vp-av so the avatar, stool and name pill scale together.
    const av = compact ? (tight ? 28 : 37) : Math.round(clamp(vsz * 0.3, 40, 52));
    const below = av * 1.4 + (compact ? 12 : 31);   // from the avatar centre down to the bottom of the hearts/name
    const rx = Math.max(av * 1.15, Math.min(vsz * 0.95, a.width / 2 - av * 0.8 - 8));
    const ry = Math.max(av * 0.8, Math.min(vsz * 0.7, a.height / 2 - below - 4));
    ui.screen.style.setProperty('--vp-av', av + 'px');
    ui.screen.style.setProperty('--vp-rx', rx.toFixed(1) + 'px');
    ui.screen.style.setProperty('--vp-ry', ry.toFixed(1) + 'px');
    // the lobby picture sits behind the game with its pad under the Voltorb's feet (lobby-stage.css reads --vp-S / --vp-cx / --vp-ay)
    const sg = ui.stage.getBoundingClientRect(), pS = Math.max(240, Math.max(64, vsz) / 0.165);
    ui.screen.style.setProperty('--vp-S', pS.toFixed(0) + 'px');
    ui.screen.style.setProperty('--vp-cx', (sg.left + sg.width / 2 - r.left).toFixed(0) + 'px');
    ui.screen.style.setProperty('--vp-ay', (sg.top + sg.height * 0.97 - r.top - pS * 0.55).toFixed(0) + 'px');
    document.documentElement.style.setProperty('--vp-S', pS.toFixed(0) + 'px');   // the fixed #vs-scene behind the (transparent) game screen reads these
    document.documentElement.style.setProperty('--vp-ay', (sg.top + sg.height * 0.97 - pS * 0.55).toFixed(0) + 'px');
    ui.screen.style.setProperty('--vp-sug', (compact ? 88 : 170) + 'px');   // compact: about 2.5 suggestion rows
    lookAt();
  }

  // ---- identify-the-Pokémon round: art lives inside the stage, so the compact layout never grows ----
  function artProgress() {
    const ms = Math.max(1000, (S && S.minTurn ? S.minTurn : 10) * 1000);
    return clamp((now() - artStart) / ms, 0, 1);
  }
  function drawArt() {
    if (!ui || !S || !S.pr || S.pr.kind !== 'identify') return;
    const p = artProgress();
    ui.artBar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
    if (!artReady || !artImg) return;
    try {
      if (B().renderReveal) B().renderReveal(artImg, S.pr.mode, p, ui.artCanvas);
      else {
        const ctx = ui.artCanvas.getContext('2d');
        ctx.clearRect(0, 0, ui.artCanvas.width, ui.artCanvas.height);
        ctx.filter = 'blur(' + ((1 - p) * 20).toFixed(1) + 'px)';
        ctx.drawImage(artImg, 0, 0, ui.artCanvas.width, ui.artCanvas.height);
        ctx.filter = 'none';
      }
    } catch (e) {}
  }
  function loadArt(url) {
    let rec = artCache.get(url);
    if (!rec) {
      const im = new Image();
      im.crossOrigin = 'anonymous';   // the reveal renderer reads pixels back for Silhouette
      rec = { img: im, ok: false, done: false };
      im.onload = () => {
        rec.ok = true; rec.done = true;
        if (artUrl === url && ui) { artReady = true; ui.artMsg.textContent = ''; drawArt(); }
      };
      im.onerror = () => {
        rec.ok = false; rec.done = true;
        if (artUrl === url && ui) { artReady = false; ui.artMsg.textContent = 'Image unavailable'; }
      };
      im.src = url;
      artCache.set(url, rec);
      if (artCache.size > 30) { const old = artCache.keys().next().value; if (old !== url) artCache.delete(old); }
    }
    artImg = rec.img; artReady = rec.ok;
    ui.artMsg.textContent = rec.ok ? '' : rec.done ? 'Image unavailable' : 'Loading\u2026';
  }
  function startArt(pr) {
    if (!ui) return;
    ui.screen.classList.add('identify');
    ui.art.classList.remove('hidden');
    artStart = now();
    const url = pr.img || '';
    if (url !== artUrl || !artImg) {
      artUrl = url;
      artImg = null; artReady = false;
      ui.artCanvas.getContext('2d').clearRect(0, 0, ui.artCanvas.width, ui.artCanvas.height);
      if (url) loadArt(url); else { artReady = false; ui.artMsg.textContent = 'Image unavailable'; }
    }
    drawArt();
  }
  function stopArt() {
    if (!ui) return;
    ui.screen.classList.remove('identify');
    ui.art.classList.add('hidden');
    artUrl = ''; artImg = null; artReady = false; artStart = 0;
    ui.artMsg.textContent = '';
    ui.artBar.style.transform = 'scaleX(0)';
    const ctx = ui.artCanvas.getContext('2d');
    ctx.clearRect(0, 0, ui.artCanvas.width, ui.artCanvas.height);
  }

  function show() {
    if (shown) return;
    shown = true;
    ensureUI();
    ui.screen.classList.remove('hidden');
    ui.screen.classList.toggle('reduce', reduced());
    document.documentElement.classList.add('vp-active');
    baseH = Math.max(baseH, window.innerHeight);
    ui.seats.innerHTML = ''; ui.said.textContent = ''; ui.msg.textContent = '';
    stopArt();
    vvSync(); layout();
    lastTs = 0; raf = requestAnimationFrame(frame);
    // the phone keyboard needs a tap; on a laptop just start typing
    ui.msg.textContent = B().touch ? 'Tap anywhere to open the keyboard' : '';
    if (!B().touch) focusInput();
  }
  function hide() {
    stopHost();
    if (!shown) { if (S) endedGid = S.gid; S = null; return; }
    shown = false;
    if (S) endedGid = S.gid;
    cancelAnimationFrame(raf);
    ui.screen.classList.add('hidden');
    ui.screen.classList.remove('boom', 'hot', 'crit', 'mine');
    stopArt();
    document.documentElement.classList.remove('vp-active', 'vp-kb-open');
    try { ui.input.blur(); } catch (e) {}
    ui.input.value = ''; ui.sug.innerHTML = '';
    S = null; seen = null; pending = false;
  }

  // ---- seats ----
  // The same six fixed places as the lobby chairs: 1-2 at the front of the pad, 2 up the sides, 2 at the back.
  const SEAT_SX = [-0.48, 0.48, 1, 0.52, -0.52, -1];
  const SEAT_SY = [1, 1, 0, -1, -1, 0];
  function buildSeats() {
    const P = B().players(), me = B().myId();
    const mySlot = (P[me] && P[me].slot >= 0 && P[me].slot < 6) ? P[me].slot : 0;
    ui.seats.innerHTML = ''; ui.seatEls = {};
    // Rotate the chair ring so THAT player always takes the front-left chair (the bottom of the screen); the
    // others follow in clockwise order from there. The six fixed chair places are untouched - only who sits
    // where - so in a 1v1 the other player is always the front-right one (the same place as the lobby).
    const rows = Object.keys(P).map(id => ({ id, slot: (P[id] && P[id].slot >= 0 && P[id].slot < 6) ? P[id].slot : 0 }))
      .sort((a, b) => (a.slot - mySlot + 6) % 6 - (b.slot - mySlot + 6) % 6);
    let mePos = 0;
    rows.forEach(e => {
      const id = e.id, p = P[id] || { name: 'Player', av: null };
      const d = document.createElement('div');
      d.className = 'vp-seat' + (id === me ? ' me' : '') + (S.hp[id] > 0 ? '' : ' out');
      d.dataset.id = id;
      d.style.setProperty('--sx', SEAT_SX[mePos]); d.style.setProperty('--sy', SEAT_SY[mePos]);   // position 0 = front-left = the bottom of the screen (this player)
      mePos++;
      let hearts = '';
      for (let k = 0; k < S.maxhp; k++) hearts += `<i class="${k < S.hp[id] ? 'on' : ''}">&#9829;</i>`;
      d.innerHTML = `<span class="vp-av">${B().avatarHTML(p.av, 'sm')}</span><span class="vp-nm">${B().esc(p.name)}</span><span class="vp-hp">${hearts}</span>`;
      ui.seats.appendChild(d);
      ui.seatEls[id] = d;
    });
  }

  // ---- the Voltorb's eyes ----
  function lookAt() {
    if (!ui || !S) return;
    const me = B().myId();
    let ox = 0, oy = 0;
    if (S.holder === me && (S.ph === 'playing')) { oy = 1; }   // your turn: it stares straight at you (you sit at the bottom of the screen)
    else {
      const seat = ui.seatEls[S.holder];
      if (seat) {
        const avatar = seat.querySelector('.vp-av') || seat;
        const c = ui.wrap.getBoundingClientRect(), s = avatar.getBoundingClientRect();
        const dx = s.left + s.width / 2 - (c.left + c.width / 2), dy = s.top + s.height / 2 - (c.top + c.height / 2);
        const len = Math.hypot(dx, dy) || 1;
        ox = Math.round((dx / len) * 1.4); oy = Math.round((dy / len) * 1.2);   // whole sprite pixels: -1, 0 or 1
      }
    }
    ui.pupils.forEach(p => { p.style.transform = `translate(${ox}px, ${oy}px)`; });
  }

  // ---- render the snapshot (every device, host included) ----
  function render() {
    if (!S) return;
    show();
    const b = B(), me = b.myId(), P = b.players();
    const sig = S.order.join(',') + '|' + S.order.map(id => S.hp[id]).join(',');
    const first = !seen;
    if (first) seen = { sig: '', rnd: S.rnd, pid: '', pops: S.pops, passes: S.passes, swap: S.swap ? S.swap.n : 0, note: S.note ? S.note.n : 0, holder: '', ph: '', artTurn: -1 };
    if (sig !== seen.sig) { seen.sig = sig; buildSeats(); }
    if (S.pr && S.pr.id + ':' + S.rnd + ':' + (S.pr.tgt || '') !== seen.pid) {
      seen.pid = S.pr.id + ':' + S.rnd + ':' + (S.pr.tgt || '');
      mset = new Set(S.pr.m);
      // A new prompt: anything typed for the previous one is stale. (Passes inside a prompt keep the box, so an
      // answer typed ahead is still there when the Voltorb reaches you.)
      if (!first) { ui.input.value = ''; ui.sug.innerHTML = ''; }
      ui.kind.textContent = KINDS[S.pr.kind] || '';
      ui.kind.dataset.k = S.pr.kind;
      ui.label.textContent = S.pr.label;
      ui.prompt.classList.remove('flip'); void ui.prompt.offsetWidth; ui.prompt.classList.add('flip');
      if (!first) b.tone(740, 0.07, 'sine', 0.06);
    }
    // progress inside the category (the category changes after this many answers; the fuse is separate and still hidden)
    if (S.pr) ui.round.textContent = S.pr.kind === 'identify' ? 'Picture ' + Math.min(S.imgN || 1, S.catGoal || 4) + ' of ' + (S.catGoal || 4)
      : 'Category ' + (S.catNo || 1) + ' \u00b7 ' + S.said.length + ' of ' + (S.catGoal || S.pr.m.length);
    if (S.pr && S.pr.kind === 'identify') {
      if (S.turnId !== seen.artTurn) { seen.artTurn = S.turnId; startArt(S.pr); }
    } else if (ui.screen.classList.contains('identify')) {
      stopArt();
    }
    Object.keys(ui.seatEls).forEach(id => ui.seatEls[id].classList.toggle('turn', id === S.holder && S.ph === 'playing'));
    if (S.holder !== seen.holder) { seen.holder = S.holder; lookAt(); }

    const mine = S.holder === me && S.ph === 'playing';
    ui.screen.classList.toggle('mine', mine);
    ui.screen.classList.toggle('crit', !!S.crit);
    if (mine && !seen.wasMine) { b.tone(660, 0.09, 'sine', 0.09); b.tone(990, 0.12, 'sine', 0.09, 0.08); }   // you caught it
    seen.wasMine = mine;

    // READY overlay (3-2-1 is pure CSS; it starts when this class goes on)
    const rdy = S.ph === 'ready';
    if (rdy && ui.ready.classList.contains('hidden')) { ui.ready.classList.remove('hidden'); ui.readySub.textContent = 'Name a Pokémon that fits the prompt to pass the Voltorb on. Whoever is holding it when it blows loses a heart.'; if (!rdyCue) { rdyCue = true; B().tone(523.25, 0.16, 'sine', 0.12); } }
    if (!rdy) { ui.ready.classList.add('hidden'); rdyCue = false; }

    // events
    if (!first && S.pops !== seen.pops) { seen.pops = S.pops; doBoom(S.boom); }
    seen.pops = S.pops;
    if (!first && S.passes !== seen.passes && S.last) doPass(S.last);
    seen.passes = S.passes;
    if (!first && S.swap && S.swap.n > 1 && S.swap.n !== seen.swap) showNewCat(S.swap);   // (category 1 is the opening prompt, the 3-2-1 screen covers that)
    seen.swap = S.swap ? S.swap.n : 0;
    if (!first && S.note && S.note.n !== seen.note) { seen.note = S.note.n; say(S.note.t, 'good'); }
    seen.note = S.note ? S.note.n : 0;

    if (S.crit) heatTgt = 1;
    if (S.ph !== 'playing' && S.ph !== 'over') heatTgt = 0;
    if (S.ph === 'over') heatTgt = 0;
    pending = pending && S.holder === me && S.ph === 'playing' && seen.turn === S.turnId;   // a new turn clears the "sent" lock
    seen.turn = S.turnId;
    refreshInput();
  }

  // "NEW CATEGORY" banner. It sits INSIDE the prompt card (the card clips it), so a category change is one card changing rather than a
  // second layer on top: the card flips in already gold, then the gold slides off to reveal the new prompt (the label underneath is
  // already the new one). Transform/opacity only. With reduced motion the CSS has no animation, so .show just flips the opacity and
  // the timer below takes it away again.
  function showNewCat(sw) {
    if (!ui) return;
    ui.newcat.querySelector('span').textContent = sw.img ? 'Picture round!' : '';
    ui.newcat.classList.remove('show'); void ui.newcat.offsetWidth; ui.newcat.classList.add('show');
    clearTimeout(newcatTimer); newcatTimer = setTimeout(() => ui.newcat.classList.remove('show'), 1300);   // the 1.2s CSS animation plus a little slack
    B().tone(520, 0.07, 'triangle', 0.08); B().tone(780, 0.07, 'triangle', 0.08, 0.07); B().tone(1040, 0.1, 'triangle', 0.08, 0.14);
  }

  function holderName() {
    const p = B().players()[S.holder];
    return p ? p.name : 'Someone';
  }
  function refreshInput() {
    if (!ui || !S) return;
    const me = B().myId();
    const out = !(S.hp[me] > 0);
    const mine = S.holder === me && S.ph === 'playing';
    // TYPING AHEAD: while somebody else has the Voltorb you can already type (and pick) your answer for THIS list.
    // Nothing fires by itself any more: when the Voltorb reaches you, press Enter (or pick a suggestion) to send it.
    // Not for picture rounds (every holder gets a different Pokémon, so there is nothing to prepare) and never when out.
    const canType = !out && S.ph === 'playing' && !mine && !!S.pr && S.pr.kind !== 'identify';
    blocked = !(mine || canType) || pending;
    ui.input.classList.toggle('blocked', blocked);
    ui.box.classList.toggle('waiting', canType && !blocked);
    ui.input.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    ui.input.placeholder = pending ? 'Passing it on...' : canType ? 'Type ahead...' : mine ? (S.pr && S.pr.kind === 'identify' ? 'Who is this Pokémon?' : 'Name a Pokémon...')
      : out ? "You're out - watching" : S.ph === 'ready' ? 'Get ready...' : S.ph === 'boom' || S.ph === 'over' ? 'BOOM!' : `${holderName()} has the Voltorb...`;
    if (blocked) { ui.input.value = ''; ui.sug.innerHTML = ''; }
    else if (B().touch && document.activeElement !== ui.input && !ui.msg.textContent) ui.msg.textContent = 'Tap anywhere to open the keyboard';
  }

  // ---- answering ----
  function say(text, cls) {
    ui.msg.textContent = text; ui.msg.className = 'vp-msg ' + (cls || '');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { ui.msg.textContent = ''; ui.msg.className = 'vp-msg'; }, 1400);
  }
  function reject(text) {   // NO cooldown: shake, say why, keep focus, let them try again straight away
    say(text, 'bad');
    ui.box.classList.remove('shake'); void ui.box.offsetWidth; ui.box.classList.add('shake');
    if (typeof playWrongSound === 'function') { try { playWrongSound(); } catch (e) {} } else B().tone(200, 0.15, 'sawtooth', 0.1);
  }
  function submit(p) {
    if (blocked || !S || !p) return;
    const me = B().myId();
    // Typing ahead is allowed, but an answer only counts on your own turn. Pressing Enter / picking a row early is a no-op
    // (the text is kept), so the old "fires the moment you catch it" behaviour is gone.
    if (S.holder !== me) return;
    const sp = p.dexId || p.id;   // species level: Charizard and Mega Charizard X are the same answer
    ui.sug.innerHTML = ''; ui.input.value = '';
    if (S.said.indexOf(sp) >= 0) { reject('Already said'); return; }
    if (!mset.has(sp)) { reject(S.pr.no); return; }
    pending = true; seen.turn = S.turnId; refreshInput();   // lock until the host answers (blocked, not blurred)
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = false; refreshInput(); }, 1500);
    if (B().isHost()) hostAnswer(me, sp, S.turnId); else B().send({ type: 'VP_ANS', sp, t: S.turnId });
  }

  // ---- effects ----
  function doPass(last) {
    const P = B().players(), p = P[last.by];
    const nm = dispOf(last.sp);
    ui.said.textContent = (p ? p.name + ': ' : '') + nm;
    ui.said.classList.remove('go'); void ui.said.offsetWidth; ui.said.classList.add('go');
    pending = false; clearTimeout(pendingTimer);
    B().tone(520, 0.06, 'triangle', 0.08); B().tone(780, 0.09, 'triangle', 0.08, 0.05);
  }
  function celebrateOn() { return !window.Settings || window.Settings.get('celebrate'); }
  function doBoom(bm) {
    if (!bm) return;
    const sc = ui.screen;
    sc.classList.remove('boom'); void sc.offsetWidth; sc.classList.add('boom');
    setTimeout(() => sc.classList.remove('boom'), BOOM_MS - 250);
    // sound: a low thump + a crackle (noise burst through the shared audio context; silent when Sound is off)
    const b = B();
    b.tone(90, 0.5, 'sawtooth', 0.22); b.tone(55, 0.7, 'square', 0.14, 0.02); b.tone(1200, 0.12, 'square', 0.05);
    try {
      const ctx = b.ctx(), len = Math.floor(ctx.sampleRate * 0.45), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; g.gain.value = 0.25; src.connect(g); g.connect(ctx.destination); src.start();
    } catch (e) {}
    // burst: flash + shockwave + shards (shards only when Celebrations are on)
    ui.burst.innerHTML = '<i class="vp-flash"></i><i class="vp-wave"></i>';
    if (celebrateOn() && !reduced()) {
      for (let i = 0; i < 16; i++) {
        const s = document.createElement('i');
        s.className = 'vp-shard' + (i % 3 === 0 ? ' w' : '');
        s.style.setProperty('--a', (i * 360 / 16 + rand(-10, 10)).toFixed(0) + 'deg');
        s.style.setProperty('--d', rand(70, 140).toFixed(0) + 'px');
        s.style.setProperty('--r', rand(-300, 300).toFixed(0) + 'deg');
        ui.burst.appendChild(s);
      }
    }
    // the player who got hit
    const seat = ui.seatEls[bm.who];
    if (seat) {
      seat.classList.remove('hit'); void seat.offsetWidth; seat.classList.add('hit'); setTimeout(() => seat.classList.remove('hit'), 1200);
      const lostHeart = seat.querySelectorAll('.vp-hp i')[S.hp[bm.who]];   // the heart that was just lost cracks and falls
      if (lostHeart) lostHeart.classList.add('lost');
    }
    if (bm.who === B().myId() && navigator.vibrate) { try { navigator.vibrate(120); } catch (e) {} }
    say(bm.dead ? (B().players()[bm.who] ? B().players()[bm.who].name : 'Someone') + ' is out!' : 'BOOM!', 'boom');
    clearTimeout(msgTimer); msgTimer = setTimeout(() => { ui.msg.textContent = ''; ui.msg.className = 'vp-msg'; }, BOOM_MS - 200);
  }

  function setHeat(h) { heatTgt = clamp(h, 0, 1); }

  // one animation loop while the screen is up: swell, shake, redden (transform + CSS filter only, no layout changes)
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!S) return;
    const dt = Math.min(0.1, (ts - (lastTs || ts)) / 1000); lastTs = ts;
    heatCur += (heatTgt - heatCur) * Math.min(1, dt * (heatTgt < heatCur ? 3.5 : 7));
    const h = heatCur, red = reduced();
    const live = S.ph === 'playing';
    const scale = 1 + (red ? 0.05 : 0.34) * Math.pow(h, 1.4);
    const amp = red || !live ? 0 : Math.pow(h, 2.2) * (ui.screen.classList.contains('compact') ? 4 : 8) * (S.crit ? 1.7 : 1);
    const tx = amp ? (Math.random() - 0.5) * 2 * amp : 0, ty = amp ? (Math.random() - 0.5) * 2 * amp : 0;
    ui.volt.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
    if ((frameN++ & 3) === 0) {   // the colour / eyebrow / sweat variables change about 15 times a second, that is plenty
      ui.screen.style.setProperty('--h', h.toFixed(3));
      ui.screen.classList.toggle('hot', live && h > 0.72);
    }
    // identify round: reveal the art as the minimum turn runs out (the reveal itself is drawn by versus.js)
    if (S.pr && S.pr.kind === 'identify' && (frameN & 1) === 0) drawArt();
    // fuse tick: gets faster and a touch higher as it heats up
    if (live && h > 0.12 && ts >= nextTickAt) {
      nextTickAt = ts + 900 - 790 * h * h;
      B().tone(1000 + h * 500, 0.018, 'square', 0.022);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------
  // LOBBY MASCOT: the same pixel Voltorb, for the Versus menu hero. It is a COPY with its own ids/classes (vh-) so it never inherits the
  // in-game heat/shake styling, and without the crack / sweat / worried-mouth groups (those fade in with heat and have nothing to key off here).
  // Its pupils hop one whole pixel toward the pointer, same as the in-game ones follow the holder.
  function mascot(host) {
    if (!host || host.firstChild) return;
    host.innerHTML = VOLTORB_SVG.replace(/vp-/g, 'vh-').replace(/vpE/g, 'vhE')
      .replace(/<g class="vh-(?:crack|sweat|sweat b|mouth o)">.*?<\/g>/g, '').replace(' shape-rendering="crispEdges"', ' shape-rendering="crispEdges"');
    const pupils = Array.from(host.querySelectorAll('.vh-pupil'));
    let raf = 0, px = 0, py = 0;
    function aim() {
      raf = 0;
      const r = host.getBoundingClientRect();
      if (!r.width) return;   // menu is hidden
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const ox = Math.round(dx / d * Math.min(1, d / 60)), oy = Math.round(dy / d * Math.min(1, d / 60));
      pupils.forEach(p => p.setAttribute('transform', `translate(${ox} ${oy})`));
    }
    document.addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(aim); }, { passive: true });
  }
  mascot(document.getElementById('vs-hero-mascot'));

  window.Voltorb = {
    PACKS, preload, cleanPacks, defaultPacks,
    hostStart, onMessage, onPlayerLeft, resume, hide,
    active: () => shown,
    hasState: () => !!S,
    // Waiting players and eliminated spectators never type, so they must not be idle-kicked. Only the player holding it has to be active.
    idleExempt: pid => !!(shown && S && S.ph !== 'over' && pid !== S.holder)
  };
})();