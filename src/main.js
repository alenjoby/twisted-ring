import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetManager, CHARACTER_DATA, VICTORY_DANCE_KEYS, pickRandomVictoryDance, DRAW_ANIM_KEYS, pickShuffledDrawAnims } from './game/AssetManager.js';
import { Arena, ARENA_THEMES } from './game/Arena.js';
import { Character } from './game/Character.js';
import { audioSystem } from './game/AudioSystem.js';
import { SupabaseManager, safeStorage } from './game/SupabaseManager.js';
import { setupMobileControls } from './game/MobileControls.js';
import { SmartTVManager } from './game/SmartTVManager.js';

// HTML Entity Escaper & Sanitizer (XSS Mitigation)
const esc = s => String(s ?? '').slice(0, 15).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

// --- CONFIG & STATE ---
const CONFIG = {
  countdownSeconds: 5,
  initialArenaRadius: 10.5,
  shrinkPerRound: 2.2,
  playerSpeed: 7.8,
  basePlayerSpeed: 7.8,
  baseShrinkPerRound: 2.2,
  maxPlayersPerRoom: 5
};

let currentPhase = 'LOBBY'; // 'LOBBY' | 'STEALTH' | 'REVEAL' | 'SHRINK' | 'ROUND_END' | 'VICTORY'
let countdownTime = CONFIG.countdownSeconds;
let currentRound = 1;
let totalSeriesRounds = 1;
let currentSeriesRound = 1;
let arenaRadius = CONFIG.initialArenaRadius;
let currentRoomId = 'sector_1';
let currentSquadName = 'ALPHA DOGS';
let currentArenaTheme = 'cyber_gold';
let currentMatchModifier = 'standard';
let timeDilationFactor = 1.0;
let footstepTimer = 0;
let localPlayerDeployed = false;
let revealWatchdogTimer = null;

// --- PWA & ZERO-STALE AUTO-UPDATE CONTROLLER ---
let pendingUpdateReload = false;
let swRegistration = null;
let currentAppVersion = null;

function showUpdateToast(msg = 'UPDATE INSTALLED // RELOADING') {
  const toast = document.getElementById('pwa-update-toast');
  const txt = document.getElementById('pwa-update-text');
  if (toast) {
    if (txt && msg) txt.innerText = msg;
    toast.classList.remove('hidden');
  }
}

function executeSafeReload() {
  showUpdateToast('UPDATE INSTALLED // RELOADING');
  setTimeout(() => {
    window.location.reload();
  }, 500);
}

function onNewUpdateReady() {
  console.log('[PWA] New update ready for application');
  if (currentPhase === 'LOBBY' || currentPhase === 'VICTORY' || currentPhase === 'ROUND_END' || !localPlayerDeployed) {
    executeSafeReload();
  } else {
    pendingUpdateReload = true;
    showBanner('UPDATE AVAILABLE // REFRESHING AT ROUND END', 3200);
  }
}

async function checkForVersionUpdate() {
  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!currentAppVersion) {
      currentAppVersion = data.version;
      return;
    }
    if (data.version && data.version !== currentAppVersion) {
      console.log('[PWA] Version bump detected:', currentAppVersion, '->', data.version);
      currentAppVersion = data.version;
      if (swRegistration) {
        swRegistration.update();
      }
      onNewUpdateReady();
    }
  } catch (e) {
    // Offline or network error
  }
}

function formatRoundPillLabel() {
  if (totalSeriesRounds > 1) {
    return `ROUND ${currentSeriesRound}/${totalSeriesRounds}`;
  }
  return `ROUND 0${currentRound}`;
}

