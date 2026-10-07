// ---- Config: stages, blur, points ----
const stages = [
  { blur: 20, points: 5 },
  { blur: 12, points: 4 },
  { blur: 8,  points: 3 },
  { blur: 4,  points: 2 },
  { blur: 1,  points: 1 },
  { blur: 0,  points: 1 }
];

const TOTAL_ROUNDS = 5;
const START_DATE = new Date('2026-09-10T00:00:00');

// Generation Base ID Ranges (IDs 1 to 1025)
const GEN_RANGES = {
  1: [1, 151],
  2: [152, 251],
  3: [252, 386],
  4: [387, 493],
  5: [494, 649],
  6: [650, 721],
  7: [722, 809],
  8: [810, 905],
  9: [906, 1025]
};

// Map Regional Names to their actual debut Generation
const REGIONAL_GEN_MAP = {
  'alola': 7,
  'galar': 8,
  'hisui': 8,
  'paldea': 9
};

// Shared Data
let allPokemonList = [];
let pokemonCount = 0;
let teaserInterval = null;

// Daily Game State
let selectedDate = new Date();
let currentStage = 0;
let round = 1;
let totalScore = 0;
let correctCount = 0;
let answer = null;
let dailyPokemonQueue = [];
let dailyHistory = [];
let lastRoundPoints = 0;
let dailyReviewRound = TOTAL_ROUNDS;
let dailyCountdownTimer = null;

// Track used Pokémon in the active game/match to avoid repeating
let activeSessionUsedPokemon = new Set();

// Unlimited Game State
let unlimitedMode = 'normal'; // 'normal' or 'shiny'
let unlimitedRound = 1;
let unlimitedTotalScore = 0;
let unlimitedCurrentStage = 0;
let unlimitedAnswer = null;
let selectedGenerations = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);

// DOM Elements - Navigation & Modes
const dailyViewEl = document.getElementById('daily-view');
const unlimitedViewEl = document.getElementById('unlimited-view');
const modeDailyBtn = document.getElementById('mode-daily-btn');
const modeUnlimitedBtn = document.getElementById('mode-unlimited-btn');

// DOM Elements - Daily Game
const imageEl = document.getElementById('pokemon-image');
const imageOverlayEl = document.getElementById('image-loading-overlay');
const stageLabelEl = document.getElementById('stage-label');
const roundLabelEl = document.getElementById('round-label');
const puzzleDateLabelEl = document.getElementById('puzzle-date-label');
const startScreenEl = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const searchWrapperEl = document.getElementById('search-wrapper');
const buttonsEl = document.getElementById('buttons');
const inputEl = document.getElementById('guess-input');
const suggestionsEl = document.getElementById('suggestions');
const skipBtn = document.getElementById('skip-btn');
const nextBtn = document.getElementById('next-btn');
const resultEl = document.getElementById('result-message');
const gameOverPanel = document.getElementById('game-over-panel');
const finalScoreText = document.getElementById('final-score-text');
const statsLine = document.getElementById('stats-line');
const shareBtn = document.getElementById('share-btn');
const statPlayed = document.getElementById('stat-played');
const statAvg = document.getElementById('stat-avg');
const statStreak = document.getElementById('stat-streak');
const streakBestEl = document.getElementById('streak-best');
const gameOverCloseBtn = document.getElementById('game-over-close');
const dailyReviewEl = document.getElementById('daily-review');
const dailyReviewNameEl = document.getElementById('daily-review-name');
const dailyReviewPointsEl = document.getElementById('daily-review-points');
const dailyReviewChips = document.querySelectorAll('#daily-review-chips .review-chip');
const dailyReviewResultsBtn = document.getElementById('daily-review-results-btn');

// DOM Elements - Unlimited Game
const unlimitedNormalBtn = document.getElementById('unlimited-normal-btn');
const unlimitedShinyBtn = document.getElementById('unlimited-shiny-btn');
const unlimitedModeTitle = document.getElementById('unlimited-mode-title');
const unlimitedImageEl = document.getElementById('unlimited-pokemon-image');
const unlimitedImageOverlay = document.getElementById('unlimited-image-overlay');
const unlimitedRoundLabel = document.getElementById('unlimited-round-label');
const unlimitedStageLabel = document.getElementById('unlimited-stage-label');
const unlimitedStartScreen = document.getElementById('unlimited-start-screen');
const unlimitedStartBtn = document.getElementById('unlimited-start-btn');
const unlimitedSearchWrapper = document.getElementById('unlimited-search-wrapper');
const unlimitedButtons = document.getElementById('unlimited-buttons');
const unlimitedInputEl = document.getElementById('unlimited-guess-input');
const unlimitedSuggestionsEl = document.getElementById('unlimited-suggestions');
const unlimitedSkipBtn = document.getElementById('unlimited-skip-btn');
const unlimitedNextBtn = document.getElementById('unlimited-next-btn');
const unlimitedResultEl = document.getElementById('unlimited-result-message');
const unlimitedGameOverPanel = document.getElementById('unlimited-game-over-panel');
const unlimitedFinalScoreText = document.getElementById('unlimited-final-score-text');
const playAgainBtn = document.getElementById('play-again-btn');
const genFilterContainer = document.getElementById('gen-filter-container');

// DOM Elements - Timed Mode
const timedViewEl = document.getElementById('timed-view');
const modeTimedBtn = document.getElementById('mode-timed-btn');
const timedSetupContainer = document.getElementById('timed-setup-container');
const timedDurationButtons = document.querySelectorAll('#timed-duration-grid .gen-btn');
const timedCustomWrapper = document.getElementById('timed-custom-wrapper');
const timedCustomInput = document.getElementById('timed-custom-input');
const timedGenFilterContainer = document.getElementById('timed-gen-filter-container');
const timedStatsLabel = document.getElementById('timed-stats-label');
const timedStageLabel = document.getElementById('timed-stage-label');
const timedCountdownEl = document.getElementById('timed-countdown');
const timedImageEl = document.getElementById('timed-pokemon-image');
const timedImageOverlay = document.getElementById('timed-image-overlay');
const timedStartScreen = document.getElementById('timed-start-screen');
const timedStartBtn = document.getElementById('timed-start-btn');
const timedSearchWrapper = document.getElementById('timed-search-wrapper');
const timedButtons = document.getElementById('timed-buttons');
const timedInputEl = document.getElementById('timed-guess-input');
const timedSuggestionsEl = document.getElementById('timed-suggestions');
const timedSkipBtn = document.getElementById('timed-skip-btn');
const timedResultEl = document.getElementById('timed-result-message');
const timedGameOverPanel = document.getElementById('timed-game-over-panel');
const timedFinalScoreText = document.getElementById('timed-final-score-text');
const timedPlayAgainBtn = document.getElementById('timed-play-again-btn');
const timedShareBtn = document.getElementById('timed-share-btn');
const timedFinalBestText = document.getElementById('timed-final-best-text');
const timedHighScoreCard = document.getElementById('timed-highscore-card');
const timedHsScoreEl = document.getElementById('timed-hs-score');
const timedHsSettingEl = document.getElementById('timed-hs-setting');
const timedHsDetailEl = document.getElementById('timed-hs-detail');
const timedRecordsEl = document.getElementById('timed-records');
const timedRecordsListEl = document.getElementById('timed-records-list');

// Timed Mode State
let timedDuration = 30;
let timedTimeLeft = 0;
let timedInterval = null;
let timedActive = false;
let timedScore = 0;
let timedCorrectCount = 0;
let timedCurrentStage = 0;
let timedAnswer = null;
let timedRunDuration = 30;
let timedRunGens = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
let timedRoundLocked = false;

// ==========================================
// 1. TAB NAVIGATION & MODE SETUP
// ==========================================
function switchTab(activeBtn, activeView) {
  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
  
  ['daily-view', 'unlimited-view', 'timed-view', 'reverse-view'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  if (activeBtn) activeBtn.classList.add('active');
  if (activeView) activeView.classList.remove('hidden');
}

function setupModeNavigation() {
  modeDailyBtn.addEventListener('click', function() {
    switchTab(this, dailyViewEl);

    resetUnlimitedToStartScreen();

    if (!startScreenEl.classList.contains('hidden') && !teaserInterval) {
      startTeaserCarousel(imageEl, false);
    }
  });

  modeUnlimitedBtn.addEventListener('click', function() {
    switchTab(this, unlimitedViewEl);

    clearInterval(teaserInterval);
    teaserInterval = null;

    resetUnlimitedToStartScreen();
    startTeaserCarousel(unlimitedImageEl, unlimitedMode === 'shiny');
  });

  modeTimedBtn.addEventListener('click', function() {
    switchTab(this, timedViewEl);

    clearInterval(teaserInterval);
    teaserInterval = null;

    resumeTimedTimerIfNeeded();
    if (!timedActive && !teaserInterval) {
      startTeaserCarousel(timedImageEl, false);
    }
  });

  unlimitedNormalBtn.addEventListener('click', () => {
    if (unlimitedMode === 'normal') return;
    unlimitedMode = 'normal';
    unlimitedNormalBtn.classList.add('active');
    unlimitedShinyBtn.classList.remove('active');
    unlimitedModeTitle.textContent = 'Unlimited - Normal Mode';

    resetUnlimitedToStartScreen();
    startTeaserCarousel(unlimitedImageEl, false);
  });

  unlimitedShinyBtn.addEventListener('click', () => {
    if (unlimitedMode === 'shiny') return;
    unlimitedMode = 'shiny';
    unlimitedShinyBtn.classList.add('active');
    unlimitedNormalBtn.classList.remove('active');
    unlimitedModeTitle.textContent = 'Unlimited - Shiny Mode';

    resetUnlimitedToStartScreen();
    startTeaserCarousel(unlimitedImageEl, true);
  });
}

const genFilterSyncFns = [];

function syncAllGenFilterUIs() {
  genFilterSyncFns.forEach(fn => fn());
  showTimedHighScoreLabel();
}

function setupGenButtons(containerEl) {
  const genBtns = containerEl.querySelectorAll('.gen-btn:not(.all-btn)');
  const allBtn = containerEl.querySelector('.gen-btn.all-btn');

  function syncUI() {
    genBtns.forEach(btn => {
      const g = parseInt(btn.getAttribute('data-gen'), 10);
      btn.classList.toggle('active', selectedGenerations.has(g));
    });
    allBtn.classList.toggle('active', selectedGenerations.size === 9);
  }

  genBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const genNum = parseInt(btn.getAttribute('data-gen'), 10);

      if (selectedGenerations.size === 9) {
        selectedGenerations = new Set([genNum]);
      } else {
        if (selectedGenerations.has(genNum)) {
          if (selectedGenerations.size > 1) {
            selectedGenerations.delete(genNum);
          }
        } else {
          selectedGenerations.add(genNum);
        }
      }
      syncAllGenFilterUIs();
    });
  });

  allBtn.addEventListener('click', () => {
    selectedGenerations = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    syncAllGenFilterUIs();
  });

  genFilterSyncFns.push(syncUI);
  syncUI();
}

