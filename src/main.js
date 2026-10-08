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
    <span class="name-tag-dot ${player.isReady ? 'is-ready' : ''} ${player.isHost ? 'is-host' : ''}"></span>
    <span class="name-tag-label">${player.name.toUpperCase()}</span>
  `;
  container.appendChild(tag);
  player.htmlTag = tag;
}

function updateNameTag(player) {
  if (!player.htmlTag) return;
  const label = player.htmlTag.querySelector('.name-tag-label');
  const dot = player.htmlTag.querySelector('.name-tag-dot');
  if (label) {
    label.innerText = player.name.toUpperCase();
  }
  if (dot) {
    if (player.isReady) dot.classList.add('is-ready');
    else dot.classList.remove('is-ready');

    if (player.isHost) dot.classList.add('is-host');
    else dot.classList.remove('is-host');
  }
}

function getRadialSpawnPosition(index, total = 5) {
  const radius = 4.8;
  const count = Math.max(1, total);
  const angle = (index / count) * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius
  );
}

function getPlayerSpawnIndex(id) {
  const allIds = [myId, ...Array.from(players.keys()).filter(k => k !== myId)].sort();
  const idx = allIds.indexOf(id);
  return idx >= 0 ? idx : 0;
}

let inviteRoomCode = null;

function initGameAfterLoading() {
  arena = new Arena(scene, arenaRadius);

  // Initialize Local Player with pre-cached assets (Radial pod 0)
  const spawnPos = getRadialSpawnPosition(0, 5);
  localPlayer = new Character({
    scene,
    id: myId,
    name: playerName,
    isLocal: true,
    color: 0xffcc00,
    assetManager
  });
  localPlayer.group.position.copy(spawnPos);
  localPlayer.lookAtTarget(new THREE.Vector3(0, 0, 0));
  localPlayer.setLaserActive(false);
  players.set(myId, localPlayer);
  createNameTag(localPlayer);
  window.localPlayer = localPlayer;

  // Pre-fill Welcome screen input
  const welcomeInput = document.getElementById('welcome-name-input');
  if (welcomeInput) welcomeInput.value = playerName;

  // Check URL query for private invite link (?room=XYZ)
  const urlParams = new URLSearchParams(window.location.search);
  inviteRoomCode = urlParams.get('room');
  if (inviteRoomCode) {
    inviteRoomCode = inviteRoomCode.toUpperCase();
    showBanner(`INVITED TO SQUAD: ${inviteRoomCode}`, 3000);
  }

  updateScoreboard();
}

function deployPlayerSkyDrop() {
  document.getElementById('welcome-screen')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('ui-overlay')?.classList.remove('hidden');

  const myIdx = getPlayerSpawnIndex(myId);
  const spawnPos = getRadialSpawnPosition(myIdx, Math.max(5, players.size));
  if (localPlayer) {
    localPlayer.group.position.copy(spawnPos);
    localPlayer.lookAtTarget(new THREE.Vector3(0, 0, 0));
    localPlayer.animateSkyDrop(() => {
      audioSystem.playHitImpact();
      showBanner('DEPLOYED TO ARENA // READY UP TO ENGAGE', 2000);
    });
  }

  // Camera swoop
  camera.position.set(0, 22, 26);
  controls.target.set(0, 0, 0);
  controls.update();

  let t = 0;
  const camInterval = setInterval(() => {
    t += 0.04;
    camera.position.lerp(defaultCamPos, 0.12);
    controls.target.lerp(defaultTarget, 0.12);
    controls.update();
    if (t >= 1) {
      clearInterval(camInterval);
      camera.position.copy(defaultCamPos);
      controls.target.copy(defaultTarget);
      controls.update();
    }
  }, 16);
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

  const spawnIndex = getPlayerSpawnIndex(id);
  const spawnPos = pos || getRadialSpawnPosition(spawnIndex, Math.max(5, players.size + 1));
  p.group.position.copy(spawnPos);
  p.lookAtTarget(new THREE.Vector3(0, 0, 0));
  p.isBot = false;
  p.isHost = (id === currentHostId);
  p.setLaserActive(currentPhase === 'STEALTH' || currentPhase === 'REVEAL');

  players.set(id, p);
  createNameTag(p);
  updateNameTag(p);
  updateScoreboard();
  return p;
}

function isModalActive() {
  const welcome = document.getElementById('welcome-screen');
  if (welcome && !welcome.classList.contains('hidden')) return true;
  const modeSelect = document.getElementById('mode-select-screen');
  if (modeSelect && !modeSelect.classList.contains('hidden')) return true;
  const friendsHub = document.getElementById('friends-hub-modal');
  if (friendsHub && !friendsHub.classList.contains('hidden')) return true;
  const lobby = document.getElementById('lobby-modal');
  if (lobby && lobby.classList.contains('active')) return true;
  const winner = document.getElementById('winner-modal');
  if (winner && !winner.classList.contains('hidden')) return true;
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) return true;
  return false;
}

function removeRemotePlayer(id) {
  if (id === myId) return;
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
  if (isModalActive()) return;
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
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = false;
  if (k === 'a' || k === 'arrowleft') keys.a = false;
  if (k === 's' || k === 'arrowdown') keys.s = false;
  if (k === 'd' || k === 'arrowright') keys.d = false;
});

window.addEventListener('mousemove', (e) => {
  if (isModalActive()) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(raycastPlane, aimPoint);
});

// Touch controls for mobile
window.addEventListener('touchmove', (e) => {
  if (isModalActive()) return;
  if (e.touches.length > 0) {
    const t = e.touches[0];
    mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(raycastPlane, aimPoint);
  }
}, { passive: true });

// Reset Camera button
document.getElementById('btn-reset-cam')?.addEventListener('click', () => {
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
    if (id === myId) return;
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
  onForceStart: () => {
    handleRemoteSquadLaunch();
  },
  onRoundSync: (data) => {
    if (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END' || currentPhase === 'SHRINK') {
      currentRound = data.round || currentRound;
      document.getElementById('friends-hub-modal')?.classList.add('hidden');
      document.getElementById('welcome-screen')?.classList.add('hidden');
      document.getElementById('mode-select-screen')?.classList.add('hidden');
      deployPlayerSkyDrop();
      startRound(false);
    }
  },
  onReveal: () => {
    executeReveal();
  },
  onLockPacket: (data) => {
    const p = players.get(data.id);
    if (p && !p.isLocal) {
      p.group.position.set(data.x, data.y, data.z);
      p.rotationY = data.rotY;
      p.group.rotation.y = data.rotY;
      p.updateLaser();
    }
  },
  onRoundVerdict: (verdict) => {
    if (!isLocalHost) {
      applyRoundVerdict(verdict);
    }
  },
  onRoomSettings: (settings) => {
    if (settings.roundTime) CONFIG.countdownSeconds = settings.roundTime;
    if (settings.maxSquad) CONFIG.maxPlayersPerRoom = settings.maxSquad;
    if (settings.squadName) {
      const title = document.getElementById('squad-room-title');
      if (title) title.innerText = settings.squadName.toUpperCase();
    }
  },
  onRoomStateChange: (state) => {
    updateRoomUI(state);
    updateFriendsHubRoster(state);
  }
});

// --- GAME LOGIC & HUD ---
const bannerEl = document.getElementById('event-banner');
const timerEl = document.getElementById('timer-digits');
const clockPhaseLabel = document.getElementById('clock-phase-label');
const clockGuidanceText = document.getElementById('clock-guidance-text');
const roundPillEl = document.getElementById('roster-round-pill');

function showBanner(text, duration = 1800) {
  if (!bannerEl) return;
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
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END' && currentPhase !== 'SHRINK') return;
  audioSystem.init();
  deactivateSpectatorMode();
  document.getElementById('lobby-modal')?.classList.remove('active');
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('ui-overlay')?.classList.remove('hidden');

  // PHASE 1: RECON (1.5 seconds) - All players visible to observe trajectories
  currentPhase = 'RECON';
  roundPillEl.innerText = `ROUND 0${currentRound}`;
  clockPhaseLabel.innerText = 'RECONNAISSANCE';
  clockGuidanceText.innerText = 'OBSERVE OPERATOR POSITIONS // PREPARE AIM';
  showBanner('RECONNAISSANCE PHASE', 1400);

  // Reveal all alive players so everyone sees where everyone is
  players.forEach(p => {
    if (p.isAlive) {
      p.setStealth(false);
      p.setLaserActive(false);
    }
  });

  if (broadcast) {
    supabaseManager.broadcastRoundStart(currentRound);
  }

  // After 1.5s recon phase, enter PREDICTION LOCK
  setTimeout(() => {
    if (currentPhase !== 'RECON') return;
    currentPhase = 'STEALTH';
    countdownTime = CONFIG.countdownSeconds;
    clockPhaseLabel.innerText = 'PREDICTION LOCK';
    clockGuidanceText.innerText = 'OPPONENTS CONCEALED // GHOST SILHOUETTES MARKED';
    showBanner('PREDICTION LOCKDOWN', 1200);

    // Conceal opponents and generate ghost silhouettes at their positions; turn on aiming lasers
    players.forEach(p => {
      if (p.isAlive) {
        p.setStealth(true);
        p.setLaserActive(true);
      }
    });

    const interval = setInterval(() => {
      countdownTime--;
      timerEl.innerText = countdownTime.toString().padStart(2, '0');
      audioSystem.playCountdownTick(countdownTime === 0);

      if (countdownTime <= 0) {
        clearInterval(interval);
        freezeAndBroadcastLock();
      }
    }, 1000);
  }, 1500);
}

function freezeAndBroadcastLock() {
  currentPhase = 'INPUT_FREEZE';
  clockPhaseLabel.innerText = 'TRAJECTORY LOCK';
  clockGuidanceText.innerText = 'INPUTS FROZEN // FIRING SIMULTANEOUSLY';

  // Broadcast lock-packet with frozen coordinates
  if (localPlayer) {
    supabaseManager.broadcastLockPacket({
      id: myId,
      round: currentRound,
      x: localPlayer.group.position.x,
      y: localPlayer.group.position.y,
      z: localPlayer.group.position.z,
      rotY: localPlayer.rotationY
    });
  }

  // Brief freeze window before simultaneous laser blast
  setTimeout(() => {
    executeReveal();
  }, 320);
}

function executeReveal() {
  if (currentPhase === 'REVEAL') return;
  currentPhase = 'REVEAL';
  clockPhaseLabel.innerText = 'SIMULTANEOUS FIRE';
  clockGuidanceText.innerText = 'ALL OPERATORS REVEALED';
  showBanner('SIMULTANEOUS FIRE', 1800);

  // 1. Reveal all alive players & fire weapons (ghost silhouettes removed by setStealth(false))
  players.forEach(p => {
    if (p.isAlive) {
      p.setStealth(false);
      p.setLaserActive(true);
      p.triggerShoot();
    }
  });

  audioSystem.playLaserShot();

  // 2. ONLY THE HOST EVALUATES HITS (AUTHORITATIVE REFEREE)
  if (isLocalHost) {
    setTimeout(() => {
      evaluateHostVerdict();
    }, 280);
  }
}

function evaluateHostVerdict() {
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

        // Hitbox diameter 0.72m
        if (dist <= 0.72) {
          hitList.push({ shooterId: shooter.id, targetId: target.id });
        }
      }
    });
  });

  const eliminatedIds = [...new Set(hitList.map(h => h.targetId))];
  const survivors = alivePlayers.filter(p => !eliminatedIds.includes(p.id));
  const isGameOver = survivors.length <= 1;
  const winnerId = isGameOver ? (survivors[0] ? survivors[0].id : myId) : null;

  let newRingRadius = arenaRadius;
  if (eliminatedIds.length > 0) {
    newRingRadius = Math.max(3.8, arenaRadius - CONFIG.shrinkPerRound);
  } else {
    consecutiveStalemates++;
    if (consecutiveStalemates >= 2) {
      newRingRadius = Math.max(3.8, arenaRadius - CONFIG.shrinkPerRound);
    }
  }

  const verdict = {
    round: currentRound,
    eliminatedIds,
    hits: hitList,
    ringRadius: newRingRadius,
    isGameOver,
    winnerId,
    survivors: survivors.map(s => s.id)
  };

  // Broadcast authoritative verdict to all connected peers
  supabaseManager.broadcastRoundVerdict(verdict);
  applyRoundVerdict(verdict);
}

function applyRoundVerdict(verdict) {
  players.forEach(p => p.setLaserActive(false));

  // Score awards
  if (verdict.hits) {
    verdict.hits.forEach(({ shooterId }) => {
      const shooter = players.get(shooterId);
      if (shooter) shooter.score += 100;
    });
  }

  let someoneDied = false;
  verdict.eliminatedIds.forEach(targetId => {
    const target = players.get(targetId);
    if (target && target.isAlive) {
      target.die();
      someoneDied = true;
      audioSystem.playHitImpact();
    }
  });

  updateScoreboard();

  // If local player was eliminated, activate spectator mode
  if (localPlayer && !localPlayer.isAlive) {
    activateSpectatorMode();
  }

  // After animation delay, process game over or next round shrink
  setTimeout(() => {
    if (verdict.isGameOver) {
      deactivateSpectatorMode();
      const winner = players.get(verdict.winnerId) || localPlayer;
      presentWinner(winner);
    } else {
      currentPhase = 'SHRINK';
      arenaRadius = verdict.ringRadius;
      if (arena) arena.shrinkTo(arenaRadius);
      audioSystem.playRingShrink();

      if (someoneDied) {
        consecutiveStalemates = 0;
        clockPhaseLabel.innerText = 'PERIMETER COLLAPSE';
        clockGuidanceText.innerText = `RING CONTRACTED TO ${arenaRadius.toFixed(1)}M`;
        showBanner('PERIMETER COLLAPSING', 1800);
      } else {
        clockPhaseLabel.innerText = 'STALEMATE';
        clockGuidanceText.innerText = `RING POSITION: ${arenaRadius.toFixed(1)}M`;
        showBanner('STALEMATE // NO CASUALTIES', 1800);
      }

      currentRound = verdict.round + 1;
      roundPillEl.innerText = `ROUND 0${currentRound}`;

      // Only the host triggers the next round start
      setTimeout(() => {
        if (isLocalHost) {
          currentPhase = 'LOBBY';
          startRound(true);
        }
      }, 3000);
    }
  }, 2200);
}

// WINNER PODIUM CELEBRATION PRESENTATION
function presentWinner(winner) {
  currentPhase = 'VICTORY';
  players.forEach(p => p.setLaserActive(false));

  // Completely hide in-game HUD overlay and all name tags so the screen is clean for the dance
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('name-tags-container')?.classList.add('hidden');
  document.getElementById('spectator-bar')?.classList.add('hidden');

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

  // Position camera directly in front of champion to give full unobstructed view of the dance
  camera.position.set(0, 1.9, 4.4);
  controls.target.set(0, 1.2, 0);
  controls.update();

  // Play Victory Fanfare and Celebration Dance
  audioSystem.playVictoryFanfare();
  winner.playAction('dance', 0.2);

  // Focus high-intensity spotlight on the champion
  ringSpot.position.set(0, 10, 2);
  ringSpot.target.position.set(0, 1.2, 0);
  ringSpot.intensity = 6.0;

  // Show Cinematic Victory Overlay (clean title & next match button)
  const modal = document.getElementById('winner-modal');
  const nameDisplay = document.getElementById('winner-name-display');
  if (nameDisplay) nameDisplay.innerText = `${winner.name.toUpperCase()} WINS`;
  if (modal) modal.classList.remove('hidden');
}

function resetGame() {
  deactivateSpectatorMode();
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) winnerModal.classList.add('hidden');

  // Restore HUD overlay & name tags
  document.getElementById('ui-overlay')?.classList.remove('hidden');
  document.getElementById('name-tags-container')?.classList.remove('hidden');

  // Restore camera & spotlight
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultTarget);
  controls.update();

  ringSpot.position.set(0, 18, 0);
  ringSpot.target.position.set(0, 0, 0);
  ringSpot.intensity = 3.8;

  // Restore player scales & disable lasers
  players.forEach(p => {
    if (p.originalScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.originalScale);
    }
    p.setLaserActive(false);
  });

  currentRound = 1;
  arenaRadius = CONFIG.initialArenaRadius;
  if (arena) arena.shrinkTo(arenaRadius);

  let i = 0;
  players.forEach(p => {
    const spawnPos = getRadialSpawnPosition(i, Math.max(1, players.size));
    p.revive(spawnPos);
    p.lookAtTarget(new THREE.Vector3(0, 0, 0));
    p.setVisible(true);
    i++;
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
  const friendsReadyBtn = document.getElementById('btn-friends-ready');
  const friendsReadyText = document.getElementById('friends-ready-btn-text');

  if (isLocalReady) {
    topBtn?.classList.add('is-ready');
    if (topBtnText) topBtnText.innerText = 'READY (WAITING)';
    lobbyBtn?.classList.add('is-ready');
    if (lobbyBtnText) lobbyBtnText.innerText = 'READY (WAITING)';
    friendsReadyBtn?.classList.add('is-ready');
    if (friendsReadyText) friendsReadyText.innerText = 'READY (WAITING)';
  } else {
    topBtn?.classList.remove('is-ready');
    if (topBtnText) topBtnText.innerText = 'READY UP';
    lobbyBtn?.classList.remove('is-ready');
    if (lobbyBtnText) lobbyBtnText.innerText = 'READY UP';
    friendsReadyBtn?.classList.remove('is-ready');
    if (friendsReadyText) friendsReadyText.innerText = 'READY UP';
  }
}

function launchFriendsSquadMatch() {
  if (!isLocalHost) return;
  audioSystem.init();
  supabaseManager.broadcastForceStart();
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  deployPlayerSkyDrop();
  startRound(true);
}

function handleRemoteSquadLaunch() {
  audioSystem.init();
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('welcome-screen')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  deployPlayerSkyDrop();
  startRound(false);
}

function checkAllPlayersReady(playersList) {
  if (!playersList || playersList.length < 2) return;
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;

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
        document.getElementById('friends-hub-modal')?.classList.add('hidden');
        if (isLocalHost) {
          startRound(true);
        }
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

function updateFriendsHubRoster(state) {
  const rosterGrid = document.getElementById('friends-roster-grid');
  const countVal = document.getElementById('squad-player-count-val');
  const hostVal = document.getElementById('squad-host-status-val');
  const launchBtn = document.getElementById('btn-friends-host-launch');
  const waitingNotice = document.getElementById('friends-waiting-notice');

  if (countVal) countVal.innerText = `${state.count}/${CONFIG.maxPlayersPerRoom}`;
  if (hostVal) {
    if (state.isHost) {
      hostVal.innerText = 'YOU ARE HOST';
      hostVal.className = 'status-val text-gold';
    } else {
      hostVal.innerText = 'SQUAD MEMBER';
      hostVal.className = 'status-val';
    }
  }

  if (launchBtn) {
    if (state.isHost) {
      launchBtn.classList.remove('hidden');
      if (waitingNotice) waitingNotice.classList.add('hidden');
    } else {
      launchBtn.classList.add('hidden');
      if (waitingNotice) waitingNotice.classList.remove('hidden');
    }
  }

  if (rosterGrid && state.players) {
    rosterGrid.innerHTML = '';
    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `lobby-player-card ${p.id === myId ? 'is-local' : ''}`;
      const isReady = p.isReady === true;
      const isPHost = (p.id === state.hostId);

      card.innerHTML = `
        <div class="player-card-name">
          <span>${p.name.toUpperCase()} ${p.id === myId ? '(YOU)' : ''}</span>
          ${isPHost ? `
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
      rosterGrid.appendChild(card);
    });
  }
}

function updateRoomUI(state) {
  const roomNameEl = document.getElementById('room-name-display');
  const roomCountEl = document.getElementById('room-players-count');
  const playersListEl = document.getElementById('lobby-players-list');
  isLocalHost = !!state.isHost;
  currentHostId = state.hostId;

  if (localPlayer) {
    localPlayer.isHost = isLocalHost;
    updateNameTag(localPlayer);
  }

  const isPrivate = state.roomId.startsWith('custom_');
  const displayTitle = isPrivate 
    ? `CUSTOM SQUAD: ${state.roomId.replace('custom_', '')}` 
    : `PUBLIC SECTOR: ${state.roomId.toUpperCase()}`;

  if (roomNameEl) roomNameEl.innerText = `CONNECTED: ${displayTitle}`;
  if (roomCountEl) roomCountEl.innerText = `${state.count}/5 PLAYERS`;

  if (playersListEl && state.players) {
    playersListEl.innerHTML = '';
    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `lobby-player-card ${p.id === myId ? 'is-local' : ''}`;
      const isReady = p.isReady === true;
      const isPPlayerHost = (p.id === currentHostId);

      const char = players.get(p.id);
      if (char) {
        char.isHost = isPPlayerHost;
        char.setReady(isReady);
        updateNameTag(char);
      }

      card.innerHTML = `
        <div class="player-card-name">
          <span>${p.name.toUpperCase()} ${p.id === myId ? '(YOU)' : ''}</span>
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

  checkAllPlayersReady(state.players);
}

