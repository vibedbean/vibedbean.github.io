// Versus View Tab Switcher & Hash Router
document.addEventListener('DOMContentLoaded', () => {
  const vsBtn = document.getElementById('mode-versus-btn');
  const vsView = document.getElementById('versus-view');

  if (!vsBtn || !vsView) return;

  const tabToHash = {
    'mode-daily-btn': '#daily',
    'mode-unlimited-btn': '#unlimited',
    'mode-timed-btn': '#timed',
    'mode-reverse-btn': '#reverse',
    'mode-versus-btn': '#versus'
  };

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetHash = tabToHash[e.currentTarget.id];
      if (targetHash) {
        window.location.hash = targetHash;
      }
    });
  });

  function syncViewWithHash() {
    const hash = window.location.hash.toLowerCase() || '#daily';

    if (hash === '#versus' || hash.startsWith('#versus/')) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      vsBtn.classList.add('active');

      document.querySelectorAll('.main-content > div').forEach(div => {
        if (div !== vsView) div.classList.add('hidden');
      });
      vsView.classList.remove('hidden');
    } else {
      vsView.classList.add('hidden');

      let targetBtn;
      if (hash === '#reverse') {
        targetBtn = document.getElementById('mode-reverse-btn');
      } else if (hash === '#unlimited') {
        targetBtn = document.getElementById('mode-unlimited-btn');
      } else if (hash === '#timed') {
        targetBtn = document.getElementById('mode-timed-btn');
      } else {
        targetBtn = document.getElementById('mode-daily-btn');
      }

      if (!targetBtn) return;

      if (!targetBtn.classList.contains('active')) {
        targetBtn.click();
      } else {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        targetBtn.classList.add('active');
      }
    }
  }

  window.addEventListener('hashchange', syncViewWithHash);
  syncViewWithHash();
});

// ==========================================
// VERSUS MODE - 6-PLAYER REAL-TIME MULTIPLAYER (PeerJS)
// ==========================================
let vsPeer = null;
let vsIsHost = false;
let vsHostConn = null;
let vsClients = [];
let vsPlayers = {};
let vsRoomCode = null;

const VS_REVEAL_MODES = ['Classic Blur', 'Pixelation', 'Tile Reveal', 'Silhouette', 'Zoom Out', 'Scramble', 'Color Drain', 'Spotlight'];
const VS_REVEAL_DURATION = 25000;
const VS_MAX_POINTS = 100;
const VS_MIN_POINTS = 20;
const VS_WRONG_PENALTY_MS = 2000;
const VS_SHINY_CHANCE = 0.2;
const VS_MAX_PLAYERS = 6;
const VS_IDLE_WARN_MS = 60 * 1000;     // no taps / keys / mouse for this long -> "still there?" warning
const VS_IDLE_KICK_MS = 90 * 1000;     // ...and for this long -> removed from the room
const VS_ACTIVE_PING_MS = 5000;        // guests tell the host "still here" at most this often (only while they are really using the page)
const VS_RECONNECT_WAIT_MS = 5000;     // a newly promoted host waits this long for everybody to reconnect
const VS_MIGRATE_TRY_MS = 3000;        // one attempt at reaching the would-be host (4 attempts, then on to the next player in line)
const VS_NOTICE_KEY = 'pokeblur-vs-notice';
const VS_AUTO_ADVANCE_MS = 3000;
const VS_COUNTDOWN_MS = 3300;

let vsNumRounds = 5;
let vsRound = 0;
let vsCurrentRevealMode = 'Classic Blur';
let vsAnswer = null;
let vsIsShinyRound = false;
let vsRoundStartTime = 0;
let vsAnimFrame = null;
let vsRoundLocked = false;
let vsGuessLocked = false;
let vsPenaltyTimer = null;
let vsPixelBuffer = null;
let vsTileOrder = null;
let vsScrambleOffsets = null;
let vsScaledSprite = null;   // pre-scaled 280x280 copy of the current artwork
let vsSpotlightBuffer = null; // reusable off-screen canvas for the Spotlight mode mask

let vsAutoAdvanceTimer = null;
let vsCountdownInterval = null;
let vsRoundTimeoutTimer = null; // host-only: ends a round nobody solved (timer-driven, see applyStartRound)
let vsSpinCancel = null;        // cancels a wheel that is still spinning/finishing on this device

// ---- Generation vote state ----
let vsSelectedGenerations = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]); // gens actually used to pick this match's Pokémon
let vsGenVotes = {};        // peerId -> { gens: number[], isRandom: bool }
let vsMyVoteGens = new Set();
let vsMyVoteRandom = false;
let vsVoteTimer = null;
let vsVoteResultTimer = null;
let vsVoteCountdownInterval = null;
const VS_VOTE_DURATION_S = 15;
const VS_VOTE_FAST_RATE = 3;    // once everybody has picked, the vote clock runs this many times faster (and goes back to 1 if somebody undoes their pick)
let vsVoteOpen = false;          // a vote is currently running
let vsVoteRemain = 0, vsVoteRate = 1, vsVoteClockAt = 0;   // host-side vote clock: seconds left when last updated, speed, and when that was
const VS_VOTE_MAX_GENS = 3;

// Audio
let vsAudioCtx = null;
function getVsAudioCtx() {
  if (window.Settings && !window.Settings.get('sound')) return window.Settings.silentCtx();   // sound off in Settings
  if (!vsAudioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    vsAudioCtx = new AC();
  }
  if (vsAudioCtx.state === 'suspended') vsAudioCtx.resume();
  return vsAudioCtx;
}
// Escapes user-supplied text before it's interpolated into innerHTML.
// Player names come from other people's devices and get broadcast to
// everyone in the room - without this, a player could set their name to
// something like <img src=x onerror=...> and run script in every other
// player's browser the moment the lobby/leaderboard/standings render.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function playVsTone(freq, duration, type = 'sine', volume = 0.12, delay = 0) {
  try {
    const ctx = getVsAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch (e) { /* audio not available */ }
}

// Short "go" blip when a round's guessing window actually opens.
function playVsRoundStartSound() {
  playVsTone(660, 0.09, 'sine', 0.09, 0);
  playVsTone(880, 0.12, 'sine', 0.11, 0.07);
}

// Plays for everyone who did NOT win the round, so it's audible even to
// people not currently looking at the screen that the round has ended.
function playVsRoundOverSound() {
  playVsTone(392, 0.16, 'triangle', 0.09, 0);
  playVsTone(330, 0.20, 'triangle', 0.08, 0.10);
}

// Time expired with nobody guessing correctly.
function playVsTimesUpSound() {
  playVsTone(220, 0.22, 'sawtooth', 0.09, 0);
  playVsTone(185, 0.28, 'sawtooth', 0.09, 0.12);
}

// Match-over cue. A bigger fanfare for the winner, a softer resolving
// chime for everyone else (or on a tie).
function playVsGameOverSound(isWinner) {
  if (isWinner) {
    playVsTone(523.25, 0.16, 'sine', 0.14, 0);
    playVsTone(659.25, 0.16, 'sine', 0.14, 0.12);
    playVsTone(783.99, 0.16, 'sine', 0.14, 0.24);
    playVsTone(1046.5, 0.35, 'sine', 0.17, 0.36);
  } else {
    playVsTone(392, 0.18, 'sine', 0.11, 0);
    playVsTone(329.63, 0.30, 'sine', 0.11, 0.14);
  }
}

// ==========================================
// VERSUS EXTRAS: names, avatars, short codes, Firebase public-lobby list
// (pure helpers live up here so they can be unit-tested; UI wiring is inside the main block below)
// ==========================================

// >>> PASTE YOUR FIREBASE CONFIG HERE (Project settings > Your apps > Web app > "Config"). Leave databaseURL empty to turn public lobbies off.
const VS_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA84XCKdHm-YDJDmNpq26KDKCwjlPf4KTU',
  authDomain: 'pokeblur.firebaseapp.com',
  databaseURL: 'https://pokeblur-default-rtdb.asia-southeast1.firebasedatabase.app',   // e.g. https://pokeblur-xxxxx-default-rtdb.firebaseio.com
  projectId: 'pokeblur',
  appId: '1:991623174583:web:5ce0897e1b66eda2ccb032'
};

const VS_PEER_PREFIX = 'pokeblur-vs-';          // keeps our 4-digit codes away from other PeerJS apps
const VS_NAME_KEY = 'pokeblur-vs-name';
const VS_AVATAR_KEY = 'pokeblur-vs-avatar';
const VS_NAME_MAX = 12;
const VS_LOBBY_STALE_MS = 3 * 60 * 60 * 1000;   // ignore lobby rows older than 3h (crashed hosts)
const VS_LOBBY_LIVE_MS = 90 * 1000;     // a listed room must have "pulsed" this recently, otherwise it's a ghost (host crashed / froze / went to the background)
const VS_PULSE_MS = 20 * 1000;          // how often a host's room row pulses
const VS_LIST_IDLE_MS = 90 * 1000;      // looking at the lobby list with no taps / keys / mouse for this long -> list pauses and frees its connection slot
const VS_LIST_HIDDEN_MS = 30 * 1000;    // ...or with the tab in the background for this long
const VS_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
// Avatar blur uses the same stages + tier names as the Pokédex (Sharp = stage 1-2, Good = 3-4, Clear = 5-6).
// Slider position b: 0 = Stage 6 (no blur) ... 5 = Stage 1 (blurriest).
const VS_BLUR_MAX = 5;
const VS_BLUR_LABELS = ['Stage 6 \u00b7 Clear', 'Stage 5 \u00b7 Clear', 'Stage 4 \u00b7 Good', 'Stage 3 \u00b7 Good', 'Stage 2 \u00b7 Sharp', 'Stage 1 \u00b7 Sharp'];
const VS_BLUR_PX = [0, 0.3, 0.9, 1.8, 2.7, 4.6];   // px of blur on a 96px thumbnail, same numbers the Pokédex grid uses

// ---- 4-digit codes ----
function vsRandomCode() { return String(Math.floor(Math.random() * 10000)).padStart(4, '0'); }
function vsCleanCode(v) { return String(v || '').replace(/\D/g, '').slice(0, 4); }

// ---- names ----
const VS_BAD_SUBSTR = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigg', 'fagg', 'retard', 'rapist', 'nazi', 'hitler', 'porn', 'penis', 'vagina', 'twat', 'wank', 'bastard', 'dildo', 'molest', 'pedo', 'jihad', 'blowjob', 'handjob', 'asshole', 'cumshot', 'tranny', 'kys', 'killyourself'];
const VS_BAD_EXACT = ['ass', 'cum', 'anal', 'tit', 'tits', 'fag', 'kkk', 'sex', 'rape', 'isis', 'piss', 'boob', 'boobs', 'cnt', 'dck', 'fuk', 'sht', 'btch'];
function vsNormForFilter(s) {
  const leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '+': 't' };
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[01345788@$!+]/g, c => leet[c] || c);
}
function vsIsBadName(name) {
  const n = vsNormForFilter(name);
  const tokens = n.split(/[^a-z]+/).filter(Boolean);
  if (tokens.some(t => VS_BAD_EXACT.includes(t))) return true;
  const compact = n.replace(/[^a-z]/g, '');
  const collapsed = compact.replace(/(.)\1+/g, '$1');
  const badCollapsed = VS_BAD_SUBSTR.map(w => w.replace(/(.)\1+/g, '$1'));
  return VS_BAD_SUBSTR.some(w => compact.includes(w)) || badCollapsed.some(w => collapsed.includes(w)) || VS_BAD_EXACT.includes(compact) || VS_BAD_EXACT.includes(collapsed);
}
function vsCleanName(raw) {
  return String(raw == null ? '' : raw).normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, VS_NAME_MAX).trim();
}
function vsValidateName(raw) {
  const name = vsCleanName(raw);
  if (!name) return { ok: false, reason: 'Type a name first.' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, reason: 'Use at least one letter or number.' };
  if (vsIsBadName(name)) return { ok: false, reason: "Let's keep it friendly - pick a different name." };
  return { ok: true, name };
}
// For names that arrive over the network: never trust, fall back instead of rejecting.
function vsSanitizeIncomingName(raw, fallback) {
  const r = vsValidateName(raw);
  return r.ok ? r.name : fallback;
}
function vsLoadName() {
  try { const r = vsValidateName(localStorage.getItem(VS_NAME_KEY)); return r.ok ? r.name : ''; } catch (e) { return ''; }
}
function vsSaveName(n) { try { localStorage.setItem(VS_NAME_KEY, n); } catch (e) {} }

// ---- avatars: { id: dex number 1-1025, s: 0/1 shiny, b: 0-5 blur stage, f: form, d: border } ----
// f = 0 for the base form, a PokeAPI sprite id for other forms (Mega, regional...), or 'f' for the female HOME sprite.
// d = the Pokédex border ring: '' none, 'u' Unlimited (green), 't' Timed (blue), 'd' Daily (rainbow).
// f and d are never picked by hand: they come from the Pokédex card (see vsResolveAvatar).
function vsCleanAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  const id = parseInt(a.id, 10), b = parseInt(a.b, 10);
  if (!(id >= 1 && id <= 1025)) return null;
  let f = 0;
  if (a.f === 'f') f = 'f';
  else { const n = parseInt(a.f, 10); if (n >= 1 && n <= 99999 && n !== id) f = n; }
  return { id, s: a.s ? 1 : 0, b: b >= 0 ? Math.min(b, VS_BLUR_MAX) : 0, f, d: (a.d === 'u' || a.d === 't' || a.d === 'd') ? a.d : '' };
}
function vsLoadAvatar() {
  try { return vsCleanAvatar(JSON.parse(localStorage.getItem(VS_AVATAR_KEY))); } catch (e) { return null; }
}
function vsSaveAvatar(a) {
  try { if (a) localStorage.setItem(VS_AVATAR_KEY, JSON.stringify(a)); else localStorage.removeItem(VS_AVATAR_KEY); } catch (e) {}
}
function vsAvatarStr(a) { a = vsCleanAvatar(a); return a ? `${a.id}.${a.s}.${a.b}${a.f ? '.' + a.f : ''}${a.d ? '.' + a.d : ''}` : ''; }
// The public lobby row keeps the original id.shiny.blur[.form] format: the lobby database only accepts that shape, and a ring isn't needed in the list
function vsAvatarLobbyStr(a) { a = vsCleanAvatar(a); return a ? vsAvatarStr({ id: a.id, s: a.s, b: a.b, f: a.f, d: '' }) : ''; }
function vsAvatarFromStr(s) {
  const m = /^(\d{1,4})\.([01])\.([0-6])(?:\.(\d{1,5}|f))?(?:\.([utd]))?$/.exec(String(s || ''));
  return m ? vsCleanAvatar({ id: +m[1], s: +m[2], b: +m[3], f: m[4] === 'f' ? 'f' : (m[4] ? +m[4] : 0), d: m[5] || '' }) : null;
}
function vsSpriteUrl(id, shiny, f) {
  if (f === 'f') return `${VS_SPRITE_BASE}other/home/${shiny ? 'shiny/' : ''}female/${id}.png`;
  return `${VS_SPRITE_BASE}${shiny ? 'shiny/' : ''}${f || id}.png`;
}
// Form sprite missing -> try the plain species sprite -> Poké Ball
function vsImgErr(img) {
  const fb = img.dataset.fb;
  if (fb) { img.removeAttribute('data-fb'); img.src = fb; return; }
  const ball = document.createElement('span'); ball.className = 'vs-ball'; img.replaceWith(ball);
}
function vsAvatarInner(a) {
  a = vsCleanAvatar(a);
  if (!a) return '<span class="vs-ball"></span>';
  const fb = a.f ? ` data-fb="${vsSpriteUrl(a.id, a.s, 0)}"` : '';
  return `<img src="${vsSpriteUrl(a.id, a.s, a.f)}" alt="" decoding="async" style="--bl:${VS_BLUR_PX[a.b]}"${fb} onerror="vsImgErr(this)">` +
    (a.d ? `<i class="vs-ring vs-ring-${a.d}"></i>` : '');
}
function vsAvatarHTML(a, size) { return `<span class="vs-avatar vs-avatar-${size || 'md'}">${vsAvatarInner(a)}</span>`; }

