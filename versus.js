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
// VERSUS MODE - 4-PLAYER REAL-TIME MULTIPLAYER (PeerJS)
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
const VS_MAX_PLAYERS = 4;
const VS_AUTO_ADVANCE_MS = 3000;

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
  const vsMyNameInput = document.getElementById('vs-my-name-input');
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

  // Safety net: remove the old Next Round button if it's still in the HTML.
  const staleNextBtn = document.getElementById('vs-next-round-btn');
  if (staleNextBtn && staleNextBtn.parentNode) {
    staleNextBtn.parentNode.removeChild(staleNextBtn);
  }

  (function prefillFromHash() {
    const m = window.location.hash.match(/^#versus\/(.+)$/i);
    if (m && m[1]) vsRoomIdInput.value = decodeURIComponent(m[1]);
  })();

  vsRoundsMinus.addEventListener('click', () => {
    vsNumRounds = Math.max(1, vsNumRounds - 1);
    vsRoundsValue.textContent = vsNumRounds;
  });
  vsRoundsPlus.addEventListener('click', () => {
    vsNumRounds = Math.min(15, vsNumRounds + 1);
    vsRoundsValue.textContent = vsNumRounds;
  });

  let vsConnecting = false;

  vsCreateRoomBtn.addEventListener('click', () => {
    if (vsConnecting) return;
    vsConnecting = true;
    vsCreateRoomBtn.disabled = true;
    vsJoinRoomBtn.disabled = true;
    vsIsHost = true;
    const roomCode = 'vs-' + Math.random().toString(36).substring(2, 7);
    initVsPeer(roomCode);
  });

  vsJoinRoomBtn.addEventListener('click', () => {
    if (vsConnecting) return;
    const hostId = vsRoomIdInput.value.trim();
    if (!hostId) return alert('Enter a room code first!');
    vsConnecting = true;
    vsCreateRoomBtn.disabled = true;
    vsJoinRoomBtn.disabled = true;
    vsIsHost = false;
    initVsPeer(null, hostId);
  });

  function initVsPeer(customId, joinHostId) {
    if (typeof Peer === 'undefined') {
      alert('The multiplayer library failed to load - check your connection and reload the page.');
      return;
    }
    vsPeer = customId ? new Peer(customId) : new Peer();

    vsPeer.on('open', (id) => {
      vsRoomCode = vsIsHost ? id : joinHostId;
      vsLobbyStatus.classList.remove('hidden');
      vsRoomCodeDisplay.textContent = vsRoomCode;
      window.location.hash = `#versus/${vsRoomCode}`;

      if (vsIsHost) {
        vsPlayers = {};
        vsPlayers[id] = { name: 'Host', score: 0, slot: 0 };
        if (vsMyNameInput) vsMyNameInput.value = 'Host';
        vsRoundsSelector.classList.remove('hidden');
        renderVsLobby();
      } else if (joinHostId) {
        vsHostConn = vsPeer.connect(joinHostId, { reliable: true });
        setupVsConnection(vsHostConn);
      }
    });

    vsPeer.on('error', (err) => {
      console.error('PeerJS error:', err);
      vsConnecting = false;
      vsCreateRoomBtn.disabled = false;
      vsJoinRoomBtn.disabled = false;
      if (err.type === 'peer-unavailable') {
        alert("Couldn't find that room - double check the code and try again.");
      } else if (err.type === 'unavailable-id') {
        alert('That room code is already taken - try creating again.');
      } else {
        alert('Connection error: ' + err.type);
      }
    });

    vsPeer.on('connection', (conn) => {
      if (!vsIsHost) return;
      if (vsGameplayScreen && !vsGameplayScreen.classList.contains('hidden')) {
        conn.on('open', () => { conn.send({ type: 'GAME_IN_PROGRESS' }); conn.close(); });
        return;
      }
      if (vsClients.length >= VS_MAX_PLAYERS - 1) {
        conn.on('open', () => { conn.send({ type: 'LOBBY_FULL' }); conn.close(); });
        return;
      }
      vsClients.push(conn);
      setupVsConnection(conn);
    });
  }

  function setupVsConnection(conn) {
    conn.on('open', () => {
      if (!vsIsHost) {
        const defaultName = `Player ${Math.floor(Math.random() * 900 + 100)}`;
        if (vsMyNameInput) vsMyNameInput.value = defaultName;
        conn.send({ type: 'JOIN', peerId: vsPeer.id, name: defaultName });
      }
    });

    conn.on('data', (data) => handleVsNetworkMessage(data, conn));

    conn.on('close', () => {
      if (!vsIsHost) return;
      vsClients = vsClients.filter(c => c !== conn);
      if (conn._vsPeerId && vsPlayers[conn._vsPeerId]) {
        delete vsPlayers[conn._vsPeerId];
        renderVsLobby();
        broadcastVs({ type: 'LOBBY_UPDATE', players: vsPlayers, numRounds: vsNumRounds });
      }
    });
  }

  function broadcastVs(data) {
    vsClients.forEach(c => { if (c.open) c.send(data); });
  }

  function handleVsNetworkMessage(data, conn) {
    switch (data.type) {
      case 'JOIN': {
        if (!vsIsHost) break;
        const usedSlots = new Set(Object.values(vsPlayers).map(p => p.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < VS_MAX_PLAYERS) slot++;
        conn._vsPeerId = data.peerId;
        vsPlayers[data.peerId] = { name: data.name || `Player ${slot + 1}`, score: 0, slot };
        renderVsLobby();
        broadcastVs({ type: 'LOBBY_UPDATE', players: vsPlayers, numRounds: vsNumRounds });
        break;
      }

      case 'NAME_UPDATE': {
        if (!vsIsHost) break;
        if (!vsPlayers[data.peerId]) break;

        vsPlayers[data.peerId].name = data.name;
        renderVsLobby();
        broadcastVs({ type: 'LOBBY_UPDATE', players: vsPlayers, numRounds: vsNumRounds });
        break;
      }

      case 'LOBBY_UPDATE':
        vsPlayers = data.players;
        vsNumRounds = data.numRounds;
        renderVsLobby();
        break;

      case 'LOBBY_FULL':
        alert('That room is already full (4/4 players).');
        location.hash = '#versus';
        location.reload();
        break;

      case 'GAME_IN_PROGRESS':
        alert('That game has already started - ask the host for the next room code.');
        location.hash = '#versus';
        location.reload();
        break;

      case 'HOST_LEFT':
        alert('The host left the room, so the game has ended.');
        location.hash = '#versus';
        location.reload();
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
        vsVoteStatus.textContent = `${data.voted} of ${data.total} players have voted`;
        break;

      case 'VOTE_RESULT':
        applyVoteResult(data);
        break;

      case 'START_GAME':
        vsNumRounds = data.numRounds;
        vsPlayers = data.players || vsPlayers;
        vsRound = 0;
        vsModeTitle.textContent = 'Choosing Round Mode...';
        vsRoundLabel.textContent = '';
        vsLobbyScreen.classList.add('hidden');
        vsVoteScreen.classList.add('hidden');
        vsGameplayScreen.classList.remove('hidden');
        vsGameOverPanel.classList.add('hidden');
        vsRoundOverPanel.classList.add('hidden');
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
    }
  }

  function renderVsLobby() {
    vsPlayerSlots.innerHTML = '';
    const entries = Object.entries(vsPlayers).map(([id, p]) => ({ id, ...p }));

    for (let i = 0; i < VS_MAX_PLAYERS; i++) {
      const entry = entries.find(p => p.slot === i);
      const div = document.createElement('div');
      div.className = 'vs-slot' + (entry ? ' filled' : ' empty');
      if (entry) {
        const isYou = vsPeer && entry.id === vsPeer.id;
        const roleLabel = entry.slot === 0 ? 'HOST' : 'PLAYER';
        div.innerHTML = `
          <span class="vs-slot-role">${roleLabel}</span>
          <span class="vs-slot-name">${escapeHtml(entry.name)}${isYou ? ' (You)' : ''}</span>
        `;
      } else {
        div.innerHTML = `<span class="vs-slot-role empty-role">OPEN</span><span class="vs-slot-name">Empty Slot</span>`;
      }
      vsPlayerSlots.appendChild(div);
    }

    const count = entries.length;
    if (vsIsHost) {
      vsStartGameBtn.classList.remove('hidden');
      vsStartGameBtn.disabled = count < 2;
      vsLobbyHint.classList.remove('hidden');
      vsLobbyHint.textContent = count < 2
        ? 'Need at least 2 players to start.'
        : `Ready! ${count} players in the room.`;
      vsWaitingMsg.classList.add('hidden');
    } else {
      vsStartGameBtn.classList.add('hidden');
      vsLobbyHint.classList.add('hidden');
      vsWaitingMsg.classList.remove('hidden');
    }
  }

  function commitMyNameChange() {
    if (!vsMyNameInput || !vsPeer) return;
    const myId = vsPeer.id;
    const newName = vsMyNameInput.value.trim().slice(0, 16);
    if (!newName || !vsPlayers[myId] || vsPlayers[myId].name === newName) {
      if (vsPlayers[myId]) vsMyNameInput.value = vsPlayers[myId].name;
      return;
    }
    vsPlayers[myId].name = newName;
    renderVsLobby();
    if (vsIsHost) {
      broadcastVs({ type: 'LOBBY_UPDATE', players: vsPlayers, numRounds: vsNumRounds });
    } else if (vsHostConn) {
      vsHostConn.send({ type: 'NAME_UPDATE', peerId: myId, name: newName });
    }
  }
  if (vsMyNameInput) {
    vsMyNameInput.addEventListener('change', commitMyNameChange);
    vsMyNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') vsMyNameInput.blur();
    });
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

  function updateVoteStatus() {
    const total = Object.keys(vsPlayers).length;
    const voted = Object.keys(vsGenVotes).length;
    vsVoteStatus.textContent = `${voted} of ${total} players have voted`;
  }

  function broadcastVoteTally() {
    updateVoteStatus();
    const total = Object.keys(vsPlayers).length;
    const voted = Object.keys(vsGenVotes).length;
    broadcastVs({ type: 'VOTE_TALLY_UPDATE', voted, total });
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
    vsMyVoteRandom = true;
    vsMyVoteGens = new Set();
    syncVoteButtonsUI();
    submitMyVote();
  });

  // Shown on every device (host included) the moment a vote opens. Each
  // device runs its own local countdown rather than trusting a shared
  // timestamp, for the same clock-skew reason the round timer does this.
  function applyVoteStart(duration) {
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

    let secondsLeft = duration;
    vsVoteTimerEl.textContent = secondsLeft;
    vsVoteTimerEl.classList.remove('urgent');
    updateVoteStatus();

    vsVoteCountdownInterval = setInterval(() => {
      secondsLeft--;
      vsVoteTimerEl.textContent = Math.max(secondsLeft, 0);
      if (secondsLeft <= 5) vsVoteTimerEl.classList.add('urgent');
      if (secondsLeft <= 0) clearInterval(vsVoteCountdownInterval);
    }, 1000);

    if (vsIsHost) {
      vsVoteTimer = setTimeout(finalizeGenVoteAndStart, duration * 1000);
    }
  }

  function beginGenVote() {
    if (!vsIsHost) return;
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsGenVotes = {};
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
      vsGameplayScreen.classList.remove('hidden');
      launchVsRound();
    }, 4000);
  }

  vsStartGameBtn.addEventListener('click', () => {
    if (!vsIsHost || Object.keys(vsPlayers).length < 2) return;
    beginGenVote();
  });

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

  // ---- Wheel with pointer, winner highlight, and audio ----
  function spinVsWheel(targetMode, callback) {
    if (vsSpinCancel) vsSpinCancel(); // never run two wheels at once
    vsWheelOverlay.classList.remove('hidden');

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
    vsGuessInput.disabled = false;
    vsSearchWrapper.classList.remove('hidden');
    vsGuessInput.focus();

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
      wrapper.className = 'vs-player-bar-wrapper';
      wrapper.dataset.peerId = id;
      const isYou = vsPeer && id === vsPeer.id;
      const roleTag = p.slot === 0 ? '<span class="vs-role-tag">HOST</span> ' : '';
      wrapper.innerHTML = `
        <div class="vs-player-bar-label">
          <span>${roleTag}${escapeHtml(p.name)}${isYou ? ' (You)' : ''}</span>
          <span>${p.score} pts</span>
        </div>
        <div class="vs-progress-track">
          <div class="vs-progress-fill" style="width: 0%"></div>
        </div>
      `;
      vsPlayerBars.appendChild(wrapper);
    });
  }

  vsGuessInput.addEventListener('input', () => {
    if (typeof setupAutocomplete === 'function') {
      setupAutocomplete(vsGuessInput, vsSuggestions, handleVsGuess);
    }
  });
  if (typeof attachAutocompleteKeyboardNav === 'function') {
    attachAutocompleteKeyboardNav(vsGuessInput, vsSuggestions);
  }

  function handleVsGuess(guessedPkmn) {
    if (vsGuessLocked || !vsAnswer) return;
    vsSuggestions.innerHTML = '';
    vsGuessInput.value = '';

    if (guessedPkmn.rawName === vsAnswer.rawName) {
      vsGuessLocked = true;
      vsGuessInput.disabled = true;
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
    vsGuessInput.disabled = true;
    let remaining = Math.ceil(VS_WRONG_PENALTY_MS / 1000);
    vsResultMessage.style.color = '#ff4757';
    vsResultMessage.textContent = `Wrong - not ${wrongName}. Try again in ${remaining}s...`;

    clearInterval(vsPenaltyTimer);
    vsPenaltyTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(vsPenaltyTimer);
        if (!vsGuessLocked) {
          vsGuessInput.disabled = false;
          vsGuessInput.focus();
          vsResultMessage.style.color = '#d0d7de';
          vsResultMessage.textContent = 'Back in it - take another guess!';
        }
      } else {
        vsResultMessage.textContent = `Wrong - not ${wrongName}. Try again in ${remaining}s...`;
      }
    }, 1000);
  }

  function handleCorrectGuess(peerId, clientElapsedMs) {
    if (!vsIsHost || vsRoundLocked) return;
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

    vsGuessInput.disabled = true;
    vsGuessInput.blur(); // dismiss the mobile keyboard so it can't cover the winner text
    vsSuggestions.innerHTML = '';
    vsSearchWrapper.classList.add('hidden'); // was staying visible/typeable-looking over the round result
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

  function endVsGame() {
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;

    const entries = Object.entries(vsPlayers);
    const maxScore = Math.max(...entries.map(([, p]) => p.score));
    const winners = entries.filter(([, p]) => p.score === maxScore);
    const payload = {
      type: 'GAME_OVER',
      players: vsPlayers,
      winnerId: winners.length === 1 ? winners[0][0] : null,
      winnerName: winners.length === 1 ? winners[0][1].name : null,
      isTie: winners.length > 1
    };
    broadcastVs(payload);
    applyGameOver(payload);
  }

  function applyGameOver(payload) {
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;

    vsPlayers = payload.players;
    vsRoundOverPanel.classList.add('hidden');
    vsGameOverPanel.classList.remove('hidden');

    const sorted = Object.entries(vsPlayers).sort((a, b) => b[1].score - a[1].score);
    vsFinalStandings.innerHTML = sorted.map(([id, p], i) => {
      const rank = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
      const isYou = vsPeer && id === vsPeer.id;
      return `<div class="vs-standing-row${i === 0 ? ' vs-standing-first' : ''}">
        <span><span class="vs-rank-tag">${rank}</span> ${escapeHtml(p.name)}${isYou ? ' (You)' : ''}</span>
        <span>${p.score} pts</span>
      </div>`;
    }).join('');

    if (payload.isTie) {
      vsWinnerText.textContent = "It's a tie!";
      playVsGameOverSound(false);
    } else {
      const isMe = vsPeer && payload.winnerId === vsPeer.id;
      vsWinnerText.textContent = isMe ? 'You win!' : `${payload.winnerName} wins!`;
      if (isMe && typeof launchConfetti === 'function') launchConfetti();
      playVsGameOverSound(isMe);
    }

    vsPlayAgainBtn.classList.toggle('hidden', !vsIsHost);
  }

  vsPlayAgainBtn.addEventListener('click', () => {
    if (!vsIsHost) return;
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    vsAutoAdvanceTimer = null;
    vsCountdownInterval = null;
    beginGenVote();
  });

  function leaveVsRoom() {
    clearTimeout(vsAutoAdvanceTimer);
    clearInterval(vsCountdownInterval);
    clearTimeout(vsPenaltyTimer);
    clearTimeout(vsVoteTimer);
    clearTimeout(vsVoteResultTimer);
    clearInterval(vsVoteCountdownInterval);
    if (vsAnimFrame) cancelAnimationFrame(vsAnimFrame);

    try {
      if (vsIsHost) {
        // No host-migration support, so the fairest thing is to tell
        // everyone the room's ending rather than leaving them stuck
        // watching a screen that will never update again.
        broadcastVs({ type: 'HOST_LEFT' });
      } else if (vsHostConn && vsHostConn.open) {
        // Closing this explicitly (instead of just reloading the page and
        // letting the browser tear it down whenever it gets around to it)
        // fires the host's conn.on('close') handler right away, so the
        // lobby list actually updates for everyone else immediately.
        vsHostConn.close();
      }
      if (vsPeer) vsPeer.destroy();
    } catch (e) { /* already on the way out, nothing more to clean up */ }

    location.hash = '#versus';
    // Small delay so the close/broadcast above actually gets sent over the
    // data channel before the reload tears the connection down under it.
    setTimeout(() => location.reload(), 150);
  }

  vsLeaveRoomBtn.addEventListener('click', leaveVsRoom);
  if (vsLobbyLeaveBtn) vsLobbyLeaveBtn.addEventListener('click', leaveVsRoom);
});