function syncSeriesRoundsUI() {
  const pill = document.getElementById('roster-round-pill');
  if (pill) pill.innerText = formatRoundPillLabel();
  const squadRoundsVal = document.getElementById('squad-rounds-val');
  if (squadRoundsVal) {
    squadRoundsVal.innerText = totalSeriesRounds === 1 ? '1 ROUND' : `${totalSeriesRounds} ROUNDS`;
  }
  const friendsSelect = document.getElementById('friends-rounds-select');
  if (friendsSelect && String(friendsSelect.value) !== String(totalSeriesRounds)) {
    friendsSelect.value = String(totalSeriesRounds);
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 5; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

const savedName = safeStorage.getItem('twisted_player_name') || `OPERATOR_${Math.floor(100 + Math.random() * 900)}`;
let playerName = savedName.slice(0, 15);
let selectedCharacterId = safeStorage.getItem('twisted_character_id') || 'ajp';
if (!CHARACTER_DATA[selectedCharacterId]) selectedCharacterId = 'ajp';
let pendingDeployment = null;

// --- THREE.JS ENGINE SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);
scene.fog = new THREE.FogExp2(0x090b10, 0.018);

// Default camera position
const defaultCamPos = new THREE.Vector3(0, 11, 14.5);
const defaultTarget = new THREE.Vector3(0, 1.2, 0);

// --- CINEMATIC CAMERA & VFX STATE ---
let victoryOrbitAngle = 0;
let screenShakeIntensity = 0;
let screenShakeTime = 0;

function triggerScreenShake(intensity = 0.5) {
  screenShakeIntensity = Math.min(1.0, screenShakeIntensity + intensity);
}

function triggerDeathVignette(duration = 800, isCritical = false) {
  const el = document.getElementById('death-vignette');
  if (!el) return;
  el.classList.remove('critical', 'active');
  void el.offsetWidth; // Force CSS animation restart
  if (isCritical) el.classList.add('critical');
  el.classList.add('active');
  setTimeout(() => {
    el.classList.remove('active', 'critical');
  }, duration);
}

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
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
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

// --- DYNAMIC GRAPHICS QUALITY & 60 FPS PERFORMANCE ENGINE ---
const isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isLowPowerHardware = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

// Default to 'performance' on mobile devices for rock-solid 60 FPS, 'high' on desktop
let currentGraphicsTier = localStorage.getItem('twisted_perf_tier') || (isMobileDevice || isLowPowerHardware ? 'performance' : 'high');

function applyGraphicsTier(tier, notify = false) {
  currentGraphicsTier = tier;
  try {
    localStorage.setItem('twisted_perf_tier', tier);
  } catch (e) {}

  if (tier === 'performance') {
    // 60 FPS ULTRA PERFORMANCE MODE (Zero dynamic shadow pass, DPR 1.0, Maximum speed on budget phones)
    renderer.setPixelRatio(1.0);
    renderer.shadowMap.enabled = false;
    sunLight.castShadow = false;
    document.body.classList.add('perf-mode');
    const badge = document.getElementById('perf-mode-label');
    if (badge) badge.innerText = '60 FPS: MAX';
    if (notify) showBanner('60 FPS PERFORMANCE MODE ENGAGED', 1600);
  } else if (tier === 'balanced') {
    // BALANCED MODE (Lightweight 512 Shadows, Capped DPR on mobile)
    const maxDpr = isMobileDevice ? 1.25 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(512, 512);
    document.body.classList.remove('perf-mode');
    const badge = document.getElementById('perf-mode-label');
    if (badge) badge.innerText = '60 FPS: BALANCED';
    if (notify) showBanner('GRAPHICS: BALANCED MODE', 1600);
  } else {
    // HIGH FIDELITY ULTRA (Full PCF Soft Shadows, 1024 Map, High DPR)
    const maxDpr = isMobileDevice ? 1.5 : 2.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    document.body.classList.remove('perf-mode');
    const badge = document.getElementById('perf-mode-label');
    if (badge) badge.innerText = 'GRAPHICS: ULTRA';
    if (notify) showBanner('GRAPHICS: ULTRA FIDELITY', 1600);
  }

  if (typeof arena !== 'undefined' && arena) {
    arena.setQualityTier(tier);
  }

  renderer.shadowMap.needsUpdate = true;
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initial application of graphics tier
applyGraphicsTier(currentGraphicsTier, false);

function applyArenaTheme(themeId) {
  if (!arena) return;
  const theme = arena.setTheme(themeId);
  currentArenaTheme = theme.id;
  arena.setQualityTier(currentGraphicsTier);
  if (scene.fog) scene.fog.color.setHex(theme.fogColor);
  if (scene.background) scene.background.setHex(theme.fogColor);
  if (ringSpot) ringSpot.color.setHex(theme.spotColor);
  if (rimLight && theme.rimColor) rimLight.color.setHex(theme.rimColor);
  const badge = document.getElementById('theme-badge-label');
  if (badge) badge.innerText = `MAP: ${theme.name}`;
}

function applyMatchModifier(modifierId) {
  currentMatchModifier = modifierId || 'standard';
  if (currentMatchModifier === 'turbo_speed') {
    CONFIG.playerSpeed = 10.6;
    CONFIG.shrinkPerRound = 2.6;
  } else if (currentMatchModifier === 'sudden_death') {
    CONFIG.playerSpeed = 8.8;
    CONFIG.shrinkPerRound = 3.8;
  } else {
    CONFIG.playerSpeed = CONFIG.basePlayerSpeed;
    CONFIG.shrinkPerRound = CONFIG.baseShrinkPerRound;
  }
}

// Raycast plane for aiming
const raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const aimPoint = new THREE.Vector3();

// Module-level static scratch vectors & cached viewport (Zero-allocation performance)
const _scratchHeadPos = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchMoveInput = new THREE.Vector3();
const _scratchCamForward = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveDir = new THREE.Vector3();
const _scratchTargetVel = new THREE.Vector3();
const _scratchYUp = new THREE.Vector3(0, 1, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _chestOffset = new THREE.Vector3(0, 1.35, 0);
let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;
let wasMoving = false;
const localPlayerVelocity = new THREE.Vector3(0, 0, 0);
const lockedPlayerCoords = new Map();
let currentRoundSyncEpoch = null;
let stealthCountdownInterval = null;

// --- GAME OBJECTS & COLLECTIONS ---
let arena;
const players = new Map();
const myId = 'player_' + Math.random().toString(36).substring(2, 7);
let localPlayer = null;

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
    <span class="name-tag-label">${esc(player.name.toUpperCase())}</span>
    <span class="streak-tag hidden"></span>
    <span class="emote-bubble-tag hidden"></span>
  `;
  container.appendChild(tag);
  player.htmlTag = tag;
}

function updateNameTag(player) {
  if (!player.htmlTag) return;
  const label = player.htmlTag.querySelector('.name-tag-label');
  const dot = player.htmlTag.querySelector('.name-tag-dot');
  const streakEl = player.htmlTag.querySelector('.streak-tag');
  const emoteEl = player.htmlTag.querySelector('.emote-bubble-tag');
  if (label) {
    label.innerText = esc(player.name.toUpperCase());
  }
  if (dot) {
    if (player.isReady) dot.classList.add('is-ready');
    else dot.classList.remove('is-ready');

    if (player.isHost) dot.classList.add('is-host');
    else dot.classList.remove('is-host');
  }
  if (streakEl) {
    if (player.winStreak >= 2) {
      streakEl.innerText = `${player.winStreak}X STREAK`;
      streakEl.classList.remove('hidden');
    } else {
      streakEl.classList.add('hidden');
    }
  }
  if (emoteEl) {
    if (player.activeEmoteText) {
      emoteEl.innerText = player.activeEmoteText;
      emoteEl.classList.remove('hidden');
    } else {
      emoteEl.classList.add('hidden');
    }
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

let previewScene = null;
let previewCamera = null;
let previewRenderer = null;
let previewPodiumMat = null;
const previewCharacters = new Map();
const previewCanvasContexts = new Map();

function initCharacterSelectPreviews() {
  if (previewRenderer) return;
  try {
    previewScene = new THREE.Scene();

    const amb = new THREE.AmbientLight(0xffffff, 1.85);
    previewScene.add(amb);

    const keyLight = new THREE.DirectionalLight(0xfff6e5, 2.8);
    keyLight.position.set(2.5, 4.5, 5.0);
    previewScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 1.4);
    rimLight.position.set(-3.0, 3.0, -3.0);
    previewScene.add(rimLight);

    const podiumGeo = new THREE.RingGeometry(0.62, 0.78, 36);
    podiumGeo.rotateX(-Math.PI / 2);
    previewPodiumMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    });
    const podiumMesh = new THREE.Mesh(podiumGeo, previewPodiumMat);
    podiumMesh.position.set(0, 0.02, 0);
    previewScene.add(podiumMesh);

    previewCamera = new THREE.PerspectiveCamera(34, 300 / 380, 0.1, 30);
    previewCamera.position.set(0, 1.0, 5.2);
    previewCamera.lookAt(0, 0.95, 0);

    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    previewRenderer.setSize(300, 380, false);
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure = 1.25;

    const charIds = Object.keys(CHARACTER_DATA);
    for (const charId of charIds) {
      const charInstance = new Character({
        scene: previewScene,
        id: `preview_${charId}`,
        name: CHARACTER_DATA[charId].name,
        isLocal: false,
        color: 0xffcc00,
        assetManager,
        characterId: charId
      });
      charInstance.setLaserActive(false);
      if (charInstance.blasterMesh) {
        charInstance.blasterMesh.visible = false;
      }
      charInstance.group.position.set(0, 0, 0);
      charInstance.group.rotation.y = 0;
      charInstance.rotationY = 0;
      charInstance.group.visible = false;
      previewCharacters.set(charId, charInstance);

      const canvas = document.querySelector(`canvas[data-char-canvas="${charId}"]`);
      if (canvas) {
        previewCanvasContexts.set(charId, {
          canvas,
          ctx: canvas.getContext('2d')
        });
      }
    }
  } catch (err) {
    console.warn('[CharacterPreview] Failed to initialize 3D preview renderer:', err);
  }
}

function renderCharacterSelectPreviews(delta) {
  const charSelectEl = document.getElementById('character-select-screen');
  if (!charSelectEl || charSelectEl.classList.contains('hidden')) return;
  if (!previewRenderer || previewCharacters.size === 0) return;

  for (const [charId, charInstance] of previewCharacters.entries()) {
    const target = previewCanvasContexts.get(charId);
    if (!target || !target.ctx) continue;

    charInstance.update(delta);
    charInstance.group.visible = true;

    if (previewPodiumMat) {
      previewPodiumMat.color.setHex(charId === selectedCharacterId ? 0xffcc00 : 0x00f0ff);
      previewPodiumMat.opacity = charId === selectedCharacterId ? 0.95 : 0.45;
    }

    previewRenderer.render(previewScene, previewCamera);
    target.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.ctx.drawImage(previewRenderer.domElement, 0, 0, target.canvas.width, target.canvas.height);

    charInstance.group.visible = false;
  }
}

function initGameAfterLoading() {
  arena = new Arena(scene, arenaRadius);
  arena.setQualityTier(currentGraphicsTier);

  // Initialize Local Player with pre-cached assets (Radial pod 0)
  const spawnPos = getRadialSpawnPosition(0, 5);
  localPlayer = new Character({
    scene,
    id: myId,
    name: playerName,
    isLocal: true,
    color: 0xffcc00,
    assetManager,
    characterId: selectedCharacterId
  });
  localPlayer.group.position.copy(spawnPos);
  localPlayer.lookAtTarget(new THREE.Vector3(camera.position.x, 0, camera.position.z));
  localPlayer.setLaserActive(false);
  localPlayer.setVisible(true);
  players.set(myId, localPlayer);
  createNameTag(localPlayer);
  if (localPlayer.htmlTag) localPlayer.htmlTag.classList.add('hidden');
  window.localPlayer = localPlayer;

  initCharacterSelectPreviews();

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

function openFriendsHub() {
  const hub = document.getElementById('friends-hub-modal');
  if (hub) {
    hub.classList.remove('hidden');
    hub.classList.add('active');
  }
}

function closeFriendsHub() {
  const hub = document.getElementById('friends-hub-modal');
  if (hub) {
    hub.classList.add('hidden');
    hub.classList.remove('active');
  }
}

function deployPlayerSkyDrop() {
  localPlayerDeployed = true;
  document.getElementById('welcome-screen')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.remove('active');
  closeFriendsHub();
  document.getElementById('lobby-modal')?.classList.remove('active');
  document.getElementById('ui-overlay')?.classList.remove('hidden');

  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  window.focus();

  const myIdx = getPlayerSpawnIndex(myId);
  const spawnPos = getRadialSpawnPosition(myIdx, Math.max(5, players.size));
  if (localPlayer) {
    localPlayer.setVisible(true);
    if (localPlayer.htmlTag) localPlayer.htmlTag.classList.remove('hidden');
    localPlayer.group.position.copy(spawnPos);
    localPlayer.lookAtTarget(new THREE.Vector3(defaultCamPos.x, 0, defaultCamPos.z));
    supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, true);
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

function addRemotePlayer(id, name, pos = null, characterId = 'ajp') {
  if (players.has(id)) {
    const existing = players.get(id);
    if (characterId && existing.characterId !== characterId) {
      existing.setCharacterId(characterId);
    }
    return existing;
  }
  const operatorColors = [0xff2a5f, 0xffaa00, 0x00f0ff, 0xaa00ff, 0x00ff88];
  const color = operatorColors[players.size % operatorColors.length];

  const p = new Character({
    scene,
    id,
    name: name || `Operator ${players.size + 1}`,
    isLocal: false,
    color,
    assetManager,
    characterId: characterId || 'ajp'
  });

  // Register immediately in players Map so p can never become an untracked orphan in scene
  players.set(id, p);

  const spawnIndex = getPlayerSpawnIndex(id);
  const fallbackPos = getRadialSpawnPosition(spawnIndex, Math.max(5, players.size));
  const spawnPos = (pos && typeof pos.x === 'number' && typeof pos.z === 'number')
    ? new THREE.Vector3(pos.x, typeof pos.y === 'number' ? pos.y : 0, pos.z)
    : fallbackPos;

  p.group.position.copy(spawnPos);
  p.targetPos = spawnPos.clone();
  p.lookAtTarget(new THREE.Vector3(0, 0, 0));
  p.isBot = false;
  p.isHost = (id === currentHostId);
  p.setLaserActive(currentPhase === 'STEALTH' || currentPhase === 'REVEAL');

  createNameTag(p);
  updateNameTag(p);
  if (currentPhase === 'VICTORY') {
    p.setVisible(false);
    if (p.htmlTag) p.htmlTag.classList.add('hidden');
  }
  updateScoreboard();
  return p;
}

const practiceBots = [];

function pickRandomBotCharacters(count = 2) {
  const allCharIds = Object.keys(CHARACTER_DATA);
  const otherChars = allCharIds.filter(id => id !== selectedCharacterId);
  const shuffled = [...otherChars];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length] || allCharIds[i % allCharIds.length]);
  }
  return result;
}

function randomizePracticeBotCharacters() {
  if (practiceBots.length === 0) return;
  const randomChars = pickRandomBotCharacters(practiceBots.length);
  practiceBots.forEach((bot, idx) => {
    const newCharId = randomChars[idx];
    if (newCharId) {
      bot.setCharacterId(newCharId);
    }
  });
}

function spawnPracticeBots(count = 2) {
  clearPracticeBots();
  const botNames = ['TARGET_VIPER', 'TARGET_PHANTOM', 'TARGET_SPECTRE', 'TARGET_APEX'];
  const botColors = [0x00f0ff, 0xff0055, 0x00ff88, 0xaa00ff];
  const botChars = pickRandomBotCharacters(count);
  const existingCount = players.size;
  const totalSlots = Math.max(5, existingCount + count);
  for (let i = 0; i < count; i++) {
    const botId = `bot_${i + 1}`;
    const p = new Character({
      scene,
      id: botId,
      name: botNames[i] || `BOT_${i + 1}`,
      isLocal: false,
      color: botColors[i % botColors.length] || 0x00f0ff,
      assetManager,
      characterId: botChars[i] || 'big_vegas'
    });
    p.isBot = true;
    p.isHost = false;
    p.isReady = true;
    const spawnPos = getRadialSpawnPosition(existingCount + i, totalSlots);
    p.group.position.copy(spawnPos);
    p.targetPos = spawnPos.clone();
    p.lookAtTarget(new THREE.Vector3(0, 0, 0));
    p.setLaserActive(false);
    players.set(botId, p);
    createNameTag(p);
    updateNameTag(p);
    practiceBots.push(p);
  }
  updateScoreboard();
  updateDemoBotsButtonUI();
}

function clearPracticeBots() {
  while (practiceBots.length > 0) {
    const bot = practiceBots.pop();
    if (players.has(bot.id)) {
      removeRemotePlayer(bot.id);
    }
  }
  updateDemoBotsButtonUI();
}

function updateDemoBotsButtonUI() {
  const hudBtn = document.getElementById('btn-toggle-demo-bots');
  const hudBtnText = document.getElementById('demo-bots-btn-text');
  const lobbyBtn = document.getElementById('btn-lobby-demo-bots');
  const lobbyBtnText = document.getElementById('lobby-demo-bots-text');

  if (currentRoomId.startsWith('custom_')) {
    hudBtn?.classList.add('hidden');
    lobbyBtn?.classList.add('hidden');
    if (practiceBots.length > 0) {
      clearPracticeBots();
    }
    return;
  }

  if (currentRoomId.startsWith('sector_')) {
    hudBtn?.classList.remove('hidden');
    lobbyBtn?.classList.remove('hidden');
  }

  const label = practiceBots.length > 0 ? 'REMOVE DEMO BOTS' : 'ADD DEMO BOTS';
  if (hudBtnText) hudBtnText.innerText = label;
  if (lobbyBtnText) lobbyBtnText.innerText = label;
}

function toggleDemoBots() {
  audioSystem.init();
  audioSystem.playReadyClick();

  if (currentRoomId.startsWith('custom_')) {
    clearPracticeBots();
    updateDemoBotsButtonUI();
    return;
  }

  if (practiceBots.length === 0) {
    const botsToAdd = Math.max(1, 5 - players.size);
    spawnPracticeBots(botsToAdd);
    updateDemoBotsButtonUI();
    showBanner('DEMO PLAYERS ADDED TO SECTOR', 1800);
  } else {
    clearPracticeBots();
    updateDemoBotsButtonUI();
    showBanner('DEMO PLAYERS REMOVED', 1600);
  }
}

function isModalActive() {
  const loader = document.getElementById('loading-screen');
  if (loader && !loader.classList.contains('hidden')) return true;
  const welcome = document.getElementById('welcome-screen');
  if (welcome && !welcome.classList.contains('hidden')) return true;
  const modeSelect = document.getElementById('mode-select-screen');
  if (modeSelect && !modeSelect.classList.contains('hidden')) return true;
  const charSelect = document.getElementById('character-select-screen');
  if (charSelect && !charSelect.classList.contains('hidden')) return true;
  const friendsHub = document.getElementById('friends-hub-modal');
  if (friendsHub && !friendsHub.classList.contains('hidden') && friendsHub.classList.contains('active')) return true;
  const lobby = document.getElementById('lobby-modal');
  if (lobby && lobby.classList.contains('active') && !lobby.classList.contains('hidden')) return true;
  const winner = document.getElementById('winner-modal');
  if (winner && !winner.classList.contains('hidden')) return true;
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

// --- IN-GAME QUICK EMOTE & TAUNT SYSTEM ---
const EMOTE_DEFS = {
  HYPE: { label: 'LET US GO', animKey: 'jump' },
  TAUNT: { label: 'TOO EASY', animKey: 'turnLeft' },
  DANCE: { label: 'WATCH THIS', animKey: 'random_dance' },
  JUMP: { label: 'AIRBORNE', animKey: 'jump' }
};

function triggerLocalEmote(emoteId) {
  if (!localPlayer || !localPlayer.isAlive) return;
  if (currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL' || currentPhase === 'VICTORY') return;
  audioSystem.init();

  const def = EMOTE_DEFS[emoteId] || EMOTE_DEFS.HYPE;
  const animKey = def.animKey === 'random_dance' ? pickRandomVictoryDance() : def.animKey;
  const label = (localPlayer.characterId === 'dog' && emoteId === 'TAUNT') ? 'WOOF WOOF' : def.label;

  localPlayer.triggerEmote(label, animKey, updateNameTag);
  audioSystem.playEmoteSound(emoteId, localPlayer.characterId);
  supabaseManager.broadcastEmote({ label, animKey, emoteId });
}

// --- CONTROLS & AIMING ---
const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
    return;
  }
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

  // Emote hotkeys 1, 2, 3, 4
  if (k === '1') triggerLocalEmote('HYPE');
  if (k === '2') triggerLocalEmote('TAUNT');
  if (k === '3') triggerLocalEmote('DANCE');
  if (k === '4') triggerLocalEmote('JUMP');
});

window.addEventListener('keyup', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = false;
  if (k === 'a' || k === 'arrowleft') keys.a = false;
  if (k === 's' || k === 'arrowdown') keys.s = false;
  if (k === 'd' || k === 'arrowright') keys.d = false;
});

renderer.domElement.addEventListener('pointerdown', () => {
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
});

let hasAimedSinceStop = false;
const _scratchCameraFacePos = new THREE.Vector3();

function updateAimFromScreenCoords(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(raycastPlane, aimPoint);
  if (currentPhase === 'STEALTH') {
    hasAimedSinceStop = true;
  }
}

window.addEventListener('mousemove', (e) => {
  if (isModalActive()) return;
  updateAimFromScreenCoords(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (isModalActive()) return;
  if (e.button === 0 || e.pointerType === 'touch') {
    updateAimFromScreenCoords(e.clientX, e.clientY);
  }
});

// Dual-Stick 360-Degree Mobile Controls & Direct Arena Tap-to-Aim
const analogMove = { active: false, aimStickActive: false, x: 0, z: 0 };
const mobileControls = setupMobileControls({
  controls,
  camera,
  rendererDom: renderer.domElement,
  analogMove,
  aimPoint,
  getLocalPlayer: () => localPlayer,
  isModalActive,
  updateAimFromScreenCoords
});

// Smart TV D-Pad Remote Navigation & Bluetooth Gamepad Controller
const smartTVManager = new SmartTVManager({
  analogMove,
  aimPoint,
  camera,
  getLocalPlayer: () => localPlayer,
  renderer
});

// Emote HUD buttons & Map Theme cycle button
document.querySelectorAll('#hud-emote-bar .emote-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoteId = btn.getAttribute('data-emote-id');
    if (emoteId) triggerLocalEmote(emoteId);
  });
});

document.getElementById('btn-cycle-theme')?.addEventListener('click', () => {
  audioSystem.init();
  audioSystem.playReadyClick();
  const themeKeys = Object.keys(ARENA_THEMES);
  const currIdx = themeKeys.indexOf(currentArenaTheme);
  const nextThemeId = themeKeys[(currIdx + 1) % themeKeys.length];
  applyArenaTheme(nextThemeId);
  if (isLocalHost) {
    supabaseManager.broadcastRoomSettings({
      squadName: currentSquadName,
      roundTime: CONFIG.countdownSeconds,
      maxSquad: CONFIG.maxPlayersPerRoom,
      arenaTheme: currentArenaTheme,
      matchModifier: currentMatchModifier
    });
  }
});

// Reset Camera button
document.getElementById('btn-reset-cam')?.addEventListener('click', () => {
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultTarget);
});

// Performance / 60 FPS Mode toggle button
document.getElementById('btn-toggle-perf-mode')?.addEventListener('click', () => {
  audioSystem.init();
  audioSystem.playReadyClick();
  const tiers = ['performance', 'balanced', 'high'];
  const nextIdx = (tiers.indexOf(currentGraphicsTier) + 1) % tiers.length;
  applyGraphicsTier(tiers[nextIdx], true);
});

// --- SUPABASE REALTIME MULTIPLAYER MANAGER ---
const supabaseManager = new SupabaseManager({
  onPlayerJoined: (data) => {
    if (data.id === myId || players.has(data.id)) return;
    if (practiceBots.length > 0 && players.size >= 5) {
      const removedBot = practiceBots.pop();
      if (removedBot && players.has(removedBot.id)) {
        removeRemotePlayer(removedBot.id);
      }
      updateDemoBotsButtonUI();
    }
    addRemotePlayer(data.id, data.name || 'Operator', data.position, data.characterId || 'ajp');
    audioSystem.playPlayerJoined();
    showBanner(`${esc((data.name || 'OPERATOR').toUpperCase())} JOINED THE RING`, 1600);
    if (isLocalHost) {
      supabaseManager.broadcastRoomSettings({
        squadName: currentSquadName,
        roundTime: CONFIG.countdownSeconds,
        maxSquad: CONFIG.maxPlayersPerRoom,
        arenaTheme: currentArenaTheme,
        matchModifier: currentMatchModifier,
        seriesRounds: totalSeriesRounds
      });
    }
  },
  onPlayerLeft: (id) => {
    if (id === myId) return;
    const p = players.get(id);
    if (p) {
      showBanner(`${esc(p.name.toUpperCase())} DISCONNECTED`, 1600);
      audioSystem.playPlayerLeft();
      removeRemotePlayer(id);
    }
  },
  onPlayerMoved: (data) => {
    if (!data || !data.id || data.id === myId) return;
    if (currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL' || currentPhase === 'VICTORY') return;
    if (!supabaseManager.connectedPlayers.has(data.id)) return;
    let p = players.get(data.id);
    if (!p) {
      if (practiceBots.length > 0 && players.size >= 5) {
        const removedBot = practiceBots.pop();
        if (removedBot && players.has(removedBot.id)) {
          removeRemotePlayer(removedBot.id);
        }
        updateDemoBotsButtonUI();
      }
      p = addRemotePlayer(data.id, data.name || 'Operator', new THREE.Vector3(data.x, data.y, data.z), data.characterId || 'ajp');
    } else if (data.characterId && p.characterId !== data.characterId) {
      p.setCharacterId(data.characterId);
    }
    if (p && !p.isLocal) {
      p.hasReceivedMovePacket = true;
      p.targetPos = new THREE.Vector3(data.x, data.y, data.z);
      p.targetRotY = data.rotY;
      if (data.isStopped) {
        // Immediate clean halt without ice-skate gliding
        p.group.position.copy(p.targetPos);
        p.rotationY = data.rotY;
        p.group.rotation.y = data.rotY;
        if (p.currentActionName === 'walk' || p.currentActionName === 'run') {
          p.playAction('idle', 0.16);
        }
      }
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
    const currentRoster = Array.from(players.values()).map(pl => ({
      id: pl.id,
      name: pl.name,
      isReady: pl.isReady,
      isHost: pl.isHost,
      characterId: pl.characterId
    }));
    updateFriendsHubRoster({ count: players.size, max: CONFIG.maxPlayersPerRoom, isHost: isLocalHost, hostId: currentHostId, players: currentRoster });
    updateRoomUI({ roomId: currentRoomId, count: players.size, max: CONFIG.maxPlayersPerRoom, isHost: isLocalHost, hostId: currentHostId, players: currentRoster });
  },
  onPlayerRenamed: (data) => {
    if (!data || data.id === myId) return;
    const p = players.get(data.id);
    if (p) {
      p.name = esc(data.name || p.name);
      updateNameTag(p);
      updateScoreboard();
    }
  },
  onPlayerEmote: (data) => {
    if (!data || !data.id || data.id === myId) return;
    const p = players.get(data.id);
    if (p && p.isAlive) {
      p.triggerEmote(esc(data.label || 'HYPE'), data.animKey || null, updateNameTag);
      audioSystem.playEmoteSound(data.emoteId || 'HYPE', p.characterId);
    }
  },
  onForceStart: (payload) => {
    if (payload?.senderId && currentHostId && payload.senderId !== currentHostId) return;
    handleRemoteSquadLaunch();
  },
  onRoundSync: (data) => {
    if (data?.senderId && currentHostId && data.senderId !== currentHostId) return;
    if (data?.totalSeriesRounds) {
      totalSeriesRounds = parseInt(data.totalSeriesRounds, 10) || 1;
    }
    if (data?.seriesRound && data.seriesRound !== currentSeriesRound) {
      prepareNextSeriesRound(data.seriesRound, totalSeriesRounds);
    }
    if (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END' || currentPhase === 'SHRINK') {
      currentRound = data.round || currentRound;
      currentRoundSyncEpoch = data;
      closeFriendsHub();
      document.getElementById('welcome-screen')?.classList.add('hidden');
      document.getElementById('mode-select-screen')?.classList.add('hidden');
      document.getElementById('ui-overlay')?.classList.remove('hidden');
      if (!localPlayerDeployed) {
        deployPlayerSkyDrop();
      }
      startRound(false, data);
    }
  },
  onPhaseLock: (data) => {
    if (data?.senderId && currentHostId && data.senderId !== currentHostId) return;
    if (currentPhase === 'STEALTH') {
      if (stealthCountdownInterval) {
        clearInterval(stealthCountdownInterval);
        stealthCountdownInterval = null;
      }
      freezeAndBroadcastLock();
    }
  },
  onLatencyUpdate: (ms) => {
    const badge = document.getElementById('network-ping-val');
    if (badge) badge.innerText = `${ms}MS`;
  },
  onReveal: () => {
    executeReveal();
  },
  onLockPacket: (data) => {
    if (!data || !data.id) return;
    lockedPlayerCoords.set(data.id, { x: data.x, y: data.y, z: data.z, rotY: data.rotY });
    const p = players.get(data.id);
    if (p && !p.isLocal) {
      p.targetPos = new THREE.Vector3(data.x, data.y, data.z);
      p.targetRotY = data.rotY;
      p.group.position.copy(p.targetPos);
      p.rotationY = data.rotY;
      p.group.rotation.y = data.rotY;
      p.updateLaser();
    }
  },
  onRoundVerdict: (verdict) => {
    if (!verdict) return;
    applyRoundVerdict(verdict);
  },
  onRoomSettings: (settings) => {
    if (settings?.senderId && currentHostId && settings.senderId !== currentHostId) return;
    if (settings.roundTime) {
      CONFIG.countdownSeconds = settings.roundTime;
      const timerVal = document.getElementById('squad-timer-val');
      if (timerVal) timerVal.innerText = `${settings.roundTime}S`;
    }
    if (settings.maxSquad) CONFIG.maxPlayersPerRoom = settings.maxSquad;
    if (settings.arenaTheme) applyArenaTheme(settings.arenaTheme);
    if (settings.matchModifier) applyMatchModifier(settings.matchModifier);
    if (settings.seriesRounds) {
      totalSeriesRounds = parseInt(settings.seriesRounds, 10) || 1;
      syncSeriesRoundsUI();
    }
    if (settings.squadName) {
      currentSquadName = settings.squadName;
      const title = document.getElementById('squad-room-title');
      if (title) title.innerText = esc(settings.squadName.toUpperCase());
    }
  },
  onGameReset: (data) => {
    if (data?.senderId && currentHostId && data.senderId !== currentHostId) return;
    resetGame({ resetScores: data?.resetScores !== false });
    if (data?.autoLaunch && isLocalHost) {
      setTimeout(() => {
        if (currentPhase === 'LOBBY') {
          if (currentRoomId.startsWith('custom_')) {
            launchFriendsSquadMatch();
          } else {
            startRound(true);
          }
        }
      }, 450);
    }
  },
  onRoomStateChange: (state) => {
    if (state.roomId && state.roomId !== currentRoomId) {
      currentRoomId = state.roomId;
      if (currentRoomId.startsWith('sector_')) {
        showBanner(`SECTOR FULL // ROUTED TO PUBLIC SECTOR ${currentRoomId.replace('sector_', '')}`, 2600);
      }
      updateDemoBotsButtonUI();
    }
    if (state.players && state.max && !currentRoomId.startsWith('sector_')) {
      const myIndex = state.players.findIndex(p => p.id === myId);
      if (myIndex >= state.max) {
        showBanner('SQUAD FULL // CAPACITY EXCEEDED', 3000);
        supabaseManager.leaveRoom();
        closeFriendsHub();
        document.getElementById('ui-overlay')?.classList.add('hidden');
        document.getElementById('mode-select-screen')?.classList.remove('hidden');
        return;
      }
    }
    // Reconcile 3D players Map with authoritative room roster to prevent phantom/stacked models
    if (state.players && Array.isArray(state.players)) {
      const activeRosterIds = new Set(state.players.map(pl => pl.id));
      Array.from(players.keys()).forEach(pid => {
        if (pid === myId) return;
        const existing = players.get(pid);
        if (existing && !existing.isBot && !activeRosterIds.has(pid)) {
          removeRemotePlayer(pid);
        }
      });
      const totalSlots = Math.max(5, state.players.length);
      state.players.forEach((pl, idx) => {
        if (pl.id !== myId && !players.has(pl.id)) {
          const spawnPos = getRadialSpawnPosition(idx, totalSlots);
          addRemotePlayer(pl.id, pl.name || 'Operator', spawnPos, pl.characterId || 'ajp');
        }
        const char = players.get(pl.id);
        if (char && currentPhase === 'LOBBY' && !char.hasReceivedMovePacket && (!char.isLocal || !wasMoving)) {
          const podPos = getRadialSpawnPosition(idx, totalSlots);
          char.group.position.copy(podPos);
          if (!char.isLocal) {
            char.targetPos = podPos.clone();
          }
          char.lookAtTarget(new THREE.Vector3(0, 0, 0));
        }
      });
    }
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

let bannerTimer = null;
function showBanner(text, duration = 1800) {
  if (currentPhase === 'VICTORY') return;
  const el = document.getElementById('event-banner');
  if (!el) return;
  if (bannerTimer) clearTimeout(bannerTimer);
  el.innerText = text;
  el.classList.add('active');
  bannerTimer = setTimeout(() => {
    el.classList.remove('active');
    bannerTimer = null;
  }, duration);
}

let consecutiveStalemates = 0;
let lastAppliedVerdictRound = '';
let lastVerdictWasAuthoritative = false;
let roundTransitionTimer = null;

function prepareNextSeriesRound(nextSeriesRound, nextTotalRounds = totalSeriesRounds) {
  timeDilationFactor = 1.0;
  audioSystem.stopAjpCelebration();
  if (stealthCountdownInterval) {
    clearInterval(stealthCountdownInterval);
    stealthCountdownInterval = null;
  }
  if (revealWatchdogTimer) {
    clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = null;
  }
  if (roundTransitionTimer) {
    clearTimeout(roundTransitionTimer);
    roundTransitionTimer = null;
  }

  currentSeriesRound = nextSeriesRound;
  if (nextTotalRounds) totalSeriesRounds = nextTotalRounds;
  currentRound = 1;
  lastAppliedVerdictRound = '';
  lastVerdictWasAuthoritative = false;
  arenaRadius = CONFIG.initialArenaRadius;
  if (arena) arena.resetRadius(arenaRadius);
  consecutiveStalemates = 0;

  let i = 0;
  players.forEach(p => {
    if (p.baseScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.baseScale);
      p.fbxModel.position.y = p.baseOffsetY || 0;
    } else if (p.originalScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.originalScale);
      p.fbxModel.position.y = p.baseOffsetY || 0;
    }
    p.setLaserActive(false);
    const spawnPos = getRadialSpawnPosition(i, Math.max(1, players.size));
    p.hasReceivedMovePacket = false;
    p.revive(spawnPos);
    p.lookAtTarget(new THREE.Vector3(0, 0, 0));
    p.setVisible(true);
    if (p.htmlTag) p.htmlTag.classList.remove('hidden');
    i++;
  });

  currentPhase = 'ROUND_END';
  syncSeriesRoundsUI();
  updateScoreboard();
}