// ---- what the Pokédex says about a species (forms caught, form picked, border) ----
let vsFormMapCache = null, vsFormMapSize = -1;
function vsFormMap() {
  try {
    if (typeof allPokemonList !== 'undefined' && Array.isArray(allPokemonList)) {
      if (!vsFormMapCache || vsFormMapSize !== allPokemonList.length) {
        vsFormMapCache = new Map();
        allPokemonList.forEach(p => vsFormMapCache.set(p.rawName, p));
        vsFormMapSize = allPokemonList.length;
      }
      return vsFormMapCache;
    }
  } catch (e) {}
  return new Map();
}
function vsFormSpriteOf(p, id) { if (p.synthetic) return 'f'; const n = p.spriteId || p.id; return n === id ? 0 : n; }
// Same rule as the Pokédex card: the border you chose if you own it, otherwise the rarest one you own
function vsBorderOf(e, L) {
  const r = e && e[L];
  if (!r || !(r[1] > 0)) return '';
  const MODES = ['unlimited', 'timed', 'daily'], BIT = { unlimited: 0, timed: 1, daily: 3 };
  const mask = r[5] | 0, owned = MODES.filter(m => mask & (1 << BIT[m]));
  if (!owned.length) return '';
  const pk = (r[6] | 0) - 1;
  return (pk >= 0 && owned.indexOf(MODES[pk]) !== -1 ? MODES[pk] : owned[owned.length - 1]).charAt(0);
}
// One species out of the Pokédex save: { id, n, s, forms:{n:[{f,name}],s:[...]}, pick:{n,s}, bd:{n,s}, ts, lc } or null if not caught
function vsEntryFromRaw(e, id, fm) {
  const n = !!(e && e.n && e.n[1] > 0), s = !!(e && e.s && e.s[1] > 0);
  if (!(id >= 1 && id <= 1025) || !(n || s)) return null;
  const forms = { n: [], s: [] }, pick = { n: null, s: null };
  ['n', 's'].forEach(L => {
    ((e.forms && e.forms[L]) || []).forEach(rawName => {
      const p = fm.get(rawName);
      if (!p || p.excluded) return;
      const f = vsFormSpriteOf(p, id);
      if (!forms[L].some(x => x.f === f)) forms[L].push({ f, name: p.displayName || rawName });
    });
    const pr = e.pick && fm.get(e.pick[L]);
    if (pr) pick[L] = vsFormSpriteOf(pr, id);
  });
  const names = [vsDexName(id)].concat(forms.n.map(x => x.name), forms.s.map(x => x.name));
  return { id, n, s, forms, pick, bd: { n: vsBorderOf(e, 'n'), s: vsBorderOf(e, 's') },
    ts: Math.max((e.n && e.n[3]) || 0, (e.s && e.s[3]) || 0), lc: names.join(' ').toLowerCase() };
}
// The form a layer's card shows: the one picked in the Pokédex, else the base form, else the first one caught
function vsDefaultForm(c, shiny) {
  const list = shiny ? c.forms.s : c.forms.n;
  if (!list.length) return 0;
  const pk = c.pick[shiny ? 's' : 'n'];
  if (pk !== null && list.some(x => x.f === pk)) return pk;
  return list.some(x => x.f === 0) ? 0 : list[0].f;
}
function vsCaughtList() {
  const out = [];
  try {
    const raw = JSON.parse(localStorage.getItem('pokeblur-pokedex')), fm = vsFormMap();
    Object.keys((raw && raw.e) || {}).forEach(k => {
      const c = vsEntryFromRaw(raw.e[k], parseInt(k, 10), fm);
      if (c) out.push(c);
    });
  } catch (e) {}
  return out.sort((a, b) => a.id - b.id);
}
function vsDexLook(id, shiny) {
  try {
    const raw = JSON.parse(localStorage.getItem('pokeblur-pokedex'));
    const c = raw && raw.e && vsEntryFromRaw(raw.e[id], id, vsFormMap());
    if (c) return { f: vsDefaultForm(c, !!shiny), d: c.bd[shiny ? 's' : 'n'] };
  } catch (e) {}
  return { f: 0, d: '' };
}
// Take the player's chosen Pokémon + shiny + blur and fill in the form and border from the Pokédex as it is right now
function vsResolveAvatar(a) {
  a = vsCleanAvatar(a);
  if (!a) return null;
  const look = vsDexLook(a.id, !!a.s);
  return vsCleanAvatar({ id: a.id, s: a.s, b: a.b, f: look.f, d: look.d });
}

// ---- cries (PokeAPI cries repo, same site the sprites come from) ----
const VS_CRY_BASE = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/';
const VS_SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let vsCryAudio = null, vsCryUnlocked = false, vsCryToken = 0;
function vsCryUrl(a, species) {
  a = vsCleanAvatar(a);
  if (!a) return '';
  return VS_CRY_BASE + ((!species && a.f && a.f !== 'f') ? a.f : a.id) + '.ogg';
}
let vsLastCryAt = 0;
function vsPlayCry(a) {
  try {
    if (window.Settings && !window.Settings.get('sound')) return;
    if (document.hidden) return;                       // don't blast cries into a backgrounded tab
    const nowMs = Date.now();
    if (nowMs - vsLastCryAt < 2500) return;            // never stack or repeat cries back-to-back
    vsLastCryAt = nowMs;
    const url = vsCryUrl(a, false);
    if (!url) return;
    if (!vsCryAudio) vsCryAudio = new Audio();
    const au = vsCryAudio, token = ++vsCryToken;
    au.muted = false; au.volume = 0.5;
    au.loop = false;
    au.onerror = () => {   // form cry missing -> plain species cry (tried once only, so a bad file can't loop)
      au.onerror = null;
      const fb = vsCryUrl(a, true);
      if (token === vsCryToken && fb && au.src !== fb) { au.src = fb; const p2 = au.play(); if (p2 && p2.catch) p2.catch(() => {}); }
    };
    au.src = url;
    const p = au.play();
    if (p && p.catch) p.catch(() => {});   // blocked by the browser: stay silent
  } catch (e) {}
}
// Phones only let a page play sound after a tap, and only on an audio element that was started by a tap.
// So the first tap anywhere starts a silent clip on the shared cry element; later cries can reuse it.
function vsUnlockCry() {
  if (vsCryUnlocked) return;
  vsCryUnlocked = true;
  try {
    if (!vsCryAudio) vsCryAudio = new Audio();
    const au = vsCryAudio;
    au.muted = true; au.src = VS_SILENT_WAV;
    const p = au.play();
    if (p && p.then) p.then(() => { au.pause(); au.muted = false; }).catch(() => { au.muted = false; vsCryUnlocked = false; });
  } catch (e) { vsCryUnlocked = false; }
}
document.addEventListener('click', vsUnlockCry, true);
document.addEventListener('touchend', vsUnlockCry, true);

function vsDexName(id) {
  try { const p = (typeof allPokemonList !== 'undefined') && allPokemonList[id - 1]; if (p && p.displayName) return p.displayName; } catch (e) {}
  return '#' + id;
}

// ---- Firebase public lobby list ----
let vsDb = null;
let vsLobbyRef = null;
function vsFirebase() {
  if (vsDb) return vsDb;
  try {
    const c = window.PB_FIREBASE_CONFIG || VS_FIREBASE_CONFIG;   // window override is only used by the tests
    if (!window.firebase || !c.databaseURL || !c.apiKey) return null;
    if (!firebase.apps.length) firebase.initializeApp(c);
    vsDb = firebase.database();
  } catch (e) { console.warn('Firebase init failed:', e); vsDb = null; }
  return vsDb;
}
// Server clock (so a player's wrong PC clock can't hide every room), and the connection helpers.
// The free Firebase plan allows ~100 connections at once, so we only stay connected while it's needed.
let vsServerOffset = 0, vsOffsetWatching = false;
function vsServerNow() { return Date.now() + vsServerOffset; }
function vsGoOnline() { try { const db = vsFirebase(); if (db) db.goOnline(); } catch (e) {} }
function vsPulseLobby() { if (!vsLobbyRef) return; try { vsLobbyRef.update({ ts: firebase.database.ServerValue.TIMESTAMP }); } catch (e) {} }
function vsPublishLobby(info) {
  const db = vsFirebase();
  if (!db) return;
  try { db.goOnline(); } catch (e) {}
  try {
    const row = { host: info.host, av: info.av || '', players: info.players, max: VS_MAX_PLAYERS, rounds: info.rounds, status: info.status };
    if (!vsLobbyRef || vsLobbyRef.key !== info.code) {
      vsLobbyRef = db.ref('lobbies/' + info.code);
      vsLobbyRef.onDisconnect().remove();                // dead rooms remove themselves
      const w = vsLobbyRef.set(Object.assign({ ts: firebase.database.ServerValue.TIMESTAMP }, row));
      if (w && w.then) {   // no answer in 8s = the lobby server is full or unreachable; the room itself still works via its code
        const slow = setTimeout(() => vsToast("Your room may not show in the public list (lobby server busy). Friends can still join with your room code."), 8000);
        w.then(() => clearTimeout(slow), () => clearTimeout(slow));
      }
      if (w && w.catch) w.catch(err => { console.warn('publish lobby rejected', err); vsToast("Your room isn't showing in the public list (lobby database said no" + (err && err.code ? ': ' + err.code : '') + ').'); });
    } else {
      vsLobbyRef.update(row);
    }
  } catch (e) { console.warn('publish lobby failed', e); }
}
function vsUnpublishLobby() {
  if (!vsLobbyRef) return;
  try { vsLobbyRef.remove(); vsLobbyRef.onDisconnect().cancel(); } catch (e) {}
  vsLobbyRef = null;
}
// Raw firebase value -> clean array of rows we are willing to show
function vsParseLobbies(val, now, maxAge) {
  now = now || Date.now();
  return Object.keys(val || {}).map(code => {
    const l = val[code];
    if (!/^\d{4}$/.test(code) || !l || typeof l !== 'object') return null;
    const players = Math.max(0, Math.min(VS_MAX_PLAYERS, parseInt(l.players, 10) || 0));
    const ts = typeof l.ts === 'number' ? l.ts : 0;
    if (players < 1 || (ts && now - ts > (maxAge || VS_LOBBY_STALE_MS))) return null;
    return {
      code, ts, players, max: Math.max(4, Math.min(VS_MAX_PLAYERS, parseInt(l.max, 10) || 4)),   // rows from older 4-player rooms keep their own size
      host: vsSanitizeIncomingName(l.host, 'Player'),
      av: vsAvatarFromStr(l.av),
      rounds: Math.max(1, Math.min(15, parseInt(l.rounds, 10) || 5)),
      status: l.status === 'playing' ? 'playing' : 'waiting'
    };
  }).filter(Boolean);
}
function vsLobbyState(l) { return l.status === 'playing' ? 'playing' : (l.players >= l.max ? 'full' : 'waiting'); }
// Quick Play order: fullest waiting room first, ties go to the oldest room
function vsQuickCandidates(val, now, maxAge) {
  return vsParseLobbies(val, now, maxAge).filter(l => vsLobbyState(l) === 'waiting')
    .sort((a, b) => b.players - a.players || a.ts - b.ts).map(l => l.code);
}