function formatPokemonName(rawName) {
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  let tokens = rawName.split('-');

  // PokeAPI names put the prefix last ("charizard-mega-x", "gengar-gmax").
  // Players type "Mega Charizard X" / "Gigantamax Gengar", so reorder for display.
  // Token-based on purpose: "meganium" and "yanmega" must NOT be treated as Megas.
  let prefix = '';
  if (tokens.includes('mega')) prefix = 'Mega ';
  else if (tokens.includes('gmax')) prefix = 'Gigantamax ';
  else if (tokens.includes('primal')) prefix = 'Primal ';

  if (prefix) tokens = tokens.filter(t => t !== 'mega' && t !== 'gmax' && t !== 'primal');
  return prefix + tokens.map(cap).join(' ');
}

function getStoredStats() {
  const defaultStats = { gamesPlayed: 0, totalPoints: 0 };
  const saved = localStorage.getItem('pokeblur-stats');
  return saved ? JSON.parse(saved) : defaultStats;
}

function saveStats(stats) {
  localStorage.setItem('pokeblur-stats', JSON.stringify(stats));
}

function updatePersistentStats(finalScore) {
  const stats = getStoredStats();
  stats.gamesPlayed += 1;
  stats.totalPoints += finalScore;
  saveStats(stats);
  return stats;
}

const TIMED_RECORDS_KEY = 'pokeblur-timed-records';

function timedGenKey(gens) {
  const list = Array.from(gens).sort((a, b) => a - b);
  return list.length === 9 ? 'all' : list.join('-');
}

function timedGenLabel(gens) {
  const list = Array.from(gens).sort((a, b) => a - b);
  if (list.length === 9) return 'All Gens';
  if (list.length === 1) return `Gen ${list[0]}`;
  const contiguous = list.every((g, i) => i === 0 || g === list[i - 1] + 1);
  return contiguous ? `Gens ${list[0]}-${list[list.length - 1]}` : `Gens ${list.join(', ')}`;
}

function formatTimedDuration(sec) {
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0 ? `${m} min` : `${m}m ${r}s`;
}

function getTimedRecords() {
  try {
    return JSON.parse(localStorage.getItem(TIMED_RECORDS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function timedRecordKey(seconds, gens) {
  return `${seconds}|${timedGenKey(gens)}`;
}

function getTimedRecord(seconds, gens) {
  return getTimedRecords()[timedRecordKey(seconds, gens)] || null;
}

function saveTimedRecord(seconds, gens, score, correct) {
  if (score <= 0) return false;
  const all = getTimedRecords();
  const key = timedRecordKey(seconds, gens);
  const prev = all[key];
  if (prev && score <= prev.score) return false;
  all[key] = { score, correct };
  try { localStorage.setItem(TIMED_RECORDS_KEY, JSON.stringify(all)); } catch (e) {}
  return true;
}

function getReverseHighScore() {
  const saved = localStorage.getItem('pokeblur-reverse-highscore');
  return saved ? parseInt(saved, 10) : 0;
}

function updateReverseHighScore(score) {
  const currentBest = getReverseHighScore();
  if (score > currentBest) {
    localStorage.setItem('pokeblur-reverse-highscore', score.toString());
    return score;
  }
  return currentBest;
}

function getSeedString(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 8, t | 30);
    return ((t ^ t >>> 19) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return hash;
}

function setupPuzzleHeader() {
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  const dateStr = selectedDate.toLocaleDateString('en-US', options);

  const timeDiff = selectedDate.getTime() - START_DATE.getTime();
  const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
  const puzzleNum = Math.max(1, daysDiff + 1);

  if (puzzleDateLabelEl) {
    puzzleDateLabelEl.textContent = `${dateStr} - Puzzle #${puzzleNum}`;
  }
}

const POKEMON_LIST_URL = 'https://pokeapi.co/api/v2/pokemon?limit=10275';
const POKEMON_URL_PREFIX = 'https://pokeapi.co/api/v2/pokemon/';
// ==========================================
// DATASET RULES  (edit these - storage versioning below picks changes up automatically)
// ==========================================
// Matching is done on the lowercase PokeAPI name (e.g. "charizard-mega-x").
// Regexes are stored as strings so the whole config can be fingerprinted.
const FORM_RULES = {
  // Always kept. Checked BEFORE exclusions, so these win any conflict.
  forceInclude: [
    '(^|-)mega(-|$)',                       // charizard-mega-x, lucario-mega, mega-lucario ("meganium"/"yanmega" don't match)
    '-gmax$',                               // gengar-gmax, pikachu-gmax, urshifu-rapid-strike-gmax
    '^(pyroar|meowstic|indeedee|oinkologne|basculegion|jellicent|frillish|unfezant)-female$',
    '^minior-(red|orange|yellow|green|blue|indigo|violet)$'   // the 7 Core colour forms
  ],

  // Dropped from the pool (autocomplete, Unlimited, Timed, Versus, Reverse, Daily).
  exclude: [
    '^pikachu-',                            // caps / event / cosplay (pikachu-gmax is rescued by forceInclude)
    '^eevee-starter$',
    '-(totem|busted|gulping|gorging|antique)', // Totems, Mimikyu busted, Cramorant, Sinistea/Polteageist
    '-power-construct$',
    '^(pumpkaboo|gourgeist)-.*(small|large|super)',
    // Minior: keep ONLY the 7 Core colours (forceInclude); drops brown "meteor" shell incl. minior-red-meteor
    '^minior-(?!(red|orange|yellow|green|blue|indigo|violet)$)',
    // Cosmetic / pattern-only variants (base species like "arceus" or "unown" is untouched)
    '^unown-', '^vivillon-', '^alcremie-', '^arceus-', '^silvally-', '^furfrou-'
  ],

  // Female forms PokeAPI does NOT list as their own /pokemon entry. They are injected into the
  // pool (appended AFTER the real list, so daily-puzzle indices never shift) and use the
  // Pokemon HOME female render, since official-artwork has no female image.
  syntheticFemale: { 'pyroar-female': 668, 'frillish-female': 592, 'jellicent-female': 593, 'unfezant-female': 521 }
};

const FORCE_INCLUDE_RES = FORM_RULES.forceInclude.map(p => new RegExp(p));
const EXCLUDE_RES = FORM_RULES.exclude.map(p => new RegExp(p));

// ==========================================
// AUTOMATED LOCALSTORAGE VERSIONING
// ==========================================
// Version = manual schema number + auto fingerprint of FORM_RULES.
//  - Change FORM_RULES      -> fingerprint changes   -> cache purged automatically.
//  - Change the SHAPE of stored data (rare) -> bump STORAGE_SCHEMA_VERSION by hand.
const STORAGE_SCHEMA_VERSION = 1;
const STORAGE_VERSION_KEY = 'pokeblur-data-version';

function computeDataVersion() {
  const json = JSON.stringify(FORM_RULES);
  let h = 5381;                                   // djb2 hash
  for (let i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) >>> 0;
  return `${STORAGE_SCHEMA_VERSION}-${h.toString(36)}`;
}
const CURRENT_DATA_VERSION = computeDataVersion();

// Keys that are DERIVED from the dataset and safe to rebuild. Prefix match, so the old
// 'pokeblur-pokemon-list-v1' / -v2 / -v3 keys are swept up too.
// Deliberately NOT listed (player progress, never purged): pokeblur-stats, pokeblur-streak,
// pokeblur-timed-records, pokeblur-reverse-highscore, pokeblur-daily-state-<date>.
// (Your real keys use the "pokeblur-" prefix, not "poke_" - add prefixes here if you add caches.)
const PURGE_KEY_PREFIXES = ['pokeblur-pokemon-list'];

function migrateStorageIfNeeded() {
  try {
    const stored = localStorage.getItem(STORAGE_VERSION_KEY);
    if (stored === CURRENT_DATA_VERSION) return false;   // up to date

    // Fingerprints aren't ordered, so ANY mismatch (including a rollback) counts as stale.
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && PURGE_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) doomed.push(key);
    }
    doomed.forEach(key => localStorage.removeItem(key));   // collect first, remove after (indices shift)

    localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_DATA_VERSION);
    if (doomed.length) console.info(`[PokéBlur] Data version ${stored || 'none'} -> ${CURRENT_DATA_VERSION}; purged:`, doomed);
    return true;
  } catch (e) {
    return false;   // storage blocked (private mode / quota) - the game works fine without it
  }
}

const POKEMON_LIST_CACHE_KEY = 'pokeblur-pokemon-list';
const POKEMON_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const POKEMON_LIST_MIN_SIZE = 1025;

function readPokemonListCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(POKEMON_LIST_CACHE_KEY));
    if (cached && Array.isArray(cached.items) && cached.items.length >= POKEMON_LIST_MIN_SIZE) {
      return cached;
    }
  } catch (e) {}
  return null;
}