// --- BUTTON & SCREEN LISTENERS ---

// 1. Welcome Screen
document.getElementById('btn-enter-game')?.addEventListener('click', () => {
  const input = document.getElementById('welcome-name-input');
  const val = input ? input.value.trim() : '';
  if (val) {
    playerName = val;
    localStorage.setItem('twisted_player_name', playerName);
    if (localPlayer) {
      localPlayer.name = playerName;
      updateNameTag(localPlayer);
      updateScoreboard();
    }
  }
  audioSystem.init();
  audioSystem.playReadyClick();

  if (inviteRoomCode) {
    currentRoomId = `custom_${inviteRoomCode}`;
    document.getElementById('welcome-screen')?.classList.add('hidden');
    document.getElementById('friends-hub-modal')?.classList.remove('hidden');
    const codeEl = document.getElementById('squad-code-val');
    if (codeEl) codeEl.innerText = inviteRoomCode;
    const titleEl = document.getElementById('squad-room-title');
    if (titleEl) titleEl.innerText = `SQUAD ${inviteRoomCode}`;
    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      position: localPlayer.group.position
    });
    showBanner(`JOINED INVITE SQUAD: ${inviteRoomCode}`, 2500);
  } else {
    document.getElementById('welcome-screen')?.classList.add('hidden');
    document.getElementById('mode-select-screen')?.classList.remove('hidden');
  }
});