function vsToast(msg) {
  let t = document.getElementById('vs-toast');
  if (!t) { t = document.createElement('div'); t.id = 'vs-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3200);
}
// A message to show after the page reloads (e.g. "you were removed for being inactive")
function vsSetNotice(msg) { try { sessionStorage.setItem(VS_NOTICE_KEY, msg); } catch (e) {} }
function vsTakeNotice() { try { const m = sessionStorage.getItem(VS_NOTICE_KEY); if (m) sessionStorage.removeItem(VS_NOTICE_KEY); return m || ''; } catch (e) { return ''; } }

document.addEventListener('DOMContentLoaded', () => {
  const vsLobbyScreen = document.getElementById('vs-lobby-screen');
  const vsVoteScreen = document.getElementById('vs-vote-screen');
  const vsVoteTimerEl = document.getElementById('vs-vote-timer');
  const vsVoteStatus = document.getElementById('vs-vote-status');
  const vsVoteResults = document.getElementById('vs-vote-results');
  const vsVotePicksLeft = document.getElementById('vs-vote-picks-left');
  const vsVoteRandomBtn = document.getElementById('vs-vote-random-btn');
  const vsGameplayScreen = document.getElementById('vs-gameplay-screen');
  const vsCreateRoomBtn = document.getElementById('vs-create-room-btn');
  const vsJoinRoomBtn = document.getElementById('vs-join-room-btn');
  const vsRoomIdInput = document.getElementById('vs-room-id-input');
  const vsLobbyStatus = document.getElementById('vs-lobby-status');
  const vsRoomCodeDisplay = document.getElementById('vs-room-code-display');
  const vsCopyCodeBtn = document.getElementById('vs-copy-code-btn');
  const $id = (x) => document.getElementById(x);
  const vsMenu = $id('vs-menu');
  const vsNameInput = $id('vs-name-input');
  const vsNameSave = $id('vs-name-save');
  const vsNameMsg = $id('vs-name-msg');
  const vsProfileCard = $id('vs-profile');
  const vsMyAvatarEl = $id('vs-my-avatar');
  const vsAvatarBtn = $id('vs-avatar-btn');
  const vsQuickPlayBtn = $id('vs-quick-play-btn');
  const vsVisPrivate = $id('vs-vis-private');
  const vsVisPublic = $id('vs-vis-public');
  const vsVisHint = $id('vs-vis-hint');
  const vsPublicList = $id('vs-public-list');
  const vsPublicCount = $id('vs-public-count');
  const vsRoomVisBadge = $id('vs-room-vis-badge');
  const vsCountdown = $id('vs-countdown');
  const vsCountNum = $id('vs-count-num');
  const vsCountSub = $id('vs-count-sub');
  const vsCountPlayers = $id('vs-count-players');
  const vsPlayerSlots = document.getElementById('vs-player-slots');
  const vsRoundsSelector = document.getElementById('vs-rounds-selector');
  const vsRoundsValue = document.getElementById('vs-rounds-value');
  const vsRoundsMinus = document.getElementById('vs-rounds-minus');
  const vsRoundsPlus = document.getElementById('vs-rounds-plus');
  const vsStartGameBtn = document.getElementById('vs-start-game-btn');
  const vsLobbyHint = document.getElementById('vs-lobby-hint');
  const vsWaitingMsg = document.getElementById('vs-waiting-msg');

  const vsWheelOverlay = document.getElementById('vs-wheel-overlay');
  const wheelCanvas = document.getElementById('wheel-canvas');
  const wheelResultText = document.getElementById('wheel-result-text');
  const vsShinyBanner = document.getElementById('vs-shiny-banner');

  const vsModeTitle = document.getElementById('vs-mode-title');
  const vsRoundLabel = document.getElementById('vs-round-label');
  const vsRevealCanvas = document.getElementById('vs-reveal-canvas');
  const vsImageOverlay = document.getElementById('vs-image-overlay');
  const vsPokemonImage = document.getElementById('vs-pokemon-image');
  const vsPlayerBars = document.getElementById('vs-player-bars');

  const vsGuessInput = document.getElementById('vs-guess-input');
  const vsSearchWrapper = document.getElementById('vs-search-wrapper');
  const vsSuggestions = document.getElementById('vs-suggestions');
  const vsResultMessage = document.getElementById('vs-result-message');
  const vsRoundOverPanel = document.getElementById('vs-round-over-panel');
  const vsRoundWinnerText = document.getElementById('vs-round-winner-text');
  const vsRoundAnswerText = document.getElementById('vs-round-answer-text');
  const vsWaitingNextMsg = document.getElementById('vs-waiting-next-msg');

  const vsGameOverPanel = document.getElementById('vs-game-over-panel');
  const vsWinnerText = document.getElementById('vs-winner-text');
  const vsFinalStandings = document.getElementById('vs-final-standings');
  const vsPlayAgainBtn = document.getElementById('vs-play-again-btn');
  const vsLeaveRoomBtn = document.getElementById('vs-leave-room-btn');
  const vsLobbyLeaveBtn = document.getElementById('vs-lobby-leave-btn');

  if (!vsCreateRoomBtn) return;
  { const pendingNotice = vsTakeNotice(); if (pendingNotice) setTimeout(() => vsToast(pendingNotice), 400); }

  // Safety net: remove the old Next Round button if it's still in the HTML.
  const staleNextBtn = document.getElementById('vs-next-round-btn');
  if (staleNextBtn && staleNextBtn.parentNode) {
    staleNextBtn.parentNode.removeChild(staleNextBtn);
  }

  (function prefillFromHash() {
    const m = window.location.hash.match(/^#versus\/(.+)$/i);
    if (m && m[1]) vsRoomIdInput.value = vsCleanCode(decodeURIComponent(m[1]));
  })();
  vsRoomIdInput.addEventListener('input', () => { vsRoomIdInput.value = vsCleanCode(vsRoomIdInput.value); });

  vsRoundsMinus.addEventListener('click', () => {
    vsNumRounds = Math.max(1, vsNumRounds - 1);
    vsRoundsValue.textContent = vsNumRounds;
    roundsChanged();
  });
  vsRoundsPlus.addEventListener('click', () => {
    vsNumRounds = Math.min(15, vsNumRounds + 1);
    vsRoundsValue.textContent = vsNumRounds;
    roundsChanged();
  });
  function roundsChanged() {
    if (!vsIsHost) return;
    broadcastVs(vsLobbyPayload());
    vsSyncPublic();
  }

  let vsConnecting = false;
  let vsIsPublic = false;       // the room you are in right now
  let vsLeaving = false;        // this page is on its way out (left, was kicked, host left, tab closing)
  let vsWantPublic = false;     // what the Private/Public toggle on the menu says (joining a room must never change this)
  let vsInRoom = false;
  let vsMatchActive = false;      // host: a match has started, so new joiners are turned away
  let vsQuickMode = false;
  let vsQuickQueue = [];
  let vsJoinTimer = null;
  let vsStartTimer = null;
  let vsCountTimer = null;
  let vsMyName = vsLoadName();
  let vsMyAvatar = vsLoadAvatar();
  let vsPhase = 'lobby';          // lobby | vote | voteresult | playing | over - kept in step on every device so a new host knows where to pick up
  let vsMigrating = false;        // guest: the host is gone and we are working out who takes over
  let vsMigTimer = null, vsMigSkip = null, vsMigDrop = null;
  let vsReconnectTimer = null;    // new host: waiting for everyone to reconnect
  let vsAwaiting = null;          // new host: ids we still expect to see again
  let vsRoomPeer = null;          // new host: second PeerJS peer that re-claims the 4-digit room code
  const vsLastSeen = {};          // host: peerId -> last time we heard from them
  let vsLastInput = Date.now(), vsInputSinceSend = true, vsIdleWarned = false;
  const vsPodium = document.getElementById('vs-podium');

  function vsLobbyPayload() {
    return { type: 'LOBBY_UPDATE', players: vsPlayers, numRounds: vsNumRounds, isPublic: vsIsPublic };
  }

  // ---------- profile card: name gate + avatar ----------
  // Ring + form come from the Pokédex card, so re-read them whenever it might have changed
  function syncAvatarWithDex() {
    if (!vsMyAvatar) return;
    const next = vsResolveAvatar(vsMyAvatar);
    if (!next || vsAvatarStr(next) === vsAvatarStr(vsMyAvatar)) return;
    vsMyAvatar = next;
    vsSaveAvatar(vsMyAvatar);
    vsMyAvatarEl.innerHTML = vsAvatarInner(vsMyAvatar);
    if (vsInRoom && !vsMatchActive) pushMyProfile();
  }
  window.addEventListener('hashchange', syncAvatarWithDex);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAvatarWithDex(); });
  window.addEventListener('focus', syncAvatarWithDex);

  function paintProfile() {
    if (vsMyAvatar) { const r = vsResolveAvatar(vsMyAvatar); if (r) vsMyAvatar = r; }
    vsNameInput.value = vsMyName;
    vsMyAvatarEl.innerHTML = vsAvatarInner(vsMyAvatar);
    paintGate();
  }
  function paintGate() {
    document.querySelectorAll('.vs-gated').forEach(b => {
      b.classList.toggle('locked', !vsMyName);
      b.setAttribute('aria-disabled', vsMyName ? 'false' : 'true');
    });
    vsProfileCard.classList.toggle('needs-name', !vsMyName);
    if (!vsMyName) { vsNameMsg.className = 'vs-name-msg'; vsNameMsg.textContent = 'You need a name before you can play.'; }
    else if (vsNameMsg.className === 'vs-name-msg') vsNameMsg.textContent = '';
  }
  function nameMsg(text, ok) { vsNameMsg.textContent = text; vsNameMsg.className = 'vs-name-msg ' + (ok ? 'ok' : 'err'); }
  function shakeProfile() {
    vsProfileCard.classList.remove('shake'); void vsProfileCard.offsetWidth; vsProfileCard.classList.add('shake');
  }
  function commitName() {
    const r = vsValidateName(vsNameInput.value);
    if (!r.ok) { nameMsg(r.reason, false); shakeProfile(); return false; }
    vsMyName = r.name;
    vsSaveName(vsMyName);
    vsNameInput.value = vsMyName;
    nameMsg('Saved as ' + vsMyName, true);
    paintGate();
    pushMyProfile();
    return true;
  }
  // Called before create / join / quick play. Saves a typed-but-unsaved name for the player if it is valid.
  function requireName() {
    if (vsMyName && vsNameInput.value.trim() === vsMyName) return true;
    if (vsNameInput.value.trim() && commitName()) return true;
    nameMsg(vsMyName ? 'Save your new name first.' : 'Pick a name first!', false);
    shakeProfile();
    try { vsNameInput.focus(); } catch (e) {}
    return false;
  }
  vsNameSave.addEventListener('click', commitName);
  vsNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); vsNameInput.blur(); } });
  vsNameInput.addEventListener('input', () => {
    if (vsNameInput.value.length > VS_NAME_MAX) vsNameInput.value = vsNameInput.value.slice(0, VS_NAME_MAX);
  });

  // Tell the room about a changed name/avatar
  function pushMyProfile() {
    if (!vsInRoom || !vsPeer || !vsPlayers[vsPeer.id]) return;
    vsPlayers[vsPeer.id].name = vsMyName;
    vsPlayers[vsPeer.id].av = vsMyAvatar;
    renderVsLobby();
    if (vsIsHost) { broadcastVs(vsLobbyPayload()); vsSyncPublic(); }
    else if (vsHostConn && vsHostConn.open) vsHostConn.send({ type: 'PROFILE_UPDATE', peerId: vsPeer.id, name: vsMyName, av: vsMyAvatar });
  }

  // ---------- avatar picker ----------
  // You pick the Pokémon, shiny or not, and how blurry. The form and the ring come from that Pokémon's Pokédex card.
  // Built to cope with a full Pokédex: the grid draws 60 at a time as you scroll, search is debounced,
  // picking a Pokémon only redraws the two cells that changed, and filters/sort help you find things fast.
  const AV_CHUNK = 60;
  const avModal = $id('vs-avatar-modal');
  const avGrid = $id('vs-av-grid');
  const avSearch = $id('vs-av-search');
  const avBlur = $id('vs-av-blur');
  const avBlurLabel = $id('vs-av-blur-label');
  const avShiny = $id('vs-av-shiny');
  const avPreview = $id('vs-av-preview');
  const avEmpty = $id('vs-av-empty');
  const avCountEl = $id('vs-av-count');
  const avFilterBar = $id('vs-av-filters');
  let avPick = null, avCaught = [], avById = new Map(), avView = [], avDrawn = 0, avFilter = 'all', avNewest = false, avSearchT = 0;

  const avNForms = c => Math.max(c.forms.n.length, c.forms.s.length);
  function avDraft() { return avPick ? { id: avPick.id, s: avPick.s ? 1 : 0, b: +avBlur.value, f: 0, d: '' } : null; }
  // Slider moved: only the blur changes, so just update the existing preview image
  function avPaintBlur() {
    const b = +avBlur.value;
    avBlurLabel.textContent = VS_BLUR_LABELS[b] || VS_BLUR_LABELS[0];
    avBlur.style.setProperty('--p', (b / VS_BLUR_MAX * 100) + '%');
    const im = avPreview.firstElementChild;
    if (im && im.tagName === 'IMG') im.style.setProperty('--bl', VS_BLUR_PX[b] || 0);
    else avPreview.innerHTML = vsAvatarInner(vsResolveAvatar(avDraft()));
  }
  // Pick (species / shiny) changed
  function avPaintPick() {
    avPreview.innerHTML = vsAvatarInner(vsResolveAvatar(avDraft()));
    avBlurLabel.textContent = VS_BLUR_LABELS[+avBlur.value] || VS_BLUR_LABELS[0];
    avBlur.style.setProperty('--p', (+avBlur.value / VS_BLUR_MAX * 100) + '%');
    const c = avPick && avById.get(avPick.id);
    avShiny.classList.toggle('hidden', !(c && c.s && c.n));   // only offer the toggle if both versions are caught
    avShiny.classList.toggle('on', !!(avPick && avPick.s));
    avShiny.setAttribute('aria-pressed', avPick && avPick.s ? 'true' : 'false');
  }
  function avMakeCell(c) {
    const sel = !!(avPick && avPick.id === c.id);
    const shiny = sel ? !!avPick.s : ((!c.n && c.s) || (avFilter === 'shiny' && c.s));
    const f = vsDefaultForm(c, shiny), d = c.bd[shiny ? 's' : 'n'];
    const name = vsDexName(c.id), nf = avNForms(c);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vs-av-cell' + (sel ? ' sel' : '') + (d ? ' ring-' + d : '');
    b.dataset.id = c.id;
    b.title = name;
    b.innerHTML = `<img loading="lazy" decoding="async" alt="${escapeHtml(name)}" src="${vsSpriteUrl(c.id, shiny, f)}"${f ? ` data-fb="${vsSpriteUrl(c.id, shiny, 0)}"` : ''} onerror="vsImgErr(this)">` +
      (nf > 1 ? `<i class="vs-av-badge">+${nf - 1}</i>` : '');
    return b;
  }
  function avRefreshCell(id) {
    const old = avGrid.querySelector(`.vs-av-cell[data-id="${id}"]`), c = avById.get(id);
    if (old && c) old.replaceWith(avMakeCell(c));
  }
  function avDrawMore() {
    if (avDrawn >= avView.length) return;
    const frag = document.createDocumentFragment();
    avView.slice(avDrawn, avDrawn + AV_CHUNK).forEach(c => frag.appendChild(avMakeCell(c)));
    avDrawn = Math.min(avView.length, avDrawn + AV_CHUNK);
    avGrid.appendChild(frag);
  }
  function avApplyFilter() {
    const q = avSearch.value.trim().toLowerCase();
    let list = avCaught.filter(c => {
      if (avFilter === 'shiny' && !c.s) return false;
      if (avFilter === 'forms' && avNForms(c) < 2) return false;
      return !q || c.lc.indexOf(q) !== -1 || String(c.id) === q;
    });
    if (avNewest) list = list.slice().sort((a, b) => b.ts - a.ts || a.id - b.id);
    avView = list; avDrawn = 0;
    avGrid.innerHTML = ''; avGrid.scrollTop = 0;
    avDrawMore();
    avCountEl.textContent = !avCaught.length ? '' : (avView.length ? `${avView.length} of ${avCaught.length} Pokémon` : 'No matches');
    avEmpty.classList.toggle('hidden', avCaught.length > 0);
  }
  function avPaintFilters() {
    avFilterBar.querySelectorAll('[data-avf]').forEach(b => b.classList.toggle('on', b.dataset.avf === avFilter));
    avFilterBar.querySelectorAll('[data-avs]').forEach(b => b.classList.toggle('on', avNewest));
  }
  function openAvatarPicker() {
    avCaught = vsCaughtList();
    avById = new Map(avCaught.map(c => [c.id, c]));
    const cur = vsMyAvatar;
    avPick = cur ? { id: cur.id, s: cur.s } : null;
    avBlur.value = cur ? cur.b : 0;
    avSearch.value = ''; avFilter = 'all'; avNewest = false;
    avPaintFilters(); avApplyFilter(); avPaintPick();
    avModal.classList.remove('hidden');
    document.documentElement.classList.add('settings-lock');
  }
  function closeAvatarPicker() { avModal.classList.add('hidden'); document.documentElement.classList.remove('settings-lock'); }
  vsAvatarBtn.addEventListener('click', openAvatarPicker);
  avModal.addEventListener('click', (e) => {
    if (e.target.closest('[data-vs-close]')) { closeAvatarPicker(); return; }
    const cell = e.target.closest('.vs-av-cell');
    if (cell) {
      const id = +cell.dataset.id, c = avById.get(id);
      if (!c) return;
      const prev = avPick ? avPick.id : 0;
      const shiny = ((!c.n && c.s) || (avFilter === 'shiny' && c.s)) ? 1 : 0;
      avPick = { id, s: shiny };
      if (prev && prev !== id) avRefreshCell(prev);
      avRefreshCell(id); avPaintPick();
      return;
    }
    const chip = e.target.closest('[data-avf], [data-avs]');
    if (chip) {
      if (chip.dataset.avf) avFilter = chip.dataset.avf; else avNewest = !avNewest;
      avPaintFilters(); avApplyFilter();
    }
  });
  avGrid.addEventListener('scroll', () => { if (avGrid.scrollTop + avGrid.clientHeight > avGrid.scrollHeight - 160) avDrawMore(); }, { passive: true });
  avBlur.addEventListener('input', avPaintBlur);
  avSearch.addEventListener('input', () => { clearTimeout(avSearchT); avSearchT = setTimeout(avApplyFilter, 120); });
  avShiny.addEventListener('click', () => {
    if (!avPick) return;
    avPick.s = avPick.s ? 0 : 1;
    avRefreshCell(avPick.id); avPaintPick();
  });
  $id('vs-av-save').addEventListener('click', () => {
    vsMyAvatar = vsResolveAvatar(avDraft()); vsSaveAvatar(vsMyAvatar); paintProfile(); pushMyProfile(); closeAvatarPicker();
  });
  $id('vs-av-none').addEventListener('click', () => {
    vsMyAvatar = null; vsSaveAvatar(null); paintProfile(); pushMyProfile(); closeAvatarPicker();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !avModal.classList.contains('hidden')) closeAvatarPicker(); });
  paintProfile();

  // ---------- public / private toggle ----------
  function setVisibility(pub) {
    vsWantPublic = pub;
    vsVisPrivate.classList.toggle('on', !pub); vsVisPublic.classList.toggle('on', pub);
    vsVisPrivate.setAttribute('aria-pressed', String(!pub)); vsVisPublic.setAttribute('aria-pressed', String(pub));
    vsVisHint.textContent = pub ? 'Public: shows up in the Public Lobbies list for anyone to join.' : 'Private: only people with your code can join.';
  }
  vsVisPrivate.addEventListener('click', () => setVisibility(false));
  vsVisPublic.addEventListener('click', () => setVisibility(true));

  // ---------- public lobby list (Firebase) ----------
  let vsWatching = false, vsWatchRef = null, vsLobbyCache = null, vsWatchTimer = 0;
  // The free Firebase plan only allows about 100 people connected at once. When it's full, new connections just never
  // go through (no error), so we show this after a few seconds of silence. It also appears if the player is offline.
  const VS_BUSY_MSG = '<p class="vs-lobby-hint">Can\'t reach the public lobby list right now. It may be full (lots of people online) or your connection may be down. You can still make a private room and share the code, or join a friend\'s code.</p>';
  function renderPublicList(val) {
    const rows = vsParseLobbies(val, vsServerNow(), VS_LOBBY_LIVE_MS);
    const order = { waiting: 0, full: 1, playing: 2 };
    rows.sort((a, b) => order[vsLobbyState(a)] - order[vsLobbyState(b)] || b.players - a.players);
    vsPublicCount.textContent = rows.length ? `${rows.length} open` : '';
    if (!rows.length) { vsPublicList.innerHTML = '<p class="vs-lobby-hint">No public lobbies right now - create one or hit Quick Play!</p>'; return; }
    vsPublicList.innerHTML = rows.map(l => {
      const st = vsLobbyState(l);
      const label = st === 'waiting' ? 'Waiting' : st === 'full' ? 'Full' : 'In game';
      const dots = Array.from({ length: l.max }, (_, i) => `<i class="${i < l.players ? 'on' : ''}"></i>`).join('');
      return `<div class="vs-public-row ${st}">
        ${vsAvatarHTML(l.av, 'sm')}
        <div class="vs-public-info"><b>${escapeHtml(l.host)}</b><span>${l.rounds} round${l.rounds === 1 ? '' : 's'} &middot; <span class="vs-dots" aria-label="${l.players} of ${l.max} players">${dots}</span></span></div>
        <span class="vs-badge vs-badge-${st}">${label}</span>
        <button type="button" class="action-btn vs-gated vs-public-join${vsMyName ? '' : ' locked'}" data-code="${l.code}" ${st === 'waiting' ? '' : 'disabled'}>Join</button>
      </div>`;
    }).join('');
  }
  let vsListPaused = false, vsListLastActive = Date.now(), vsListHiddenAt = 0, vsStaleTimer = 0, vsOfflineTimer = 0;
  const onVersusTab = () => /^#versus/i.test(location.hash) && !vsInRoom;
  function startLobbyWatch() {
    if (vsWatching || vsInRoom) return;
    const db = vsFirebase();
    if (!db) {
      vsPublicList.innerHTML = '<p class="vs-lobby-hint">Public lobbies aren\'t switched on yet. You can still make a private room and share the code.</p>';
      return;
    }
    clearTimeout(vsOfflineTimer);
    try { db.goOnline(); } catch (e) {}
    vsListPaused = false; vsListLastActive = Date.now();
    vsWatching = true;
    vsWatchRef = db.ref('lobbies');
    clearTimeout(vsWatchTimer);
    vsWatchTimer = setTimeout(() => { if (vsWatching && vsLobbyCache === null && !vsInRoom) vsPublicList.innerHTML = VS_BUSY_MSG; }, 8000);
    if (!vsOffsetWatching) { vsOffsetWatching = true; db.ref('.info/serverTimeOffset').on('value', s => { vsServerOffset = Number(s.val()) || 0; }, () => {}); }
    vsWatchRef.on('value', snap => { clearTimeout(vsWatchTimer); vsLobbyCache = snap.val(); renderPublicList(vsLobbyCache); },
      () => { vsPublicList.innerHTML = '<p class="vs-lobby-hint">Couldn\'t load public lobbies. Check your connection.</p>'; });
    // rooms whose host stopped pulsing disappear on their own, even when nothing else changes
    clearInterval(vsStaleTimer);
    vsStaleTimer = setInterval(() => { if (vsWatching && vsLobbyCache !== null) renderPublicList(vsLobbyCache); }, 10000);
  }
  function stopLobbyWatch() {
    if (vsWatchRef) { try { vsWatchRef.off(); } catch (e) {} }
    clearTimeout(vsWatchTimer); clearInterval(vsStaleTimer);
    vsWatchRef = null; vsWatching = false;
    // Free the connection slot of anyone who isn't looking at the list (unless they're hosting a public room)
    clearTimeout(vsOfflineTimer);
    vsOfflineTimer = setTimeout(() => { if (!vsWatching && !vsLobbyRef && !vsConnecting && vsDb) { try { vsDb.goOffline(); } catch (e) {} } }, 4000);
  }
  function syncWatch() {
    if (onVersusTab()) { if (!vsListPaused) startLobbyWatch(); }
    else { vsListPaused = false; stopLobbyWatch(); }
  }
  window.addEventListener('hashchange', syncWatch);
  syncWatch();

  // Away from the list (no input for a while, or the tab is in the background): pause it so the slot goes to someone else.
  function pauseLobbyWatch() {
    if (!vsWatching) return;
    stopLobbyWatch();
    vsListPaused = true;
    vsLobbyCache = null;
    vsPublicCount.textContent = '';
    vsPublicList.innerHTML = '<p class="vs-lobby-hint">The lobby list paused because you were away (it frees up room for other players). <button type="button" class="action-btn vs-list-resume">Refresh</button></p>';
  }
  function resumeLobbyWatch() {
    if (!vsListPaused) return;
    vsListPaused = false; vsLobbyCache = null;
    vsPublicList.innerHTML = '<p class="vs-lobby-hint">Reconnecting...</p>';
    syncWatch();
  }
  ['pointermove', 'wheel', 'scroll'].forEach(ev => document.addEventListener(ev, () => { vsListLastActive = Date.now(); }, { passive: true, capture: true }));
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => {
    vsListLastActive = Date.now();
    if (vsListPaused && onVersusTab()) resumeLobbyWatch();
  }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) vsListHiddenAt = Date.now();
    else { vsListHiddenAt = 0; vsListLastActive = Date.now(); if (vsListPaused && onVersusTab()) resumeLobbyWatch(); }
  });
  setInterval(() => {
    if (!vsWatching) return;
    const now = Date.now();
    if (now - vsListLastActive >= VS_LIST_IDLE_MS || (vsListHiddenAt && now - vsListHiddenAt >= VS_LIST_HIDDEN_MS)) pauseLobbyWatch();
  }, 5000);
  vsPublicList.addEventListener('click', (e) => {
    if (e.target.closest('.vs-list-resume')) { resumeLobbyWatch(); return; }
    const b = e.target.closest('.vs-public-join');
    if (!b || b.disabled || vsConnecting) return;
    if (!requireName()) return;
    vsQuickMode = false;
    beginConnecting();
    startJoin(b.dataset.code);
  });
  // Host side: keep the public row current. A room is listed ONLY while it can really be joined: waiting in the lobby, the host
  // is on the Versus tab with the page open, and the connection to the matchmaking server is alive. In a match, on the results
  // screen, away on another tab, or with a dead connection the row comes down (it comes back by itself when that changes),
  // and a "pulse" every 20s lets everyone else spot ghost rooms (crashed / frozen / backgrounded hosts) and hide them.
  let vsAwayFromLobby = false, vsAwayTimer = 0;
  function vsShouldPublish() {
    return !!(vsIsHost && vsIsPublic && vsInRoom && !vsLeaving && vsPhase === 'lobby' && !vsMatchActive && !vsAwayFromLobby
      && /^#versus/i.test(location.hash) && vsPeer && !vsPeer.destroyed && !vsPeer.disconnected && vsPlayers[vsPeer.id]);
  }
  function vsSyncPublic(pulse) {
    if (!vsIsHost || !vsIsPublic || !vsPeer || !vsPlayers[vsPeer.id]) return;
    if (!vsShouldPublish()) { vsUnpublishLobby(); return; }
    if (pulse && vsLobbyRef) { vsPulseLobby(); return; }
    vsPublishLobby({
      code: vsRoomCode, host: vsPlayers[vsPeer.id].name, av: vsAvatarLobbyStr(vsPlayers[vsPeer.id].av),
      players: Object.keys(vsPlayers).length, rounds: vsNumRounds, status: vsMatchActive ? 'playing' : 'waiting'
    });
  }
  setInterval(() => {
    if (!vsInRoom || !vsIsHost) return;
    try { if (vsPeer && vsPeer.disconnected && !vsPeer.destroyed && !vsLeaving) vsPeer.reconnect(); } catch (e) {}   // lost the matchmaking server (throttled tab?) - try to get back
    vsSyncPublic(true);
  }, VS_PULSE_MS);
  window.addEventListener('hashchange', () => { if (vsInRoom) vsSyncPublic(); });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(vsAwayTimer);
    if (document.hidden) { vsAwayTimer = setTimeout(() => { vsAwayFromLobby = true; vsSyncPublic(); }, 20000); return; }
    vsAwayFromLobby = false;
    if (!vsInRoom) return;
    try { if (vsPeer && vsPeer.disconnected && !vsPeer.destroyed && !vsLeaving) vsPeer.reconnect(); } catch (e) {}
    setTimeout(() => vsSyncPublic(), 800);
  });

  // ---------- creating / joining ----------
  function setMenuBusy(b) {
    vsCreateRoomBtn.disabled = b; vsJoinRoomBtn.disabled = b; vsQuickPlayBtn.disabled = b;
  }
  function beginConnecting() { vsConnecting = true; setMenuBusy(true); }
  function endConnecting() { vsConnecting = false; setMenuBusy(false); }

  vsCreateRoomBtn.addEventListener('click', () => {
    if (vsConnecting || !requireName()) return;
    syncAvatarWithDex();
    vsQuickMode = false;
    beginConnecting();
    startHost(vsWantPublic);
  });

  vsJoinRoomBtn.addEventListener('click', () => {
    if (vsConnecting || !requireName()) return;
    syncAvatarWithDex();
    const code = vsCleanCode(vsRoomIdInput.value);
    if (code.length !== 4) { vsToast('Enter the 4-digit room code.'); vsRoomIdInput.focus(); return; }
    vsQuickMode = false;
    beginConnecting();
    startJoin(code);
  });
  vsRoomIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') vsJoinRoomBtn.click(); });

  vsQuickPlayBtn.addEventListener('click', async () => {
    if (vsConnecting || !requireName()) return;
    syncAvatarWithDex();
    const db = vsFirebase();
    if (!db) { vsToast('Public lobbies are not switched on yet.'); return; }
    beginConnecting();
    vsQuickMode = true;
    vsGoOnline();
    try {
      // if the lobby server is full or unreachable this never answers, so don't wait forever
      const snap = await Promise.race([db.ref('lobbies').once('value'), new Promise((_, rej) => setTimeout(() => rej(new Error('lobby-timeout')), 8000))]);
      vsQuickQueue = vsQuickCandidates(snap.val(), vsServerNow(), VS_LOBBY_LIVE_MS);
    } catch (e) {
      endConnecting(); vsQuickMode = false;
      vsToast(e && e.message === 'lobby-timeout' ? "Can't reach the lobby list right now (it may be full). Make a private room or join with a code." : "Couldn't load the lobby list. Try again.");
      return;
    }
    quickNext();
  });
  function quickNext() {
    const code = vsQuickQueue.shift();
    if (code) startJoin(code);
    else { vsQuickMode = false; vsToast('No open lobby - made you a new public one!'); startHost(true); }
  }

  function destroyPeer() {
    clearTimeout(vsJoinTimer);
    try { if (vsPeer) vsPeer.destroy(); } catch (e) {}
    vsPeer = null; vsHostConn = null; vsClients = [];
  }

  // Short code: claim it by registering the PeerJS id; if somebody already holds it, roll a new one.
  function startHost(isPublic, attempt) {
    attempt = attempt || 0;
    if (typeof Peer === 'undefined') { vsToast('The multiplayer library failed to load - reload the page.'); endConnecting(); return; }
    vsIsHost = true; vsIsPublic = isPublic;
    const code = vsRandomCode();
    const peer = new Peer(VS_PEER_PREFIX + code);
    vsPeer = peer;
    peer.on('open', (id) => {
      vsRoomCode = code;
      vsPlayers = {};
      vsPlayers[id] = { name: vsMyName, score: 0, slot: 0, av: vsMyAvatar, ready: true, joinedAt: Date.now() };
      vsRoundsSelector.classList.remove('hidden');
      showRoom();
      renderVsLobby();
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && !vsInRoom) {
        try { peer.destroy(); } catch (e) {}
        if (attempt < 12) { startHost(isPublic, attempt + 1); return; }
        vsToast('Could not find a free room code - try again.');
        endConnecting(); return;
      }
      peerError(err);
    });
    peer.on('connection', acceptConnection);
    peer._pbListening = true;
  }

  // Shared by the original host and by a guest who gets promoted. Players we already know (they were in the room before
  // the host changed) are always let back in, even mid-match; strangers are turned away once a match has started or the room is full.
  function acceptConnection(conn) {
    if (!vsIsHost) return;
    const known = !!vsPlayers[conn.peer];
    if (!known && vsMatchActive) { conn.on('open', () => { conn.send({ type: 'GAME_IN_PROGRESS' }); setTimeout(() => conn.close(), 200); }); return; }
    if (!known && (vsClients.length >= VS_MAX_PLAYERS - 1 || Object.keys(vsPlayers).length >= VS_MAX_PLAYERS)) { conn.on('open', () => { conn.send({ type: 'LOBBY_FULL' }); setTimeout(() => conn.close(), 200); }); return; }
    vsClients.push(conn);
    setupVsConnection(conn);
  }

  function startJoin(code) {
    if (typeof Peer === 'undefined') { vsToast('The multiplayer library failed to load - reload the page.'); endConnecting(); return; }
    vsIsHost = false; vsIsPublic = false;
    const peer = new Peer();
    vsPeer = peer;
    peer.on('open', () => {
      vsRoomCode = code;
      vsHostConn = peer.connect(VS_PEER_PREFIX + code, { reliable: true });
      setupVsConnection(vsHostConn);
      vsJoinTimer = setTimeout(() => { if (!vsInRoom) joinFailed("Couldn't reach that room (timed out).", true); }, 10000);
    });
    peer.on('error', (err) => {
      if (vsMigrating && err.type === 'peer-unavailable') { if (vsMigDrop) vsMigDrop(); return; }   // the would-be host is gone too: try the next player in line
      if (err.type === 'peer-unavailable' && !vsInRoom) {
        joinFailed("Couldn't find that room - double check the code.", true);
        return;
      }
      peerError(err);
    });
  }

  function peerError(err) {
    console.error('PeerJS error:', err);
    if (vsInRoom) { vsToast('Connection problem: ' + err.type); return; }
    destroyPeer(); endConnecting();
    vsToast('Connection error: ' + err.type);
  }

  // A join attempt didn't work. Quick Play quietly moves on to the next room.
  function joinFailed(message, stale) {
    const failedCode = vsRoomCode;
    destroyPeer();
    if (stale && failedCode) { const db = vsFirebase(); if (db) { try { db.goOnline(); db.ref('lobbies/' + failedCode).remove(); } catch (e) {} } }
    if (vsQuickMode) { quickNext(); return; }
    endConnecting();
    vsToast(message);
  }

  function showRoom() {
    vsInRoom = true; vsConnecting = false;
    clearTimeout(vsJoinTimer);
    stopLobbyWatch();
    vsMenu.classList.add('hidden');
    vsLobbyStatus.classList.remove('hidden');
    vsRoomCodeDisplay.textContent = vsRoomCode;
    paintRoomBadge();
    window.location.hash = `#versus/${vsRoomCode}`;
  }
  function paintRoomBadge() {
    vsRoomVisBadge.textContent = vsIsPublic ? 'Public' : 'Private';
    vsRoomVisBadge.classList.toggle('pub', vsIsPublic);
  }

  function setupVsConnection(conn) {
    conn.on('open', () => {
      if (!vsIsHost) {
        conn.send({ type: 'JOIN', peerId: vsPeer.id, name: vsMyName, av: vsMyAvatar });
        if (vsIAmBack && vsPhase === 'over') conn.send({ type: 'BACK' });
      }
    });

    conn.on('data', (data) => handleVsNetworkMessage(data, conn));

    conn.on('close', () => {
      if (vsIsHost) { vsDropPlayer(conn); return; }
      if (conn !== vsHostConn) return;                                   // an old connection we already moved on from
      if (vsMigrating) { if (vsMigSkip) vsMigSkip(); return; }           // the would-be host closed on us: retry / next in line
      // Guest: the host's connection died without telling us (their tab was closed or crashed) -> promote the next player in line
      if (vsInRoom && !vsLeaving) vsHostGone();
    });
  }

  // Host only: a guest is gone (closed the tab, left, or the connection died)
  function vsDropPlayer(conn) {
    if (!vsIsHost) return;
    vsClients = vsClients.filter(c => c !== conn);
    const pid = conn._vsPeerId;
    if (pid && vsPlayers[pid]) {
      delete vsPlayers[pid];
      delete vsLastSeen[pid];
      if (vsAwaiting) vsAwaiting.delete(pid);
      renderVsLobby();
      broadcastVs(vsLobbyPayload());
      vsPruneBars();
      if (vsVoteOpen) broadcastVoteTally();   // fewer players to wait for - might mean everyone has voted now
      vsAfterRosterShrink();
    }
  }

  // Host only: somebody left. If a match is on and only one person is left, the match ends and they are crowned.
  function vsAfterRosterShrink() {
    if (!vsIsHost) return;
    if (vsAwaiting) { if (!vsAwaiting.size) vsResume(); return; }   // a new host is still waiting for people to reconnect: vsResume() decides
    if (vsMatchActive && vsPhase !== 'lobby' && vsPhase !== 'over' && Object.keys(vsPlayers).length < 2) endVsGame('alone');
  }
  function vsPruneBars() {
    vsPlayerBars.querySelectorAll('[data-peer-id]').forEach(el => { if (!vsPlayers[el.dataset.peerId]) el.remove(); });
  }

  function broadcastVs(data) {
    vsClients.forEach(c => { if (c.open) c.send(data); });
  }

  function handleVsNetworkMessage(data, conn) {
    if (vsIsHost && conn && conn._vsPeerId) vsLastSeen[conn._vsPeerId] = Date.now();   // any message from a guest counts as "still here"
    switch (data.type) {
      case 'ACTIVE':   // a guest's "I'm still using the page" ping (the timestamp is updated above)
        break;

      case 'JOIN': {
        if (!vsIsHost) break;
        if (typeof data.peerId !== 'string' || !data.peerId) break;
        if (vsPlayers[data.peerId]) {
          // Somebody we already know, coming back after the host changed. Only trust it if the connection really is theirs.
          if (conn.peer !== data.peerId) break;
          conn._vsPeerId = data.peerId;
          vsLastSeen[data.peerId] = Date.now();
          if (vsAwaiting) vsAwaiting.delete(data.peerId);
          renderVsLobby();
          broadcastVs(vsLobbyPayload());
          if (vsAwaiting && !vsAwaiting.size) vsResume();
          break;
        }
        const usedSlots = new Set(Object.values(vsPlayers).map(p => p.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < VS_MAX_PLAYERS) slot++;
        conn._vsPeerId = data.peerId;
        vsPlayers[data.peerId] = { name: vsSanitizeIncomingName(data.name, `Player ${slot + 1}`), score: 0, slot, av: vsCleanAvatar(data.av), ready: false, joinedAt: Date.now() };
        vsLastSeen[data.peerId] = Date.now();
        renderVsLobby();
        broadcastVs(vsLobbyPayload());
        break;
      }

      case 'READY': {
        if (!vsIsHost) break;
        const pid = conn._vsPeerId;                       // trust the connection, not the id the client claims
        if (!pid || !vsPlayers[pid] || (vsMatchActive && vsPhase !== 'over')) break;
        vsPlayers[pid].ready = !!data.ready;
        renderVsLobby();
        broadcastVs(vsLobbyPayload());
        break;
      }

      case 'PROFILE_UPDATE':
      case 'NAME_UPDATE': {
        if (!vsIsHost) break;
        const pid = conn._vsPeerId;                       // trust the connection, not the id the client claims
        if (!pid || !vsPlayers[pid] || vsMatchActive) break;
        vsPlayers[pid].name = vsSanitizeIncomingName(data.name, vsPlayers[pid].name);
        if (data.av !== undefined) vsPlayers[pid].av = vsCleanAvatar(data.av);
        renderVsLobby();
        broadcastVs(vsLobbyPayload());
        break;
      }

      case 'LOBBY_UPDATE':
        vsPlayers = data.players;
        vsNumRounds = data.numRounds;
        vsIsPublic = !!data.isPublic;
        vsRoundsValue.textContent = vsNumRounds;
        if (vsMigrating) {   // the new host answered: we're back in business
          vsMigrating = false; clearTimeout(vsMigTimer); vsMigSkip = null; vsMigDrop = null;
          const nh = Object.values(vsPlayers).find(p => p.slot === 0);
          vsToast((nh ? nh.name : 'Someone') + ' is the host now.');
        }
        if (!vsInRoom && !vsIsHost) showRoom();
        paintRoomBadge();
        renderVsLobby();
        vsPruneBars();   // somebody left mid-match: take their bar off the race board
        break;

      case 'LOBBY_FULL':
        joinFailed('That room is already full.', false);
        break;

      case 'GAME_IN_PROGRESS':
        joinFailed('That game has already started - try another room.', false);
        break;

      case 'KICKED':
        if (vsIsHost) break;
        vsLeaving = true;
        vsToast(data.reason === 'idle' ? 'You were removed from the room for being inactive.' : data.reason === 'afk' ? 'You were removed from the room for not going back to the lobby in time.' : 'The host removed you from the room.');
        setTimeout(() => { location.hash = '#versus'; location.reload(); }, 1500);
        break;

      case 'LEAVE':   // a guest told us they're going (sent as their tab closes)
        if (vsIsHost) { vsDropPlayer(conn); try { conn.close(); } catch (er) {} }
        break;

      case 'HOST_LEFT':   // the host told us they're going: the next player in line takes over
        if (!vsIsHost) vsHostGone();
        break;

      case 'VOTE_START':
        applyVoteStart(data.duration || VS_VOTE_DURATION_S);
        break;

      case 'VOTE_SUBMIT': {
        if (!vsIsHost) break;
        vsGenVotes[data.peerId] = { gens: data.gens || [], isRandom: !!data.isRandom };
        broadcastVoteTally();
        break;
      }

      case 'VOTE_TALLY_UPDATE':
        vsVoteStatus.textContent = voteStatusText(Number(data.voted) || 0, Number(data.total) || 0);
        break;

      case 'VOTE_RATE': {
        if (vsIsHost) break;
        const left = Math.max(0, Math.min(VS_VOTE_DURATION_S, Number(data.remaining) || 0));
        runVoteCountdown(left, Number(data.rate) === VS_VOTE_FAST_RATE ? VS_VOTE_FAST_RATE : 1);
        break;
      }

      case 'VOTE_RESULT':
        applyVoteResult(data);
        break;

      case 'START_GAME':
        vsNumRounds = data.numRounds;
        vsPlayers = data.players || vsPlayers;
        vsRound = 0;
        vsPhase = 'playing';
        vsGameplayScreen.classList.remove('is-over');
        vsModeTitle.textContent = 'Choosing Round Mode...';
        vsRoundLabel.textContent = '';
        vsLobbyScreen.classList.add('hidden');
        vsVoteScreen.classList.add('hidden');
        vsGameplayScreen.classList.remove('hidden');
        vsGameOverPanel.classList.add('hidden');
        vsRoundOverPanel.classList.add('hidden');
        showVsCountdown();
        break;

      case 'VS_SPIN_START':
        showVsWheelDuringSpin(data.targetMode);
        break;

      case 'VS_PRELOAD':
        // The host already picked this round's Pokémon while the wheel spins;
        // download its image now so it's ready the instant the round starts.
        if (!vsIsHost && data.image) vsPreloadImage(data.image, 8000);
        break;

      case 'START_ROUND':
        applyStartRound(data);
        break;

      case 'CORRECT_GUESS':
        if (vsIsHost) handleCorrectGuess(data.peerId, data.elapsedMs);
        break;

      case 'ROUND_RESULT':
        applyRoundResult(data);
        break;

      case 'GAME_OVER':
        applyGameOver(data);
        break;

      case 'BACK': {   // a guest went back to the lobby screen
        if (!vsIsHost) break;
        const pid = conn._vsPeerId;
        if (pid && vsBackPending) vsBackPending.delete(pid);
        vsMaybeFinishBackWindow();
        break;
      }
    }
  }

  const vsReadyBtn = $id('vs-ready-btn');
  let vsShownIds = null;
  const vsCriedIds = new Set();   // peers whose cry has already played this session
  function renderVsLobby() {
    vsPlayerSlots.innerHTML = '';
    const entries = Object.entries(vsPlayers).map(([id, p]) => ({ id, ...p }));
    const idsNow = new Set(entries.map(e => e.id));
    const fresh = vsShownIds ? entries.filter(e => !vsShownIds.has(e.id)) : [];
    // First time we land in this room: hear your own Pokémon's cry. Later, whoever walks in announces themselves with theirs.
    const me = vsPeer && entries.find(e => e.id === vsPeer.id);
    if (!vsShownIds && me && me.av && !vsCriedIds.has(me.id)) { vsCriedIds.add(me.id); vsPlayCry(me.av); }
    const joiner = fresh.find(e => !(vsPeer && e.id === vsPeer.id) && !vsCriedIds.has(e.id));
    if (vsShownIds && joiner) {
      vsCriedIds.add(joiner.id);
      if (joiner.av) vsPlayCry(joiner.av);
      else { playVsTone(660, 0.08, 'sine', 0.08); playVsTone(990, 0.1, 'sine', 0.08, 0.07); }
    }
    const hadLeaver = vsShownIds && Array.from(vsShownIds).some(id => !idsNow.has(id));
    if (hadLeaver) playVsTone(330, 0.14, 'triangle', 0.07);

    for (let i = 0; i < VS_MAX_PLAYERS; i++) {
      const entry = entries.find(p => p.slot === i);
      const div = document.createElement('div');
      div.className = 'vs-slot' + (entry ? ' filled' : ' empty');
      if (entry) {
        const isYou = vsPeer && entry.id === vsPeer.id;
        if (vsShownIds && fresh.some(f => f.id === entry.id)) div.classList.add('pop-in');
        if (isYou) div.classList.add('you');
        const roleLabel = entry.slot === 0 ? 'HOST' : 'PLAYER';
        div.innerHTML = `
          ${vsAvatarHTML(entry.av, 'lg')}
          <span class="vs-slot-role">${roleLabel}</span>
          <span class="vs-slot-name">${escapeHtml(entry.name)}</span>
          ${entry.slot === 0 ? '' : `<span class="vs-ready-tag${entry.ready ? ' on' : ''}">${entry.ready ? 'READY' : 'NOT READY'}</span>`}
        `;
        if (vsIsHost && vsIsPublic && !vsMatchActive && entry.slot !== 0) {
          const kb = document.createElement('button');
          kb.type = 'button'; kb.className = 'vs-kick-btn'; kb.dataset.kick = entry.id;
          kb.setAttribute('aria-label', 'Kick ' + entry.name);
          kb.textContent = 'Kick';
          div.appendChild(kb);
        }
      } else {
        div.innerHTML = `<span class="vs-avatar vs-avatar-lg vs-avatar-empty"><span class="vs-ball ghost"></span></span><span class="vs-slot-role empty-role">OPEN</span><span class="vs-slot-name">Waiting...</span>`;
      }
      vsPlayerSlots.appendChild(div);
    }
    vsShownIds = idsNow;

    const count = entries.length;
    const notReady = entries.filter(e => e.slot !== 0 && !e.ready);
    const allReady = count >= 2 && !notReady.length;
    if (vsIsHost) {
      vsStartGameBtn.classList.remove('hidden');
      vsStartGameBtn.disabled = count < 2;
      vsStartGameBtn.textContent = (count < 2 || allReady) ? 'Start Game' : `Start anyway (${notReady.length} not ready)`;
      vsStartGameBtn.classList.toggle('ready-go', allReady);
      vsLobbyHint.classList.remove('hidden');
      vsLobbyHint.textContent = count < 2
        ? 'Need at least 2 players to start.'
        : (allReady ? 'Everyone is ready!' : `Waiting for ${notReady.map(e => e.name).join(', ')} to ready up.`);
      vsWaitingMsg.classList.add('hidden');
      vsReadyBtn.classList.add('hidden');
      vsSyncPublic();
    } else {
      vsStartGameBtn.classList.add('hidden');
      vsLobbyHint.classList.add('hidden');
      vsWaitingMsg.classList.remove('hidden');
      vsReadyBtn.classList.remove('hidden');
      const isReady = !!(me && me.ready);
      vsReadyBtn.textContent = isReady ? 'Ready \u2713 (tap to undo)' : "I'm ready";
      vsReadyBtn.classList.toggle('on', isReady);
      vsReadyBtn.setAttribute('aria-pressed', String(isReady));
    }
  }

  vsCopyCodeBtn.addEventListener('click', async () => {
    const link = `${window.location.origin}${window.location.pathname}#versus/${vsRoomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      vsCopyCodeBtn.textContent = 'Copied!';
      setTimeout(() => { vsCopyCodeBtn.textContent = 'Copy Link'; }, 1500);
    } catch (e) {
      prompt('Copy this invite link:', link);
    }
  });

  // ---- Generation vote (runs before every match start, including rematches) ----
  const vsVoteGenButtons = Array.from(document.querySelectorAll('[data-vote-gen]'));

  function syncVoteButtonsUI() {
    vsVoteGenButtons.forEach(btn => {
      const g = parseInt(btn.getAttribute('data-vote-gen'), 10);
      btn.classList.toggle('active', vsMyVoteGens.has(g));
    });
    vsVoteRandomBtn.classList.toggle('active', vsMyVoteRandom);

    const picksLeft = VS_VOTE_MAX_GENS - vsMyVoteGens.size;
    vsVotePicksLeft.textContent = vsMyVoteRandom
      ? 'Voting Random'
      : `${picksLeft} pick${picksLeft === 1 ? '' : 's'} remaining`;
  }

  // A player counts as "voted" once they have picked Random or at least one generation (and only while still in the room)
  function countVotes() {
    const ids = Object.keys(vsPlayers);
    const voted = ids.filter(pid => { const v = vsGenVotes[pid]; return v && (v.isRandom || (v.gens && v.gens.length)); }).length;
    return { voted, total: ids.length };
  }

  function voteStatusText(voted, total) {
    return (total > 0 && voted >= total) ? "Everyone's voted - speeding up!" : `${voted} of ${total} players have voted`;
  }
  function updateVoteStatus() {
    const { voted, total } = countVotes();
    vsVoteStatus.textContent = voteStatusText(voted, total);
  }

  // On-screen countdown: `remaining` seconds, ticking `rate` times faster than normal. Each device runs its own
  // (same reason as the round timer); the host tells everybody whenever the rate changes.
  function runVoteCountdown(remaining, rate) {
    clearInterval(vsVoteCountdownInterval);
    rate = rate > 1 ? rate : 1;
    const t0 = performance.now();
    vsVoteTimerEl.classList.toggle('fast', rate > 1);
    let shown = -1;
    // Polled every frame-ish (16ms) and only touches the page when the number changes. At 3x speed each number lasts
    // 333ms, so a slow poll (it used to be 200ms) made some numbers last almost twice as long as others.
    const paint = () => {
      const left = Math.max(0, Math.ceil(remaining - ((performance.now() - t0) / 1000) * rate));
      if (left !== shown) {
        shown = left;
        vsVoteTimerEl.textContent = left;
        vsVoteTimerEl.classList.toggle('urgent', left <= 5);
      }
      if (left <= 0) clearInterval(vsVoteCountdownInterval);
    };
    paint();
    vsVoteCountdownInterval = setInterval(paint, 16);
  }

  // Host only: seconds left on the vote clock right now
  function vsVoteLeft() { return Math.max(0, vsVoteRemain - ((Date.now() - vsVoteClockAt) / 1000) * vsVoteRate); }

  // Host only: change how fast the clock runs, keeping whatever time is left
  function setVoteRate(rate) {
    if (!vsIsHost || !vsVoteOpen || rate === vsVoteRate) return;
    // Speeding up: round the time left UP to a whole second first, so every number from here on lasts exactly 1/rate seconds
    // (otherwise the first number after the speed-up is cut short and the countdown looks lumpy).
    const left = vsVoteLeft();
    vsVoteRemain = rate > 1 ? Math.ceil(left) : left;
    vsVoteClockAt = Date.now();
    vsVoteRate = rate;
    clearTimeout(vsVoteTimer);
    vsVoteTimer = setTimeout(finalizeGenVoteAndStart, Math.round((vsVoteRemain / rate) * 1000));
    broadcastVs({ type: 'VOTE_RATE', remaining: vsVoteRemain, rate });
    runVoteCountdown(vsVoteRemain, rate);
    updateVoteStatus();
  }

  // Everybody has picked -> run the clock faster. Somebody undoes their pick -> back to normal speed from where it is now.
  function maybeSpeedUpVote() {
    if (!vsIsHost || !vsVoteOpen) return;
    const { voted, total } = countVotes();
    setVoteRate(total >= 1 && voted >= total ? VS_VOTE_FAST_RATE : 1);
  }

  function broadcastVoteTally() {
    updateVoteStatus();
    const { voted, total } = countVotes();
    broadcastVs({ type: 'VOTE_TALLY_UPDATE', voted, total });
    maybeSpeedUpVote();
  }

  function submitMyVote() {
    const gens = Array.from(vsMyVoteGens);
    const isRandom = vsMyVoteRandom;
    if (vsIsHost) {
      vsGenVotes[vsPeer.id] = { gens, isRandom };
      broadcastVoteTally();
    } else if (vsHostConn && vsHostConn.open) {
      vsHostConn.send({ type: 'VOTE_SUBMIT', peerId: vsPeer.id, gens, isRandom });
    }
  }

  vsVoteGenButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const g = parseInt(btn.getAttribute('data-vote-gen'), 10);
      vsMyVoteRandom = false;
      if (vsMyVoteGens.has(g)) {
        vsMyVoteGens.delete(g);
      } else if (vsMyVoteGens.size < VS_VOTE_MAX_GENS) {
        vsMyVoteGens.add(g);
      }
      syncVoteButtonsUI();
      submitMyVote();
    });
  });

  vsVoteRandomBtn.addEventListener('click', () => {
    vsMyVoteRandom = !vsMyVoteRandom;   // tap again to undo
    vsMyVoteGens = new Set();
    syncVoteButtonsUI();
    submitMyVote();
  });

  // Shown on every device (host included) the moment a vote opens. Each
  // device runs its own local countdown rather than trusting a shared
  // timestamp, for the same clock-skew reason the round timer does this.
  function applyVoteStart(duration) {
    vsClearBackWindow();
    clearInterval(vsVoteCountdownInterval);
    clearTimeout(vsVoteTimer);
    clearTimeout(vsVoteResultTimer);

    vsMyVoteGens = new Set();
    vsMyVoteRandom = false;
    syncVoteButtonsUI();

    vsLobbyScreen.classList.add('hidden');
    vsGameplayScreen.classList.add('hidden');
    vsGameOverPanel.classList.add('hidden');
    vsVoteScreen.classList.remove('hidden');
    vsVoteResults.classList.add('hidden');
    vsVoteStatus.classList.remove('hidden');
    vsVoteTimerEl.classList.remove('hidden');
    vsVoteTimerEl.classList.remove('urgent', 'fast');

    vsVoteOpen = true;
    vsPhase = 'vote';
    vsGameplayScreen.classList.remove('is-over');
    vsVoteRemain = duration; vsVoteRate = 1; vsVoteClockAt = Date.now();
    runVoteCountdown(duration, 1);
    updateVoteStatus();

    if (vsIsHost) {
      vsVoteTimer = setTimeout(finalizeGenVoteAndStart, duration * 1000);
    }
  }

  function beginGenVote() {
    if (!vsIsHost) return;
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsMatchActive = true;          // lock the room: nobody new can join once a match is under way
    vsSyncPublic();
    vsGenVotes = {};
    Object.values(vsPlayers).forEach(p => { p.ready = false; });
    broadcastVs({ type: 'VOTE_START', duration: VS_VOTE_DURATION_S });
    applyVoteStart(VS_VOTE_DURATION_S);
  }

  // Shown on every device once the vote closes: which generations made the
  // pool, and a per-player breakdown of what everyone actually voted for.
  // Uses textContent throughout (never innerHTML) since player names are
  // untrusted input from other devices.
  function applyVoteResult(payload) {
    vsSelectedGenerations = new Set(
      payload.gens && payload.gens.length ? payload.gens : [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );

    clearInterval(vsVoteCountdownInterval);
    vsVoteOpen = false;
    vsPhase = 'voteresult';
    vsVoteTimerEl.classList.add('hidden');
    vsVoteStatus.classList.add('hidden');

    const gensText = (payload.gens && payload.gens.length === 9)
      ? 'All Generations'
      : `Generations: ${(payload.gens || []).slice().sort((a, b) => a - b).join(', ')}`;

    vsVoteResults.textContent = '';
    const heading = document.createElement('div');
    heading.style.fontWeight = '800';
    heading.style.marginBottom = '6px';
    heading.textContent = gensText;
    vsVoteResults.appendChild(heading);

    (payload.votes || []).forEach(v => {
      const line = document.createElement('div');
      line.textContent = `${v.name}: ${v.label}`;
      vsVoteResults.appendChild(line);
    });

    vsVoteResults.classList.remove('hidden');
  }

  // Host-only: tallies whatever came in and actually starts the match.
  // Tally rule: the pool is the union of every gen anyone voted for -
  // simple and means everyone's pick has a chance of showing up. If
  // everybody voted Random (or nobody voted in time), default to all gens.
  function finalizeGenVoteAndStart() {
    if (!vsIsHost) return;
    clearInterval(vsVoteCountdownInterval);
    clearTimeout(vsVoteTimer);
    vsVoteOpen = false;
    const quick = vsVoteRate > 1;   // everyone was already in, so don't make them sit through a long results screen either

    const unionGens = new Set();
    Object.values(vsGenVotes).forEach(v => {
      if (!v.isRandom) (v.gens || []).forEach(g => unionGens.add(g));
    });
    const finalGens = unionGens.size > 0 ? Array.from(unionGens) : [1, 2, 3, 4, 5, 6, 7, 8, 9];

    const voteSummary = Object.keys(vsPlayers).map(pid => {
      const name = (vsPlayers[pid] && vsPlayers[pid].name) || 'Player';
      const v = vsGenVotes[pid];
      let label;
      if (!v) label = 'Did not vote';
      else if (v.isRandom) label = 'Random';
      else if (!v.gens || v.gens.length === 0) label = 'No pick';
      else label = v.gens.slice().sort((a, b) => a - b).join(', ');
      return { name, label };
    });

    const resultPayload = { gens: finalGens, votes: voteSummary };
    broadcastVs({ type: 'VOTE_RESULT', ...resultPayload });
    applyVoteResult(resultPayload);

    // Give everyone a few seconds to actually read the results before the
    // match launches out from under them.
    vsVoteResultTimer = setTimeout(() => {
      vsRound = 0;
      Object.values(vsPlayers).forEach(p => { p.score = 0; });
      vsModeTitle.textContent = 'Choosing Round Mode...';
      vsRoundLabel.textContent = '';

      vsVoteScreen.classList.add('hidden');
      vsGameOverPanel.classList.add('hidden');
      broadcastVs({ type: 'START_GAME', numRounds: vsNumRounds, players: vsPlayers });
      vsPhase = 'playing';
      vsGameplayScreen.classList.remove('is-over');
      vsGameplayScreen.classList.remove('hidden');
      showVsCountdown();
      clearTimeout(vsStartTimer);
      vsStartTimer = setTimeout(launchVsRound, VS_COUNTDOWN_MS);   // 3-2-1 first, then the wheel
    }, quick ? 2500 : 4000);
  }

  vsStartGameBtn.addEventListener('click', () => {
    if (!vsIsHost || Object.keys(vsPlayers).length < 2) return;
    beginGenVote();
  });
  vsPlayerSlots.addEventListener('click', (e) => {
    const b = e.target.closest('.vs-kick-btn');
    if (!b || !vsIsHost || !vsIsPublic || vsMatchActive) return;
    const pid = b.dataset.kick;
    if (!pid || !vsPlayers[pid] || pid === (vsPeer && vsPeer.id)) return;
    const name = vsPlayers[pid].name;
    const conn = vsClients.find(c => c._vsPeerId === pid);
    delete vsPlayers[pid];
    if (conn) {
      vsClients = vsClients.filter(c => c !== conn);
      try { if (conn.open) conn.send({ type: 'KICKED' }); } catch (er) {}
      setTimeout(() => { try { conn.close(); } catch (er) {} }, 300);
    }
    renderVsLobby();
    broadcastVs(vsLobbyPayload());
    vsToast(name + ' was removed from the room.');
  });
  vsReadyBtn.addEventListener('click', () => {
    if (vsIsHost || !vsPeer || !vsPlayers[vsPeer.id] || !vsHostConn || !vsHostConn.open) return;
    const next = !vsPlayers[vsPeer.id].ready;
    vsPlayers[vsPeer.id].ready = next;   // show it straight away; the host's update confirms it
    renderVsLobby();
    vsHostConn.send({ type: 'READY', ready: next });
  });

  // ---------- inactivity ----------
  // Real input (taps, keys, mouse, touch) = "active". Guests ping the host while active; the host removes anybody it hasn't heard
  // from for VS_IDLE_KICK_MS. The host watches its own input too: an idle host leaves, and the next player in line takes over.
  function vsNoteInput() { vsLastInput = Date.now(); vsInputSinceSend = true; vsIdleWarned = false; }
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, vsNoteInput, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) vsNoteInput(); });

  function vsKickIdle(conn) {
    const pid = conn._vsPeerId, name = pid && vsPlayers[pid] ? vsPlayers[pid].name : 'A player';
    try { if (conn.open) conn.send({ type: 'KICKED', reason: 'idle' }); } catch (e) {}
    setTimeout(() => { try { conn.close(); } catch (e) {} }, 300);
    vsDropPlayer(conn);
    vsToast(name + ' was removed for being inactive.');
  }

  setInterval(() => {
    if (!vsInRoom || vsLeaving || !vsPeer) return;
    const now = Date.now();
    if (!vsIsHost && vsHostConn && vsHostConn.open && vsInputSinceSend) { try { vsHostConn.send({ type: 'ACTIVE' }); } catch (e) {} vsInputSinceSend = false; }
    const idle = now - vsLastInput;
    if (idle >= VS_IDLE_WARN_MS && !vsIdleWarned) { vsIdleWarned = true; vsToast('Still there? Tap or move to stay in the room - inactive players get removed.'); }
    if (!vsIsHost) return;
    if (idle >= VS_IDLE_KICK_MS) { vsSetNotice('You were removed from the room for being inactive.'); leaveVsRoom(); return; }
    vsClients.slice().forEach(c => {
      const id = c._vsPeerId;
      if (!id || !vsPlayers[id]) return;
      const last = vsLastSeen[id] || (vsLastSeen[id] = now);
      if (now - last >= VS_IDLE_KICK_MS) vsKickIdle(c);
    });
  }, VS_ACTIVE_PING_MS);

  // ---------- host leaves -> the player who has been here longest takes over ----------
  // Every device holds the same player list (it is re-sent on every change) and every player carries the time they joined,
  // so when the host disappears (they left, closed the tab, or crashed) every guest works out the same successor on its own.
  function vsEndRoomHard(msg) {
    if (vsLeaving) return;
    vsLeaving = true;
    clearTimeout(vsMigTimer);
    vsToast(msg);
    setTimeout(() => { location.hash = '#versus'; location.reload(); }, 1800);
  }
  function vsHostPlayerId() {
    const e = Object.entries(vsPlayers).find(([, p]) => p.slot === 0);
    return e ? e[0] : null;
  }
  function vsHostGone() {
    if (vsIsHost || vsLeaving || vsMigrating) return;
    if (!vsInRoom || !vsPeer || !vsPlayers[vsPeer.id]) { vsEndRoomHard('The host left the room, so the game has ended.'); return; }
    const oldId = vsHostPlayerId();
    if (oldId) delete vsPlayers[oldId];
    const order = Object.entries(vsPlayers)
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[1].slot - b[1].slot).map(([id]) => id);
    if (!order.length) { vsEndRoomHard('The host left the room, so the game has ended.'); return; }
    vsMigrating = true;
    vsTryHost(order, 0, 0);
  }
  // Try to reach order[i]. Up to 4 attempts (they may not have noticed the host is gone yet), then on to the next in line.
  function vsTryHost(order, i, attempt) {
    clearTimeout(vsMigTimer);
    if (vsLeaving || !vsMigrating) return;
    const id = order[i];
    if (!id) { vsMigrating = false; vsEndRoomHard('Could not find a new host, so the room has ended.'); return; }
    if (id === vsPeer.id) { vsBecomeHost(); return; }
    if (attempt === 0) { const p = vsPlayers[id]; vsToast((p ? p.name : 'Someone') + ' is taking over as host...'); }
    let conn, used = false;
    try { conn = vsPeer.connect(id, { reliable: true }); } catch (e) { delete vsPlayers[id]; vsTryHost(order, i + 1, 0); return; }
    vsHostConn = conn;
    setupVsConnection(conn);
    vsMigSkip = () => {   // this attempt didn't work
      if (used || vsHostConn !== conn || !vsMigrating) return;
      used = true;
      try { conn.close(); } catch (e) {}
      if (attempt < 3) vsTryHost(order, i, attempt + 1);
      else { delete vsPlayers[id]; vsTryHost(order, i + 1, 0); }
    };
    vsMigDrop = () => {   // that player is gone for good
      if (used || vsHostConn !== conn || !vsMigrating) return;
      used = true;
      try { conn.close(); } catch (e) {}
      delete vsPlayers[id];
      vsTryHost(order, i + 1, 0);
    };
    vsMigTimer = setTimeout(vsMigSkip, VS_MIGRATE_TRY_MS);
  }
  // Take over as host with the room exactly as it was (same players, scores, rounds)
  function vsBecomeHost() {
    clearTimeout(vsMigTimer);
    vsMigrating = false; vsMigSkip = null; vsMigDrop = null;
    const myId = vsPeer.id, me = vsPlayers[myId];
    if (!me) { vsEndRoomHard('Could not take over the room, so it has ended.'); return; }
    vsStopMatchTimers();
    vsIsHost = true; vsHostConn = null; vsClients = [];
    vsMatchActive = vsPhase !== 'lobby';
    me.slot = 0; me.ready = true;                       // the old host's slot 0 is free now
    const now = Date.now();
    Object.keys(vsPlayers).forEach(id => { vsLastSeen[id] = now; });
    vsLobbyRef = null;                                  // publish a fresh public row (if the room is public) once everyone is back
    vsRoundsSelector.classList.remove('hidden');
    if (!vsPeer._pbListening) { vsPeer.on('connection', acceptConnection); vsPeer._pbListening = true; }
    vsClaimRoomCode(0);                                 // so the 4-digit code / invite link keeps working
    vsAwaiting = new Set(Object.keys(vsPlayers).filter(id => id !== myId));
    vsPlayAgainBtn.classList.toggle('hidden', vsPhase !== 'over');
    if (vsPhase === 'over') vsStartBackWindow();
    vsToast("The host left - you're the host now!");
    if (vsPhase === 'playing') vsSetBlocked(true, 'New host taking over...');
    renderVsLobby();
    if (!vsAwaiting.size) vsResume();
    else vsReconnectTimer = setTimeout(vsResume, VS_RECONNECT_WAIT_MS);
  }
  // A second PeerJS peer whose id is the old room code, so people can still join by code. The old host's id can take a few
  // seconds to be released by the PeerJS server, so retry for a while.
  function vsClaimRoomCode(attempt) {
    if (!vsIsHost || vsLeaving || typeof Peer === 'undefined' || !vsRoomCode) return;
    const rp = new Peer(VS_PEER_PREFIX + vsRoomCode);
    vsRoomPeer = rp;
    rp.on('connection', acceptConnection);
    rp.on('error', (err) => {
      if (err.type !== 'unavailable-id') return;
      try { rp.destroy(); } catch (e) {}
      if (vsRoomPeer === rp) vsRoomPeer = null;
      if (attempt < 12) setTimeout(() => vsClaimRoomCode(attempt + 1), 1500);
    });
  }
  // New host: everybody who is coming back has reconnected (or time ran out) -> carry on from where the room was
  function vsResume() {
    clearTimeout(vsReconnectTimer); vsReconnectTimer = null;
    if (!vsIsHost || vsLeaving) return;
    if (vsAwaiting) { vsAwaiting.forEach(id => { delete vsPlayers[id]; delete vsLastSeen[id]; }); vsAwaiting = null; }   // never came back
    renderVsLobby();
    broadcastVs(vsLobbyPayload());
    vsPruneBars();
    vsSyncPublic();
    if (vsPhase === 'lobby' || vsPhase === 'over') return;
    if (Object.keys(vsPlayers).length < 2) { endVsGame('alone'); return; }
    if (vsPhase === 'vote' || vsPhase === 'voteresult') { beginGenVote(); return; }   // run the vote again
    clearTimeout(vsStartTimer);
    vsStartTimer = setTimeout(() => {   // mid-match: a finished round moves on to the next one, a live round starts over
      if (!vsIsHost || vsLeaving) return;
      if (vsRoundLocked) advanceVsRound();
      else { if (vsRound > 0) vsRound--; launchVsRound(); }
    }, 1200);
  }

  // ---- Round lifecycle (host drives it) ----

  // Downloads an image ahead of time and resolves when it's loaded, failed, or
  // maxMs has passed (never rejects, never hangs). crossOrigin matches what
  // applyStartRound uses, so the browser reuses this copy.
  function vsPreloadImage(url, maxMs) {
    return new Promise((resolve) => {
      if (!url) { resolve(); return; }
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = finish;
      img.onerror = finish;
      timer = setTimeout(finish, maxMs);
      img.src = url;
    });
  }

  function launchVsRound() {
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    clearTimeout(vsRoundTimeoutTimer);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;
    vsRoundTimeoutTimer = null;

    vsRound++;
    const chosenMode = VS_REVEAL_MODES[Math.floor(Math.random() * VS_REVEAL_MODES.length)];
    const isShiny = Math.random() < VS_SHINY_CHANCE;

    broadcastVs({ type: 'VS_SPIN_START', targetMode: chosenMode });

    // Pick the Pokémon and download its artwork WHILE the wheel is spinning,
    // instead of only after it stops. Before, the host spun for ~4s, THEN
    // waited on PokéAPI, THEN told everyone to start - so guests sat on a
    // blank screen after their own wheel finished. Now the round data is
    // normally ready the moment the wheel stops.
    const roundDataPromise = (async () => {
      const fallbackPkmn = { rawName:'pikachu', displayName:'Pikachu', image:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' };
      let pkmnData;
      try {
        pkmnData = typeof fetchRandomPokemonWithArtwork === 'function'
          ? await fetchRandomPokemonWithArtwork(isShiny, vsSelectedGenerations, 10000)
          : fallbackPkmn;
      } catch (e) {
        // A PokeAPI hiccup used to throw here and silently kill the round
        // for every player, with nothing shown on screen. Fall back instead
        // of failing the whole round.
        console.error('Failed to fetch a Pokémon for this round, using fallback:', e);
        pkmnData = fallbackPkmn;
      }
      broadcastVs({ type: 'VS_PRELOAD', image: pkmnData.image });
      await vsPreloadImage(pkmnData.image, 8000);
      return pkmnData;
    })();

    spinVsWheel(chosenMode, async () => {
      const pkmnData = await roundDataPromise;

      const payload = {
        type: 'START_ROUND',
        round: vsRound,
        revealMode: chosenMode,
        pokemon: pkmnData,
        isShiny,
        startTime: Date.now() + 600,
        numRounds: vsNumRounds
      };

      broadcastVs(payload);
      applyStartRound(payload);
    });
  }

  // The fixed top bar can be taller than the page's 56px offset on phones (the tabs wrap), which would hide the top of the wheel under it.
  // Measure it and nudge the wheel down just enough to clear it.
  function vsClearWheelOfHeader() {
    const hd = document.querySelector('.top-header');
    vsWheelOverlay.style.marginTop = '';
    if (!hd || getComputedStyle(hd).position !== 'fixed') return;
    const gap = hd.getBoundingClientRect().bottom + 8 - vsWheelOverlay.getBoundingClientRect().top;
    if (gap > 0) vsWheelOverlay.style.marginTop = Math.ceil(gap) + 'px';
  }
  // ---- Wheel with pointer, winner highlight, and audio ----
  function spinVsWheel(targetMode, callback) {
    if (vsSpinCancel) vsSpinCancel(); // never run two wheels at once
    hideVsCountdown();
    vsWheelOverlay.classList.remove('hidden');
    requestAnimationFrame(() => { window.scrollTo(0, 0); vsClearWheelOfHeader(); vsScheduleFit(true); });   // wheel + race board are right at the top, no scrolling needed

    // Hide the "Next round in X..." message while the wheel is on screen.
    if (vsWaitingNextMsg) vsWaitingNextMsg.classList.add('hidden');

    const ctx = wheelCanvas.getContext('2d');
    const W = 280, R = 120, cx = 140, cy = 140;
    const numSlices = VS_REVEAL_MODES.length;
    const sliceAngle = (2 * Math.PI) / numSlices;
    const colors = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#2ecc71', '#e67e22', '#1abc9c', '#e84393'];

    const targetIdx = VS_REVEAL_MODES.indexOf(targetMode);
    const fullSpins = 5;
    const targetAngle = (2 * Math.PI) - (targetIdx + 0.5) * sliceAngle;
    const finalAngle = fullSpins * 2 * Math.PI + targetAngle;

    // IMPORTANT: finishing the spin (which is what lets the host send
    // START_ROUND) is driven by setTimeout, NOT by requestAnimationFrame.
    // Browsers stop animation frames entirely in a background tab, so when the
    // animation loop decided "the wheel is done", a host whose tab was in the
    // background (e.g. testing with two tabs, or a phone host who switched
    // app) never started the round - everyone waited until the host looked at
    // the screen again. requestAnimationFrame now only draws the spinning.
    const SPIN_MS = 3000;
    const spinStart = performance.now();
    let finished = false;
    let spinTimer = null;
    let hideTimer = null;
    let spinDone = false;
    let lastTickIdx = 0;
    wheelResultText.textContent = 'Spinning...';

    playVsTone(220, 0.18, 'sawtooth', 0.05);
    playVsTone(440, 0.30, 'sine', 0.04, 0.05);

    function drawWheel(angle) {
      ctx.clearRect(0, 0, W, W);

      for (let i = 0; i < numSlices; i++) {
        const a0 = angle - Math.PI / 2 + i * sliceAngle;
        const a1 = a0 + sliceAngle;

        const isWinner = spinDone && i === targetIdx;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = isWinner ? '#ffcb05' : colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = '#1a262c';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a0 + sliceAngle / 2);
        ctx.fillStyle = isWinner ? '#1a262c' : '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(VS_REVEAL_MODES[i], R - 10, 0);
        ctx.restore();
      }

      // Pointer triangle at 12 o'clock
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 4);
      ctx.lineTo(cx - 12, cy - R - 16);
      ctx.lineTo(cx + 12, cy - R - 16);
      ctx.closePath();
      ctx.fillStyle = '#ff4757';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (!spinDone) {
        const tickIdx = Math.floor(angle / sliceAngle);
        if (tickIdx !== lastTickIdx) {
          lastTickIdx = tickIdx;
          playVsTone(1300, 0.022, 'square', 0.035);
        }
      }
    }

    function finishSpin() {
      if (finished) return;
      finished = true;
      spinDone = true;
      drawWheel(finalAngle);
      wheelResultText.textContent = `Mode: ${targetMode}!`;

      playVsTone(523.25, 0.14, 'sine', 0.14, 0);
      playVsTone(659.25, 0.14, 'sine', 0.14, 0.10);
      playVsTone(783.99, 0.30, 'sine', 0.16, 0.20);

      hideTimer = setTimeout(() => {
        vsSpinCancel = null;
        vsWheelOverlay.classList.add('hidden');
        if (callback) callback();
      }, 1000);
    }

    // Lets applyStartRound() (or a newer spin) stop this one cleanly, so a
    // late-finishing wheel can't play its sounds over the start of a round.
    vsSpinCancel = () => {
      finished = true;
      clearTimeout(spinTimer);
      clearTimeout(hideTimer);
      vsSpinCancel = null;
    };

    function animate() {
      if (finished) return;
      const elapsed = performance.now() - spinStart;
      if (elapsed >= SPIN_MS) return; // the timer below finishes the spin
      const progress = elapsed / SPIN_MS;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      drawWheel(easeOut * finalAngle);
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    spinTimer = setTimeout(finishSpin, SPIN_MS);
  }

  function showVsWheelDuringSpin(targetMode) {
    spinVsWheel(targetMode, null);
  }

  function applyStartRound(payload) {
    if (vsSpinCancel) vsSpinCancel();
    vsWheelOverlay.classList.add('hidden');
    clearTimeout(vsRoundTimeoutTimer);
    vsRoundTimeoutTimer = null;

    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;

    vsPhase = 'playing';
    vsGameplayScreen.classList.remove('is-over');
    vsRound = payload.round;
    vsAnswer = payload.pokemon;
    vsIsShinyRound = payload.isShiny;
    vsCurrentRevealMode = payload.revealMode;
    // Deliberately NOT payload.startTime here. That's an absolute timestamp
    // taken from the host's Date.now() - if this device's system clock
    // differs from the host's (very common: phones/laptops drift, or have
    // auto-time off), "now - payload.startTime" can be negative or huge,
    // which clamps to 0 and gets a player stuck at max blur for the whole
    // round while always scoring near-max points. Measuring from the local
    // moment this device received the round makes every device's timing
    // self-consistent regardless of what anyone's clock says.
    vsRoundStartTime = Date.now();
    if (vsIsHost) {
      // The "nobody got it" timeout used to fire only from the animation loop
      // (startVsRevealLoop), which doesn't run in a background tab - a hidden
      // host tab left the round hanging forever. A plain timer always fires;
      // handleRoundTimeout() ignores it if the round was already solved.
      vsRoundTimeoutTimer = setTimeout(() => { handleRoundTimeout(); }, VS_REVEAL_DURATION + 250);
    }
    vsRoundLocked = false;
    vsGuessLocked = false;
    vsPixelBuffer = null;
    vsTileOrder = null;
    vsScrambleOffsets = null;
    vsScaledSprite = null;
    vsRevealCanvas.style.filter = 'none';

    vsShinyBanner.classList.remove('flash-fade');
    if (vsIsShinyRound) {
      vsShinyBanner.classList.remove('hidden');
      requestAnimationFrame(() => {
        vsShinyBanner.classList.add('flash-fade');
      });
      setTimeout(() => {
        vsShinyBanner.classList.add('hidden');
      }, 1500);
    } else {
      vsShinyBanner.classList.add('hidden');
    }

    vsModeTitle.textContent = `Round ${vsRound} - Reveal Mode: ${vsCurrentRevealMode}`;
    vsRoundLabel.textContent = `Round ${vsRound} / ${vsNumRounds}`;
    clearTimeout(vsPenaltyTimer);
    clearInterval(vsPenaltyTimer);
    vsResultMessage.textContent = '';
    vsRoundOverPanel.classList.add('hidden');
    vsWaitingNextMsg.classList.add('hidden');
    vsGuessInput.value = '';
    vsSearchWrapper.classList.remove('hidden');
    vsSetBlocked(false);
    vsFocusGuess();
    setTimeout(vsFocusGuess, 150);
    vsScheduleFit(true);

    vsPokemonImage.classList.add('hidden');
    vsRevealCanvas.classList.remove('hidden');
    vsImageOverlay.classList.add('visible');
    playVsRoundStartSound();

    renderVsLeaderboard();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      vsImageOverlay.classList.remove('visible');
      if (!vsRoundLocked) startVsRevealLoop(img);
    };
    img.onerror = () => {
      vsImageOverlay.classList.remove('visible');
      if (!vsRoundLocked) startVsRevealLoop(img);
    };
    img.src = vsAnswer.image;
  }

  function startVsRevealLoop(img) {
    if (vsAnimFrame) cancelAnimationFrame(vsAnimFrame);

    function renderLoop() {
      const now = Date.now();
      const elapsed = Math.min(Math.max(now - vsRoundStartTime, 0), VS_REVEAL_DURATION);
      const progress = elapsed / VS_REVEAL_DURATION;

      if (!vsRoundLocked) {
        try { renderVsCanvas(img, vsCurrentRevealMode, progress); } catch (e) {}
        updateVsRaceBars(progress);
      }

      if (vsRoundLocked) return;

      if (progress < 1.0) {
        vsAnimFrame = requestAnimationFrame(renderLoop);
      } else if (vsIsHost) {
        handleRoundTimeout();
      }
    }
    vsAnimFrame = requestAnimationFrame(renderLoop);
  }

  function renderVsCanvas(img, mode, progress) {
    const ctx = vsRevealCanvas.getContext('2d');
    const w = 280, h = 280;
    ctx.clearRect(0, 0, w, h);

    if (mode === 'Classic Blur') {
      vsRevealCanvas.style.filter = `blur(${(1 - progress) * 20}px)`;
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }

    if (mode === 'Color Drain') {
      vsRevealCanvas.style.filter = `grayscale(${Math.round((1 - progress) * 100)}%)`;
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }

    vsRevealCanvas.style.filter = 'none';

    if (mode === 'Pixelation') {
      const factor = 0.02 + progress * 0.98;
      const sw = Math.max(4, Math.floor(w * factor));
      const sh = Math.max(4, Math.floor(h * factor));

      if (!vsPixelBuffer) vsPixelBuffer = document.createElement('canvas');
      vsPixelBuffer.width = sw;
      vsPixelBuffer.height = sh;
      const bctx = vsPixelBuffer.getContext('2d');
      bctx.imageSmoothingEnabled = true;
      bctx.clearRect(0, 0, sw, sh);
      bctx.drawImage(img, 0, 0, sw, sh);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(vsPixelBuffer, 0, 0, sw, sh, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;

    } else if (mode === 'Tile Reveal') {
      ctx.drawImage(img, 0, 0, w, h);
      const gridSize = 8;
      const tileSize = w / gridSize;
      const totalTiles = gridSize * gridSize;

      if (!vsTileOrder || vsTileOrder.length !== totalTiles) {
        vsTileOrder = [...Array(totalTiles).keys()];
        for (let i = vsTileOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [vsTileOrder[i], vsTileOrder[j]] = [vsTileOrder[j], vsTileOrder[i]];
        }
      }

      const visibleCount = Math.floor(progress * totalTiles);
      const revealed = new Set(vsTileOrder.slice(0, visibleCount));

      ctx.fillStyle = '#222e35';
      for (let i = 0; i < totalTiles; i++) {
        if (!revealed.has(i)) {
          const tx = (i % gridSize) * tileSize;
          const ty = Math.floor(i / gridSize) * tileSize;
          ctx.fillRect(tx, ty, tileSize, tileSize);
        }
      }

    } else if (mode === 'Silhouette') {
      ctx.drawImage(img, 0, 0, w, h);
      if (progress < 1.0) {
        const imgData = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < imgData.data.length; i += 4) {
          if (imgData.data[i + 3] > 20) {
            const v = Math.floor(progress * 255);
            imgData.data[i] = Math.min(imgData.data[i], v);
            imgData.data[i + 1] = Math.min(imgData.data[i + 1], v);
            imgData.data[i + 2] = Math.min(imgData.data[i + 2], v);
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }

    } else if (mode === 'Zoom Out') {
      const zoom = 4 - 3 * progress;
      const dw = w * zoom;
      const dh = h * zoom;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();

    } else if (mode === 'Scramble') {
      const gridSize = 4;
      const tileSize = w / gridSize;
      const totalTiles = gridSize * gridSize;

      if (!vsScaledSprite) {
        vsScaledSprite = document.createElement('canvas');
        vsScaledSprite.width = w;
        vsScaledSprite.height = h;
        const sctx = vsScaledSprite.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(img, 0, 0, w, h);
      }

      if (!vsScrambleOffsets || vsScrambleOffsets.length !== totalTiles) {
        vsScrambleOffsets = [];
        for (let i = 0; i < totalTiles; i++) {
          vsScrambleOffsets.push({
            ox: (Math.random() - 0.5) * 3,
            oy: (Math.random() - 0.5) * 3
          });
        }
      }

      const spread = Math.max(0, 1 - progress * 1.05);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;

      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const i = gy * gridSize + gx;
          const off = vsScrambleOffsets[i];
          const dx = gx * tileSize + off.ox * tileSize * spread;
          const dy = gy * tileSize + off.oy * tileSize * spread;
          ctx.drawImage(
            vsScaledSprite,
            gx * tileSize, gy * tileSize, tileSize, tileSize,
            dx, dy, tileSize, tileSize
          );
        }
      }
      ctx.restore();

    } else if (mode === 'Spotlight') {
      ctx.drawImage(img, 0, 0, w, h);

      if (!vsSpotlightBuffer) vsSpotlightBuffer = document.createElement('canvas');
      vsSpotlightBuffer.width = w;
      vsSpotlightBuffer.height = h;
      const sctx = vsSpotlightBuffer.getContext('2d');
      sctx.clearRect(0, 0, w, h);
      sctx.fillStyle = '#12191d';
      sctx.fillRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      // 1.2x the corner distance so the reveal comfortably covers the
      // whole canvas (feathered edge included) by the time progress hits 1,
      // rather than leaving a faint vignette in the corners.
      const maxRadius = Math.hypot(w, h) / 2 * 1.2;
      const feather = 40;
      const radius = 18 + progress * (maxRadius - 18);

      sctx.globalCompositeOperation = 'destination-out';
      const grad = sctx.createRadialGradient(cx, cy, Math.max(0, radius - feather), cx, cy, radius);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.arc(cx, cy, radius, 0, Math.PI * 2);
      sctx.fill();
      sctx.globalCompositeOperation = 'source-over';

      ctx.drawImage(vsSpotlightBuffer, 0, 0);
    }
  }

  function updateVsRaceBars(progress) {
    document.querySelectorAll('.vs-progress-fill:not(.finished)').forEach(el => {
      el.style.width = `${Math.floor(progress * 100)}%`;
    });
  }

  function renderVsLeaderboard() {
    vsPlayerBars.innerHTML = '';
    const sorted = Object.entries(vsPlayers).sort((a, b) => b[1].score - a[1].score);
    sorted.forEach(([id, p]) => {
      const wrapper = document.createElement('div');
      const isYou = !!(vsPeer && id === vsPeer.id);
      wrapper.className = 'vs-player-bar-wrapper' + (isYou ? ' is-you' : '');
      wrapper.dataset.peerId = id;
      // Host is marked with a little crown on the avatar (a text tag used to eat the space the name needs)
      const av = p.slot === 0 ? `<span class="vs-host-wrap" title="Host">${vsAvatarHTML(p.av, 'sm')}<i class="vs-host-crown" aria-label="Host">\u{1F451}</i></span>` : vsAvatarHTML(p.av, 'sm');
      wrapper.innerHTML = `
        <div class="vs-player-bar-label">
          <span class="vs-lb-name">${av}<span>${escapeHtml(p.name)}</span></span>
          <span>${p.score} pts</span>
        </div>
        <div class="vs-progress-track">
          <div class="vs-progress-fill" style="width: 0%"></div>
        </div>
      `;
      vsPlayerBars.appendChild(wrapper);
    });
  }

  // ---------- focus + keyboard handling ----------
  // The guess box is NEVER disabled or blurred during a match - it is just "blocked" (input ignored, dimmed).
  // That keeps the phone keyboard open between rounds, which is the only reliable way to keep typing on iOS Safari
  // (iOS only opens the keyboard when focus() is called inside a real tap, or while the keyboard is already up).
  const vsCoarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const vsRoot = document.documentElement;
  const vv = window.visualViewport;
  let vsBlocked = false;
  let vsBaseH = window.innerHeight, vsFitRaf = 0, vsFitBlurTimer = 0;
  vsGuessInput.setAttribute('autocapitalize', 'none');
  vsGuessInput.setAttribute('autocorrect', 'off');
  vsGuessInput.setAttribute('spellcheck', 'false');
  vsGuessInput.setAttribute('enterkeyhint', 'go');
  vsGuessInput.setAttribute('inputmode', 'text');

  function vsSetBlocked(b, placeholder) {
    vsBlocked = b;
    vsGuessInput.classList.toggle('blocked', b);
    vsGuessInput.setAttribute('aria-disabled', b ? 'true' : 'false');
    vsGuessInput.placeholder = b ? (placeholder || 'Hang on...') : 'Type a Pokémon name...';
    if (b) { vsGuessInput.value = ''; vsSuggestions.innerHTML = ''; }
  }
  function vsGuessVisible() {
    return !vsGameplayScreen.classList.contains('hidden') && !vsSearchWrapper.classList.contains('hidden');
  }
  function vsFocusGuess() {
    if (!vsGuessVisible() || document.activeElement === vsGuessInput) return;
    try { vsGuessInput.focus({ preventScroll: true }); } catch (e) { vsGuessInput.focus(); }
  }
  // Any tap on the match screen (outside buttons) puts you back in the box - this is also what opens the keyboard
  // the first time on iOS, because it happens inside a real touch event.
  function vsMatchTap(e) {
    if (!vsGuessVisible()) return;
    if (e.target.closest && e.target.closest('button, a, input, .suggestion-item')) return;
    vsFocusGuess();
  }
  vsGameplayScreen.addEventListener('touchend', vsMatchTap, { passive: true });
  vsGameplayScreen.addEventListener('click', vsMatchTap);
  // Desktop: just start typing anywhere
  document.addEventListener('keydown', (e) => {
    if (!vsGuessVisible() || e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1) return;
    const t = document.activeElement;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    vsFocusGuess();
  });

  // Phone keyboard: shrink the image so it stays visible, and keep the suggestion list inside the visible area.
  // The list always opens BELOW the box (it never flips up over the image); it just gets a scrollable max height.
  const VS_WANT_SUG_PX = 140, VS_MIN_SCALE = 0.3;   // room kept under the box for suggestions (about 3 rows) / smallest the picture may shrink to
  let vsFitWantScroll = false, vsKbWasOpen = false;   // only move the page when asked to (keyboard just opened / new round / wheel start), never on a plain swipe
  function vsFitKeyboard() {
    vsFitRaf = 0;
    const doScroll = vsFitWantScroll; vsFitWantScroll = false;
    const focused = document.activeElement === vsGuessInput && !vsGameplayScreen.classList.contains('hidden');
    if (!vv || !vsCoarse || !focused) { vsRoot.classList.remove('vs-kb-open'); vsKbWasOpen = false; return; }
    const open = vsBaseH - vv.height > 100;
    const justOpened = open && !vsKbWasOpen;
    vsKbWasOpen = open;
    vsRoot.classList.toggle('vs-kb-open', open);
    if (!open) return;
    const wrap = vsGameplayScreen.querySelector('.image-wrapper');
    const h = (wrap && wrap.offsetHeight) || 250;
    let k = Math.max(0.3, Math.min(1, (vv.height - 330) / h));   // first guess; the loop below then measures and shrinks further if the list is still squeezed
    vsRoot.style.setProperty('--vs-h', h + 'px');
    vsRoot.style.setProperty('--vs-scale', k.toFixed(3));
    requestAnimationFrame(() => {
      const wheelUp = !vsWheelOverlay.classList.contains('hidden');
      if (wheelUp) vsClearWheelOfHeader();
      const head = wheelUp ? vsWheelOverlay : (vsGameplayScreen.querySelector('.game-header') || wrap);   // wheel spinning: keep the wheel in view
      const toTop = () => { if (head && (doScroll || justOpened)) window.scrollTo(0, Math.max(0, head.getBoundingClientRect().top + window.scrollY - 6)); };
      toTop();
      vsRoot.style.setProperty('--vs-vv-top', vv.offsetTop + 'px');
      if (wheelUp) return;
      // Measure the REAL room under the box (after the page has scrolled) and shrink the picture until about 3 suggestions fit.
      const roomBelow = () => vv.offsetTop + vv.height - vsGuessInput.getBoundingClientRect().bottom - 8;
      for (let i = 0; i < 10 && roomBelow() < VS_WANT_SUG_PX && k > VS_MIN_SCALE; i++) {
        k = Math.max(VS_MIN_SCALE, k * 0.88);
        vsRoot.style.setProperty('--vs-scale', k.toFixed(3));
        toTop();
      }
      vsRoot.style.setProperty('--vs-sug-max', Math.max(96, Math.min(240, roomBelow())) + 'px');
    });
  }
  const vsScheduleFit = (scroll) => { if (scroll === true) vsFitWantScroll = true; if (!vsFitRaf) vsFitRaf = requestAnimationFrame(vsFitKeyboard); };
  vsGuessInput.addEventListener('focus', () => { clearTimeout(vsFitBlurTimer); vsScheduleFit(true); setTimeout(() => vsScheduleFit(true), 300); });
  vsGuessInput.addEventListener('blur', () => { vsFitBlurTimer = setTimeout(() => { vsRoot.classList.remove('vs-kb-open'); }, 250); });
  vsGuessInput.addEventListener('input', () => setTimeout(() => vsScheduleFit(false), 0));
  if (vv) {
    vv.addEventListener('resize', () => { if (document.activeElement !== vsGuessInput) vsBaseH = Math.max(vsBaseH, window.innerHeight); vsScheduleFit(false); });
    vv.addEventListener('scroll', () => vsScheduleFit(false));   // swiping must never trigger a scroll-back
  }
  window.addEventListener('orientationchange', () => { vsBaseH = window.innerHeight; });

  // ---------- 3-2-1 before round 1 ----------
  function showVsCountdown() {
    clearInterval(vsCountTimer);
    vsCountPlayers.innerHTML = Object.values(vsPlayers).sort((a, b) => a.slot - b.slot)
      .map(p => `<div class="vs-count-player">${vsAvatarHTML(p.av, 'lg')}<span>${escapeHtml(p.name)}</span></div>`).join('');
    vsSearchWrapper.classList.remove('hidden');
    vsSetBlocked(true, 'Get ready...');
    vsFocusGuess();
    vsCountSub.textContent = (vsCoarse && document.activeElement !== vsGuessInput) ? 'Tap anywhere to open the keyboard' : 'Get ready!';
    vsCountdown.classList.remove('hidden');
    let n = 3;
    const show = (v, f) => {
      vsCountNum.textContent = v;
      vsCountNum.classList.remove('tick'); void vsCountNum.offsetWidth; vsCountNum.classList.add('tick');
      playVsTone(f, 0.12, 'sine', 0.1);
    };
    show(n, 440);
    vsCountTimer = setInterval(() => {
      n--;
      if (n > 0) show(n, 440);
      else { clearInterval(vsCountTimer); vsCountTimer = null; show('GO!', 880); }
    }, 1000);
  }
  function hideVsCountdown() {
    clearInterval(vsCountTimer); vsCountTimer = null;
    vsCountdown.classList.add('hidden');
  }

  vsGuessInput.addEventListener('input', () => {
    if (vsBlocked) { vsGuessInput.value = ''; vsSuggestions.innerHTML = ''; return; }
    if (typeof setupAutocomplete === 'function') {
      setupAutocomplete(vsGuessInput, vsSuggestions, handleVsGuess);
    }
  });
  if (typeof attachAutocompleteKeyboardNav === 'function') {
    attachAutocompleteKeyboardNav(vsGuessInput, vsSuggestions);
  }

  function handleVsGuess(guessedPkmn) {
    if (vsGuessLocked || !vsAnswer || vsBlocked) return;
    vsSuggestions.innerHTML = '';
    vsGuessInput.value = '';

    if (guessedPkmn.rawName === vsAnswer.rawName) {
      vsGuessLocked = true;
      vsSetBlocked(true, 'Nice! Waiting for the result...');
      const elapsedMs = Date.now() - vsRoundStartTime;
      if (typeof playCorrectSound === 'function') playCorrectSound();
      vsResultMessage.style.color = '#4cd137';
      vsResultMessage.textContent = 'Got it! Confirming...';

      if (vsIsHost) {
        handleCorrectGuess(vsPeer.id, elapsedMs);
      } else if (vsHostConn) {
        vsHostConn.send({ type: 'CORRECT_GUESS', peerId: vsPeer.id, elapsedMs });
      }
    } else {
      if (typeof playWrongSound === 'function') playWrongSound();
      applyVsWrongGuessPenalty(guessedPkmn.displayName);
    }
  }

  function applyVsWrongGuessPenalty(wrongName) {
    vsSetBlocked(true, 'Wrong - hold on...');
    vsFocusGuess();
    let remaining = Math.ceil(VS_WRONG_PENALTY_MS / 1000);
    vsResultMessage.style.color = '#ff4757';
    vsResultMessage.textContent = `Wrong - not ${wrongName}. Try again in ${remaining}s...`;

    clearInterval(vsPenaltyTimer);
    vsPenaltyTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(vsPenaltyTimer);
        if (!vsGuessLocked) {
          vsSetBlocked(false);
          vsFocusGuess();
          vsResultMessage.style.color = '#d0d7de';
          vsResultMessage.textContent = 'Back in it - take another guess!';
        }
      } else {
        vsResultMessage.textContent = `Wrong - not ${wrongName}. Try again in ${remaining}s...`;
      }
    }, 1000);
  }

  function handleCorrectGuess(peerId, clientElapsedMs) {
    if (!vsIsHost || vsRoundLocked || vsAwaiting) return;   // (a freshly promoted host ignores guesses until everyone has reconnected and the round restarts)
    vsRoundLocked = true;

    // Evaluate host timestamp against client's reported elapsed time to prevent latency issues.
    // Only trust the client's number if it's within a reasonable margin of what the host itself
    // measured - otherwise a modified client could just always report elapsedMs: 0 for free
    // max-points wins. Anything further off falls back to the host's own timer.
    const hostElapsedMs = Date.now() - vsRoundStartTime;
    const CLIENT_TIME_TOLERANCE_MS = 1500;
    const elapsedMs = (clientElapsedMs !== undefined && Math.abs(clientElapsedMs - hostElapsedMs) <= CLIENT_TIME_TOLERANCE_MS)
      ? clientElapsedMs
      : hostElapsedMs;

    const clamped = Math.max(0, Math.min(elapsedMs, VS_REVEAL_DURATION));
    const points = Math.round(VS_MAX_POINTS - (VS_MAX_POINTS - VS_MIN_POINTS) * (clamped / VS_REVEAL_DURATION));
    if (vsPlayers[peerId]) vsPlayers[peerId].score += points;

    const payload = {
      type: 'ROUND_RESULT',
      round: vsRound,
      winnerId: peerId,
      winnerName: vsPlayers[peerId] ? vsPlayers[peerId].name : 'A player',
      points,
      answerDisplayName: vsAnswer.displayName,
      isShiny: vsIsShinyRound,
      players: vsPlayers,
      noWinner: false
    };
    broadcastVs(payload);
    applyRoundResult(payload);
  }

  function handleRoundTimeout() {
    if (!vsIsHost || vsRoundLocked) return;
    vsRoundLocked = true;

    const payload = {
      type: 'ROUND_RESULT',
      round: vsRound,
      winnerId: null,
      winnerName: null,
      points: 0,
      answerDisplayName: vsAnswer.displayName,
      isShiny: vsIsShinyRound,
      players: vsPlayers,
      noWinner: true
    };
    broadcastVs(payload);
    applyRoundResult(payload);
  }

  function applyRoundResult(payload) {
    vsRoundLocked = true;
    vsGuessLocked = true;
    vsPlayers = payload.players;
    clearTimeout(vsRoundTimeoutTimer);
    vsRoundTimeoutTimer = null;
    clearTimeout(vsPenaltyTimer);
    clearInterval(vsPenaltyTimer);
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;

    if (vsAnimFrame) cancelAnimationFrame(vsAnimFrame);

    // The box stays focused (keyboard stays up) so the next round can start typing instantly.
    // On phones the winner panel pins itself to the top of the visible area (see .vs-kb-open in style.css).
    vsSetBlocked(true, 'Next round coming up...');
    vsSuggestions.innerHTML = '';
    vsImageOverlay.classList.remove('visible');
    vsRevealCanvas.classList.add('hidden');
    vsRevealCanvas.style.filter = 'none';
    if (vsAnswer) vsPokemonImage.src = vsAnswer.image;
    vsPokemonImage.classList.remove('hidden');

    renderVsLeaderboard();
    if (payload.winnerId) {
      const bar = document.querySelector(`.vs-player-bar-wrapper[data-peer-id="${payload.winnerId}"] .vs-progress-fill`);
      if (bar) { bar.style.width = '100%'; bar.classList.add('finished'); }
    }

    vsRoundOverPanel.classList.remove('hidden');
    if (payload.noWinner) {
      vsRoundWinnerText.textContent = `Time's up! Nobody got it.`;
      playVsTimesUpSound();
    } else {
      const isMe = vsPeer && payload.winnerId === vsPeer.id;
      vsRoundWinnerText.textContent = `${isMe ? 'You' : payload.winnerName} got it! +${payload.points} pts`;
      if (isMe && typeof launchConfetti === 'function') launchConfetti();
      // The winner already heard playCorrectSound() the instant they guessed
      // right, in handleVsGuess() - this is for everyone else, so the round
      // ending is audible even if they're not staring at the screen.
      if (!isMe) playVsRoundOverSound();
    }
    vsRoundAnswerText.textContent = `It was ${payload.isShiny ? 'Shiny ' : ''}${payload.answerDisplayName}!`;

    vsModeTitle.textContent = 'Round Complete';
    vsRoundLabel.textContent = `Round ${vsRound} / ${vsNumRounds}`;

    const isLastRound = vsRound >= vsNumRounds;
    let secondsLeft = Math.ceil(VS_AUTO_ADVANCE_MS / 1000);

    vsWaitingNextMsg.classList.remove('hidden');
    const renderCountdown = () => {
      vsWaitingNextMsg.textContent = isLastRound
        ? `Final results in ${secondsLeft}...`
        : `Next round in ${secondsLeft}...`;
    };
    renderCountdown();

    vsCountdownInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        renderCountdown();
      } else {
        clearInterval(vsCountdownInterval);
        vsCountdownInterval = null;
      }
    }, 1000);

    if (vsIsHost) {
      vsAutoAdvanceTimer = setTimeout(() => {
        advanceVsRound();
      }, VS_AUTO_ADVANCE_MS);
    }
  }

  function advanceVsRound() {
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;

    if (!vsIsHost) return;

    if (vsRound >= vsNumRounds) {
      endVsGame();
    } else {
      launchVsRound();
    }
  }

  // Cancels every timer / loop that belongs to a match (vote clock, 3-2-1, wheel, reveal animation, round timers)
  function vsStopMatchTimers() {
    clearTimeout(vsAutoAdvanceTimer); clearInterval(vsCountdownInterval);
    clearTimeout(vsPenaltyTimer); clearInterval(vsPenaltyTimer);
    clearTimeout(vsVoteTimer); clearTimeout(vsVoteResultTimer); clearInterval(vsVoteCountdownInterval);
    clearTimeout(vsStartTimer); clearTimeout(vsRoundTimeoutTimer); clearInterval(vsCountTimer);
    vsAutoAdvanceTimer = null; vsCountdownInterval = null; vsRoundTimeoutTimer = null; vsCountTimer = null;
    if (vsAnimFrame) { cancelAnimationFrame(vsAnimFrame); vsAnimFrame = null; }
    if (vsSpinCancel) vsSpinCancel();
    vsVoteOpen = false;
  }

  // reason 'alone' = everybody else left, so the last player standing is crowned
  function endVsGame(reason) {
    if (!vsIsHost) return;
    vsStopMatchTimers();
    if (vsPhase === 'vote' || vsPhase === 'voteresult') Object.values(vsPlayers).forEach(p => { p.score = 0; });   // the new match never started

    const payload = { type: 'GAME_OVER', players: vsPlayers, reason: reason || '' };
    broadcastVs(payload);
    applyGameOver(payload);
  }

  // Players grouped by score, best first. Equal scores share a place (1st, 1st, 3rd...).
  function vsRankGroups(players) {
    const sorted = Object.entries(players).sort((a, b) => b[1].score - a[1].score || (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    const groups = [];
    sorted.forEach(([id, p], i) => {
      const last = groups[groups.length - 1];
      if (last && last.score === p.score) last.members.push([id, p]);
      else groups.push({ score: p.score, place: i + 1, members: [[id, p]] });
    });
    return groups;
  }
  const vsPlaceLabel = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';

  // Podium: 2nd on the left, 1st in the middle, 3rd on the right (just the steps that exist). Ties share a step.
  function renderPodium(groups) {
    const top = groups.slice(0, 3);
    const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
    vsPodium.innerHTML = order.map(gi => {
      const g = top[gi];
      const people = g.members.map(([id, p]) =>
        `<div class="vs-pod-person${vsPeer && id === vsPeer.id ? ' is-you' : ''}">${vsAvatarHTML(p.av, gi === 0 ? 'xl' : 'lg')}<span class="vs-pod-name">${escapeHtml(p.name)}</span></div>`).join('');
      return `<div class="vs-pod-col vs-pod-${gi + 1}">
        ${gi === 0 ? '<span class="vs-pod-crown" aria-hidden="true">\u{1F451}</span>' : ''}
        <div class="vs-pod-people">${people}</div>
        <div class="vs-pod-step"><b>${vsPlaceLabel(g.place)}</b><span>${g.score} pts</span></div>
      </div>`;
    }).join('');
  }

  function applyGameOver(payload) {
    vsStopMatchTimers();
    hideVsCountdown();
    vsPhase = 'over';
    vsPlayers = payload.players;

    // Get rid of the game itself (image, race board, round panel, wheel...) - only the results panel stays
    vsWheelOverlay.classList.add('hidden');
    vsLobbyScreen.classList.add('hidden');
    vsVoteScreen.classList.add('hidden');
    vsShinyBanner.classList.add('hidden');
    vsRoundOverPanel.classList.add('hidden');
    vsGameplayScreen.classList.remove('hidden');
    vsGameplayScreen.classList.add('is-over');
    vsGameOverPanel.classList.remove('hidden');
    vsSetBlocked(true);
    vsSearchWrapper.classList.add('hidden');
    try { vsGuessInput.blur(); } catch (e) {}   // match is over: let the keyboard go
    window.scrollTo(0, 0);

    const groups = vsRankGroups(vsPlayers);
    renderPodium(groups);

    // The little scores menu: everybody in the room, best first
    vsFinalStandings.innerHTML = groups.map(g => g.members.map(([id, p]) => {
      const isYou = vsPeer && id === vsPeer.id;
      return `<div class="vs-standing-row${g.place === 1 ? ' vs-standing-first' : ''}${isYou ? ' is-you' : ''}">
        <span class="vs-lb-name"><span class="vs-rank-tag">${vsPlaceLabel(g.place)}</span> ${vsAvatarHTML(p.av, 'sm')}<span>${escapeHtml(p.name)}</span></span>
        <span>${p.score} pts</span>
      </div>`;
    }).join('')).join('');

    const first = groups[0] ? groups[0].members : [];
    const iAmFirst = !!(vsPeer && first.some(([id]) => id === vsPeer.id));
    let caption = '';
    if (payload.reason === 'alone') caption = iAmFirst ? 'Everyone else left - you win by default!' : 'Everyone else left.';
    else if (first.length > 1) caption = first.length === 2 ? "It's a tie for first!" : `${first.length}-way tie for first!`;
    vsWinnerText.textContent = caption;
    vsWinnerText.classList.toggle('hidden', !caption);

    if (iAmFirst && typeof launchConfetti === 'function') launchConfetti();
    playVsGameOverSound(iAmFirst);

    vsPlayAgainBtn.classList.remove('hidden');
    vsStartBackWindow();
  }

  // ---------- after a match: EVERYONE can go back to the lobby, and anyone who hasn't after 30s is removed ----------
  // Each player taps "Back to Lobby" for themselves. The host going back reopens the room (joinable, listed if public).
  // The host enforces the 30s window; when it ends the host goes back too (if it hasn't already).
  const VS_BACK_WINDOW_MS = 30 * 1000, VS_BACK_LABEL = 'Back to Lobby';
  let vsBackPending = null, vsBackTimer = 0, vsBackTick = 0, vsBackDeadline = 0, vsHostBack = false, vsIAmBack = false;

  function vsClearBackWindow() {
    clearTimeout(vsBackTimer); clearInterval(vsBackTick);
    vsBackTimer = 0; vsBackTick = 0; vsBackPending = null;
    vsPlayAgainBtn.textContent = VS_BACK_LABEL;
  }
  function vsPaintBackCountdown() {
    const s = Math.max(0, Math.ceil((vsBackDeadline - Date.now()) / 1000));
    vsPlayAgainBtn.textContent = s > 0 ? `${VS_BACK_LABEL} (${s}s)` : VS_BACK_LABEL;
    if (s <= 0) { clearInterval(vsBackTick); vsBackTick = 0; }
  }
  function vsStartBackWindow() {   // every device when the results screen appears
    clearTimeout(vsBackTimer); clearInterval(vsBackTick);
    vsIAmBack = false; vsHostBack = false;
    vsBackDeadline = Date.now() + VS_BACK_WINDOW_MS;
    vsPaintBackCountdown();
    vsBackTick = setInterval(vsPaintBackCountdown, 1000);
    if (vsIsHost) {
      const me = vsPeer && vsPeer.id;
      vsBackPending = new Set(Object.keys(vsPlayers).filter(id => id !== me));
      vsBackTimer = setTimeout(vsBackWindowEnded, VS_BACK_WINDOW_MS);
    }
  }
  function vsKickAfk(conn) {
    const pid = conn._vsPeerId, name = pid && vsPlayers[pid] ? vsPlayers[pid].name : 'A player';
    try { if (conn.open) conn.send({ type: 'KICKED', reason: 'afk' }); } catch (e) {}
    setTimeout(() => { try { conn.close(); } catch (e) {} }, 300);
    vsDropPlayer(conn);
    vsToast(name + ' was removed for not going back to the lobby.');
  }
  function vsBackWindowEnded() {
    vsBackTimer = 0;
    if (!vsIsHost || vsLeaving) return;
    if (vsBackPending) {
      Array.from(vsBackPending).forEach(id => {
        if (!vsPlayers[id]) return;
        const conn = vsClients.find(c => c._vsPeerId === id);
        if (conn) vsKickAfk(conn);
        else { delete vsPlayers[id]; delete vsLastSeen[id]; }
      });
      vsBackPending = null;
      vsPruneBars();
      renderVsLobby();
      broadcastVs(vsLobbyPayload());
    }
    if (!vsHostBack && vsPhase === 'over') vsHostGoBack();
  }
  function vsMaybeFinishBackWindow() {   // everybody is back: nothing left to enforce
    if (vsIsHost && vsHostBack && (!vsBackPending || !vsBackPending.size)) { clearTimeout(vsBackTimer); vsBackTimer = 0; vsBackPending = null; }
  }
  // The host is back: the room reopens. (Scores are cleared when the next match starts, so nobody's results screen changes.)
  function vsHostGoBack() {
    if (!vsIsHost) return;
    vsHostBack = true;
    vsMatchActive = false;
    vsShowLobbyView();     // also lists the room again if it is public
    broadcastVs(vsLobbyPayload());
    vsMaybeFinishBackWindow();
  }
  // Show the waiting screen on THIS device
  function vsShowLobbyView() {
    vsStopMatchTimers();
    hideVsCountdown();
    vsPhase = 'lobby';
    vsIAmBack = true;
    clearInterval(vsBackTick); vsBackTick = 0;
    vsPlayAgainBtn.textContent = VS_BACK_LABEL;
    vsWheelOverlay.classList.add('hidden');
    vsVoteScreen.classList.add('hidden');
    vsShinyBanner.classList.add('hidden');
    vsRoundOverPanel.classList.add('hidden');
    vsGameOverPanel.classList.add('hidden');
    vsWinnerText.classList.add('hidden');
    vsGameplayScreen.classList.remove('is-over');
    vsGameplayScreen.classList.add('hidden');
    vsLobbyScreen.classList.remove('hidden');
    vsPruneBars();
    renderVsLobby();
    window.scrollTo(0, 0);
  }
  vsPlayAgainBtn.textContent = VS_BACK_LABEL;
  vsPlayAgainBtn.addEventListener('click', () => {
    if (vsPhase !== 'over') return;
    if (vsIsHost) { vsHostGoBack(); return; }
    vsShowLobbyView();
    if (vsHostConn && vsHostConn.open) { try { vsHostConn.send({ type: 'BACK' }); } catch (e) {} }
  });

  function vsDestroyPeers() {
    try { if (vsRoomPeer) vsRoomPeer.destroy(); } catch (e) {}
    try { if (vsPeer) vsPeer.destroy(); } catch (e) {}
  }

  function leaveVsRoom() {
    vsLeaving = true;
    clearTimeout(vsMigTimer); clearTimeout(vsReconnectTimer);
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    clearTimeout(vsPenaltyTimer);
    clearTimeout(vsVoteTimer);
    clearTimeout(vsVoteResultTimer);
    clearInterval(vsVoteCountdownInterval);
    clearTimeout(vsStartTimer);
    clearTimeout(vsRoundTimeoutTimer);
    clearInterval(vsCountTimer);
    if (vsAnimFrame) cancelAnimationFrame(vsAnimFrame);
    vsUnpublishLobby();   // take the public row down right away (onDisconnect covers crashes)

    try {
      if (vsIsHost) {
        // Tell everyone straight away. Each guest works out the same next host from the join order
        // (whoever has been in the room longest after you) and reconnects to them.
        broadcastVs({ type: 'HOST_LEFT' });
      } else if (vsHostConn && vsHostConn.open) {
        // Closing this explicitly (instead of just reloading the page and
        // letting the browser tear it down whenever it gets around to it)
        // fires the host's conn.on('close') handler right away, so the
        // lobby list actually updates for everyone else immediately.
        vsHostConn.close();
      }
      vsDestroyPeers();
    } catch (e) { /* already on the way out, nothing more to clean up */ }

    location.hash = '#versus';
    // Small delay so the close/broadcast above actually gets sent over the
    // data channel before the reload tears the connection down under it.
    setTimeout(() => location.reload(), 150);
  }

  vsLeaveRoomBtn.addEventListener('click', leaveVsRoom);

  // Closing the tab / navigating away: tell everyone straight away instead of waiting for the connection to time out.
  // (No reload here - the page is already going.)
  function vsQuickExit() {
    if (vsLeaving) return;
    vsLeaving = true;
    try { vsUnpublishLobby(); } catch (e) {}
    try {
      if (vsIsHost) broadcastVs({ type: 'HOST_LEFT' });
      else if (vsHostConn && vsHostConn.open) { vsHostConn.send({ type: 'LEAVE' }); vsHostConn.close(); }
      vsDestroyPeers();
    } catch (e) {}
  }
  window.addEventListener('pagehide', () => { if (vsInRoom) vsQuickExit(); });
  // Back/forward cache can resurrect a page whose connection we just closed - start clean instead
  window.addEventListener('pageshow', (e) => { if (e.persisted && vsLeaving) location.reload(); });
  if (vsLobbyLeaveBtn) vsLobbyLeaveBtn.addEventListener('click', leaveVsRoom);
});