function savePokemonListCache(results) {
  const items = results.map(r => [
    r.name,
    r.url.startsWith(POKEMON_URL_PREFIX) ? r.url.slice(POKEMON_URL_PREFIX.length) : r.url
  ]);
  try {
    localStorage.setItem(POKEMON_LIST_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch (e) {}
}

async function fetchPokemonListFromApi() {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(POKEMON_LIST_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.results) || data.results.length < POKEMON_LIST_MIN_SIZE) {
        throw new Error('Unexpected Pokémon list response');
      }
      return data.results;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// Species id of a form WITHOUT a network call, by matching name tokens against the first
// 1025 (base) entries: "charizard-mega-x" -> charizard, "deoxys-attack" -> deoxys-normal,
// "mr-mime-galar" -> mr-mime. Only used for pool filtering; once a Pokémon is actually
// fetched, its exact species URL is used instead.
function guessSpeciesId(rawName, baseEntries) {
  const tokens = rawName.split('-').filter(t => t !== 'mega' && t !== 'gmax' && t !== 'primal');
  let best = null, bestK = 0, bestFull = false;
  for (const b of baseEntries) {
    let k = 0;
    while (k < b.tokens.length && k < tokens.length && b.tokens[k] === tokens[k]) k++;
    if (k === 0) continue;
    const full = k === b.tokens.length;
    if (k > bestK || (k === bestK && full && !bestFull)) { best = b; bestK = k; bestFull = full; }
  }
  return best ? best.id : null;
}

// Generation for a form. Regional forms use their debut gen; everything else
// (Mega, Gmax, Primal, female...) uses the species' gen.
function resolveGeneration(rawName, speciesId) {
  for (const [region, targetGen] of Object.entries(REGIONAL_GEN_MAP)) {
    if (rawName.includes(`-${region}`)) return targetGen;
  }
  for (const [g, [min, max]] of Object.entries(GEN_RANGES)) {
    if (speciesId >= min && speciesId <= max) return parseInt(g, 10);
  }
  return null;
}

function buildPokemonList(results) {
  const list = results.map((item, idx) => {
    const tail = parseInt(item.url.replace(POKEMON_URL_PREFIX, ''), 10);
    return {
      id: idx + 1,                       // list position (== dex number for the first 1025)
      rawName: item.name,
      displayName: formatPokemonName(item.name),
      url: item.url,
      spriteId: Number.isFinite(tail) ? tail : null   // real PokeAPI id, for thumbnail sprites
    };
  });

  const baseEntries = list.slice(0, 1025).map(p => ({ id: p.id, tokens: p.rawName.split('-') }));
  const unresolved = [];

  list.forEach(p => {
    p.dexId = p.id <= 1025 ? p.id : guessSpeciesId(p.rawName, baseEntries);
    p.gen = resolveGeneration(p.rawName, p.dexId);
    if (p.gen === null) unresolved.push(p.rawName);
  });
  if (unresolved.length) console.warn('[PokéBlur] Could not resolve generation for:', unresolved);

  // Inject female forms PokeAPI doesn't list. Appended at the END so daily indices stay stable.
  const have = new Set(list.map(p => p.rawName));
  Object.entries(FORM_RULES.syntheticFemale).forEach(([rawName, speciesId]) => {
    if (have.has(rawName)) return;
    list.push({
      id: list.length + 1,
      rawName,
      displayName: formatPokemonName(rawName),
      url: `${POKEMON_URL_PREFIX}${speciesId}/`,   // base species: same types/stats
      spriteId: speciesId,
      dexId: speciesId,
      gen: resolveGeneration(rawName, speciesId),
      synthetic: true
    });
  });

  // Computed ONCE here instead of on every keystroke. isExcludedForm() runs dozens of
  // regexes, and autocomplete used to run it (plus toLowerCase) on all ~10,000 entries for
  // every key typed - slow enough on a phone that typing froze. Lookups now just read these.
  list.forEach(p => {
    p.lc = p.displayName.toLowerCase();
    p.rawLc = p.rawName.toLowerCase();
    p.excluded = isExcludedForm(p.rawLc);
  });

  return list;
}

async function loadPokemonList() {
  let results;
  const cached = readPokemonListCache();

  if (cached) {
    results = cached.items.map(([name, tail]) => ({
      name,
      url: tail.startsWith('http') ? tail : POKEMON_URL_PREFIX + tail
    }));
    if (Date.now() - cached.savedAt > POKEMON_LIST_MAX_AGE_MS) {
      fetchPokemonListFromApi().then(savePokemonListCache).catch(() => {});
    }
  } else {
    results = await fetchPokemonListFromApi();
    savePokemonListCache(results);
  }

  allPokemonList = buildPokemonList(results);

  pokemonCount = allPokemonList.length;
  generateDailyPokemonQueue();
}

function showPokemonListError() {
  const msg = "Couldn't load the Pokémon list from PokéAPI. Check your connection and refresh the page.";
  ['result-message', 'unlimited-result-message', 'timed-result-message', 'reverse-result-message'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
  ['start-btn', 'unlimited-start-btn', 'timed-start-btn', 'reverse-start-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });
}

function generateDailyPokemonQueue() {
  const seedStr = getSeedString(selectedDate);
  const seedNum = hashString(seedStr);
  const rng = mulberry32(seedNum);

  const chosenIndices = new Set();
  while (chosenIndices.size < TOTAL_ROUNDS) {
    const idx = Math.floor(rng() * 1025);
    // Deterministic re-roll if the entry is excluded (only affects minior-red-meteor, #774)
    if (isExcludedForm(allPokemonList[idx].rawName.toLowerCase())) continue;
    chosenIndices.add(idx);
  }

  dailyPokemonQueue = Array.from(chosenIndices);
}

// fetch() + JSON parse with a hard timeout. A plain fetch() on a flaky phone connection
// (wifi <-> cellular switch, app resumed from background) can hang forever; every loader
// awaits one of these, so a hung request used to leave the round stuck on the loading
// spinner with the input locked - which looks exactly like "the site froze".
async function fetchJsonWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Shown when a Pokémon can't be loaded at all: clears the spinner and offers a retry
// instead of leaving the player stuck.
function showLoadFailure(messageEl, overlayEl, retryFn) {
  overlayEl.classList.remove('visible');
  messageEl.textContent = "Couldn't load a Pokémon (slow or dropped connection). ";
  const btn = document.createElement('button');
  btn.className = 'action-btn retry-btn';
  btn.textContent = 'Try again';
  btn.addEventListener('click', () => {
    messageEl.textContent = '';
    retryFn();
  });
  messageEl.appendChild(btn);
}

async function fetchPokemonByQueueIndex(roundIdx) {
  const index = dailyPokemonQueue[roundIdx];
  const pokemon = allPokemonList[index];
  
  try {
    const data = await fetchJsonWithTimeout(pokemon.url);
    const artwork = data.sprites?.other?.['official-artwork']?.front_default;
    
    if (artwork) {
      return { rawName: pokemon.rawName, displayName: pokemon.displayName, image: artwork };
    }
  } catch (e) {
  }
  return fetchRandomPokemonWithArtwork(false);
}

function isExcludedForm(rawNameLower) {
  if (FORCE_INCLUDE_RES.some(re => re.test(rawNameLower))) return false;
  return EXCLUDE_RES.some(re => re.test(rawNameLower));
}

// Species id from fetched data (exact), else from the precomputed name-based guess.
function getSpeciesId(pokemon, pokemonData) {
  if (pokemonData?.species?.url) {
    const parts = pokemonData.species.url.split('/').filter(Boolean);
    return parseInt(parts[parts.length - 1], 10);
  }
  return pokemon.dexId ?? pokemon.id;
}

// Works with OR without fetched data. Without data it uses pokemon.gen (precomputed),
// so forms (Megas, Gmax, ...) can be filtered by generation with no network call.
function isPokemonInSelectedGens(pokemon, pokemonData = null, gensOverride = null) {
  const rawName = pokemon.rawLc || pokemon.rawName.toLowerCase();

  if (pokemon.excluded ?? isExcludedForm(rawName)) {
    return false;
  }

  const gen = pokemonData
    ? resolveGeneration(rawName, getSpeciesId(pokemon, pokemonData))
    : pokemon.gen;

  return (gensOverride || selectedGenerations).has(gen);
}

function probeImage(url, timeoutMs = 8000) {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

// Official artwork first. Female forms with no official artwork (or injected ones, whose
// fetched data is the MALE base species) use the HOME female render instead.
async function resolveArtworkUrl(entry, data, isShiny) {
  const art = data?.sprites?.other?.['official-artwork'];
  const official = isShiny ? art?.front_shiny : art?.front_default;

  if (!entry.synthetic && official) return official;

  if (entry.rawName.endsWith('-female') && entry.dexId) {
    const homeUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${isShiny ? 'shiny/' : ''}female/${entry.dexId}.png`;
    return (await probeImage(homeUrl)) ? homeUrl : null;
  }
  return null;
}

async function fetchRandomPokemonWithArtwork(isShiny = false, gensOverride = null, budgetMs = 20000) {
  const MAX_ATTEMPTS = 50;
  const deadline = Date.now() + budgetMs; // give up (and let the caller recover) instead of hanging

  // Filter by name first (no network) so we never spend a fetch on a form we'd reject anyway.
  const pool = allPokemonList.filter(p =>
    !activeSessionUsedPokemon.has(p.rawName) && isPokemonInSelectedGens(p, null, gensOverride)
  );

  for (let attempt = 0; attempt < MAX_ATTEMPTS && pool.length > 0 && Date.now() < deadline; attempt++) {
    const pokemon = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];   // never retry the same one

    try {
      // Never let one slow request run past the overall budget.
      const data = await fetchJsonWithTimeout(pokemon.url, Math.max(1500, Math.min(8000, deadline - Date.now())));

      // Re-check with exact species data (the name-based gen is only a guess for forms)
      if (!isPokemonInSelectedGens(pokemon, data, gensOverride)) continue;

      const artwork = await resolveArtworkUrl(pokemon, data, isShiny);

      if (artwork) {
        activeSessionUsedPokemon.add(pokemon.rawName);
        return { rawName: pokemon.rawName, displayName: pokemon.displayName, image: artwork };
      }
    } catch (e) {
      continue;
    }
  }

  throw new Error('Could not find a matching Pokémon after multiple attempts');
}

function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 15000);
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
  });
}

function startTeaserCarousel(targetImgEl, isShiny = false) {
  clearInterval(teaserInterval);
  teaserInterval = null;
  targetImgEl.style.filter = 'blur(12px)';
  
  const cycleImage = () => {
    const randomId = Math.floor(Math.random() * 898) + 1;
    targetImgEl.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${isShiny ? 'shiny/' : ''}${randomId}.png`;
  };

  cycleImage();
  teaserInterval = setInterval(cycleImage, 1500);
}

// ==========================================
// 2. DAILY GAME LOGIC
// ==========================================
startBtn.addEventListener('click', async () => {
  clearInterval(teaserInterval);
  teaserInterval = null;
  activeSessionUsedPokemon.clear();
  startScreenEl.classList.add('hidden');
  searchWrapperEl.classList.remove('hidden');
  buttonsEl.classList.remove('hidden');

  await loadNewPokemon();
});

async function loadNewPokemon(isRestoring = false) {
  imageOverlayEl.classList.add('visible');

  let data;
  try {
    data = await fetchPokemonByQueueIndex(round - 1);
  } catch (e) {
    console.error('Daily load failed:', e);
    showLoadFailure(resultEl, imageOverlayEl, () => loadNewPokemon(isRestoring));
    return;
  }
  answer = { rawName: data.rawName, displayName: data.displayName, image: data.image };

  await preloadImage(answer.image);

  if (!isRestoring) currentStage = 0;

  imageEl.src = answer.image;
  applyStage(true);
  updateRoundLabel();

  imageOverlayEl.classList.remove('visible');

  resultEl.textContent = '';
  inputEl.disabled = false;
  inputEl.value = '';
  skipBtn.disabled = false;
  nextBtn.classList.add('hidden');
  inputEl.focus();
}

function applyStage(instant = false) {
  const stage = stages[currentStage];
  if (instant) {
    imageEl.style.transition = 'none';
    imageEl.style.filter = `blur(${stage.blur}px)`;
    void imageEl.offsetHeight;
    imageEl.style.transition = 'filter 0.4s ease';
  } else {
    imageEl.style.filter = `blur(${stage.blur}px)`;
  }
  stageLabelEl.textContent = `Stage ${currentStage + 1} - Guess for ${stage.points} points`;
  stageLabelEl.classList.remove('stage-pending');
}

function updateRoundLabel() {
  roundLabelEl.textContent = `Round ${round} / ${TOTAL_ROUNDS} - Score: ${totalScore}`;
}

inputEl.addEventListener('input', () => {
  setupAutocomplete(inputEl, suggestionsEl, handleGuess);
});
attachAutocompleteKeyboardNav(inputEl, suggestionsEl, () => {
  if (!skipBtn.disabled) skipBtn.click();
});

function setupAutocomplete(inputField, suggestionsContainer, selectHandler) {
  const query = inputField.value.toLowerCase().trim();
  suggestionsContainer.innerHTML = '';

  if (query === '') return;

  // One pass over the list using the precomputed lowercase names / excluded flag, stopping
  // as soon as 8 "starts with" matches are found. Same results and order as before (names
  // starting with the query first, then other matches in list order), minus the freeze.
  const MAX_SUGGESTIONS = 8;
  const startsWithQuery = [];
  const otherMatches = [];
  for (const p of allPokemonList) {
    if (p.excluded) continue;
    const pos = p.lc.indexOf(query);
    if (pos === 0) {
      startsWithQuery.push(p);
      if (startsWithQuery.length >= MAX_SUGGESTIONS) break;
    } else if (otherMatches.length < MAX_SUGGESTIONS && (pos > 0 || p.rawLc.includes(query))) {
      otherMatches.push(p);
    }
  }
  const matches = startsWithQuery.concat(otherMatches).slice(0, MAX_SUGGESTIONS);

  if (matches.length === 0) {
    suggestionsContainer.innerHTML = '<div class="suggestion-item suggestion-empty">No Pokémon found</div>';
    return;
  }

  matches.forEach(pkmn => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = pkmn.displayName;
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => selectHandler(pkmn));
    suggestionsContainer.appendChild(item);
  });
}

function attachAutocompleteKeyboardNav(inputField, suggestionsContainer, onEmptyEnter = null) {
  let activeIndex = -1;

  const getItems = () =>
    Array.from(suggestionsContainer.querySelectorAll('.suggestion-item:not(.suggestion-empty)'));

  const setActive = (items, index) => {
    items.forEach(el => el.classList.remove('active'));
    if (index >= 0 && items[index]) {
      items[index].classList.add('active');
      items[index].scrollIntoView({ block: 'nearest' });
    }
  };

  inputField.addEventListener('input', () => {
    activeIndex = -1;
  });

  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inputField.value.trim() === '' && typeof onEmptyEnter === 'function') {
      e.preventDefault();
      e.stopPropagation();
      onEmptyEnter();
      return;
    }

    const items = getItems();
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive(items, activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const target = items[activeIndex] || items[0];
      if (target) target.click();
      activeIndex = -1;
    } else if (e.key === 'Escape') {
      suggestionsContainer.innerHTML = '';
      activeIndex = -1;
    }
  });
}