// 2. Mode Select Screen
document.getElementById('btn-back-to-welcome')?.addEventListener('click', () => {
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('welcome-screen')?.classList.remove('hidden');
});

document.getElementById('tab-create-squad')?.addEventListener('click', () => {
  document.getElementById('tab-create-squad')?.classList.add('active');
  document.getElementById('tab-join-squad')?.classList.remove('active');
  document.getElementById('panel-create-squad')?.classList.remove('hidden');
  document.getElementById('panel-join-squad')?.classList.add('hidden');
});

document.getElementById('tab-join-squad')?.addEventListener('click', () => {
  document.getElementById('tab-join-squad')?.classList.add('active');
  document.getElementById('tab-create-squad')?.classList.remove('active');
  document.getElementById('panel-join-squad')?.classList.remove('hidden');
  document.getElementById('panel-create-squad')?.classList.add('hidden');
});

// Deploy to Public Quick-Match
document.getElementById('btn-deploy-public')?.addEventListener('click', () => {
  audioSystem.init();
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
  deployPlayerSkyDrop();
  showBanner('PUBLIC SECTOR 1 DEPLOYMENT', 2000);
});

// Confirm Create Private Squad
document.getElementById('btn-confirm-create-squad')?.addEventListener('click', () => {
  audioSystem.init();
  const squadName = document.getElementById('create-squad-name')?.value.trim() || 'ALPHA DOGS';
  const roundTime = parseInt(document.getElementById('create-timer-select')?.value) || 5;
  const maxPlayers = parseInt(document.getElementById('create-max-players-select')?.value) || 5;
  CONFIG.countdownSeconds = roundTime;
  CONFIG.maxPlayersPerRoom = maxPlayers;

  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  currentRoomId = `custom_${code}`;

  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('friends-hub-modal')?.classList.remove('hidden');

  const titleEl = document.getElementById('squad-room-title');
  if (titleEl) titleEl.innerText = squadName.toUpperCase();
  const codeEl = document.getElementById('squad-code-val');
  if (codeEl) codeEl.innerText = code;
  const timerVal = document.getElementById('squad-timer-val');
  if (timerVal) timerVal.innerText = `${roundTime}S`;

  isLocalReady = false;
  updateReadyButtonUI();

  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    position: localPlayer.group.position
  });

  setTimeout(() => {
    supabaseManager.broadcastRoomSettings({ squadName, roundTime, maxSquad: maxPlayers });
  }, 500);

  showBanner(`PRIVATE SQUAD ESTABLISHED: ${code}`, 2500);
});