function startRound(broadcast = true, syncEpoch = null) {
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END' && currentPhase !== 'SHRINK') return;
  audioSystem.init();
  if (roundTransitionTimer) {
    clearTimeout(roundTransitionTimer);
    roundTransitionTimer = null;
  }
  document.getElementById('lobby-modal')?.classList.remove('active');
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('ui-overlay')?.classList.remove('hidden');

  lockedPlayerCoords.clear();
  if (stealthCountdownInterval) {
    clearInterval(stealthCountdownInterval);
    stealthCountdownInterval = null;
  }

  // PHASE 1: RECON (1.5 seconds) - All players visible to observe trajectories
  currentPhase = 'RECON';
  updateHostStartButtonUI();
  syncSeriesRoundsUI();
  clockPhaseLabel.innerText = 'RECONNAISSANCE';
  clockGuidanceText.innerText = 'OBSERVE OPERATOR POSITIONS // PREPARE AIM';
  showBanner(totalSeriesRounds > 1 ? `ROUND ${currentSeriesRound} OF ${totalSeriesRounds} // RECONNAISSANCE` : 'RECONNAISSANCE PHASE', 1400);

  // Reveal all alive players so everyone sees where everyone is
  players.forEach(p => {
    if (p.isAlive) {
      p.setStealth(false);
      p.setLaserActive(false);
    }
  });

  const now = Date.now();
  const reconDuration = syncEpoch?.reconDuration || 1500;
  const stealthDuration = syncEpoch?.stealthDuration || (CONFIG.countdownSeconds * 1000);
  const serverStart = syncEpoch?.serverStartTime || now;

  if (broadcast) {
    supabaseManager.broadcastRoundStart(currentRound, {
      seriesRound: currentSeriesRound,
      totalSeriesRounds,
      serverStartTime: now,
      reconDuration,
      stealthDuration
    });
  }

  const elapsedRecon = Date.now() - serverStart;
  const remainingRecon = Math.max(80, reconDuration - elapsedRecon);

  // After recon phase, enter synchronized PREDICTION LOCK
  setTimeout(() => {
    if (currentPhase !== 'RECON') return;
    currentPhase = 'STEALTH';
    clockPhaseLabel.innerText = 'PREDICTION LOCK';
    clockGuidanceText.innerText = 'OPPONENTS CONCEALED // GHOST SILHOUETTES MARKED';
    showBanner('PREDICTION LOCKDOWN', 1200);

    // Initialize aimPoint along localPlayer's current facing direction so laser doesn't snap to (0,0,0) before aiming
    if (localPlayer && !hasAimedSinceStop) {
      _scratchForward.set(0, 0, 1).applyAxisAngle(_yAxis, localPlayer.rotationY).normalize();
      aimPoint.copy(localPlayer.group.position).addScaledVector(_scratchForward, 8.0);
    }

    // Conceal opponents and generate ghost silhouettes at their positions; turn on aiming lasers
    players.forEach(p => {
      if (p.isAlive) {
        p.setStealth(true);
        p.setLaserActive(true);
      }
    });

    // Practice bots pick stealth destinations and aim targets
    practiceBots.forEach(bot => {
      if (bot.isAlive) {
        const angle = Math.random() * Math.PI * 2;
        const dist = (arenaRadius - 2.2) * Math.sqrt(0.15 + 0.85 * Math.random());
        bot.targetPos.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        const candidates = Array.from(players.values()).filter(p => p.id !== bot.id && p.isAlive);
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        if (chosen) {
          bot.botAimPoint = chosen.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4));
        } else {
          bot.botAimPoint = new THREE.Vector3(0, 0, 0);
        }
      }
    });

    const stealthEndTarget = serverStart + reconDuration + stealthDuration;
    const initialRemaining = Math.max(1, Math.ceil((stealthEndTarget - Date.now()) / 1000));
    countdownTime = initialRemaining;
    timerEl.innerText = countdownTime.toString().padStart(2, '0');

    stealthCountdownInterval = setInterval(() => {
      const remainingMs = stealthEndTarget - Date.now();
      const sec = Math.max(0, Math.ceil(remainingMs / 1000));
      countdownTime = sec;
      timerEl.innerText = countdownTime.toString().padStart(2, '0');
      audioSystem.playCountdownTick(countdownTime === 0);

      if (remainingMs <= 0) {
        clearInterval(stealthCountdownInterval);
        stealthCountdownInterval = null;
        if (isLocalHost) {
          supabaseManager.broadcastPhaseLock(currentRound);
        }
        freezeAndBroadcastLock();
      }
    }, 250); // Synchronous 250ms interval ensures accurate real-time second boundaries
  }, remainingRecon);
}

