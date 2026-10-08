import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetManager } from './game/AssetManager.js';
import { Arena } from './game/Arena.js';
import { Character } from './game/Character.js';
import { audioSystem } from './game/AudioSystem.js';
import { SupabaseManager } from './game/SupabaseManager.js';

// --- CONFIG & STATE ---
const CONFIG = {
  countdownSeconds: 5,
  initialArenaRadius: 10.5,
  shrinkPerRound: 2.2,
  playerSpeed: 7.8,
  maxPlayersPerRoom: 5
};

let currentPhase = 'LOBBY'; // 'LOBBY' | 'STEALTH' | 'REVEAL' | 'SHRINK' | 'VICTORY'
let countdownTime = CONFIG.countdownSeconds;
let currentRound = 1;
let arenaRadius = CONFIG.initialArenaRadius;
let currentRoomId = 'sector_1';

const savedName = localStorage.getItem('twisted_player_name') || `OPERATOR_${Math.floor(100 + Math.random() * 900)}`;
let playerName = savedName;

// --- THREE.JS ENGINE SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);
scene.fog = new THREE.FogExp2(0x090b10, 0.018);

// Default camera position
const defaultCamPos = new THREE.Vector3(0, 11, 14.5);
const defaultTarget = new THREE.Vector3(0, 1.2, 0);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.copy(defaultCamPos);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
container.appendChild(renderer.domElement);

// --- FULL INTERACTIVE ORBIT CAMERA CONTROLS ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.copy(defaultTarget);
controls.maxPolarAngle = Math.PI / 2 - 0.06; // Don't go below floor
controls.minDistance = 5;
controls.maxDistance = 35;
// Right-click rotates / pans, middle/wheel zooms, Left-click is reserved for character aiming
controls.mouseButtons = {
  LEFT: null, // Left click is used for laser aiming!
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE
};

// --- STUDIO ARENA LIGHTING ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x181c2b, 2.5);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
sunLight.position.set(10, 24, 12);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 50;
sunLight.shadow.camera.left = -18;
sunLight.shadow.camera.right = 18;
sunLight.shadow.camera.top = 18;
sunLight.shadow.camera.bottom = -18;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);

// Ring center spotlight
const ringSpot = new THREE.SpotLight(0xffcc00, 3.8, 30, Math.PI / 3.8, 0.45, 1.2);
ringSpot.position.set(0, 18, 0);
ringSpot.target.position.set(0, 0, 0);
scene.add(ringSpot);
scene.add(ringSpot.target);

// Dramatic back rim light
const rimLight = new THREE.DirectionalLight(0xff2a5f, 2.0);
rimLight.position.set(-10, 16, -12);
scene.add(rimLight);

// Raycast plane for aiming
const raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const aimPoint = new THREE.Vector3();

// --- GAME OBJECTS & COLLECTIONS ---
let arena;
const players = new Map();
const myId = 'player_' + Math.random().toString(36).substring(2, 7);
let localPlayer = null;

// Expose globals for debugging
window.players = players;
window.startRound = startRound;
window.THREE = THREE;

// --- PRE-LOAD ALL ASSETS BEFORE STARTING ---
const loadingScreen = document.getElementById('loading-screen');
const progressBar = document.getElementById('loader-progress-bar');
const pctText = document.getElementById('loader-pct-text');
const statusText = document.getElementById('loader-status-text');

assetManager.loadAll(
  (pct) => {
    progressBar.style.width = pct + '%';
    pctText.innerText = pct + '%';
  },
  () => {
    statusText.innerText = 'INITIALIZING BATTLEGROUND...';
    setTimeout(() => {
      initGameAfterLoading();
      loadingScreen.classList.add('hidden');
    }, 400);
  },
  (err) => {
    console.error('Asset load error', err);
    statusText.innerText = 'PROCEEDING WITH STANDALONE ASSETS...';
    setTimeout(() => {
      initGameAfterLoading();
      loadingScreen.classList.add('hidden');
    }, 500);
  }
);

function createNameTag(player) {
  const container = document.getElementById('name-tags-container');
  const tag = document.createElement('div');
  tag.className = `floating-name-tag ${player.isLocal ? 'local' : ''}`;
  tag.innerHTML = `
    <div class="name-tag-indicator"></div>
    <span class="name-tag-host-badge ${player.isHost ? '' : 'hidden'}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      HOST
    </span>
    <span class="name-tag-label">${player.name.toUpperCase()}</span>
    <span class="name-tag-ready-badge ${player.isReady ? 'is-ready' : ''}">
      ${player.isReady ? 'READY' : 'PREPARING'}
    </span>
  `;
  container.appendChild(tag);
  player.htmlTag = tag;
}