function handleGuess(guessedPkmn) {
  suggestionsEl.innerHTML = '';
  inputEl.value = '';

  if (guessedPkmn.rawName === answer.rawName) {
    const points = stages[currentStage].points;
    lastRoundPoints = points;
    totalScore += points;
    correctCount++;
    imageEl.style.filter = 'blur(0px)';
    resultEl.textContent = `Correct! It's ${answer.displayName} - scored ${points} pts!`;
    launchConfetti();
    playCorrectSound();
    dexLog(answer.rawName, true, false, currentStage + 1, imageEl, 'daily');
    endRound();
  } else {
    playWrongSound();
    nextStage(`Wrong guess - it's not ${guessedPkmn.displayName}.`);
  }
}

skipBtn.addEventListener('click', () => {
  playWrongSound();
  nextStage('Skipped.');
});

function nextStage(message) {
  if (currentStage >= stages.length - 1) {
    imageEl.style.filter = 'blur(0px)';
    resultEl.textContent = `Out of guesses - it was ${answer.displayName}. 0 points.`;
    lastRoundPoints = 0;
    dexLog(answer.rawName, false, false, 0, null, 'daily');
    endRound();
    return;
  }
  currentStage++;
  applyStage();
  resultEl.textContent = message;
  saveDailyProgress(false, false);
  inputEl.focus();
}

function endRound() {
  inputEl.disabled = true;
  skipBtn.disabled = true;
  updateRoundLabel();
  if (answer) {
    dailyHistory[round - 1] = { rawName: answer.rawName, displayName: answer.displayName, image: answer.image, points: lastRoundPoints };
  }

  if (round >= TOTAL_ROUNDS) {
    resultEl.textContent += ` Game over! Final score: ${totalScore} / 25.`;
    nextBtn.classList.add('hidden');
    stageLabelEl.classList.add('stage-pending');
    saveDailyProgress(true, false);
    const stats = updatePersistentStats(totalScore);
    showGameOverPanel(stats);
  } else {
    nextBtn.classList.remove('hidden');
    saveDailyProgress(false, true);
  }
}

const STREAK_KEY = 'pokeblur-streak';

function getStreakData() {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY));
    if (s && Number.isFinite(s.current) && Number.isFinite(s.best)) return s;
  } catch (e) {}
  return { current: 0, best: 0, lastDate: null };
}

function recordDailyStreak() {
  const data = getStreakData();
  const today = getSeedString(selectedDate);
  if (data.lastDate === today) return data;

  const yesterday = new Date(selectedDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const continued = data.lastDate === getSeedString(yesterday);

  data.current = continued ? data.current + 1 : 1;
  data.best = Math.max(data.best, data.current);
  data.lastDate = today;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch (e) {}
  return data;
}

function showGameOverPanel(stats) {
  const avg = (stats.totalPoints / stats.gamesPlayed).toFixed(1);

  finalScoreText.textContent = `Final Score: ${totalScore} / 25`;
  statsLine.textContent = `You correctly guessed ${correctCount} out of ${TOTAL_ROUNDS} Pokémon!`;
  statPlayed.textContent = stats.gamesPlayed;
  statAvg.textContent = avg;

  const streak = recordDailyStreak();
  statStreak.textContent = streak.current;
  streakBestEl.textContent = `Best streak: ${streak.best}`;

  dailyReviewEl.classList.add('hidden');
  gameOverPanel.classList.remove('hidden');
  startDailyCountdown();
}

async function getDailyRoundData(roundNum) {
  const cached = dailyHistory[roundNum - 1];
  if (cached && cached.rawName) return cached;
  const data = await fetchPokemonByQueueIndex(roundNum - 1);
  const entry = { rawName: data.rawName, displayName: data.displayName, image: data.image, points: null };
  dailyHistory[roundNum - 1] = entry;
  return entry;
}

function updateReviewChips() {
  dailyReviewChips.forEach(chip => {
    const n = parseInt(chip.getAttribute('data-round'), 10);
    const entry = dailyHistory[n - 1];
    chip.classList.toggle('active', n === dailyReviewRound);
    chip.classList.toggle('hit', !!entry && entry.points > 0);
    chip.classList.toggle('miss', !!entry && entry.points === 0);
  });
}

async function showDailyReview(roundNum) {
  dailyReviewRound = roundNum;
  gameOverPanel.classList.add('hidden');
  searchWrapperEl.classList.add('hidden');
  buttonsEl.classList.add('hidden');
  dailyReviewEl.classList.remove('hidden');
  resultEl.textContent = '';
  dailyReviewNameEl.textContent = 'Loading...';
  dailyReviewPointsEl.textContent = '';
  updateReviewChips();

  const entry = await getDailyRoundData(roundNum);
  if (dailyReviewRound !== roundNum) return;

  imageEl.style.filter = 'blur(0px)';
  imageEl.src = entry.image;
  dailyReviewNameEl.textContent = entry.displayName;
  const maxPts = stages[0].points;
  dailyReviewPointsEl.textContent = entry.points == null
    ? ''
    : (entry.points > 0 ? `${entry.points}/${maxPts}` : `0/${maxPts} - not guessed`);
  updateReviewChips();
}

gameOverCloseBtn.addEventListener('click', () => showDailyReview(TOTAL_ROUNDS));
dailyReviewResultsBtn.addEventListener('click', () => {
  dailyReviewEl.classList.add('hidden');
  gameOverPanel.classList.remove('hidden');
});
dailyReviewChips.forEach(chip => {
  chip.addEventListener('click', () => showDailyReview(parseInt(chip.getAttribute('data-round'), 10)));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !gameOverPanel.classList.contains('hidden') && !dailyViewEl.classList.contains('hidden')) {
    showDailyReview(TOTAL_ROUNDS);
  }
});

function formatCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const sec = String(t % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function startDailyCountdown() {
  if (dailyCountdownTimer) return;
  const nextPuzzleAt = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);

  const tick = () => {
    const remaining = nextPuzzleAt - new Date();
    if (remaining <= 0) {
      clearInterval(dailyCountdownTimer);
      dailyCountdownTimer = null;
      document.querySelectorAll('.daily-countdown').forEach(el => {
        el.textContent = '';
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = 'New puzzle ready - play now';
        btn.addEventListener('click', () => window.location.reload());
        el.appendChild(btn);
      });
      return;
    }
    document.querySelectorAll('.daily-countdown-time').forEach(el => {
      el.textContent = formatCountdown(remaining);
    });
  };

  tick();
  dailyCountdownTimer = setInterval(tick, 1000);
}

function pointsToEmoji(points) {
  if (points == null) return '\u2B1C';
  if (points >= 4) return '\uD83D\uDFE9';
  if (points >= 2) return '\uD83D\uDFE8';
  if (points >= 1) return '\uD83D\uDFE7';
  return '\uD83D\uDFE5';
}

function buildShareText() {
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  const dateStr = selectedDate.toLocaleDateString('en-US', options);
  const grid = Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
    const entry = dailyHistory[i];
    return pointsToEmoji(entry ? entry.points : null);
  }).join('');

  const lines = [
    `PokéBlur - ${dateStr}`,
    `${grid} ${totalScore}/${TOTAL_ROUNDS * stages[0].points}`
  ];
  const streak = getStreakData();
  if (streak.current >= 2) lines.push(`\uD83D\uDD25 ${streak.current}-day streak`);
  lines.push('https://vibedbean.github.io/');
  return lines.join('\n');
}

shareBtn.addEventListener('click', () => {
  const originalText = shareBtn.textContent;
  const flash = (msg) => {
    shareBtn.textContent = msg;
    setTimeout(() => { shareBtn.textContent = originalText; }, 2000);
  };
  navigator.clipboard.writeText(buildShareText()).then(
    () => flash('Copied!'),
    () => flash('Copy failed')
  );
});

nextBtn.addEventListener('click', async () => {
  if (round >= TOTAL_ROUNDS) return;
  nextBtn.disabled = true;
  round++;
  saveDailyProgress(false, false);
  await loadNewPokemon();
  setTimeout(() => { nextBtn.disabled = false; }, 500);
});

// ==========================================
// 3. UNLIMITED MODE LOGIC
// ==========================================
function resetUnlimitedToStartScreen() {
  clearInterval(teaserInterval);
  teaserInterval = null;

  unlimitedStartScreen.classList.remove('hidden');
  genFilterContainer.classList.remove('hidden');
  unlimitedSearchWrapper.classList.add('hidden');
  unlimitedButtons.classList.add('hidden');
  unlimitedGameOverPanel.classList.add('hidden');

  unlimitedRound = 1;
  unlimitedTotalScore = 0;
  unlimitedRoundLabel.textContent = 'Round 1 / 5 - Score: 0';
  unlimitedStageLabel.textContent = 'Stage 1 - Guess for 5 points';
  unlimitedStageLabel.classList.add('stage-pending');
  unlimitedResultEl.textContent = '';
}

unlimitedStartBtn.addEventListener('click', async () => {
  clearInterval(teaserInterval);
  teaserInterval = null;
  activeSessionUsedPokemon.clear();

  unlimitedStartScreen.classList.add('hidden');
  genFilterContainer.classList.add('hidden');
  unlimitedSearchWrapper.classList.remove('hidden');
  unlimitedButtons.classList.remove('hidden');

  await startUnlimitedGame();
});

async function startUnlimitedGame() {
  unlimitedRound = 1;
  unlimitedTotalScore = 0;
  unlimitedGameOverPanel.classList.add('hidden');
  
  await loadUnlimitedPokemon();
}

async function loadUnlimitedPokemon() {
  unlimitedImageOverlay.classList.add('visible');

  const isShiny = (unlimitedMode === 'shiny');
  let data;
  try {
    data = await fetchRandomPokemonWithArtwork(isShiny);
  } catch (e) {
    console.error('Unlimited load failed:', e);
    showLoadFailure(unlimitedResultEl, unlimitedImageOverlay, loadUnlimitedPokemon);
    return;
  }

  unlimitedAnswer = { rawName: data.rawName, displayName: data.displayName, image: data.image };

  await preloadImage(unlimitedAnswer.image);

  unlimitedCurrentStage = 0;
  unlimitedImageEl.src = unlimitedAnswer.image;
  applyUnlimitedStage(true);
  updateUnlimitedRoundLabel();

  unlimitedImageOverlay.classList.remove('visible');

  unlimitedResultEl.textContent = '';
  unlimitedInputEl.disabled = false;
  unlimitedInputEl.value = '';
  unlimitedSkipBtn.disabled = false;
  unlimitedNextBtn.classList.add('hidden');
  unlimitedInputEl.focus();
}

function applyUnlimitedStage(instant = false) {
  const stage = stages[unlimitedCurrentStage];
  if (instant) {
    unlimitedImageEl.style.transition = 'none';
    unlimitedImageEl.style.filter = `blur(${stage.blur}px)`;
    void unlimitedImageEl.offsetHeight;
    unlimitedImageEl.style.transition = 'filter 0.4s ease';
  } else {
    unlimitedImageEl.style.filter = `blur(${stage.blur}px)`;
  }
  unlimitedStageLabel.textContent = `Stage ${unlimitedCurrentStage + 1} - Guess for ${stage.points} points`;
  unlimitedStageLabel.classList.remove('stage-pending');
}

function updateUnlimitedRoundLabel() {
  unlimitedRoundLabel.textContent = `Round ${unlimitedRound} / ${TOTAL_ROUNDS} - Score: ${unlimitedTotalScore}`;
}

unlimitedInputEl.addEventListener('input', () => {
  setupAutocomplete(unlimitedInputEl, unlimitedSuggestionsEl, handleUnlimitedGuess);
});
attachAutocompleteKeyboardNav(unlimitedInputEl, unlimitedSuggestionsEl, () => {
  if (!unlimitedSkipBtn.disabled) unlimitedSkipBtn.click();
});

function handleUnlimitedGuess(guessedPkmn) {
  unlimitedSuggestionsEl.innerHTML = '';
  unlimitedInputEl.value = '';

  if (guessedPkmn.rawName === unlimitedAnswer.rawName) {
    const points = stages[unlimitedCurrentStage].points;
    unlimitedTotalScore += points;
    unlimitedImageEl.style.filter = 'blur(0px)';
    unlimitedResultEl.textContent = `Correct! It's ${unlimitedAnswer.displayName} - scored ${points} pts!`;
    launchConfetti();
    playCorrectSound();
    dexLog(unlimitedAnswer.rawName, true, unlimitedMode === 'shiny', unlimitedCurrentStage + 1, unlimitedImageEl, 'unlimited');
    endUnlimitedRound();
  } else {
    playWrongSound();
    nextUnlimitedStage(`Wrong guess - it's not ${guessedPkmn.displayName}.`);
  }
}

unlimitedSkipBtn.addEventListener('click', () => {
  playWrongSound();
  nextUnlimitedStage('Skipped.');
});

function nextUnlimitedStage(message) {
  if (unlimitedCurrentStage >= stages.length - 1) {
    unlimitedImageEl.style.filter = 'blur(0px)';
    unlimitedResultEl.textContent = `Out of guesses - it was ${unlimitedAnswer.displayName}. 0 points.`;
    dexLog(unlimitedAnswer.rawName, false, unlimitedMode === 'shiny', 0, null, 'unlimited');
    endUnlimitedRound();
    return;
  }
  unlimitedCurrentStage++;
  applyUnlimitedStage();
  unlimitedResultEl.textContent = message;
  unlimitedInputEl.focus();
}

function endUnlimitedRound() {
  unlimitedInputEl.disabled = true;
  unlimitedSkipBtn.disabled = true;
  updateUnlimitedRoundLabel();

  if (unlimitedRound >= TOTAL_ROUNDS) {
    unlimitedResultEl.textContent += ` Game over! Score: ${unlimitedTotalScore} / 25.`;
    unlimitedNextBtn.classList.add('hidden');
    
    unlimitedFinalScoreText.textContent = `Final Score: ${unlimitedTotalScore} / 25`;
    unlimitedGameOverPanel.classList.remove('hidden');
  } else {
    unlimitedNextBtn.classList.remove('hidden');
  }
}

unlimitedNextBtn.addEventListener('click', async () => {
  if (unlimitedRound >= TOTAL_ROUNDS) return;
  unlimitedNextBtn.disabled = true;
  unlimitedRound++;
  await loadUnlimitedPokemon();
  setTimeout(() => { unlimitedNextBtn.disabled = false; }, 500);
});

playAgainBtn.addEventListener('click', () => {
  resetUnlimitedToStartScreen();
  startTeaserCarousel(unlimitedImageEl, unlimitedMode === 'shiny');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  if (!dailyViewEl.classList.contains('hidden') &&
      !nextBtn.classList.contains('hidden') && !nextBtn.disabled) {
    nextBtn.click();
  } else if (!unlimitedViewEl.classList.contains('hidden') &&
             !unlimitedNextBtn.classList.contains('hidden') && !unlimitedNextBtn.disabled) {
    unlimitedNextBtn.click();
  }
});

// ==========================================
// 4. TIMED MODE LOGIC
// ==========================================
function showTimedHighScoreLabel() {
  const best = getTimedRecord(timedDuration, selectedGenerations);
  timedHsScoreEl.textContent = best ? best.score : '-';
  timedHsSettingEl.textContent = `${formatTimedDuration(timedDuration)} · ${timedGenLabel(selectedGenerations)}`;
  timedHsDetailEl.textContent = best ? `${best.correct} correct` : 'No score yet - set one!';
  renderTimedRecordsList();
}