function freezeAndBroadcastLock() {
  if (currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL' || currentPhase === 'VICTORY') return;
  currentPhase = 'INPUT_FREEZE';
  clockPhaseLabel.innerText = 'TRAJECTORY LOCK';
  clockGuidanceText.innerText = 'INPUTS FROZEN // FIRING SIMULTANEOUSLY';

  // Record and broadcast local lock packet
  if (localPlayer) {
    if (localPlayer.isAlive && hasAimedSinceStop) {
      localPlayer.lookAtTarget(aimPoint);
      localPlayer.updateLaser();
    }
    lockedPlayerCoords.set(myId, {
      x: localPlayer.group.position.x,
      y: localPlayer.group.position.y,
      z: localPlayer.group.position.z,
      rotY: localPlayer.rotationY
    });

    supabaseManager.broadcastLockPacket({
      id: myId,
      round: currentRound,
      x: localPlayer.group.position.x,
      y: localPlayer.group.position.y,
      z: localPlayer.group.position.z,
      rotY: localPlayer.rotationY
    });
  }

  // Freeze practice bots and record their lock coordinates
  practiceBots.forEach(bot => {
    if (bot.isAlive) {
      if (bot.botAimPoint) {
        bot.lookAtTarget(bot.botAimPoint);
      }
      lockedPlayerCoords.set(bot.id, {
        x: bot.group.position.x,
        y: bot.group.position.y,
        z: bot.group.position.z,
        rotY: bot.rotationY
      });
    }
  });

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

  // 2. Authoritative host referee evaluates hits with 520ms grace window for peer lock packets
  if (isLocalHost) {
    setTimeout(() => {
      evaluateHostVerdict(true);
    }, 520);
  } else {
    // Watchdog fallback ONLY if host completely disconnected for 3.6 seconds
    if (revealWatchdogTimer) clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = setTimeout(() => {
      if (currentPhase === 'REVEAL') {
        console.warn('Host verdict timeout - evaluating local fallback');
        evaluateHostVerdict(false);
      }
    }, 3600);
  }
}

function evaluateHostVerdict(isAuthoritative = true) {
  const hitList = [];
  const alivePlayers = Array.from(players.values()).filter(p => p.isAlive);

  // Ensure every alive player has locked coordinates recorded for deterministic raycasting
  alivePlayers.forEach(p => {
    if (!lockedPlayerCoords.has(p.id)) {
      lockedPlayerCoords.set(p.id, {
        x: p.group.position.x,
        y: p.group.position.y,
        z: p.group.position.z,
        rotY: p.rotationY
      });
    }
  });

  alivePlayers.forEach(shooter => {
    let ray;
    const lockedShooter = lockedPlayerCoords.get(shooter.id);
    if (lockedShooter) {
      _scratchForward.set(0, 0, 1).applyAxisAngle(_yAxis, lockedShooter.rotY).normalize();
      _scratchRight.set(-1, 0, 0).applyAxisAngle(_yAxis, lockedShooter.rotY).normalize();
      const origin = new THREE.Vector3(lockedShooter.x, lockedShooter.y, lockedShooter.z)
        .add(_chestOffset)
        .addScaledVector(_scratchForward, 0.3)
        .addScaledVector(_scratchRight, 0.2);
      ray = { origin, direction: _scratchForward.clone(), length: shooter.laserLength };
    } else {
      ray = shooter.getLaserRay();
    }

    let closestTarget = null;
    let minProj = Infinity;

    alivePlayers.forEach(target => {
      if (shooter.id === target.id) return;

      const lockedTarget = lockedPlayerCoords.get(target.id);
      const targetPos = lockedTarget 
        ? new THREE.Vector3(lockedTarget.x, lockedTarget.y + 1.35, lockedTarget.z)
        : target.group.position.clone().add(new THREE.Vector3(0, 1.35, 0));

      const v = new THREE.Vector3().subVectors(targetPos, ray.origin);
      const proj = v.dot(ray.direction);

      if (proj > 0 && proj < ray.length) {
        const closestPoint = ray.origin.clone().add(ray.direction.clone().multiplyScalar(proj));
        const horizDist = Math.hypot(closestPoint.x - targetPos.x, closestPoint.z - targetPos.z);

        // Horizontal cylinder hitbox radius 0.90m - only strike the closest obstacle/player along the ray
        if (horizDist <= 0.90 && proj < minProj) {
          minProj = proj;
          closestTarget = target;
        }
      }
    });

    if (closestTarget) {
      hitList.push({ shooterId: shooter.id, targetId: closestTarget.id });
    }
  });

  const eliminatedIds = [...new Set(hitList.map(h => h.targetId))];
  const survivors = alivePlayers.filter(p => !eliminatedIds.includes(p.id));
  const isRoundComplete = survivors.length <= 1;
  const roundWinnerId = isRoundComplete ? (survivors.length === 1 ? survivors[0].id : null) : null;
  const roundDanceKey = isRoundComplete ? pickRandomVictoryDance() : null;
  const isGameOver = isRoundComplete && (currentSeriesRound >= totalSeriesRounds);

  // Compute authoritative projected scores across all players
  const projectedScores = {};
  players.forEach(p => {
    projectedScores[p.id] = {
      score: p.score || 0,
      wins: p.wins || 0,
      winStreak: p.winStreak || 0
    };
  });
  hitList.forEach(({ shooterId }) => {
    if (projectedScores[shooterId]) {
      projectedScores[shooterId].score += 100;
    }
  });
  if (isRoundComplete) {
    Object.keys(projectedScores).forEach(pid => {
      if (roundWinnerId && pid === roundWinnerId) {
        projectedScores[pid].score += 250;
        projectedScores[pid].wins += 1;
        projectedScores[pid].winStreak += 1;
      } else {
        projectedScores[pid].winStreak = 0;
      }
    });
  }

  let winnerId = null;
  let topLeaderIds = [];
  if (isGameOver) {
    if (totalSeriesRounds > 1) {
      const scoreEntries = Object.entries(projectedScores);
      const maxScore = scoreEntries.reduce((max, [, val]) => Math.max(max, val.score), 0);
      topLeaderIds = scoreEntries
        .filter(([, val]) => val.score === maxScore && maxScore > 0)
        .map(([pid]) => pid);
      if (topLeaderIds.length === 1) {
        winnerId = topLeaderIds[0];
      } else {
        winnerId = null;
      }
    } else {
      winnerId = roundWinnerId;
    }
  }

  const winnerDanceKey = isGameOver ? (roundDanceKey || pickRandomVictoryDance()) : null;

  let drawShowcase = null;
  if (isGameOver && !winnerId) {
    const drawCandidateIds = (totalSeriesRounds > 1 && topLeaderIds.length >= 2)
      ? [...topLeaderIds]
      : [...eliminatedIds];
    if (drawCandidateIds.length < 2) {
      const sortedIds = Array.from(players.values())
        .sort((a, b) => (projectedScores[b.id]?.score || 0) - (projectedScores[a.id]?.score || 0))
        .map(p => p.id);
      for (const pid of sortedIds) {
        if (drawCandidateIds.length >= Math.min(3, players.size)) break;
        if (!drawCandidateIds.includes(pid)) {
          drawCandidateIds.push(pid);
        }
      }
    }
    const finalDrawIds = drawCandidateIds.slice(0, 3);
    const drawAnims = pickShuffledDrawAnims(finalDrawIds.length);
    drawShowcase = finalDrawIds.map((playerId, idx) => ({
      playerId,
      animKey: drawAnims[idx % drawAnims.length]
    }));
  }

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
    verdictKey: `${currentSeriesRound}_${currentRound}`,
    round: currentRound,
    seriesRound: currentSeriesRound,
    totalSeriesRounds,
    isAuthoritative,
    eliminatedIds,
    hits: hitList,
    lockedCoords: Object.fromEntries(lockedPlayerCoords),
    ringRadius: newRingRadius,
    isRoundComplete,
    roundWinnerId,
    roundDanceKey,
    projectedScores,
    isGameOver,
    winnerId,
    winnerDanceKey,
    drawShowcase,
    survivors: survivors.map(s => s.id)
  };

  // Only the authoritative Host broadcasts the verdict to all connected peers
  if (isAuthoritative) {
    supabaseManager.broadcastRoundVerdict(verdict);
  }
  applyRoundVerdict(verdict);
}

function applyRoundVerdict(verdict) {
  if (!verdict) return;
  const isAuth = verdict.isAuthoritative !== false;
  const vKey = verdict.verdictKey || `${verdict.seriesRound || currentSeriesRound}_${verdict.round || currentRound}`;
  if (vKey && lastAppliedVerdictRound === vKey) {
    // Ignore duplicate verdict for the same round unless an authoritative Host verdict is overriding a local watchdog fallback
    if (lastVerdictWasAuthoritative || !isAuth) return;
  }
  if (vKey) {
    lastAppliedVerdictRound = vKey;
    lastVerdictWasAuthoritative = isAuth;
  }
  if (verdict.seriesRound) currentSeriesRound = verdict.seriesRound;
  if (verdict.totalSeriesRounds) totalSeriesRounds = verdict.totalSeriesRounds;
  syncSeriesRoundsUI();

  if (revealWatchdogTimer) {
    clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = null;
  }
  if (roundTransitionTimer) {
    clearTimeout(roundTransitionTimer);
    roundTransitionTimer = null;
  }
  // Snap all remote players to the authoritative locked coordinates used in the verdict
  if (verdict.lockedCoords && typeof verdict.lockedCoords === 'object') {
    Object.entries(verdict.lockedCoords).forEach(([pid, coords]) => {
      if (!coords || pid === myId) return;
      const p = players.get(pid);
      if (p && !p.isLocal) {
        p.targetPos = new THREE.Vector3(coords.x, coords.y, coords.z);
        p.targetRotY = coords.rotY;
        p.group.position.copy(p.targetPos);
        p.rotationY = coords.rotY;
        p.group.rotation.y = coords.rotY;
      }
    });
  }
  players.forEach(p => {
    p.removeGhostSilhouette();
    p.setLaserActive(false);
  });

  // Apply authoritative projected scores if present, otherwise fallback to local score calculation
  if (verdict.projectedScores && typeof verdict.projectedScores === 'object') {
    players.forEach(p => {
      const ps = verdict.projectedScores[p.id];
      if (ps) {
        p.score = ps.score;
        p.wins = ps.wins;
        p.winStreak = ps.winStreak;
      }
      updateNameTag(p);
    });
  } else {
    if (verdict.hits) {
      verdict.hits.forEach(({ shooterId }) => {
        const shooter = players.get(shooterId);
        if (shooter) shooter.score += 100;
      });
    }
    if (verdict.isRoundComplete || verdict.isGameOver) {
      const rWinId = verdict.roundWinnerId !== undefined ? verdict.roundWinnerId : verdict.winnerId;
      players.forEach(p => {
        if (rWinId && p.id === rWinId) {
          p.wins = (p.wins || 0) + 1;
          p.winStreak = (p.winStreak || 0) + 1;
          p.score += 250;
        } else {
          p.winStreak = 0;
        }
        updateNameTag(p);
      });
    }
  }

  let someoneDied = false;
  let localPlayerEliminated = false;
  const eliminatedSet = new Set(verdict.eliminatedIds || []);
  eliminatedSet.forEach(targetId => {
    const target = players.get(targetId);
    if (target && target.isAlive) {
      target.die();
      someoneDied = true;
      if (localPlayer && targetId === localPlayer.id) {
        localPlayerEliminated = true;
      }
    }
  });

  if (someoneDied) {
    audioSystem.playCinematicElimination();
    triggerScreenShake(localPlayerEliminated ? 0.8 : 0.45);
    triggerDeathVignette(localPlayerEliminated ? 1400 : 700, localPlayerEliminated);
  }

  // Dramatic slow-motion on round or match conclusion
  if ((verdict.isRoundComplete || verdict.isGameOver) && someoneDied) {
    timeDilationFactor = 0.32;
    audioSystem.playSlowMoFinish();
    setTimeout(() => {
      timeDilationFactor = 1.0;
    }, 1100);
  }

  updateScoreboard();

  // If local player was eliminated and the current round is still ongoing, update guidance
  if (localPlayer && !localPlayer.isAlive && !verdict.isRoundComplete && !verdict.isGameOver) {
    clockGuidanceText.innerText = 'ELIMINATED // OBSERVING ARENA';
    showBanner('ELIMINATED // ROUND IN PROGRESS', 2200);
  }

  // After animation delay, process game over, next series round, or next shrink wave
  roundTransitionTimer = setTimeout(() => {
    roundTransitionTimer = null;
    timeDilationFactor = 1.0;
    if (verdict.isGameOver) {
      const winner = verdict.winnerId ? (players.get(verdict.winnerId) || localPlayer) : null;
      presentWinner(winner, verdict.winnerDanceKey, verdict.drawShowcase);
    } else if (verdict.isRoundComplete) {
      // Intermediate Round in a Multi-Round Series finished!
      currentPhase = 'ROUND_END';
      const roundWinner = verdict.roundWinnerId ? players.get(verdict.roundWinnerId) : null;
      const sortedStandings = Array.from(players.values()).sort((a, b) => b.score - a.score);
      const seriesLeader = sortedStandings[0];
      const leaderText = seriesLeader ? `LEADER: ${seriesLeader.name.toUpperCase()} (${seriesLeader.score} PTS)` : '';

      if (roundWinner) {
        roundWinner.playAction(verdict.roundDanceKey || pickRandomVictoryDance(), 0.2);
        audioSystem.playVictoryFanfare();
        clockPhaseLabel.innerText = `ROUND ${currentSeriesRound}/${totalSeriesRounds} COMPLETE`;
        clockGuidanceText.innerText = `${roundWinner.name.toUpperCase()} WON ROUND (+250 PTS) // ${leaderText}`;
        showBanner(`ROUND ${currentSeriesRound}/${totalSeriesRounds}: ${roundWinner.name.toUpperCase()} (+250 PTS) // ${leaderText}`, 3400);
      } else {
        clockPhaseLabel.innerText = `ROUND ${currentSeriesRound}/${totalSeriesRounds} DRAW`;
        clockGuidanceText.innerText = `NO SURVIVORS // ${leaderText}`;
        showBanner(`ROUND ${currentSeriesRound}/${totalSeriesRounds} DRAW // ${leaderText}`, 3400);
      }

      const nextSR = currentSeriesRound + 1;
      roundTransitionTimer = setTimeout(() => {
        roundTransitionTimer = null;
        if (currentPhase === 'VICTORY') return;
        prepareNextSeriesRound(nextSR, totalSeriesRounds);
        if (isLocalHost) {
          startRound(true);
        }
      }, 3600);
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
      syncSeriesRoundsUI();

      // Only the host triggers the next round start
      setTimeout(() => {
        if (isLocalHost && currentPhase === 'SHRINK') {
          currentPhase = 'LOBBY';
          startRound(true);
        }
      }, 3000);
    }
  }, 2200);
}