function updateNameTag(player) {
  if (!player.htmlTag) return;
  const hostBadge = player.htmlTag.querySelector('.name-tag-host-badge');
  const label = player.htmlTag.querySelector('.name-tag-label');
  const readyBadge = player.htmlTag.querySelector('.name-tag-ready-badge');

  if (hostBadge) {
    if (player.isHost) hostBadge.classList.remove('hidden');
    else hostBadge.classList.add('hidden');
  }
  if (label) {
    label.innerText = player.name.toUpperCase();
  }
  if (readyBadge) {
    if (player.isReady) {
      readyBadge.classList.add('is-ready');
      readyBadge.innerText = 'READY';
    } else {
      readyBadge.classList.remove('is-ready');
      readyBadge.innerText = 'PREPARING';
    }
  }
}

function initGameAfterLoading() {
  arena = new Arena(scene, arenaRadius);

  // Initialize Local Player with pre-cached assets (NO DEMO BOTS!)
  localPlayer = new Character({
    scene,
    id: myId,
    name: playerName,
    isLocal: true,
    color: 0xffcc00,
    assetManager
  });
  localPlayer.group.position.set(-2.8, 0, 0);
  players.set(myId, localPlayer);
  createNameTag(localPlayer);
  window.localPlayer = localPlayer;

  // Check URL query for private invite link (?room=XYZ)
  const urlParams = new URLSearchParams(window.location.search);
  const inviteRoom = urlParams.get('room');
  if (inviteRoom) {
    currentRoomId = `custom_${inviteRoom.toUpperCase()}`;
    showBanner(`JOINED INVITE ROOM: ${inviteRoom.toUpperCase()}`, 2500);
  }

  // Connect to Supabase Realtime Room
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    position: localPlayer.group.position
  });

  updateScoreboard();
}

function addRemotePlayer(id, name, pos = null) {
  if (players.has(id)) return;
  const operatorColors = [0xff2a5f, 0xffaa00, 0x00f0ff, 0xaa00ff, 0x00ff88];
  const color = operatorColors[players.size % operatorColors.length];

  const p = new Character({
    scene,
    id,
    name: name || `Operator ${players.size + 1}`,
    isLocal: false,
    color,
    assetManager
  });

  const angle = (players.size / 5) * Math.PI * 2;
  const spawnPos = pos || new THREE.Vector3(Math.cos(angle) * 4.5, 0, Math.sin(angle) * 4.5);
  p.group.position.copy(spawnPos);
  p.lookAtTarget(new THREE.Vector3(0, 0, 0));
  p.isBot = false;
  p.isHost = (id === currentHostId);

  players.set(id, p);
  createNameTag(p);
  updateNameTag(p);
  updateScoreboard();
  return p;
}

function removeRemotePlayer(id) {
  const p = players.get(id);
  if (p) {
    p.dispose();
    if (p.htmlTag && p.htmlTag.parentNode) {
      p.htmlTag.parentNode.removeChild(p.htmlTag);
    }
    players.delete(id);
    updateScoreboard();
  }
}

// --- CONTROLS & AIMING ---
const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('keydown', (e) => {
  audioSystem.init();
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = true;
  if (k === 'a' || k === 'arrowleft') keys.a = true;
  if (k === 's' || k === 'arrowdown') keys.s = true;
  if (k === 'd' || k === 'arrowright') keys.d = true;

  if (k === 'r' && (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END')) {
    toggleReady();
  }

  // Spectator mode arrow navigation
  if (localPlayer && !localPlayer.isAlive && spectatingPlayerId) {
    if (k === 'arrowleft') cycleSpectatorTarget(-1);
    if (k === 'arrowright') cycleSpectatorTarget(1);
  }

  if (e.code === 'Space' && (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END')) {
    if (isLocalHost) initiateForceStart();
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = false;
  if (k === 'a' || k === 'arrowleft') keys.a = false;
  if (k === 's' || k === 'arrowdown') keys.s = false;
  if (k === 'd' || k === 'arrowright') keys.d = false;
});

window.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(raycastPlane, aimPoint);
});

// Touch controls for mobile
window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    const t = e.touches[0];
    mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(raycastPlane, aimPoint);
  }
}, { passive: true });

// Reset Camera button
document.getElementById('btn-reset-cam').addEventListener('click', () => {
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultTarget);
});