// Confirm Join Private Squad with Code
document.getElementById('btn-confirm-join-squad')?.addEventListener('click', () => {
  audioSystem.init();
  const code = document.getElementById('join-squad-code-input')?.value.trim().toUpperCase();
  if (!code) return;

  currentRoomId = `custom_${code}`;
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('friends-hub-modal')?.classList.remove('hidden');

  const titleEl = document.getElementById('squad-room-title');
  if (titleEl) titleEl.innerText = `SQUAD ${code}`;
  const codeEl = document.getElementById('squad-code-val');
  if (codeEl) codeEl.innerText = code;

  isLocalReady = false;
  updateReadyButtonUI();

  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    position: localPlayer.group.position
  });

  showBanner(`JOINING SQUAD: ${code}`, 2000);
});

// 3. Friends Squad Hub
document.getElementById('btn-friends-ready')?.addEventListener('click', toggleReady);
document.getElementById('btn-friends-host-launch')?.addEventListener('click', launchFriendsSquadMatch);

document.getElementById('btn-friends-copy-link')?.addEventListener('click', () => {
  const code = currentRoomId.startsWith('custom_') ? currentRoomId.replace('custom_', '') : currentRoomId;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showBanner('SQUAD INVITE LINK COPIED', 2000);
  });
});

document.getElementById('btn-friends-leave')?.addEventListener('click', () => {
  supabaseManager.leaveRoom();
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.remove('hidden');
  showBanner('LEFT SQUAD FREQUENCY', 1600);
});