function renderVictoryStandings() {
  const card = document.getElementById('victory-standings-card');
  const header = document.getElementById('victory-standings-header');
  const list = document.getElementById('victory-standings-list');
  if (!card || !list) return;

  if (header) {
    header.innerText = totalSeriesRounds > 1
      ? `FINAL SERIES STANDINGS (${totalSeriesRounds} ROUNDS)`
      : 'MATCH STANDINGS';
  }

  const sorted = Array.from(players.values()).sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (b.wins || 0) - (a.wins || 0);
  });

  list.innerHTML = '';
  sorted.forEach((p, idx) => {
    const row = document.createElement('div');
    const isTop = idx === 0 && (p.score || 0) > 0;
    row.className = `victory-standing-row ${isTop ? 'rank-1' : ''}`;
    const winsBadge = totalSeriesRounds > 1 ? ` (${p.wins || 0}W)` : '';
    row.innerHTML = `
      <div class="victory-standing-left">
        <span class="victory-rank-badge">#${idx + 1}</span>
        <span>${esc(p.name.toUpperCase())}${winsBadge}</span>
      </div>
      <span class="victory-standing-pts">${p.score || 0} PTS</span>
    `;
    list.appendChild(row);
  });
  card.classList.remove('hidden');
}

// WINNER PODIUM CELEBRATION PRESENTATION
function presentWinner(winner, danceKeyOverride = null, drawShowcase = null) {
  currentPhase = 'VICTORY';
  timeDilationFactor = 1.0;
  players.forEach(p => {
    p.removeGhostSilhouette();
    p.setLaserActive(false);
  });

  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  // Hide ALL buttons, HUD overlays, banners, vignettes, and modals so ONLY winner overlay is visible
  document.getElementById('event-banner')?.classList.remove('active');
  document.getElementById('death-vignette')?.classList.remove('active', 'critical');
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('name-tags-container')?.classList.add('hidden');
  document.getElementById('touch-joystick-zone')?.classList.add('hidden');
  document.getElementById('touch-aim-zone')?.classList.add('hidden');
  document.getElementById('lobby-modal')?.classList.remove('active');
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('friends-hub-modal')?.classList.remove('active');
  document.getElementById('character-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.remove('active');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('welcome-screen')?.classList.add('hidden');

  const modal = document.getElementById('winner-modal');
  const nameDisplay = document.getElementById('winner-name-display');
  const playAgainText = document.getElementById('victory-play-again-text');
  if (playAgainText) {
    playAgainText.innerText = isLocalHost ? 'REMATCH NOW' : 'READY FOR REMATCH';
  }
  renderVictoryStandings();

  if (!winner) {
    let drawFinalists = [];
    if (Array.isArray(drawShowcase) && drawShowcase.length > 0) {
      const fallbackAnims = pickShuffledDrawAnims(3);
      drawShowcase.slice(0, 3).forEach((entry, idx) => {
        const p = entry && entry.playerId ? players.get(entry.playerId) : null;
        if (p) {
          const animKey = (entry.animKey && DRAW_ANIM_KEYS.includes(entry.animKey))
            ? entry.animKey
            : fallbackAnims[idx % fallbackAnims.length];
          drawFinalists.push({ player: p, animKey });
        }
      });
    }
    if (drawFinalists.length === 0) {
      const fallbackPlayers = Array.from(players.values()).slice(0, 3);
      const fallbackAnims = pickShuffledDrawAnims(fallbackPlayers.length);
      drawFinalists = fallbackPlayers.map((p, idx) => ({
        player: p,
        animKey: fallbackAnims[idx % fallbackAnims.length]
      }));
    }

    const finalistIds = new Set(drawFinalists.map(item => item.player.id));
    players.forEach(p => {
      if (!finalistIds.has(p.id)) {
        p.setVisible(false);
        if (p.htmlTag) p.htmlTag.classList.add('hidden');
      }
    });

    let stagePositions;
    if (drawFinalists.length === 1) {
      stagePositions = [new THREE.Vector3(0, 0, 0)];
    } else if (drawFinalists.length === 2) {
      stagePositions = [new THREE.Vector3(-1.15, 0, 0), new THREE.Vector3(1.15, 0, 0)];
    } else {
      stagePositions = [new THREE.Vector3(-1.4, 0, 0.25), new THREE.Vector3(0, 0, -0.35), new THREE.Vector3(1.4, 0, 0.25)];
    }

    drawFinalists.forEach((item, idx) => {
      const p = item.player;
      p.isAlive = true;
      p.setVisible(true);
      if (p.htmlTag) p.htmlTag.classList.add('hidden');
      const stagePos = stagePositions[idx] || new THREE.Vector3(0, 0, 0);
      p.group.position.copy(stagePos);
      p.targetPos = stagePos.clone();
      p.group.rotation.y = 0;
      p.rotationY = 0;
      p.targetRotY = 0;
      if (p.fbxModel) {
        if (!p.baseScale) {
          p.baseScale = p.originalScale || p.fbxModel.scale.x;
        }
        p.fbxModel.scale.setScalar(p.baseScale * 1.12);
        p.fbxModel.position.y = (p.baseOffsetY || 0) * 1.12;
      }
      p.playAction(item.animKey, 0.2);
    });

    camera.position.set(0, 2.15, 6.2);
    controls.target.set(0, 1.05, 0);
    controls.update();
    victoryOrbitAngle = 0;

    ringSpot.position.set(0, 10, 2);
    ringSpot.target.position.set(0, 1.2, 0);
    ringSpot.intensity = 6.0;

    clockPhaseLabel.innerText = 'MATCH CONCLUDED';
    clockGuidanceText.innerText = 'MUTUAL DESTRUCTION // NO SURVIVORS';
    if (nameDisplay) nameDisplay.innerText = totalSeriesRounds > 1 ? 'SERIES DRAW' : 'DRAW';
    if (modal) modal.classList.remove('hidden');

    audioSystem.playVictoryFanfare();
    return;
  }

  clockPhaseLabel.innerText = 'MATCH CONCLUDED';
  clockGuidanceText.innerText = `${winner.name.toUpperCase()} WINS`;

  // Hide defeated opponents so spotlight is solely on the champion, and ensure champion is visible
  players.forEach(p => {
    if (p.id !== winner.id) {
      p.setVisible(false);
      if (p.htmlTag) p.htmlTag.classList.add('hidden');
    } else {
      p.isAlive = true;
      p.setVisible(true);
      if (p.htmlTag) p.htmlTag.classList.add('hidden');
    }
  });

  // Center champion facing camera (0 rotation faces camera directly)
  winner.group.position.set(0, 0, 0);
  winner.targetPos = new THREE.Vector3(0, 0, 0);
  winner.group.rotation.y = 0;
  winner.rotationY = 0;
  winner.targetRotY = 0;

  if (winner.fbxModel) {
    if (!winner.baseScale) {
      winner.baseScale = winner.originalScale || winner.fbxModel.scale.x;
    }
    // Scale champion to 1.18x so full character from head to toe is visible
    winner.fbxModel.scale.setScalar(winner.baseScale * 1.18);
    winner.fbxModel.position.y = (winner.baseOffsetY || 0) * 1.18;
  }

  // Position camera with cinematic distance to show full body dance without being overly zoomed in
  camera.position.set(0, 2.0, 5.8);
  controls.target.set(0, 1.05, 0);
  controls.update();
  victoryOrbitAngle = 0;

  // Play Victory Celebration: if champion is AJP, play AJP song rotation, else standard fanfare
  const isAjpWinner = (winner.characterId === 'ajp' || (winner.isLocal && selectedCharacterId === 'ajp'));
  if (isAjpWinner) {
    audioSystem.playAjpCelebration();
  } else {
    audioSystem.playVictoryFanfare();
  }
  const danceKey = (danceKeyOverride && VICTORY_DANCE_KEYS.includes(danceKeyOverride))
    ? danceKeyOverride
    : pickRandomVictoryDance();
  winner.playAction(danceKey, 0.2);

  // Focus high-intensity spotlight on the champion
  ringSpot.position.set(0, 10, 2);
  ringSpot.target.position.set(0, 1.2, 0);
  ringSpot.intensity = 6.0;

  // Show Winner Name and total points
  if (nameDisplay) {
    nameDisplay.innerText = totalSeriesRounds > 1
      ? `${winner.name.toUpperCase()} WINS SERIES // ${winner.score || 0} PTS`
      : `${winner.name.toUpperCase()} WINS`;
  }
  if (modal) modal.classList.remove('hidden');
}

function resetGame({ resetScores = true } = {}) {
  timeDilationFactor = 1.0;
  audioSystem.stopAjpCelebration();
  if (stealthCountdownInterval) {
    clearInterval(stealthCountdownInterval);
    stealthCountdownInterval = null;
  }
  if (readyCountdownInterval) {
    clearInterval(readyCountdownInterval);
    readyCountdownInterval = null;
  }
  if (revealWatchdogTimer) {
    clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = null;
  }
  if (roundTransitionTimer) {
    clearTimeout(roundTransitionTimer);
    roundTransitionTimer = null;
  }
  if (pendingUpdateReload) {
    executeSafeReload();
    return;
  }
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) winnerModal.classList.add('hidden');

  // Restore HUD overlay & name tags
  document.getElementById('ui-overlay')?.classList.remove('hidden');
  document.getElementById('name-tags-container')?.classList.remove('hidden');
  document.getElementById('touch-joystick-zone')?.classList.remove('hidden');
  document.getElementById('touch-aim-zone')?.classList.remove('hidden');

  // Restore camera & spotlight
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultTarget);
  controls.enabled = true;
  controls.update();

  ringSpot.position.set(0, 18, 0);
  ringSpot.target.position.set(0, 0, 0);
  ringSpot.intensity = 3.8;
  applyArenaTheme(currentArenaTheme);

  // Randomize demo bot characters for the next match in Public mode
  randomizePracticeBotCharacters();

  // Restore player scales & disable lasers
  players.forEach(p => {
    if (p.baseScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.baseScale);
      p.fbxModel.position.y = p.baseOffsetY || 0;
    } else if (p.originalScale && p.fbxModel) {
      p.fbxModel.scale.setScalar(p.originalScale);
      p.fbxModel.position.y = p.baseOffsetY || 0;
    }
    if (resetScores) {
      p.score = 0;
      p.wins = 0;
    }
    p.setLaserActive(false);
    updateNameTag(p);
  });

  currentSeriesRound = 1;
  currentRound = 1;
  lastAppliedVerdictRound = '';
  lastVerdictWasAuthoritative = false;
  arenaRadius = CONFIG.initialArenaRadius;
  if (arena) arena.resetRadius(arenaRadius);
  consecutiveStalemates = 0;

  let i = 0;
  players.forEach(p => {
    const spawnPos = getRadialSpawnPosition(i, Math.max(1, players.size));
    p.hasReceivedMovePacket = false;
    p.revive(spawnPos);
    p.lookAtTarget(new THREE.Vector3(0, 0, 0));
    p.setVisible(true);
    if (p.htmlTag) p.htmlTag.classList.remove('hidden');
    i++;
  });

  currentPhase = 'LOBBY';
  timerEl.innerText = CONFIG.countdownSeconds.toString().padStart(2, '0');
  syncSeriesRoundsUI();
  clockPhaseLabel.innerText = 'PREPARATION';
  clockGuidanceText.innerText = currentRoomId.startsWith('custom_')
    ? (isLocalHost ? 'CLICK START MATCH OR READY UP' : 'CLICK READY UP // WAITING FOR HOST')
    : 'CLICK READY UP TO START MATCH';
  
  isLocalReady = false;
  supabaseManager.setReady(false);
  updateReadyButtonUI();
  updateHostStartButtonUI();
  updateScoreboard();
}