function renderTimedRecordsList() {
  const all = getTimedRecords();
  const currentKey = timedRecordKey(timedDuration, selectedGenerations);
  const entries = Object.keys(all).map(key => {
    const [secStr, genKey] = key.split('|');
    const gens = genKey === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : genKey.split('-').map(Number);
    return { key, seconds: parseInt(secStr, 10), gens, rec: all[key] };
  }).sort((x, y) => x.seconds - y.seconds || x.key.localeCompare(y.key));

  timedRecordsListEl.innerHTML = '';
  timedRecordsEl.classList.toggle('hidden', entries.length === 0);

  entries.forEach(e => {
    const li = document.createElement('li');
    if (e.key === currentKey) li.className = 'current';
    const left = document.createElement('span');
    left.textContent = `${formatTimedDuration(e.seconds)} · ${timedGenLabel(e.gens)}`;
    const right = document.createElement('strong');
    right.textContent = `${e.rec.score} pts (${e.rec.correct})`;
    li.append(left, right);
    timedRecordsListEl.appendChild(li);
  });
}

function setupTimedMode() {
  timedDurationButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      timedDurationButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const d = btn.getAttribute('data-duration');
      if (d === 'custom') {
        timedCustomWrapper.classList.remove('hidden');
        const val = parseInt(timedCustomInput.value, 10);
        timedDuration = (val >= 10 && val <= 600) ? val : 60;
      } else {
        timedCustomWrapper.classList.add('hidden');
        timedDuration = parseInt(d, 10);
      }
      showTimedHighScoreLabel();
    });
  });

  timedCustomInput.addEventListener('input', () => {
    const val = parseInt(timedCustomInput.value, 10);
    if (val >= 10 && val <= 600) {
      timedDuration = val;
      showTimedHighScoreLabel();
    }
  });

  timedStartBtn.addEventListener('click', startTimedGame);
  timedPlayAgainBtn.addEventListener('click', resetTimedToStartScreen);

  if (timedShareBtn) {
    timedShareBtn.addEventListener('click', () => {
      const originalText = timedShareBtn.textContent;
      const textToCopy = `PokéBlur Timed Mode - ${formatTimedDuration(timedRunDuration)} · ${timedGenLabel(timedRunGens)}\nScore: ${timedScore} pts (${timedCorrectCount} correct)\nhttps://vibedbean.github.io/`;
      navigator.clipboard.writeText(textToCopy).then(
        () => {
          timedShareBtn.textContent = 'Copied!';
          setTimeout(() => { timedShareBtn.textContent = originalText; }, 2000);
        },
        () => {
          timedShareBtn.textContent = 'Copy failed';
          setTimeout(() => { timedShareBtn.textContent = originalText; }, 2000);
        }
      );
    });
  }

  timedInputEl.addEventListener('input', () => {
    if (timedRoundLocked) { timedInputEl.value = ''; timedSuggestionsEl.innerHTML = ''; return; }
    setupAutocomplete(timedInputEl, timedSuggestionsEl, handleTimedGuess);
  });
  attachAutocompleteKeyboardNav(timedInputEl, timedSuggestionsEl, () => {
    if (!timedSkipBtn.disabled) timedSkipBtn.click();
  });

  timedSkipBtn.addEventListener('click', () => {
    if (!timedActive) return;
    playWrongSound();
    nextTimedStage('Skipped.');
  });

  showTimedHighScoreLabel();
}

function resetTimedToStartScreen() {
  pauseTimedTimer();
  clearInterval(teaserInterval);
  teaserInterval = null;

  timedActive = false;
  timedScore = 0;
  timedCorrectCount = 0;
  timedTimeLeft = 0;

  timedSetupContainer.classList.remove('hidden');
  timedStartScreen.classList.remove('hidden');
  timedSearchWrapper.classList.add('hidden');
  timedButtons.classList.add('hidden');
  timedGameOverPanel.classList.add('hidden');
  timedCountdownEl.classList.add('hidden');
  timedCountdownEl.classList.remove('urgent');

  timedHighScoreCard.classList.remove('hidden');
  timedStatsLabel.classList.add('hidden');
  showTimedHighScoreLabel();
  timedStageLabel.classList.add('stage-pending');
  timedStageLabel.textContent = 'Stage 1 - Guess for 5 points';
  timedResultEl.textContent = '';

  startTeaserCarousel(timedImageEl, false);
}

async function startTimedGame() {
  clearInterval(teaserInterval);
  teaserInterval = null;
  activeSessionUsedPokemon.clear();

  timedActive = true;
  timedRoundLocked = false;
  timedRunDuration = timedDuration;
  timedRunGens = new Set(selectedGenerations);
  timedScore = 0;
  timedCorrectCount = 0;
  timedTimeLeft = timedDuration;

  timedSetupContainer.classList.add('hidden');
  timedHighScoreCard.classList.add('hidden');
  timedStatsLabel.classList.remove('hidden');
  timedStartScreen.classList.add('hidden');
  timedSearchWrapper.classList.remove('hidden');
  timedButtons.classList.remove('hidden');
  timedGameOverPanel.classList.add('hidden');
  timedCountdownEl.classList.remove('hidden');
  timedCountdownEl.classList.remove('urgent');
  timedCountdownEl.textContent = timedTimeLeft;

  updateTimedStatsLabel();
  await loadTimedPokemon();

  resumeTimedTimerIfNeeded();
}

function timedTick() {
  if (timedViewEl.classList.contains('hidden')) {
    pauseTimedTimer();
    return;
  }
  if (!timedActive) {
    pauseTimedTimer();
    return;
  }

  timedTimeLeft--;
  timedCountdownEl.textContent = Math.max(timedTimeLeft, 0);
  if (timedTimeLeft <= 10) timedCountdownEl.classList.add('urgent');

  if (timedTimeLeft <= 0) {
    endTimedGame();
  }
}

function pauseTimedTimer() {
  if (timedInterval) {
    clearInterval(timedInterval);
    timedInterval = null;
  }
}

function resumeTimedTimerIfNeeded() {
  if (timedActive && timedTimeLeft > 0 && !timedInterval && !timedViewEl.classList.contains('hidden')) {
    timedInterval = setInterval(timedTick, 1000);
  }
}

async function loadTimedPokemon() {
  timedImageOverlay.classList.add('visible');

  let data;
  try {
    data = await fetchRandomPokemonWithArtwork(false, selectedGenerations);
  } catch (e) {
    console.error('Timed load failed:', e);
    if (timedActive) showLoadFailure(timedResultEl, timedImageOverlay, loadTimedPokemon);
    return;
  }

  if (!timedActive) return;

  timedAnswer = { rawName: data.rawName, displayName: data.displayName, image: data.image };
  await preloadImage(timedAnswer.image);
  if (!timedActive) return;

  timedCurrentStage = 0;
  timedImageEl.src = timedAnswer.image;
  applyTimedStage(true);

  timedImageOverlay.classList.remove('visible');
  timedResultEl.textContent = '';
  timedRoundLocked = false;
  timedInputEl.disabled = false;
  timedInputEl.value = '';
  timedSkipBtn.disabled = false;
  timedInputEl.focus();
}

function applyTimedStage(instant = false) {
  const stage = stages[timedCurrentStage];
  if (instant) {
    timedImageEl.style.transition = 'none';
    timedImageEl.style.filter = `blur(${stage.blur}px)`;
    void timedImageEl.offsetHeight;
    timedImageEl.style.transition = 'filter 0.4s ease';
  } else {
    timedImageEl.style.filter = `blur(${stage.blur}px)`;
  }
  timedStageLabel.textContent = `Stage ${timedCurrentStage + 1} - Guess for ${stage.points} points`;
  timedStageLabel.classList.remove('stage-pending');
}

function updateTimedStatsLabel() {
  timedStatsLabel.textContent = `Score: ${timedScore} - Correct: ${timedCorrectCount}`;
}

function handleTimedGuess(guessedPkmn) {
  if (!timedActive || timedRoundLocked) return;
  timedSuggestionsEl.innerHTML = '';
  timedInputEl.value = '';

  if (guessedPkmn.rawName === timedAnswer.rawName) {
    const points = stages[timedCurrentStage].points;
    timedScore += points;
    timedCorrectCount++;
    updateTimedStatsLabel();
    timedImageEl.style.filter = 'blur(0px)';
    timedResultEl.textContent = `Correct! It's ${timedAnswer.displayName} - scored ${points} pts!`;
    launchConfetti();
    playCorrectSound();
    dexLog(timedAnswer.rawName, true, false, timedCurrentStage + 1, timedImageEl, 'timed');
    advanceTimedRound();
  } else {
    playWrongSound();
    nextTimedStage(`Wrong guess - it's not ${guessedPkmn.displayName}.`);
  }
}

function nextTimedStage(message) {
  if (!timedActive) return;
  if (timedCurrentStage >= stages.length - 1) {
    timedImageEl.style.filter = 'blur(0px)';
    timedResultEl.textContent = `Out of guesses - it was ${timedAnswer.displayName}. 0 points.`;
    dexLog(timedAnswer.rawName, false, false, 0, null, 'timed');
    advanceTimedRound();
    return;
  }
  timedCurrentStage++;
  applyTimedStage();
  timedResultEl.textContent = message;
}

function advanceTimedRound() {
  timedRoundLocked = true;
  timedSkipBtn.disabled = true;

  setTimeout(async () => {
    if (!timedActive) return;
    await loadTimedPokemon();
  }, 900);
}

function endTimedGame() {
  timedActive = false;
  pauseTimedTimer();

  timedInputEl.disabled = true;
  timedSkipBtn.disabled = true;
  timedSuggestionsEl.innerHTML = '';
  timedSearchWrapper.classList.add('hidden');
  timedButtons.classList.add('hidden');

  timedFinalScoreText.textContent = `Final Score: ${timedScore} (${timedCorrectCount} correct in ${formatTimedDuration(timedRunDuration)})`;
  const isNewBest = saveTimedRecord(timedRunDuration, timedRunGens, timedScore, timedCorrectCount);
  const best = getTimedRecord(timedRunDuration, timedRunGens);
  const settingText = `${formatTimedDuration(timedRunDuration)} · ${timedGenLabel(timedRunGens)}`;
  timedFinalBestText.classList.toggle('new-best', isNewBest);
  timedFinalBestText.textContent = isNewBest
    ? `New high score! (${settingText})`
    : (best ? `Your best (${settingText}): ${best.score} pts` : '');
  timedGameOverPanel.classList.remove('hidden');
}