// --- SUPABASE REALTIME MULTIPLAYER MANAGER ---
const supabaseManager = new SupabaseManager({
  onPlayerJoined: (data) => {
    if (data.id === myId || players.has(data.id)) return;
    addRemotePlayer(data.id, data.name || 'Operator', data.position);
    audioSystem.playPlayerJoined();
    showBanner(`${(data.name || 'OPERATOR').toUpperCase()} JOINED THE RING`, 1600);
  },
  onPlayerLeft: (id) => {
    const p = players.get(id);
    if (p) {
      showBanner(`${p.name.toUpperCase()} DISCONNECTED`, 1600);
      audioSystem.playPlayerLeft();
      removeRemotePlayer(id);
    }
  },
  onPlayerMoved: (data) => {
    const p = players.get(data.id);
    if (p && !p.isLocal) {
      // Set target vectors for smooth lerp interpolation in animate loop
      p.targetPos = new THREE.Vector3(data.x, data.y, data.z);
      p.targetRotY = data.rotY;
    }
  },
  onPlayerReady: (data) => {
    const p = players.get(data.id);
    if (p) {
      p.setReady(data.isReady);
      updateNameTag(p);
      if (data.isReady) audioSystem.playReadyClick();
      else audioSystem.playUnreadyClick();
    }
  },
  onForceStart: (data) => {
    handleRemoteForceStart(data);
  },
  onRoundSync: (data) => {
    if (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END') {
      currentRound = data.round || currentRound;
      startRound(false);
    }
  },
  onReveal: () => {
    executeReveal(false);
  },
  onRoomStateChange: (state) => {
    updateRoomUI(state);
  }
});

// --- GAME LOGIC & HUD ---
const bannerEl = document.getElementById('event-banner');
const timerEl = document.getElementById('timer-digits');
const clockPhaseLabel = document.getElementById('clock-phase-label');
const clockGuidanceText = document.getElementById('clock-guidance-text');
const roundPillEl = document.getElementById('roster-round-pill');

function showBanner(text, duration = 1800) {
  bannerEl.innerText = text;
  bannerEl.classList.add('active');
  setTimeout(() => bannerEl.classList.remove('active'), duration);
}

let consecutiveStalemates = 0;
let spectatingPlayerId = null;
const spectatorBar = document.getElementById('spectator-bar');
const specTargetName = document.getElementById('spec-target-name');

function activateSpectatorMode() {
  const livingSurvivors = Array.from(players.values()).filter(p => p.isAlive && p.id !== myId);
  if (livingSurvivors.length === 0) return;

  spectatingPlayerId = livingSurvivors[0].id;
  if (spectatorBar) spectatorBar.classList.remove('hidden');
  if (specTargetName) specTargetName.innerText = livingSurvivors[0].name.toUpperCase();
}

function deactivateSpectatorMode() {
  spectatingPlayerId = null;
  if (spectatorBar) spectatorBar.classList.add('hidden');
}

function cycleSpectatorTarget(direction = 1) {
  const livingSurvivors = Array.from(players.values()).filter(p => p.isAlive && p.id !== myId);
  if (livingSurvivors.length === 0) {
    deactivateSpectatorMode();
    return;
  }

  let currentIndex = livingSurvivors.findIndex(p => p.id === spectatingPlayerId);
  if (currentIndex === -1) currentIndex = 0;

  const nextIndex = (currentIndex + direction + livingSurvivors.length) % livingSurvivors.length;
  const nextTarget = livingSurvivors[nextIndex];
  spectatingPlayerId = nextTarget.id;
  if (specTargetName) specTargetName.innerText = nextTarget.name.toUpperCase();
}

document.getElementById('btn-spec-prev')?.addEventListener('click', () => cycleSpectatorTarget(-1));
document.getElementById('btn-spec-next')?.addEventListener('click', () => cycleSpectatorTarget(1));

function startRound(broadcast = true) {
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;
  audioSystem.init();
  deactivateSpectatorMode();
  document.getElementById('lobby-modal')?.classList.remove('active');

  currentPhase = 'STEALTH';
  countdownTime = CONFIG.countdownSeconds;
  roundPillEl.innerText = `ROUND 0${currentRound}`;
  clockPhaseLabel.innerText = 'PREDICTION LOCK';
  clockGuidanceText.innerText = 'OPPONENTS CONCEALED // LOCK AIM';

  // Conceal opponents
  players.forEach(p => {
    if (p.isAlive) p.setStealth(true);
  });

  showBanner('PREDICTION LOCKDOWN', 1100);

  if (broadcast) {
    supabaseManager.broadcastRoundStart(currentRound);
  }

  const interval = setInterval(() => {
    countdownTime--;
    timerEl.innerText = countdownTime.toString().padStart(2, '0');
    audioSystem.playCountdownTick(countdownTime === 0);

    if (countdownTime <= 0) {
      clearInterval(interval);
      executeReveal(true);
    }
  }, 1000);
}