function updateScoreboard() {
  const listEl = document.getElementById('scoreboard-list');
  const countPillEl = document.getElementById('roster-count-pill');
  if (countPillEl) {
    countPillEl.innerText = `${players.size}`;
  }
  if (!listEl) return;
  listEl.innerHTML = '';

  Array.from(players.values()).sort((a, b) => b.score - a.score).forEach(p => {
    const row = document.createElement('div');
    row.className = `roster-entry ${p.isLocal ? 'local' : ''} ${!p.isAlive ? 'dead' : ''}`;
    const streakHtml = p.winStreak >= 2 ? `<span class="streak-tag">${p.winStreak}X STREAK</span>` : '';
    row.innerHTML = `
      <div class="entry-name-box">
        <span class="entry-indicator ${!p.isAlive ? 'dead' : ''}"></span>
        <span class="entry-name">${esc(p.name)}${streakHtml}</span>
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

function updateHostStartButtonUI() {
  const hudHostBtn = document.getElementById('btn-hud-host-start');
  const hudHostText = document.getElementById('hud-host-start-text');
  if (!hudHostBtn) return;

  const isPrivate = currentRoomId.startsWith('custom_');
  const inLobbyPhase = (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END');
  if (isPrivate && isLocalHost && inLobbyPhase) {
    hudHostBtn.classList.remove('hidden');
    const realConnectedCount = 1 + supabaseManager.connectedPlayers.size;
    if (hudHostText) {
      hudHostText.innerText = realConnectedCount >= 2 ? 'START MATCH' : 'START MATCH (MIN 2)';
    }
    hudHostBtn.style.opacity = realConnectedCount >= 2 ? '1' : '0.65';
  } else {
    hudHostBtn.classList.add('hidden');
  }
}

function launchFriendsSquadMatch() {
  if (!isLocalHost) {
    showBanner('ONLY THE SQUAD HOST CAN LAUNCH THE MATCH', 2000);
    return;
  }
  audioSystem.init();
  const realConnectedCount = 1 + supabaseManager.connectedPlayers.size;
  if (currentRoomId.startsWith('custom_') && realConnectedCount < 2) {
    audioSystem.playUnreadyClick();
    showBanner('NEED AT LEAST 2 PLAYERS TO LAUNCH MATCH', 2200);
    return;
  }
  if (currentRoomId.startsWith('custom_')) {
    clearPracticeBots();
  }
  currentSeriesRound = 1;
  currentRound = 1;
  players.forEach(p => {
    p.score = 0;
    p.wins = 0;
    updateNameTag(p);
  });
  updateScoreboard();
  syncSeriesRoundsUI();
  updateDemoBotsButtonUI();
  supabaseManager.broadcastForceStart();
  closeFriendsHub();
  deployPlayerSkyDrop();
  startRound(true);
}

function handleRemoteSquadLaunch() {
  audioSystem.init();
  if (currentRoomId.startsWith('custom_')) {
    clearPracticeBots();
  }
  currentSeriesRound = 1;
  currentRound = 1;
  players.forEach(p => {
    p.score = 0;
    p.wins = 0;
    updateNameTag(p);
  });
  updateScoreboard();
  syncSeriesRoundsUI();
  updateDemoBotsButtonUI();
  closeFriendsHub();
  document.getElementById('welcome-screen')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.add('hidden');
  deployPlayerSkyDrop();
  setTimeout(() => {
    if (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END') {
      startRound(false);
    }
  }, 500);
}

function checkAllPlayersReady(playersList) {
  // STRICT PRIVATE MODE RULE: Private lobbies ('custom_*') NEVER auto-start!
  // They ONLY start when there are 2+ players AND the Host explicitly clicks START MATCH / LAUNCH MATCH.
  if (currentRoomId.startsWith('custom_')) {
    if (readyCountdownInterval) {
      clearInterval(readyCountdownInterval);
      readyCountdownInterval = null;
    }
    return;
  }

  const count = playersList ? playersList.length : 1;
  const isSolo = (count === 1);
  const totalActivePlayers = Math.max(count, players.size);

  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;

  // In Public Mode, require at least 2 total participants (2+ real players or 1 player + demo bots).
  const hasEnoughParticipants = (totalActivePlayers >= 2);
  const allReady = hasEnoughParticipants && (isSolo
    ? isLocalReady
    : (playersList && playersList.every(p => p.isReady === true)));

  if (allReady && !readyCountdownInterval) {
    let launchCount = 3;
    const modeLabel = isSolo ? 'SOLO DEPLOYMENT' : 'ALL OPERATORS READY';
    clockPhaseLabel.innerText = 'LAUNCH IMMINENT';
    clockGuidanceText.innerText = `${modeLabel} // STARTING IN ${launchCount}S`;
    showBanner(`${modeLabel} // STARTING IN ${launchCount}S`, 1100);
    audioSystem.playCountdownTick(false);

    readyCountdownInterval = setInterval(() => {
      launchCount--;
      if (launchCount > 0) {
        clockGuidanceText.innerText = `${modeLabel} // STARTING IN ${launchCount}S`;
        showBanner(`STARTING IN ${launchCount}S`, 950);
        audioSystem.playCountdownTick(false);
      } else {
        clearInterval(readyCountdownInterval);
        readyCountdownInterval = null;
        document.getElementById('lobby-modal')?.classList.remove('active');
        closeFriendsHub();
        updateDemoBotsButtonUI();
        deployPlayerSkyDrop();
        if (isLocalHost || isSolo) {
          startRound(true);
        } else {
          setTimeout(() => {
            if (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END') {
              startRound(false);
            }
          }, 600);
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
  const hostRoundsRow = document.getElementById('friends-host-rounds-row');

  if (countVal) countVal.innerText = `${state.count}/${state.max || CONFIG.maxPlayersPerRoom}`;
  if (hostVal) {
    if (state.isHost) {
      hostVal.innerText = 'YOU ARE HOST';
      hostVal.className = 'status-val text-gold';
    } else {
      hostVal.innerText = 'SQUAD MEMBER';
      hostVal.className = 'status-val';
    }
  }

  if (hostRoundsRow) {
    if (state.isHost) {
      hostRoundsRow.classList.remove('hidden');
    } else {
      hostRoundsRow.classList.add('hidden');
    }
  }
  syncSeriesRoundsUI();

  if (launchBtn) {
    if (state.isHost) {
      launchBtn.classList.remove('hidden');
      if (waitingNotice) waitingNotice.classList.add('hidden');
      const spanEl = launchBtn.querySelector('span');
      if (spanEl) {
        spanEl.innerText = (state.count >= 2) ? 'LAUNCH MATCH' : 'WAITING FOR FRIENDS (MIN 2)';
      }
      launchBtn.style.opacity = (state.count >= 2) ? '1' : '0.6';
    } else {
      launchBtn.classList.add('hidden');
      if (waitingNotice) waitingNotice.classList.remove('hidden');
    }
  }

  updateHostStartButtonUI();

  if (rosterGrid && state.players) {
    rosterGrid.innerHTML = '';
    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `lobby-player-card ${p.id === myId ? 'is-local' : ''}`;
      const isReady = p.isReady === true;
      const isPHost = (p.id === state.hostId);
      const charMeta = CHARACTER_DATA[p.characterId || 'ajp'] || CHARACTER_DATA['ajp'];

      const char = players.get(p.id);
      if (char) {
        char.isHost = isPHost;
        char.setReady(isReady);
        if (p.characterId && char.characterId !== p.characterId) {
          char.setCharacterId(p.characterId);
        }
        updateNameTag(char);
      }

      card.innerHTML = `
        <div class="player-card-name">
          <span>${esc(p.name.toUpperCase())} ${p.id === myId ? '(YOU)' : ''}</span>
          <span class="player-host-tag" style="background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18);">${charMeta.name}</span>
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
  const wasHost = isLocalHost;
  isLocalHost = !!state.isHost;
  currentHostId = state.hostId;

  const isPrivate = state.roomId.startsWith('custom_');

  if (!wasHost && isLocalHost && !isPrivate) {
    showBanner('YOU ARE NOW THE SQUAD HOST', 2000);
    if (currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL') {
      evaluateHostVerdict(true);
    } else if (currentPhase === 'SHRINK') {
      setTimeout(() => {
        if (isLocalHost && currentPhase === 'SHRINK') {
          currentPhase = 'LOBBY';
          startRound(true);
        }
      }, 1500);
    }
  }

  if (localPlayer) {
    localPlayer.isHost = isLocalHost;
    updateNameTag(localPlayer);
  }

  const displayTitle = isPrivate 
    ? `CUSTOM SQUAD: ${state.roomId.replace('custom_', '')}` 
    : `PUBLIC SECTOR: ${state.roomId.toUpperCase()}`;

  if (roomNameEl) roomNameEl.innerText = `CONNECTED: ${displayTitle}`;
  if (roomCountEl) roomCountEl.innerText = `${state.count}/${state.max || CONFIG.maxPlayersPerRoom} PLAYERS`;

  updateDemoBotsButtonUI();
  updateHostStartButtonUI();

  if (playersListEl && state.players) {
    playersListEl.innerHTML = '';
    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `lobby-player-card ${p.id === myId ? 'is-local' : ''}`;
      const isReady = p.isReady === true;
      const isPPlayerHost = (p.id === currentHostId);
      const charMeta = CHARACTER_DATA[p.characterId || 'ajp'] || CHARACTER_DATA['ajp'];

      const char = players.get(p.id);
      if (char) {
        char.isHost = isPPlayerHost;
        char.setReady(isReady);
        if (p.characterId && char.characterId !== p.characterId) {
          char.setCharacterId(p.characterId);
        }
        updateNameTag(char);
      }

      card.innerHTML = `
        <div class="player-card-name">
          <span>${esc(p.name.toUpperCase())} ${p.id === myId ? '(YOU)' : ''}</span>
          <span class="player-host-tag" style="background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18);">${charMeta.name}</span>
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

// --- SCREEN NAVIGATION & OPERATOR SELECTION ---

function openCharacterSelectScreen() {
  const el = document.getElementById('character-select-screen');
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('active');
  }
  if (localPlayer) {
    localPlayer.setVisible(true);
    localPlayer.setCharacterId(selectedCharacterId);
    if (!localPlayerDeployed) {
      localPlayer.group.position.set(0, 0, 0);
      localPlayer.rotationY = 0;
      localPlayer.group.rotation.y = 0;
    }
    localPlayer.playAction('idle', 0.15);
  }
  updateCharacterSelectUI();
}

function closeCharacterSelectScreen() {
  const el = document.getElementById('character-select-screen');
  if (el) {
    el.classList.add('hidden');
    el.classList.remove('active');
  }
  if (localPlayer && !localPlayerDeployed) {
    const myIdx = getPlayerSpawnIndex(myId);
    const spawnPos = getRadialSpawnPosition(myIdx, Math.max(5, players.size));
    localPlayer.group.position.copy(spawnPos);
    localPlayer.lookAtTarget(new THREE.Vector3(0, 0, 0));
  }
}

function updateCharacterSelectUI() {
  const cards = document.querySelectorAll('#char-cards-container .char-card');
  cards.forEach(card => {
    const id = card.getAttribute('data-char-id');
    const isSelected = (id === selectedCharacterId);
    if (isSelected) {
      card.classList.add('active');
      const status = card.querySelector('.char-status-badge');
      if (status) status.innerText = 'SELECTED';
    } else {
      card.classList.remove('active');
      const status = card.querySelector('.char-status-badge');
      if (status) status.innerText = 'SELECT';
    }
  });
}

function executeDeployment(deployment) {
  if (!deployment) deployment = { type: 'public' };
  audioSystem.init();

  if (deployment.type === 'public') {
    currentRoomId = 'sector_1';
    totalSeriesRounds = 1;
    currentSeriesRound = 1;
    syncSeriesRoundsUI();
    clearPracticeBots();
    updateDemoBotsButtonUI();
    isLocalReady = false;
    updateReadyButtonUI();
    updateHostStartButtonUI();
    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      isReady: false,
      isCreator: false,
      characterId: selectedCharacterId,
      position: localPlayer.group.position
    });
    deployPlayerSkyDrop();
    const charMeta = CHARACTER_DATA[selectedCharacterId] || CHARACTER_DATA['ajp'];
    showBanner(`DEPLOYING TO SECTOR 1 // OPERATOR: ${charMeta.name}`, 2000);
  } else if (deployment.type === 'create_squad') {
    const squadName = deployment.squadName || 'ALPHA DOGS';
    const roundTime = deployment.roundTime || 5;
    const maxPlayers = deployment.maxPlayers || 5;
    const arenaTheme = deployment.arenaTheme || 'cyber_gold';
    const matchModifier = deployment.matchModifier || 'standard';
    const seriesRounds = deployment.seriesRounds || 3;
    currentSquadName = squadName;
    totalSeriesRounds = seriesRounds;
    currentSeriesRound = 1;
    CONFIG.countdownSeconds = roundTime;
    CONFIG.maxPlayersPerRoom = maxPlayers;
    applyArenaTheme(arenaTheme);
    applyMatchModifier(matchModifier);
    syncSeriesRoundsUI();

    const code = generateRoomCode();
    currentRoomId = `custom_${code}`;
    clearPracticeBots();
    updateDemoBotsButtonUI();

    isLocalHost = true;
    currentHostId = myId;
    openFriendsHub();

    const titleEl = document.getElementById('squad-room-title');
    if (titleEl) titleEl.innerText = squadName.toUpperCase();
    const codeEl = document.getElementById('squad-code-val');
    if (codeEl) codeEl.innerText = code;
    const timerVal = document.getElementById('squad-timer-val');
    if (timerVal) timerVal.innerText = `${roundTime}S`;
    const hostVal = document.getElementById('squad-host-status-val');
    if (hostVal) {
      hostVal.innerText = 'YOU ARE HOST';
      hostVal.className = 'status-val text-gold';
    }
    document.getElementById('btn-friends-host-launch')?.classList.remove('hidden');
    document.getElementById('friends-host-rounds-row')?.classList.remove('hidden');
    document.getElementById('friends-waiting-notice')?.classList.add('hidden');

    isLocalReady = false;
    updateReadyButtonUI();
    updateHostStartButtonUI();

    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      isReady: false,
      isCreator: true,
      characterId: selectedCharacterId,
      position: localPlayer.group.position
    });

    setTimeout(() => {
      supabaseManager.broadcastRoomSettings({
        squadName,
        roundTime,
        maxSquad: maxPlayers,
        arenaTheme,
        matchModifier,
        seriesRounds
      });
    }, 500);

    showBanner(`PRIVATE SQUAD ESTABLISHED: ${code}`, 2500);
  } else if (deployment.type === 'join_squad') {
    const code = deployment.code;
    currentRoomId = `custom_${code}`;
    totalSeriesRounds = 3;
    currentSeriesRound = 1;
    syncSeriesRoundsUI();
    clearPracticeBots();
    updateDemoBotsButtonUI();

    isLocalHost = false;
    openFriendsHub();

    const titleEl = document.getElementById('squad-room-title');
    if (titleEl) titleEl.innerText = `SQUAD ${code}`;
    const codeEl = document.getElementById('squad-code-val');
    if (codeEl) codeEl.innerText = code;
    const hostVal = document.getElementById('squad-host-status-val');
    if (hostVal) {
      hostVal.innerText = 'SQUAD MEMBER';
      hostVal.className = 'status-val';
    }
    document.getElementById('btn-friends-host-launch')?.classList.add('hidden');
    document.getElementById('friends-host-rounds-row')?.classList.add('hidden');
    document.getElementById('friends-waiting-notice')?.classList.remove('hidden');

    isLocalReady = false;
    updateReadyButtonUI();
    updateHostStartButtonUI();

    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      isReady: false,
      isCreator: false,
      characterId: selectedCharacterId,
      position: localPlayer.group.position
    });

    showBanner(`JOINING SQUAD: ${code}`, 2000);
  }
}

// --- BUTTON & SCREEN LISTENERS ---

// 1. Welcome Screen
document.getElementById('btn-enter-game')?.addEventListener('click', () => {
  const input = document.getElementById('welcome-name-input');
  const val = input ? input.value.trim() : '';
  if (val) {
    playerName = val;
    safeStorage.setItem('twisted_player_name', playerName);
    if (localPlayer) {
      localPlayer.name = playerName;
      updateNameTag(localPlayer);
      updateScoreboard();
    }
  }
  audioSystem.init();
  audioSystem.playReadyClick();

  if (inviteRoomCode) {
    pendingDeployment = { type: 'join_squad', code: inviteRoomCode };
    document.getElementById('welcome-screen')?.classList.add('hidden');
    openCharacterSelectScreen();
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

// Deploy to Public Quick-Match (opens Character Select)
document.getElementById('btn-deploy-public')?.addEventListener('click', () => {
  audioSystem.init();
  applyMatchModifier('standard');
  pendingDeployment = { type: 'public' };
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  openCharacterSelectScreen();
});

// Confirm Create Private Squad (opens Character Select)
document.getElementById('btn-confirm-create-squad')?.addEventListener('click', () => {
  audioSystem.init();
  const squadName = document.getElementById('create-squad-name')?.value.trim() || 'ALPHA DOGS';
  const seriesRounds = parseInt(document.getElementById('create-rounds-select')?.value, 10) || 3;
  const roundTime = parseInt(document.getElementById('create-timer-select')?.value, 10) || 5;
  const maxPlayers = parseInt(document.getElementById('create-max-players-select')?.value, 10) || 5;
  const arenaTheme = document.getElementById('create-theme-select')?.value || 'cyber_gold';
  const matchModifier = document.getElementById('create-modifier-select')?.value || 'standard';
  pendingDeployment = { type: 'create_squad', squadName, seriesRounds, roundTime, maxPlayers, arenaTheme, matchModifier };
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  openCharacterSelectScreen();
});

// Confirm Join Private Squad with Code (opens Character Select)
document.getElementById('btn-confirm-join-squad')?.addEventListener('click', () => {
  audioSystem.init();
  const code = document.getElementById('join-squad-code-input')?.value.trim().toUpperCase();
  if (!code) {
    showBanner('PLEASE ENTER 5-DIGIT CODE', 2000);
    return;
  }
  pendingDeployment = { type: 'join_squad', code };
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  openCharacterSelectScreen();
});

// 3. Operator / Character Select Screen
const charCardsContainer = document.getElementById('char-cards-container');

document.getElementById('btn-char-scroll-left')?.addEventListener('click', () => {
  charCardsContainer?.scrollBy({ left: -290, behavior: 'smooth' });
});

document.getElementById('btn-char-scroll-right')?.addEventListener('click', () => {
  charCardsContainer?.scrollBy({ left: 290, behavior: 'smooth' });
});

charCardsContainer?.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    charCardsContainer.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

document.querySelectorAll('#char-cards-container .char-card').forEach(card => {
  card.addEventListener('click', () => {
    const charId = card.getAttribute('data-char-id');
    if (!charId || !CHARACTER_DATA[charId]) return;
    selectedCharacterId = charId;
    safeStorage.setItem('twisted_character_id', selectedCharacterId);
    if (localPlayer) {
      localPlayer.setCharacterId(selectedCharacterId);
    }
    updateCharacterSelectUI();
    card.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    audioSystem.init();
    audioSystem.playReadyClick();
  });
});

document.getElementById('btn-char-select-back')?.addEventListener('click', () => {
  closeCharacterSelectScreen();
  if (pendingDeployment && pendingDeployment.type === 'friends_hub') {
    openFriendsHub();
  } else if (inviteRoomCode) {
    document.getElementById('welcome-screen')?.classList.remove('hidden');
  } else {
    document.getElementById('mode-select-screen')?.classList.remove('hidden');
  }
});

document.getElementById('btn-confirm-operator')?.addEventListener('click', () => {
  closeCharacterSelectScreen();
  if (pendingDeployment && pendingDeployment.type === 'friends_hub') {
    supabaseManager.setPlayerInfo({ characterId: selectedCharacterId });
    openFriendsHub();
    showBanner(`OPERATOR CONFIRMED: ${CHARACTER_DATA[selectedCharacterId].name}`, 2000);
    return;
  }
  executeDeployment(pendingDeployment);
});

// Friends Hub: Change Operator button
document.getElementById('btn-friends-change-char')?.addEventListener('click', () => {
  pendingDeployment = { type: 'friends_hub' };
  closeFriendsHub();
  openCharacterSelectScreen();
});

// 4. Friends Squad Hub
document.getElementById('btn-friends-ready')?.addEventListener('click', toggleReady);
document.getElementById('btn-friends-host-launch')?.addEventListener('click', launchFriendsSquadMatch);
document.getElementById('btn-hud-host-start')?.addEventListener('click', launchFriendsSquadMatch);

document.getElementById('friends-rounds-select')?.addEventListener('change', (e) => {
  if (!isLocalHost) return;
  const val = parseInt(e.target.value, 10) || 3;
  totalSeriesRounds = val;
  syncSeriesRoundsUI();
  supabaseManager.broadcastRoomSettings({
    squadName: currentSquadName,
    roundTime: CONFIG.countdownSeconds,
    maxSquad: CONFIG.maxPlayersPerRoom,
    arenaTheme: currentArenaTheme,
    matchModifier: currentMatchModifier,
    seriesRounds: totalSeriesRounds
  });
  showBanner(`SERIES LENGTH SET TO ${totalSeriesRounds === 1 ? '1 ROUND' : totalSeriesRounds + ' ROUNDS'}`, 1800);
});

document.getElementById('btn-close-friends-hub')?.addEventListener('click', () => {
  closeFriendsHub();
  updateHostStartButtonUI();
  if (!localPlayerDeployed) {
    deployPlayerSkyDrop();
  } else {
    document.getElementById('ui-overlay')?.classList.remove('hidden');
  }
});

document.getElementById('btn-friends-copy-link')?.addEventListener('click', () => {
  const code = currentRoomId.startsWith('custom_') ? currentRoomId.replace('custom_', '') : currentRoomId;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showBanner('SQUAD INVITE LINK COPIED', 2000);
  }).catch(() => {
    showBanner(`INVITE CODE: ${code}`, 2000);
  });
});

document.getElementById('btn-friends-leave')?.addEventListener('click', () => {
  if (pendingUpdateReload) {
    executeSafeReload();
    return;
  }
  clearPracticeBots();
  audioSystem.stopAjpCelebration();
  supabaseManager.leaveRoom();
  closeFriendsHub();
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.remove('hidden');
  showBanner('LEFT SQUAD FREQUENCY', 1600);
});

// 4. In-Game HUD Controls
document.getElementById('btn-ready-toggle')?.addEventListener('click', toggleReady);
document.getElementById('btn-lobby-ready')?.addEventListener('click', toggleReady);
document.getElementById('btn-toggle-demo-bots')?.addEventListener('click', toggleDemoBots);
document.getElementById('btn-lobby-demo-bots')?.addEventListener('click', toggleDemoBots);

// Collapsible Top-Left Operators Scoreboard Panel
const hudRosterPanel = document.getElementById('hud-roster-panel');
const btnToggleRoster = document.getElementById('btn-toggle-roster');
if (window.innerWidth <= 900) {
  hudRosterPanel?.classList.add('collapsed');
}
btnToggleRoster?.addEventListener('click', () => {
  hudRosterPanel?.classList.toggle('collapsed');
});
btnToggleRoster?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    hudRosterPanel?.classList.toggle('collapsed');
  }
});