// ==========================================
// 5. REVERSE MODE LOGIC
// ==========================================
const reverseState = {
  currentRound: 1,
  maxRounds: 5,
  totalScore: 0,
  highScore: 0,
  targetPokemon: null,
  targetDetails: null,
  revealedHints: new Set(),
  mustFlipHint: false,
  currentWorth: 0,
  roundActive: false
};

const reverseElements = {
  view: document.getElementById('reverse-view'),
  navBtn: document.getElementById('mode-reverse-btn'),
  roundLabel: document.getElementById('reverse-round-label'),
  rewardBox: document.getElementById('reverse-reward-box'),
  currentValue: document.getElementById('reverse-current-value'),
  startScreen: document.getElementById('reverse-start-screen'),
  startBtn: document.getElementById('reverse-start-btn'),
  highScoreDisplay: document.getElementById('reverse-high-score-display'),
  gamePlay: document.getElementById('reverse-game-play'),
  hintTiles: document.querySelectorAll('#reverse-game-play .hint-tile'),
  statusMsg: document.getElementById('reverse-status-msg'),
  searchWrapper: document.getElementById('reverse-search-wrapper'),
  guessInput: document.getElementById('reverse-guess-input'),
  suggestions: document.getElementById('reverse-suggestions'),
  skipBtn: document.getElementById('reverse-skip-btn'),
  nextBtn: document.getElementById('reverse-next-btn'),
  resultMsg: document.getElementById('reverse-result-message'),
  gameOverPanel: document.getElementById('reverse-game-over-panel'),
  finalScoreText: document.getElementById('reverse-final-score-text'),
  finalHighScoreText: document.getElementById('reverse-final-highscore-text'),
  playAgainBtn: document.getElementById('reverse-play-again-btn')
};

reverseElements.navBtn.addEventListener('click', function() {
  switchTab(this, reverseElements.view);
  updateReverseHighScoreDisplay();
});

reverseElements.startBtn.addEventListener('click', startReverseGame);
reverseElements.playAgainBtn.addEventListener('click', startReverseGame);
reverseElements.skipBtn.addEventListener('click', giveUpReverseRound);
reverseElements.nextBtn.addEventListener('click', nextReverseRound);

reverseElements.hintTiles.forEach(tile => {
  tile.addEventListener('click', () => handleHintClick(tile));
});

reverseElements.guessInput.addEventListener('input', handleReverseAutocomplete);

document.addEventListener('mousedown', (e) => {
  if (!reverseElements.searchWrapper?.contains(e.target)) {
    reverseElements.suggestions?.classList.remove('active');
  }
});

function updateReverseHighScoreDisplay() {
  reverseState.highScore = getReverseHighScore();
  if (reverseElements.highScoreDisplay) {
    reverseElements.highScoreDisplay.textContent = `High Score: ${reverseState.highScore.toLocaleString()} pts`;
  }
}

function startReverseGame() {
  activeSessionUsedPokemon.clear();
  reverseState.currentRound = 1;
  reverseState.totalScore = 0;
  reverseState.highScore = getReverseHighScore();

  reverseElements.gameOverPanel.classList.add('hidden');
  reverseElements.startScreen.classList.add('hidden');
  reverseElements.rewardBox.classList.remove('hidden');
  reverseElements.gamePlay.classList.remove('hidden');
  
  setupReverseRound();
}

async function setupReverseRound() {
  reverseState.roundActive = false;
  reverseState.revealedHints.clear();
  reverseState.mustFlipHint = false;
  reverseElements.resultMsg.textContent = '';
  reverseElements.statusMsg.textContent = 'Make a guess or tap a category tile to reveal a hint!';
  reverseElements.statusMsg.style.color = '#dddddd';

  reverseElements.hintTiles.forEach(tile => {
    tile.classList.remove('revealed', 'must-flip');
    tile.disabled = false;
    tile.querySelector('.tile-value').textContent = '???';
  });

  reverseElements.skipBtn.classList.remove('hidden');
  reverseElements.nextBtn.classList.add('hidden');
  reverseElements.guessInput.disabled = false;
  reverseElements.guessInput.value = '';

  const validPool = allPokemonList.filter(p => isPokemonInSelectedGens(p) && !activeSessionUsedPokemon.has(p.rawName));
  const randomIndex = Math.floor(Math.random() * validPool.length);
  reverseState.targetPokemon = validPool[randomIndex];
  activeSessionUsedPokemon.add(reverseState.targetPokemon.rawName);

  reverseState.targetDetails = await fetchReversePokemonDetails(reverseState.targetPokemon);
  
  reverseState.currentWorth = validPool.length;
  reverseElements.currentValue.textContent = reverseState.currentWorth.toLocaleString();
  reverseState.roundActive = true;
  reverseElements.roundLabel.textContent = `Round ${reverseState.currentRound} / ${reverseState.maxRounds} - Score: ${reverseState.totalScore.toLocaleString()}`;
}

const MINIOR_CORES = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];

// Text for the "Form" hint tile. Token-based so "meganium"/"yanmega" are NOT Megas.
function describeForm(pokemon, data) {
  const rawName = (pokemon.rawName || '').toLowerCase();
  const tokens = rawName.split('-');

  if (tokens.includes('gmax')) return 'Gigantamax';
  if (tokens.includes('mega')) {
    const last = tokens[tokens.length - 1];
    return (last === 'x' || last === 'y') ? `Mega ${last.toUpperCase()}` : 'Mega';
  }
  if (tokens.includes('primal')) return 'Primal';
  if (rawName.endsWith('-female')) return 'Female';   // checked before is_default: injected forms fetch the male base

  if (tokens[0] === 'minior' && MINIOR_CORES.includes(tokens[1])) return `${capitalize(tokens[1])} Core`;

  if (tokens.includes('alola')) return 'Alolan';
  if (tokens.includes('galar')) return 'Galarian';
  if (tokens.includes('hisui')) return 'Hisuian';
  if (tokens.includes('paldea')) return 'Paldean';

  // Any other alternate form (deoxys-attack -> "Attack Form"); default forms stay "Base Form".
  const species = data?.species?.name || '';
  const suffix = species && rawName.startsWith(species + '-') ? rawName.slice(species.length + 1) : '';
  if (data?.is_default || !suffix) return 'Base Form';
  return `${suffix.split('-').map(capitalize).join(' ')} Form`;
}

async function fetchReversePokemonDetails(pokemon) {
  try {
    // pokemon.url is the form's own PokeAPI entry, so types/stats/size are form-specific
    // (charizard-mega-x -> Fire/Dragon). Injected female forms point at their base species.
    const res = await fetch(pokemon.url || `${POKEMON_URL_PREFIX}${pokemon.rawName}`);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();

    const rawName = (pokemon.rawName || '').toLowerCase();
    const bst = data.stats.reduce((acc, stat) => acc + stat.base_stat, 0);
    const gen = resolveGeneration(rawName, getSpeciesId(pokemon, data)) || 1;

    return {
      generation: `Gen ${gen}`,
      primaryType: data.types[0]?.type?.name ? capitalize(data.types[0].type.name) : 'Unknown',
      secondaryType: data.types[1]?.type?.name ? capitalize(data.types[1].type.name) : 'None',
      form: describeForm(pokemon, data),
      bst: `${bst} BST`,
      size: `${(data.height / 10).toFixed(1)}m / ${(data.weight / 10).toFixed(1)}kg`
    };
  } catch (err) {
    console.error('Error fetching Reverse Pokemon details:', err);
    return { 
      generation: 'Unknown', 
      primaryType: 'Unknown', 
      secondaryType: 'None', 
      form: describeForm(pokemon, null), 
      bst: '??? BST', 
      size: '???m / ???kg' 
    };
  }
}