function executeReveal(broadcast = true) {
  if (currentPhase === 'REVEAL') return;
  currentPhase = 'REVEAL';
  clockPhaseLabel.innerText = 'SIMULTANEOUS FIRE';
  clockGuidanceText.innerText = 'ALL OPERATORS REVEALED';
  showBanner('SIMULTANEOUS FIRE', 2000);

  if (broadcast) {
    supabaseManager.broadcastReveal({ round: currentRound });
  }

  // 1. Reveal all alive players & fire weapon
  players.forEach(p => {
    if (p.isAlive) {
      p.setStealth(false);
      p.triggerShoot();
    }
  });

  audioSystem.playLaserShot();

  // 2. Raycast Simultaneous Hit Detection
  const hitList = [];
  const alivePlayers = Array.from(players.values()).filter(p => p.isAlive);

  alivePlayers.forEach(shooter => {
    const ray = shooter.getLaserRay();

    alivePlayers.forEach(target => {
      if (shooter.id === target.id) return;

      const targetPos = target.group.position.clone().add(new THREE.Vector3(0, 1.25, 0));
      const v = new THREE.Vector3().subVectors(targetPos, ray.origin);
      const proj = v.dot(ray.direction);

      if (proj > 0 && proj < ray.length) {
        const closestPoint = ray.origin.clone().add(ray.direction.clone().multiplyScalar(proj));
        const dist = closestPoint.distanceTo(targetPos);

        // Precise hitbox: 0.72m
        if (dist <= 0.72) {
          hitList.push({ shooter, target });
        }
      }
    });
  });

  // 3. Process Hits & Knockouts (Supports Mutual Trade Kills & Multi-Kills!)
  setTimeout(() => {
    let someoneDied = false;
    const killedTargets = new Set();

    hitList.forEach(({ shooter, target }) => {
      killedTargets.add(target);
      shooter.score += 100;
    });

    killedTargets.forEach(target => {
      if (target.isAlive) {
        target.die();
        someoneDied = true;
        audioSystem.playHitImpact();
      }
    });

    updateScoreboard();

    // If local player was eliminated, activate spectator mode to follow living survivors
    if (localPlayer && !localPlayer.isAlive) {
      activateSpectatorMode();
    }

    // 4. Shrink Ring & Check Next Round
    setTimeout(() => {
      handlePostRound(someoneDied);
    }, 2400);
  }, 320);
}

function handlePostRound(someoneDied) {
  const survivors = Array.from(players.values()).filter(p => p.isAlive);

  if (survivors.length <= 1) {
    deactivateSpectatorMode();
    const winner = survivors[0] || localPlayer;
    presentWinner(winner);
  } else {
    currentPhase = 'SHRINK';
    
    if (someoneDied) {
      consecutiveStalemates = 0;
      // Shrink arena
      arenaRadius = Math.max(3.8, arenaRadius - CONFIG.shrinkPerRound);
      if (arena) arena.shrinkTo(arenaRadius);
      audioSystem.playRingShrink();

      clockPhaseLabel.innerText = `PERIMETER COLLAPSE`;
      clockGuidanceText.innerText = `RING CONTRACTED TO ${arenaRadius.toFixed(1)}M`;
      showBanner(`PERIMETER COLLAPSING`, 1800);
    } else {
      consecutiveStalemates++;
      if (consecutiveStalemates >= 2) {
        arenaRadius = Math.max(3.8, arenaRadius - CONFIG.shrinkPerRound);
        if (arena) arena.shrinkTo(arenaRadius);
        audioSystem.playRingShrink();
        clockPhaseLabel.innerText = `PERIMETER OVERLOAD`;
        clockGuidanceText.innerText = `STALEMATE PENALTY // RING SHRUNK TO ${arenaRadius.toFixed(1)}M`;
        showBanner(`PERIMETER OVERLOAD // RING COLLAPSING`, 2200);
      } else {
        clockPhaseLabel.innerText = `STALEMATE`;
        clockGuidanceText.innerText = `NO CASUALTIES // RING REMAINS STABLE`;
        showBanner(`STALEMATE // NO CASUALTIES`, 1800);
      }
    }

    currentRound++;
    setTimeout(() => {
      currentPhase = 'LOBBY';
      startRound();
    }, 3000);
  }
}