// Collapsible Bottom-Left Controls Drawer
const btnToggleControls = document.getElementById('btn-toggle-controls');
const hudControlsDrawer = document.getElementById('hud-controls-drawer');
btnToggleControls?.addEventListener('click', () => {
  if (!hudControlsDrawer) return;
  const isHidden = hudControlsDrawer.classList.toggle('hidden');
  btnToggleControls.classList.toggle('active', !isHidden);
});

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
  updateDemoBotsButtonUI();
  if (currentRoomId.startsWith('custom_') && (currentPhase === 'LOBBY' || currentPhase === 'ROUND_END')) {
    openFriendsHub();
  } else {
    lobbyModal.classList.add('active');
  }
});

document.getElementById('btn-close-lobby')?.addEventListener('click', () => {
  lobbyModal.classList.remove('active');
});

document.getElementById('btn-copy-link')?.addEventListener('click', () => {
  const code = currentRoomId.startsWith('custom_') ? currentRoomId.replace('custom_', '') : currentRoomId;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showBanner('ROOM INVITE LINK COPIED', 2000);
  }).catch(() => {
    showBanner(`ROOM CODE: ${code}`, 2000);
  });
});

document.getElementById('btn-quick-play')?.addEventListener('click', () => {
  audioSystem.init();
  lobbyModal.classList.remove('active');
  currentRoomId = 'sector_1';
  totalSeriesRounds = 1;
  currentSeriesRound = 1;
  syncSeriesRoundsUI();
  clearPracticeBots();
  updateDemoBotsButtonUI();
  isLocalReady = false;
  updateReadyButtonUI();
  updateHostStartButtonUI();
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    isCreator: false,
    characterId: selectedCharacterId,
    position: localPlayer.group.position
  });
  deployPlayerSkyDrop();
  showBanner('SWITCHED TO PUBLIC SECTOR 1', 2000);
});

document.getElementById('btn-create-private')?.addEventListener('click', () => {
  audioSystem.init();
  lobbyModal.classList.remove('active');
  const code = generateRoomCode();
  currentRoomId = `custom_${code}`;
  totalSeriesRounds = 3;
  currentSeriesRound = 1;
  syncSeriesRoundsUI();
  clearPracticeBots();
  updateDemoBotsButtonUI();
  isLocalHost = true;
  currentHostId = myId;
  openFriendsHub();
  const titleEl = document.getElementById('squad-room-title');
  if (titleEl) titleEl.innerText = 'ALPHA DOGS';
  const codeEl = document.getElementById('squad-code-val');
  if (codeEl) codeEl.innerText = code;
  const hostVal = document.getElementById('squad-host-status-val');
  if (hostVal) {
    hostVal.innerText = 'YOU ARE HOST';
    hostVal.className = 'status-val text-gold';
  }
  document.getElementById('btn-friends-host-launch')?.classList.remove('hidden');
  document.getElementById('friends-host-rounds-row')?.classList.remove('hidden');
  document.getElementById('friends-waiting-notice')?.classList.add('hidden');
  isLocalReady = false;
  updateReadyButtonUI();
  updateHostStartButtonUI();
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    isCreator: true,
    characterId: selectedCharacterId,
    position: localPlayer.group.position
  });
  showBanner(`PRIVATE SQUAD ESTABLISHED: ${code}`, 2000);
});

document.getElementById('btn-join-private')?.addEventListener('click', () => {
  audioSystem.init();
  const input = document.getElementById('room-code-input');
  const code = input ? input.value.trim().toUpperCase() : '';
  if (!code) return;
  lobbyModal.classList.remove('active');
  currentRoomId = `custom_${code}`;
  totalSeriesRounds = 3;
  currentSeriesRound = 1;
  syncSeriesRoundsUI();
  clearPracticeBots();
  updateDemoBotsButtonUI();
  isLocalHost = false;
  openFriendsHub();
  const titleEl = document.getElementById('squad-room-title');
  if (titleEl) titleEl.innerText = `SQUAD ${code}`;
  const codeEl = document.getElementById('squad-code-val');
  if (codeEl) codeEl.innerText = code;
  const hostVal = document.getElementById('squad-host-status-val');
  if (hostVal) {
    hostVal.innerText = 'SQUAD MEMBER';
    hostVal.className = 'status-val';
  }
  document.getElementById('btn-friends-host-launch')?.classList.add('hidden');
  document.getElementById('friends-host-rounds-row')?.classList.add('hidden');
  document.getElementById('friends-waiting-notice')?.classList.remove('hidden');
  isLocalReady = false;
  updateReadyButtonUI();
  updateHostStartButtonUI();
  supabaseManager.joinRoom(currentRoomId, {
    id: myId,
    name: playerName,
    color: 0xffcc00,
    isReady: false,
    isCreator: false,
    characterId: selectedCharacterId,
    position: localPlayer.group.position
  });
  showBanner(`JOINING SQUAD: ${code}`, 2000);
});

document.getElementById('btn-leave-room')?.addEventListener('click', () => {
  if (pendingUpdateReload) {
    executeSafeReload();
    return;
  }
  clearPracticeBots();
  audioSystem.stopAjpCelebration();
  supabaseManager.leaveRoom();
  lobbyModal.classList.remove('active');
  closeFriendsHub();
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.remove('hidden');
  showBanner('LEFT MULTIPLAYER ROOM', 1600);
});

document.getElementById('btn-save-name')?.addEventListener('click', () => {
  const newName = nameInput.value.trim();
  if (newName) {
    playerName = newName;
    safeStorage.setItem('twisted_player_name', newName);
    if (localPlayer) {
      localPlayer.name = newName;
      updateNameTag(localPlayer);
      updateScoreboard();
    }
    supabaseManager.setPlayerInfo({
      id: myId,
      name: newName,
      color: 0xffcc00,
      characterId: selectedCharacterId,
      isReady: isLocalReady,
      position: localPlayer.group.position
    });
    showBanner(`CALL-SIGN UPDATED: ${newName.toUpperCase()}`, 1600);
  }
});