// 4. In-Game HUD Controls
document.getElementById('btn-ready-toggle')?.addEventListener('click', toggleReady);
document.getElementById('btn-lobby-ready')?.addEventListener('click', toggleReady);

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
      updateNameTag(localPlayer);
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

// Winner Play Again
document.getElementById('btn-play-again')?.addEventListener('click', () => {
  resetGame();
});

// --- RENDER & GAME ANIMATION LOOP ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  const modalOpen = isModalActive();
  controls.enabled = !modalOpen;

  if (modalOpen) {
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
  }

  // Local Player Movement & Aiming locking
  const isInputLocked = modalOpen || (currentPhase === 'RECON') || (currentPhase === 'INPUT_FREEZE') || (currentPhase === 'REVEAL') || (currentPhase === 'VICTORY');
  if (localPlayer && localPlayer.isAlive && !isInputLocked) {
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
      localPlayer.lookAtTarget(aimPoint);
    } else {
      localPlayer.lookAtTarget(aimPoint);
    }
  } else if (localPlayer && isInputLocked && localPlayer.isAlive) {
    if (localPlayer.currentActionName === 'run') {
      localPlayer.playAction('idle', 0.12);
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
        headPos.y += 3.7; // Clean elevation above dog head
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

window.addEventListener('blur', () => {
  keys.w = false;
  keys.a = false;
  keys.s = false;
  keys.d = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