// WINNER PODIUM CELEBRATION PRESENTATION
function presentWinner(winner) {
  currentPhase = 'VICTORY';
  clockPhaseLabel.innerText = 'MATCH CONCLUDED';
  clockGuidanceText.innerText = `${winner.name.toUpperCase()} WINS`;

  // Hide defeated opponents so spotlight is solely on the champion
  players.forEach(p => {
    if (p.id !== winner.id) {
      p.setVisible(false);
      if (p.htmlTag) p.htmlTag.classList.add('hidden');
    }
  });

  // Center champion, elevate slightly and scale up 1.45x facing the camera
  winner.group.position.set(0, 0, 0);
  winner.group.rotation.y = Math.PI;
  winner.rotationY = Math.PI;

  if (winner.fbxModel) {
    winner.originalScale = winner.fbxModel.scale.x;
    winner.fbxModel.scale.setScalar(winner.originalScale * 1.45);
  }

  // Position camera directly in front of champion to give full view of the dance
  camera.position.set(0, 1.9, 4.4);
  controls.target.set(0, 1.2, 0);
  controls.update();

  // Play Victory Fanfare and Twerk / Celebration Dance
  audioSystem.playVictoryFanfare();
  winner.playAction('dance', 0.2);

  // Focus high-intensity spotlight on the champion
  ringSpot.position.set(0, 10, 2);
  ringSpot.target.position.set(0, 1.2, 0);
  ringSpot.intensity = 6.0;

  // Show Cinematic Victory Overlay (Leaves center 100% visible!)
  const modal = document.getElementById('winner-modal');
  const nameDisplay = document.getElementById('winner-name-display');
  const scoreVal = document.getElementById('winner-score-val');
  const roundsVal = document.getElementById('winner-rounds-val');
  const accoladeVal = document.getElementById('winner-accolade-val');

  if (nameDisplay) nameDisplay.innerText = `${winner.name.toUpperCase()} WINS`;
  if (scoreVal) scoreVal.innerText = `${winner.score} PTS`;
  if (roundsVal) roundsVal.innerText = `${currentRound}`;
  if (accoladeVal) {
    if (winner.score >= 300) accoladeVal.innerText = 'DEADSHOT OPERATOR';
    else if (currentRound <= 2) accoladeVal.innerText = 'SURVIVOR PRIME';
    else accoladeVal.innerText = 'TACTICAL TITAN';
  }
  if (modal) modal.classList.remove('hidden');
}

function resetGame() {
  deactivateSpectatorMode();
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) winnerModal.classList.add('hidden');

  // Restore camera & spotlight
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultTarget);
  controls.update();

  ringSpot.position.set(0, 18, 0);
  ringSpot.target.position.set(0, 0, 0);
  ringSpot.intensity = 3.8;

  // Restore player scales
  players.forEach(p => {
    if (p.originalScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.originalScale);
    }
  });

  currentRound = 1;
  arenaRadius = CONFIG.initialArenaRadius;
  if (arena) arena.shrinkTo(arenaRadius);

  let angle = 0;
  players.forEach(p => {
    const spawnPos = new THREE.Vector3(Math.cos(angle) * 4.6, 0, Math.sin(angle) * 4.6);
    p.revive(spawnPos);
    p.setVisible(true);
    angle += (Math.PI * 2) / Math.max(1, players.size);
  });

  currentPhase = 'LOBBY';
  timerEl.innerText = '05';
  roundPillEl.innerText = 'ROUND 01';
  clockPhaseLabel.innerText = 'PREPARATION';
  clockGuidanceText.innerText = 'CLICK READY UP TO START MATCH';
  
  isLocalReady = false;
  updateReadyButtonUI();
  updateScoreboard();
}

function updateScoreboard() {
  const listEl = document.getElementById('scoreboard-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  Array.from(players.values()).sort((a, b) => b.score - a.score).forEach(p => {
    const row = document.createElement('div');
    row.className = `roster-entry ${p.isLocal ? 'local' : ''} ${!p.isAlive ? 'dead' : ''}`;
    row.innerHTML = `
      <div class="entry-name-box">
        <span class="entry-indicator ${!p.isAlive ? 'dead' : ''}"></span>
        <span class="entry-name">${p.name}</span>
      </div>
      <span class="entry-score ${!p.isAlive ? 'dead' : ''}">${p.score} PTS</span>
    `;
    listEl.appendChild(row);
  });
}

// --- READY SYSTEM & LIVE ROOM MANAGEMENT ---
let isLocalReady = false;
let isLocalHost = false;
let currentHostId = null;
let readyCountdownInterval = null;
let forceStartCountdownInterval = null;

function toggleReady() {
  audioSystem.init();
  isLocalReady = !isLocalReady;

  if (isLocalReady) {
    audioSystem.playReadyClick();
  } else {
    audioSystem.playUnreadyClick();
  }

  if (localPlayer) {
    localPlayer.setReady(isLocalReady);
    updateNameTag(localPlayer);
  }

  supabaseManager.setReady(isLocalReady);
  updateReadyButtonUI();

  if (isLocalReady) {
    showBanner('OPERATOR READY // WAITING FOR SQUAD', 1600);
  } else {
    showBanner('STATUS: PREPARING (NOT READY)', 1400);
  }
}