// Winner Overlay Actions: One-Click Rematch Now & Back to Arena
document.getElementById('btn-play-again')?.addEventListener('click', () => {
  audioSystem.init();
  if (isLocalHost) {
    resetGame({ resetScores: true });
    supabaseManager.broadcastGameReset({ resetScores: true, autoLaunch: true });
    const realConnectedCount = 1 + supabaseManager.connectedPlayers.size;
    const canLaunchNow = currentRoomId.startsWith('custom_')
      ? (realConnectedCount >= 2)
      : (players.size >= 2);
    if (canLaunchNow) {
      setTimeout(() => {
        if (currentPhase === 'LOBBY') {
          if (currentRoomId.startsWith('custom_')) {
            launchFriendsSquadMatch();
          } else {
            startRound(true);
          }
        }
      }, 450);
    } else if (currentRoomId.startsWith('custom_')) {
      showBanner('NEED AT LEAST 2 PLAYERS TO START REMATCH', 2000);
    }
  } else {
    resetGame({ resetScores: true });
    isLocalReady = true;
    if (localPlayer) {
      localPlayer.setReady(true);
      updateNameTag(localPlayer);
    }
    supabaseManager.setReady(true);
    updateReadyButtonUI();
    supabaseManager.requestGameReset({ resetScores: true, autoLaunch: true });
    showBanner('READY FOR REMATCH // LAUNCHING WITH HOST...', 2000);
  }
});

document.getElementById('btn-victory-arena')?.addEventListener('click', () => {
  audioSystem.init();
  if (isLocalHost) {
    resetGame({ resetScores: true });
    supabaseManager.broadcastGameReset({ resetScores: true, autoLaunch: false });
  } else {
    resetGame({ resetScores: true });
    supabaseManager.requestGameReset({ resetScores: true, autoLaunch: false });
  }
});

document.getElementById('btn-victory-leave')?.addEventListener('click', () => {
  if (pendingUpdateReload) {
    executeSafeReload();
    return;
  }
  resetGame({ resetScores: true });
  audioSystem.stopAjpCelebration();
  clearPracticeBots();
  supabaseManager.leaveRoom();
  document.getElementById('winner-modal')?.classList.add('hidden');
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.remove('hidden');
  showBanner('LEFT MULTIPLAYER ROOM', 1600);
});

// --- RENDER & GAME ANIMATION LOOP ---
const clock = new THREE.Clock();
let fpsFrameCount = 0;
let fpsAccumTime = 0;
let fpsDropCounter = 0;

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const scaledDelta = delta * timeDilationFactor;

  // Adaptive Dynamic Frame-Rate Monitor (Auto-promotes 60 FPS on struggling phones)
  fpsFrameCount++;
  fpsAccumTime += delta;
  if (fpsFrameCount >= 90) {
    const currentFps = fpsFrameCount / Math.max(0.001, fpsAccumTime);
    fpsFrameCount = 0;
    fpsAccumTime = 0;

    // If frame rate drops below 42 FPS during gameplay, smoothly step down graphics
    if (currentFps < 42 && currentGraphicsTier !== 'performance') {
      fpsDropCounter++;
      if (fpsDropCounter >= 2) {
        fpsDropCounter = 0;
        const nextTier = (currentGraphicsTier === 'high') ? 'balanced' : 'performance';
        applyGraphicsTier(nextTier, false);
        showBanner('ADAPTIVE 60 FPS ENGINE // OPTIMIZED GRAPHICS', 2000);
      }
    } else {
      fpsDropCounter = Math.max(0, fpsDropCounter - 1);
    }
  }

  const modalOpen = isModalActive();
  controls.enabled = !modalOpen;

  if (modalOpen) {
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    if (analogMove.active) mobileControls.resetMoveJoystick();
    if (analogMove.aimStickActive) mobileControls.resetAimJoystick();
  }

  // Local Player Movement & Aiming locking (Free during RECON, LOBBY, and STEALTH)
  const isInputLocked = modalOpen || (currentPhase === 'INPUT_FREEZE') || (currentPhase === 'REVEAL') || (currentPhase === 'VICTORY');
  if (localPlayer && localPlayer.isAlive && !isInputLocked) {
    _scratchMoveInput.set(0, 0, 0);
    if (keys.w) _scratchMoveInput.z -= 1;
    if (keys.s) _scratchMoveInput.z += 1;
    if (keys.a) _scratchMoveInput.x -= 1;
    if (keys.d) _scratchMoveInput.x += 1;
    if (analogMove.active && (analogMove.x !== 0 || analogMove.z !== 0)) {
      _scratchMoveInput.x = analogMove.x;
      _scratchMoveInput.z = analogMove.z;
    }

    const inputLen = _scratchMoveInput.length();
    const isInputActive = (inputLen > 0.01);
    _scratchTargetVel.set(0, 0, 0);

    if (isInputActive) {
      const speedScale = analogMove.active ? Math.min(1.0, inputLen) : 1.0;
      _scratchMoveInput.normalize();

      // Convert to camera-relative movement
      camera.getWorldDirection(_scratchCamForward);
      _scratchCamForward.y = 0;
      _scratchCamForward.normalize();

      _scratchCamRight.crossVectors(_scratchCamForward, _scratchYUp).normalize();

      // W / up sets _scratchMoveInput.z to -1. We want -1 to move ALONG camForward.
      _scratchMoveDir.set(0, 0, 0)
        .addScaledVector(_scratchCamRight, _scratchMoveInput.x)
        .addScaledVector(_scratchCamForward, -_scratchMoveInput.z)
        .normalize();

      _scratchTargetVel.copy(_scratchMoveDir).multiplyScalar(CONFIG.playerSpeed * speedScale);
    }

    // Natural acceleration and braking momentum (15x accel, 18x brake friction)
    const accelRate = isInputActive ? 15.0 : 18.0;
    localPlayerVelocity.lerp(_scratchTargetVel, Math.min(1.0, accelRate * delta));

    const currentSpeed = localPlayerVelocity.length();
    const isMovingNow = (currentSpeed > 0.12);

    if (isMovingNow) {
      wasMoving = true;
      hasAimedSinceStop = false;
      localPlayer.group.position.addScaledVector(localPlayerVelocity, delta);

      if (analogMove.aimStickActive) {
        // Twin-Stick Mode: Left stick moves while Right stick aims independently in 360 degrees
        localPlayer.lookAtTarget(aimPoint, delta, 24.0);
      } else {
        // Smoothly orient player body towards movement direction
        const moveAngle = Math.atan2(localPlayerVelocity.x, localPlayerVelocity.z);
        let diff = moveAngle - localPlayer.rotationY;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        localPlayer.rotationY += diff * Math.min(1.0, 16.0 * delta);
        localPlayer.group.rotation.y = localPlayer.rotationY;

        // Keep aimPoint projected along current walking direction so stopping movement preserves laser aim
        aimPoint.set(
          localPlayer.group.position.x + Math.sin(localPlayer.rotationY) * 8,
          0,
          localPlayer.group.position.z + Math.cos(localPlayer.rotationY) * 8
        );
      }

      // Dynamic animation speed sync to completely eliminate foot sliding:
      // Basic Locomotion Pack walking cadence matches ground speed
      const walkTimeScale = Math.max(0.75, Math.min(1.45, currentSpeed / 3.4));
      localPlayer.playAction('walk', 0.16, walkTimeScale);

      // Synthesized footstep cadence synced to movement speed
      footstepTimer += delta * walkTimeScale * 2.6;
      if (footstepTimer >= 1.0) {
        footstepTimer = 0;
        audioSystem.playFootstep(currentSpeed > 8.5);
      }

      supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, false);
    } else {
      localPlayerVelocity.set(0, 0, 0);
      footstepTimer = 0.75;
      if (wasMoving) {
        // Immediate unthrottled stop packet dispatch to freeze remote visual drift
        wasMoving = false;
        localPlayer.playAction('idle', 0.22, 1.0);
        supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, true);
      } else if (!localPlayer.activeEmoteText) {
        localPlayer.playAction('idle', 0.22, 1.0);
      }

      // During STEALTH, always orient toward the aiming point so stopping movement never turns the laser away toward the camera
      const prevRot = localPlayer.rotationY;
      if (currentPhase === 'STEALTH') {
        localPlayer.lookAtTarget(aimPoint, delta, 18.0);
      } else {
        _scratchCameraFacePos.set(camera.position.x, localPlayer.group.position.y, camera.position.z);
        localPlayer.lookAtTarget(_scratchCameraFacePos, delta, 14.0);
      }
      if (Math.abs(localPlayer.rotationY - prevRot) > 0.02) {
        supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, false);
      }
    }
  } else if (localPlayer && isInputLocked && localPlayer.isAlive) {
    localPlayerVelocity.set(0, 0, 0);
    if (localPlayer.currentActionName === 'walk' || localPlayer.currentActionName === 'run') {
      localPlayer.playAction('idle', 0.15, 1.0);
    }
  }

  // STRICT BOUNDARY ENFORCEMENT & REMOTE PLAYER SMOOTHING
  players.forEach(p => {
    if (!p.isLocal && p.targetPos && p.isAlive) {
      if (currentPhase !== 'VICTORY' && currentPhase !== 'INPUT_FREEZE' && currentPhase !== 'REVEAL') {
        const dist = p.group.position.distanceTo(p.targetPos);
        if (dist > 6.0) {
          p.group.position.copy(p.targetPos);
        } else if (dist > 0.04) {
          p.group.position.lerp(p.targetPos, Math.min(1, 24.0 * delta));
          const remoteSpeed = (dist / Math.max(delta, 0.016));
          const walkTimeScale = Math.max(0.75, Math.min(1.45, remoteSpeed / 3.4));
          p.playAction('walk', 0.16, walkTimeScale);
        } else {
          p.group.position.copy(p.targetPos);
          if (p.currentActionName === 'walk' || p.currentActionName === 'run') {
            p.playAction('idle', 0.2, 1.0);
          }
        }
        if (p.targetRotY !== undefined) {
          let diff = p.targetRotY - p.rotationY;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.rotationY += diff * Math.min(1.0, 24.0 * delta);
          p.group.rotation.y = p.rotationY;
        }
      }
    }

    if (arena) arena.clampPosition(p.group.position);
    p.update(scaledDelta);
  });

  if (arena) arena.update(scaledDelta);

  // Update HTML name tags (zero-allocation projection using static scratch vectors)
  const isCombatPhase = (currentPhase === 'STEALTH' || currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL');
  players.forEach(p => {
    if (p.htmlTag) {
      if (p.isAlive && p.isVisible) {
        _scratchHeadPos.copy(p.group.position);
        _scratchHeadPos.y += 3.7; // Clean elevation above dog head
        _scratchHeadPos.project(camera);

        if (_scratchHeadPos.z < 1) { // In front of camera
          const x = (_scratchHeadPos.x * 0.5 + 0.5) * viewWidth;
          const y = (-(_scratchHeadPos.y * 0.5) + 0.5) * viewHeight;
          p.htmlTag.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
          p.htmlTag.classList.remove('hidden');
          if (isCombatPhase && !p.activeEmoteText) {
            p.htmlTag.classList.add('combat-dim');
          } else {
            p.htmlTag.classList.remove('combat-dim');
          }
        } else {
          p.htmlTag.classList.add('hidden');
        }
      } else {
        p.htmlTag.classList.add('hidden');
      }
    }
  });

  // Smart TV Gamepad & Remote Controller Update
  if (smartTVManager) {
    smartTVManager.update(delta);
  }

  // Victory 360 Cinematic Orbit Sweep
  if (currentPhase === 'VICTORY') {
    controls.enabled = false;
    victoryOrbitAngle += delta * 0.38;
    const orbitDist = 5.8;
    camera.position.x = Math.sin(victoryOrbitAngle) * orbitDist;
    camera.position.z = Math.cos(victoryOrbitAngle) * orbitDist;
    camera.position.y = 2.0 + Math.sin(victoryOrbitAngle * 1.6) * 0.22;
    camera.lookAt(0, 1.05, 0);
    controls.target.set(0, 1.05, 0);
  } else {
    // Update OrbitControls smoothly
    controls.update();
  }

  // Cinematic screen shake physics decay
  if (screenShakeIntensity > 0.001) {
    screenShakeTime += delta * 45.0;
    const decay = Math.exp(-delta * 7.5);
    screenShakeIntensity *= decay;
    const shakeX = (Math.sin(screenShakeTime * 1.1) + Math.cos(screenShakeTime * 2.3)) * 0.5 * screenShakeIntensity * 0.35;
    const shakeY = (Math.cos(screenShakeTime * 1.7) + Math.sin(screenShakeTime * 2.9)) * 0.5 * screenShakeIntensity * 0.25;
    camera.position.x += shakeX;
    camera.position.y += shakeY;
  }

  renderCharacterSelectPreviews(delta);
  renderer.render(scene, camera);
}

window.addEventListener('blur', () => {
  keys.w = false;
  keys.a = false;
  keys.s = false;
  keys.d = false;
});

window.addEventListener('resize', () => {
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  camera.aspect = viewWidth / viewHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewWidth, viewHeight);
});

updateDemoBotsButtonUI();
supabaseManager.startPingInterval();

function initPWAAndAutoUpdate() {
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  const btnHudInstall = document.getElementById('btn-hud-install');
  const iosInstallBanner = document.getElementById('ios-install-banner');

  let deferredInstallPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!isStandalone) {
      if (btnInstallPwa) btnInstallPwa.classList.remove('hidden');
      if (btnHudInstall) btnHudInstall.classList.remove('hidden');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (btnInstallPwa) btnInstallPwa.classList.add('hidden');
    if (btnHudInstall) btnHudInstall.classList.add('hidden');
    if (iosInstallBanner) iosInstallBanner.classList.add('hidden');
    showBanner('APP INSTALLED TO PHONE', 2500);
  });

  const triggerPwaInstall = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        if (btnInstallPwa) btnInstallPwa.classList.add('hidden');
        if (btnHudInstall) btnHudInstall.classList.add('hidden');
      }
      deferredInstallPrompt = null;
    } else {
      showBanner('TAP SHARE -> ADD TO HOME SCREEN TO INSTALL', 3000);
    }
  };

  if (btnInstallPwa) btnInstallPwa.addEventListener('click', triggerPwaInstall);
  if (btnHudInstall) btnHudInstall.addEventListener('click', triggerPwaInstall);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !isStandalone && iosInstallBanner) {
    iosInstallBanner.classList.remove('hidden');
  }

  // Register Service Worker with updateViaCache: 'none'
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          swRegistration = reg;
          console.log('[PWA] Service Worker registered with updateViaCache: none');

          reg.update();

          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        onNewUpdateReady();
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (swRegistration) swRegistration.update();
        checkForVersionUpdate();
      }
    });

    window.addEventListener('focus', () => {
      if (swRegistration) swRegistration.update();
      checkForVersionUpdate();
    });

    setInterval(() => {
      if (swRegistration) swRegistration.update();
      checkForVersionUpdate();
    }, 45000);
  }

  checkForVersionUpdate();
}

initPWAAndAutoUpdate();

animate();