function handleReverseAutocomplete() {
  const query = reverseElements.guessInput.value.toLowerCase().trim();
  reverseElements.suggestions.innerHTML = '';

  if (!query || reverseState.mustFlipHint) {
    reverseElements.suggestions.classList.remove('active');
    return;
  }

  // Cheap name check first, stop at 5 (same first-5-in-list-order result as before).
  const matches = [];
  for (const p of allPokemonList) {
    const name = p.lc || (p.displayName || p.rawName || '').toLowerCase();
    if (!name.includes(query) || !isPokemonInSelectedGens(p)) continue;
    matches.push(p);
    if (matches.length >= 5) break;
  }

  if (matches.length === 0) {
    reverseElements.suggestions.classList.remove('active');
    return;
  }

  matches.forEach(match => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';

    const pName = match.displayName || match.rawName;
    const pId = match.spriteId || match.dexId || match.id;

    const img = document.createElement('img');
    img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pId}.png`;
    img.alt = pName;
    img.className = 'suggestion-sprite';
    item.appendChild(img);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'suggestion-name';
    nameSpan.textContent = pName;
    item.appendChild(nameSpan);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      reverseElements.suggestions.classList.remove('active');
      submitReverseGuess(match);
    });

    reverseElements.suggestions.appendChild(item);
  });

  reverseElements.suggestions.classList.add('active');
}

function submitReverseGuess(guessedPokemon) {
  reverseElements.suggestions.classList.remove('active');
  reverseElements.guessInput.value = '';

  const targetName = reverseState.targetPokemon.displayName || reverseState.targetPokemon.rawName;
  const guessedName = guessedPokemon.displayName || guessedPokemon.rawName;

  if (guessedName.toLowerCase() === targetName.toLowerCase()) {
    reverseState.roundActive = false;
    reverseState.totalScore += reverseState.currentWorth;
    updateReverseHighScore(reverseState.totalScore);
    
    reverseElements.resultMsg.textContent = `Correct! It was ${targetName}! Scored +${reverseState.currentWorth.toLocaleString()} pts!`;
    reverseElements.resultMsg.style.color = '#4cd137';
    launchConfetti();
    playCorrectSound();
    revealAllTiles();
    finishReverseRound();
  } else {
    playWrongSound();
    const unrevealedTiles = Array.from(reverseElements.hintTiles).filter(
      tile => !reverseState.revealedHints.has(tile.dataset.category)
    );

    if (unrevealedTiles.length > 0) {
      reverseState.mustFlipHint = true;
      reverseElements.guessInput.disabled = true;
      reverseElements.statusMsg.textContent = 'Incorrect! Pick a category tile to reveal a hint before guessing again.';
      reverseElements.statusMsg.style.color = '#ff4757';
      unrevealedTiles.forEach(tile => tile.classList.add('must-flip'));
    } else {
      reverseElements.statusMsg.textContent = 'Incorrect! All hints are already flipped. Try another guess!';
      reverseElements.statusMsg.style.color = '#ff4757';
    }
  }
}

function handleHintClick(tile) {
  if (!reverseState.roundActive) return;
  const category = tile.dataset.category;
  if (reverseState.revealedHints.has(category)) return;

  reverseState.revealedHints.add(category);
  tile.classList.add('revealed');
  tile.classList.remove('must-flip');
  tile.querySelector('.tile-value').textContent = reverseState.targetDetails[category];

  recalculatePoolWorth();

  if (reverseState.mustFlipHint) {
    reverseState.mustFlipHint = false;
    reverseElements.hintTiles.forEach(t => t.classList.remove('must-flip'));
    reverseElements.guessInput.disabled = false;
    reverseElements.statusMsg.textContent = 'Hint revealed! You can now guess again.';
    reverseElements.statusMsg.style.color = '#dddddd';
  }
}

const TYPE_POOLS = {
  'Normal': 130, 'Fire': 80, 'Water': 160, 'Grass': 120, 'Electric': 60,
  'Ice': 50, 'Fighting': 60, 'Poison': 75, 'Ground': 75, 'Flying': 110,
  'Psychic': 100, 'Bug': 90, 'Rock': 75, 'Ghost': 65, 'Dragon': 60,
  'Steel': 60, 'Dark': 70, 'Fairy': 65
};

function recalculatePoolWorth() {
  const target = reverseState.targetDetails;
  if (!target) return;

  let remainingPoolSize = allPokemonList.filter(p => isPokemonInSelectedGens(p)).length;

  if (reverseState.revealedHints.has('generation')) {
    const genNum = parseInt(target.generation.replace('Gen ', ''), 10);
    remainingPoolSize = allPokemonList.filter(p => isPokemonInSelectedGens(p) && p.gen === genNum).length;
  }

  if (reverseState.revealedHints.has('primaryType')) {
    const typeShare = (TYPE_POOLS[target.primaryType] || 70) / 1025;
    remainingPoolSize = Math.ceil(remainingPoolSize * typeShare);
  }

  if (reverseState.revealedHints.has('secondaryType')) {
    if (target.secondaryType === 'None') {
      remainingPoolSize = Math.ceil(remainingPoolSize * 0.5);
    } else {
      const secShare = (TYPE_POOLS[target.secondaryType] || 60) / 1025;
      remainingPoolSize = Math.ceil(remainingPoolSize * secShare);
    }
  }

  if (reverseState.revealedHints.has('form')) {
    if (target.form !== 'Base Form') {
      remainingPoolSize = Math.max(1, Math.ceil(remainingPoolSize * 0.08));
    } else {
      remainingPoolSize = Math.ceil(remainingPoolSize * 0.85);
    }
  }

  if (reverseState.revealedHints.has('bst')) {
    remainingPoolSize = Math.ceil(remainingPoolSize * 0.25);
  }

  if (reverseState.revealedHints.has('size')) {
    remainingPoolSize = Math.ceil(remainingPoolSize * 0.35);
  }

  if (reverseState.revealedHints.size === 6) {
    reverseState.currentWorth = 1;
  } else {
    reverseState.currentWorth = Math.max(1, remainingPoolSize);
  }

  reverseElements.currentValue.textContent = reverseState.currentWorth.toLocaleString();
}

function giveUpReverseRound() {
  reverseState.roundActive = false;
  playWrongSound();
  const targetName = reverseState.targetPokemon.displayName || reverseState.targetPokemon.rawName;
  reverseElements.resultMsg.textContent = `Round skipped. It was ${targetName}.`;
  reverseElements.resultMsg.style.color = '#e1b12c';
  revealAllTiles();
  finishReverseRound();
}

function revealAllTiles() {
  reverseElements.hintTiles.forEach(tile => {
    const cat = tile.dataset.category;
    tile.querySelector('.tile-value').textContent = reverseState.targetDetails[cat];
    tile.classList.add('revealed');
    tile.classList.remove('must-flip');
  });
}

function finishReverseRound() {
  reverseElements.skipBtn.classList.add('hidden');
  reverseElements.nextBtn.classList.remove('hidden');
  reverseElements.roundLabel.textContent = `Round ${reverseState.currentRound} / ${reverseState.maxRounds} - Score: ${reverseState.totalScore.toLocaleString()}`;
}

function nextReverseRound() {
  if (reverseState.currentRound < reverseState.maxRounds) {
    reverseState.currentRound++;
    setupReverseRound();
  } else {
    reverseElements.gamePlay.classList.add('hidden');
    reverseElements.rewardBox.classList.add('hidden');
    reverseElements.resultMsg.textContent = ''; 
    
    reverseElements.gameOverPanel.classList.remove('hidden');
    
    const finalBest = updateReverseHighScore(reverseState.totalScore);
    reverseElements.finalScoreText.textContent = `Final Score: ${reverseState.totalScore.toLocaleString()} points!`;
    
    if (reverseElements.finalHighScoreText) {
      reverseElements.finalHighScoreText.textContent = `Personal Best: ${finalBest.toLocaleString()} pts`;
    }
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================================
// 6. EFFECTS & INIT
// ==========================================
// Records a finished round in the Pokédex (pokedex.js). Never lets a Pokédex problem break a game.
// stage: 1-6 when the round used the blur stages, 0 otherwise. el: the image that flies to the Pokédex button.
function dexLog(rawName, caught, shiny, stage, el, mode) {
  try {
    if (window.Pokedex) window.Pokedex.log({ rawName, caught, shiny, stage, el, mode });
  } catch (e) { console.error('[Pokédex]', e); }
}

function launchConfetti() {
  if (window.Settings && !window.Settings.get('celebrate')) return;   // celebrations off in Settings
  const colors = ['#e63946', '#f1a208', '#2a9d8f', '#457b9d', '#f4a261', '#8ac926'];
  const pieceCount = 50;

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
    piece.style.animationDelay = `${Math.random() * 0.2}s`;
    document.body.appendChild(piece);

    piece.addEventListener('animationend', () => piece.remove());
  }
}

let gameAudioCtx = null;
function getGameAudioCtx() {
  if (window.Settings && !window.Settings.get('sound')) return window.Settings.silentCtx();   // sound off in Settings
  if (!gameAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    gameAudioCtx = new AudioCtx();
  }
  if (gameAudioCtx.state === 'suspended') gameAudioCtx.resume();
  return gameAudioCtx;
}

function playCorrectSound() {
  const ctx = getGameAudioCtx();
  playTone(ctx, 880, ctx.currentTime, 0.15, 'sine');
  playTone(ctx, 1318.5, ctx.currentTime + 0.12, 0.2, 'sine');
}

function playWrongSound() {
  const ctx = getGameAudioCtx();
  playTone(ctx, 220, ctx.currentTime, 0.15, 'sawtooth');
  playTone(ctx, 164.81, ctx.currentTime + 0.12, 0.25, 'sawtooth');
}

function playTone(ctx, frequency, startTime, duration, type = 'sine') {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  gainNode.gain.setValueAtTime(0.15, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

const DAILY_STORAGE_KEY = 'pokeblur-daily-state';

function getDailyStorageKey() {
  const seedStr = getSeedString(selectedDate);
  return `${DAILY_STORAGE_KEY}-${seedStr}`;
}

function saveDailyProgress(isCompleted = false, awaitingNext = false) {
  const state = {
    date: getSeedString(selectedDate),
    round: round,
    totalScore: totalScore,
    correctCount: correctCount,
    currentStage: currentStage,
    completed: isCompleted,
    awaitingNext: awaitingNext,
    history: dailyHistory
  };
  localStorage.setItem(getDailyStorageKey(), JSON.stringify(state));
}

function loadDailyProgress() {
  const saved = localStorage.getItem(getDailyStorageKey());
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch (e) {
    return null;
  }
}

async function init() {
  migrateStorageIfNeeded();   // must run before anything reads the cached Pokémon list
  setupModeNavigation();
  setupGenButtons(genFilterContainer);
  setupGenButtons(timedGenFilterContainer);
  setupTimedMode();
  setupPuzzleHeader();
  updateReverseHighScoreDisplay();
  try {
    await loadPokemonList();
  } catch (e) {
    console.error('Pokémon list failed to load:', e);
    showPokemonListError();
    return;
  }

  const savedState = loadDailyProgress();

  if (savedState) {
    round = savedState.round;
    totalScore = savedState.totalScore;
    correctCount = savedState.correctCount;
    currentStage = savedState.currentStage;
    dailyHistory = Array.isArray(savedState.history) ? savedState.history : [];

    if (savedState.completed) {
      startScreenEl.classList.add('hidden');
      searchWrapperEl.classList.add('hidden');
      buttonsEl.classList.add('hidden');
      imageEl.style.filter = 'blur(0px)';
      updateRoundLabel();
      showGameOverPanel(getStoredStats());
      getDailyRoundData(TOTAL_ROUNDS).then(entry => { imageEl.src = entry.image; });
      return;
    }

    startScreenEl.classList.add('hidden');
    searchWrapperEl.classList.remove('hidden');
    buttonsEl.classList.remove('hidden');

    await loadNewPokemon(true);

    if (savedState.awaitingNext) {
      imageEl.style.filter = 'blur(0px)';
      inputEl.disabled = true;
      skipBtn.disabled = true;
      nextBtn.classList.remove('hidden');
      resultEl.textContent = `Round ${round} completed! Click Next Round to continue.`;
    }
    return;
  }

  startTeaserCarousel(imageEl, false);
}

function syncHeaderOffset() {
  const header = document.querySelector('.top-header');
  if (!header) return;
  document.documentElement.style.setProperty(
    '--header-height',
    `${header.offsetHeight}px`
  );
}

syncHeaderOffset();

window.addEventListener('resize', syncHeaderOffset);
window.addEventListener('orientationchange', syncHeaderOffset);

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(syncHeaderOffset);
}

if (window.ResizeObserver) {
  const header = document.querySelector('.top-header');
  if (header) new ResizeObserver(syncHeaderOffset).observe(header);
}

init();