function updateReadyButtonUI() {
  const topBtn = document.getElementById('btn-ready-toggle');
  const topBtnText = document.getElementById('ready-btn-text');
  const lobbyBtn = document.getElementById('btn-lobby-ready');
  const lobbyBtnText = document.getElementById('lobby-ready-text');

  if (isLocalReady) {
    topBtn?.classList.add('is-ready');
    if (topBtnText) topBtnText.innerText = 'READY (WAITING)';
    lobbyBtn?.classList.add('is-ready');
    if (lobbyBtnText) lobbyBtnText.innerText = 'READY (WAITING)';
  } else {
    topBtn?.classList.remove('is-ready');
    if (topBtnText) topBtnText.innerText = 'READY UP';
    lobbyBtn?.classList.remove('is-ready');
    if (lobbyBtnText) lobbyBtnText.innerText = 'READY UP';
  }
}

function initiateForceStart() {
  if (!isLocalHost) return;
  audioSystem.init();
  audioSystem.playForceStartWarning();
  supabaseManager.broadcastForceStart();
  startForceStartCountdown();
}

function handleRemoteForceStart(data) {
  audioSystem.init();
  audioSystem.playForceStartWarning();
  startForceStartCountdown();
}

function startForceStartCountdown() {
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;
  if (readyCountdownInterval) {
    clearInterval(readyCountdownInterval);
    readyCountdownInterval = null;
  }
  if (forceStartCountdownInterval) return;

  let count = 5;
  clockPhaseLabel.innerText = 'FORCE LAUNCH';
  clockGuidanceText.innerText = `HOST OVERRIDE // STARTING IN ${count}S`;
  showBanner(`HOST FORCE STARTED // LAUNCHING IN ${count}S`, 1400);
  audioSystem.playCountdownTick(false);

  forceStartCountdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      clockGuidanceText.innerText = `HOST OVERRIDE // STARTING IN ${count}S`;
      showBanner(`FORCE LAUNCH IN ${count}S`, 950);
      audioSystem.playCountdownTick(false);
    } else {
      clearInterval(forceStartCountdownInterval);
      forceStartCountdownInterval = null;
      document.getElementById('lobby-modal')?.classList.remove('active');
      startRound(true);
    }
  }, 1000);
}

function checkAllPlayersReady(playersList) {
  if (!playersList || playersList.length < 2) return;
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;
  if (forceStartCountdownInterval) return;

  // Check if every player in room is ready
  const allReady = playersList.every(p => p.isReady === true);

  if (allReady && !readyCountdownInterval) {
    let launchCount = 3;
    clockPhaseLabel.innerText = 'LAUNCH IMMINENT';
    clockGuidanceText.innerText = `ALL OPERATORS READY // STARTING IN ${launchCount}S`;
    showBanner(`ALL OPERATORS READY // STARTING IN ${launchCount}S`, 1100);
    audioSystem.playCountdownTick(false);

    readyCountdownInterval = setInterval(() => {
      launchCount--;
      if (launchCount > 0) {
        clockGuidanceText.innerText = `ALL OPERATORS READY // STARTING IN ${launchCount}S`;
        showBanner(`STARTING IN ${launchCount}S`, 950);
        audioSystem.playCountdownTick(false);
      } else {
        clearInterval(readyCountdownInterval);
        readyCountdownInterval = null;
        document.getElementById('lobby-modal')?.classList.remove('active');
        startRound(true);
      }
    }, 1000);
  } else if (!allReady && readyCountdownInterval) {
    clearInterval(readyCountdownInterval);
    readyCountdownInterval = null;
    clockPhaseLabel.innerText = 'PREPARATION';
    clockGuidanceText.innerText = 'CLICK READY UP TO START MATCH';
    showBanner('LAUNCH CANCELLED // WAITING FOR PLAYERS', 1500);
  }
}

function updateRoomUI(state) {
  const roomNameEl = document.getElementById('room-name-display');
  const roomCountEl = document.getElementById('room-players-count');
  const playersListEl = document.getElementById('lobby-players-list');
  const topStartBtn = document.getElementById('btn-start');
  const lobbyStartBtn = document.getElementById('btn-lobby-force-start');

  isLocalHost = !!state.isHost;
  currentHostId = state.hostId;

  if (localPlayer) {
    localPlayer.isHost = isLocalHost;
    updateNameTag(localPlayer);
  }

  // Show Force Start button exclusively for Host when >= 2 players in room
  const canForceStart = isLocalHost && state.count >= 2 && (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END');
  if (topStartBtn) {
    if (canForceStart) topStartBtn.classList.remove('hidden');
    else topStartBtn.classList.add('hidden');
  }
  if (lobbyStartBtn) {
    if (canForceStart) lobbyStartBtn.classList.remove('hidden');
    else lobbyStartBtn.classList.add('hidden');
  }

  const isPrivate = state.roomId.startsWith('custom_');
  const displayTitle = isPrivate 
    ? `CUSTOM ROOM: ${state.roomId.replace('custom_', '')}` 
    : `PUBLIC SECTOR: ${state.roomId.toUpperCase()}`;

  if (roomNameEl) roomNameEl.innerText = `CONNECTED: ${displayTitle}`;
  if (roomCountEl) roomCountEl.innerText = `${state.count}/5 PLAYERS`;

  // Render live cards in the lobby waiting room (NO EMOJIS, CLEAN SVG ICONS)
  if (playersListEl && state.players) {
    playersListEl.innerHTML = '';
    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `lobby-player-card ${p.id === myId ? 'is-local' : ''}`;
      const isReady = p.isReady === true;
      const isPPlayerHost = (p.id === currentHostId);

      // Sync character instance properties & 3D name tag
      const char = players.get(p.id);
      if (char) {
        char.isHost = isPPlayerHost;
        char.setReady(isReady);
        updateNameTag(char);
      }

      card.innerHTML = `
        <div class="player-card-name">
          <span>${p.name} ${p.id === myId ? '(YOU)' : ''}</span>
          ${isPPlayerHost ? `
            <span class="player-host-tag">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              HOST
            </span>
          ` : ''}
        </div>
        <div class="player-card-status ${isReady ? 'status-ready' : 'status-waiting'}">
          <span class="status-indicator"></span>
          <span>${isReady ? 'READY' : 'PREPARING'}</span>
        </div>
      `;
      playersListEl.appendChild(card);
    });
  }

  // Real-time check if all players are ready
  checkAllPlayersReady(state.players);
}

// --- BUTTON & MODAL LISTENERS ---
document.getElementById('btn-ready-toggle')?.addEventListener('click', toggleReady);
document.getElementById('btn-lobby-ready')?.addEventListener('click', toggleReady);

document.getElementById('btn-start')?.addEventListener('click', initiateForceStart);
document.getElementById('btn-lobby-force-start')?.addEventListener('click', initiateForceStart);

document.getElementById('btn-sound')?.addEventListener('click', () => {
  audioSystem.init();
  audioSystem.enabled = !audioSystem.enabled;
  const icon = document.getElementById('sound-icon');
  if (audioSystem.enabled) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
  } else {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
  }
});

// Key listener for 'R' to toggle Ready
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END')) {
    // Only toggle if not typing in input
    if (document.activeElement.tagName !== 'INPUT') {
      toggleReady();
    }
  }
});

// Lobby Modal Listeners
const lobbyModal = document.getElementById('lobby-modal');
const nameInput = document.getElementById('player-name-input');
if (nameInput) nameInput.value = playerName;

document.getElementById('btn-lobby')?.addEventListener('click', () => {
  lobbyModal.classList.add('active');
});

document.getElementById('btn-close-lobby')?.addEventListener('click', () => {
  lobbyModal.classList.remove('active');
});

document.getElementById('btn-save-name')?.addEventListener('click', () => {
  const newName = nameInput.value.trim();
  if (newName) {
    playerName = newName;
    localStorage.setItem('twisted_player_name', newName);
    if (localPlayer) {
      localPlayer.name = newName;
      if (localPlayer.htmlTag) {
        localPlayer.htmlTag.querySelector('span').innerText = newName.toUpperCase();
      }
      updateScoreboard();
    }
    supabaseManager.setPlayerInfo({
      id: myId,
      name: newName,
      color: 0xffcc00,
      isReady: isLocalReady,
      position: localPlayer.group.position
    });
    showBanner(`CALL-SIGN UPDATED: ${newName.toUpperCase()}`, 1600);
  }
});

// Quick Play (Public Matchmaking, capped at 5)
document.getElementById('btn-quick-play')?.addEventListener('click', () => {
  currentRoomId = 'sector_1';
  isLocalReady = false;
  updateReadyButtonUI();
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    position: localPlayer.group.position
  });
  lobbyModal.classList.remove('active');
  showBanner(`MATCHMAKING: CONNECTED TO SECTOR 1`, 2000);
});

// Create Private Room (5-character code for friends)
document.getElementById('btn-create-private')?.addEventListener('click', () => {
  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  currentRoomId = `custom_${code}`;
  isLocalReady = false;
  updateReadyButtonUI();
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    position: localPlayer.group.position
  });
  lobbyModal.classList.remove('active');
  showBanner(`PRIVATE ROOM CREATED: ${code}`, 3000);
});

// Join Private Room with Code
document.getElementById('btn-join-private')?.addEventListener('click', () => {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code) {
    currentRoomId = `custom_${code}`;
    isLocalReady = false;
    updateReadyButtonUI();
    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      isReady: false,
      position: localPlayer.group.position
    });
    lobbyModal.classList.remove('active');
    showBanner(`JOINED ROOM: ${code}`, 2500);
  }
});

// Copy Invite Link
document.getElementById('btn-copy-link')?.addEventListener('click', () => {
  const isPrivate = currentRoomId.startsWith('custom_');
  const code = isPrivate ? currentRoomId.replace('custom_', '') : currentRoomId;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showBanner('INVITE LINK COPIED TO CLIPBOARD', 2000);
  });
});

// Leave Room
document.getElementById('btn-leave-room')?.addEventListener('click', () => {
  supabaseManager.leaveRoom();
  document.getElementById('current-room-bar')?.classList.add('hidden');
  showBanner('DISCONNECTED FROM ROOM', 1600);
});

// Winner Play Again
document.getElementById('btn-play-again')?.addEventListener('click', () => {
  resetGame();
});

// --- RENDER & GAME ANIMATION LOOP ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Local Player Movement
  if (localPlayer && localPlayer.isAlive) {
    const moveInput = new THREE.Vector3(0, 0, 0);
    if (keys.w) moveInput.z -= 1;
    if (keys.s) moveInput.z += 1;
    if (keys.a) moveInput.x -= 1;
    if (keys.d) moveInput.x += 1;

    if (moveInput.lengthSq() > 0) {
      moveInput.normalize();
      
      // Convert to camera-relative movement
      const camForward = new THREE.Vector3();
      camera.getWorldDirection(camForward);
      camForward.y = 0;
      camForward.normalize();
      
      const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
      
      // W sets moveInput.z to -1. We want -1 to move ALONG camForward.
      const moveDir = new THREE.Vector3()
        .add(camRight.clone().multiplyScalar(moveInput.x))
        .add(camForward.clone().multiplyScalar(-moveInput.z))
        .normalize();

      localPlayer.group.position.addScaledVector(moveDir, CONFIG.playerSpeed * delta);
      localPlayer.playAction('run', 0.14);
      
      // Face movement direction while moving (Smoothly interpolate rotation for AAA feel)
      const targetRotation = Math.atan2(moveDir.x, moveDir.z);
      
      // Shortest path rotation interpolation
      let diff = targetRotation - localPlayer.rotationY;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      localPlayer.rotationY += diff * 12.0 * delta; // Smooth turn
      localPlayer.group.rotation.y = localPlayer.rotationY;

      supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY);
    } else if (localPlayer.currentActionName === 'run') {
      localPlayer.playAction('idle', 0.18);
      // Face aim point when idle
      localPlayer.lookAtTarget(aimPoint);
    } else {
      // Continuously track mouse aim when idle
      localPlayer.lookAtTarget(aimPoint);
    }
  }

  // STRICT BOUNDARY ENFORCEMENT & REMOTE PLAYER SMOOTHING
  players.forEach(p => {
    if (!p.isLocal && p.targetPos && p.isAlive) {
      const dist = p.group.position.distanceTo(p.targetPos);
      if (dist > 0.04) {
        p.group.position.lerp(p.targetPos, 0.28);
        p.playAction('run', 0.12);
      } else {
        p.playAction('idle', 0.18);
      }
      if (p.targetRotY !== undefined) {
        let diff = p.targetRotY - p.rotationY;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        p.rotationY += diff * 12.0 * delta;
        p.group.rotation.y = p.rotationY;
      }
      p.updateLaser();
    }

    if (arena) arena.clampPosition(p.group.position);
    p.update(delta);
  });

  if (arena) arena.update(delta);

  // Update HTML name tags
  players.forEach(p => {
    if (p.htmlTag) {
      if (p.isAlive && p.isVisible) {
        const headPos = p.group.position.clone();
        headPos.y += 3.2; // Above head
        headPos.project(camera);

        if (headPos.z < 1) { // In front of camera
          const x = (headPos.x * 0.5 + 0.5) * window.innerWidth;
          const y = (-(headPos.y * 0.5) + 0.5) * window.innerHeight;
          p.htmlTag.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
          p.htmlTag.classList.remove('hidden');
        } else {
          p.htmlTag.classList.add('hidden');
        }
      } else {
        p.htmlTag.classList.add('hidden');
      }
    }
  });

  // If eliminated and in spectator mode, smoothly follow the spectated survivor
  if (spectatingPlayerId && localPlayer && !localPlayer.isAlive) {
    const targetPlayer = players.get(spectatingPlayerId);
    if (targetPlayer && targetPlayer.isAlive) {
      controls.target.lerp(targetPlayer.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0.08);
    } else {
      cycleSpectatorTarget(1);
    }
  }

  // Update OrbitControls smoothly
  controls.update();

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
