import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetManager, CHARACTER_DATA, VICTORY_DANCE_KEYS, pickRandomVictoryDance } from './game/AssetManager.js';
import { Arena, ARENA_THEMES } from './game/Arena.js';
import { Character } from './game/Character.js';
import { audioSystem } from './game/AudioSystem.js';
import { SupabaseManager, safeStorage } from './game/SupabaseManager.js';

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

let currentPhase = 'LOBBY'; // 'LOBBY' | 'STEALTH' | 'REVEAL' | 'SHRINK' | 'VICTORY'
let countdownTime = CONFIG.countdownSeconds;
let currentRound = 1;
let arenaRadius = CONFIG.initialArenaRadius;
let currentRoomId = 'sector_1';
let currentSquadName = 'ALPHA DOGS';
let currentArenaTheme = 'cyber_gold';
let currentMatchModifier = 'standard';
let timeDilationFactor = 1.0;
let footstepTimer = 0;
let localPlayerDeployed = false;
let revealWatchdogTimer = null;

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

function applyArenaTheme(themeId) {
  if (!arena) return;
  const theme = arena.setTheme(themeId);
  currentArenaTheme = theme.id;
  if (scene.fog) scene.fog.color.setHex(theme.fogColor);
  if (scene.background) scene.background.setHex(theme.fogColor);
  if (ringSpot) ringSpot.color.setHex(theme.spotColor);
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
const _scratchSpecTarget = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
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

  const spawnIndex = getPlayerSpawnIndex(id);
  const spawnPos = pos || getRadialSpawnPosition(spawnIndex, Math.max(5, players.size + 1));
  p.group.position.copy(spawnPos);
  p.targetPos = spawnPos.clone();
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
    const spawnPos = getRadialSpawnPosition(i + 1, count + 1);
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
}

function clearPracticeBots() {
  while (practiceBots.length > 0) {
    const bot = practiceBots.pop();
    if (players.has(bot.id)) {
      removeRemotePlayer(bot.id);
    }
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

  // Spectator mode arrow navigation
  if (localPlayer && !localPlayer.isAlive && spectatingPlayerId) {
    if (k === 'arrowleft') cycleSpectatorTarget(-1);
    if (k === 'arrowright') cycleSpectatorTarget(1);
  }
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

window.addEventListener('mousemove', (e) => {
  if (isModalActive()) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(raycastPlane, aimPoint);
  if (currentPhase === 'STEALTH') {
    hasAimedSinceStop = true;
  }
});

// Virtual Touch Joystick Implementation for Mobile
const joystickZone = document.getElementById('touch-joystick-zone');
const joystickThumb = document.getElementById('touch-joystick-thumb');
let joystickTouchId = null;
let joystickCenter = { x: 0, y: 0 };
const JOYSTICK_MAX_RADIUS = 38;

function updateJoystick(clientX, clientY) {
  const dx = clientX - joystickCenter.x;
  const dy = clientY - joystickCenter.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const clampedDist = Math.min(dist, JOYSTICK_MAX_RADIUS);
  const angle = Math.atan2(dy, dx);
  const thumbX = Math.cos(angle) * clampedDist;
  const thumbY = Math.sin(angle) * clampedDist;
  if (joystickThumb) {
    joystickThumb.style.transform = `translate(${thumbX}px, ${thumbY}px)`;
  }

  const normX = dx / JOYSTICK_MAX_RADIUS;
  const normY = dy / JOYSTICK_MAX_RADIUS;

  keys.w = normY < -0.28;
  keys.s = normY > 0.28;
  keys.a = normX < -0.28;
  keys.d = normX > 0.28;
}

if (joystickZone) {
  joystickZone.addEventListener('touchstart', (e) => {
    if (isModalActive()) return;
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      joystickTouchId = touch.identifier;
      const rect = joystickZone.getBoundingClientRect();
      joystickCenter.x = rect.left + rect.width / 2;
      joystickCenter.y = rect.top + rect.height / 2;
      updateJoystick(touch.clientX, touch.clientY);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId) {
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }, { passive: true });

  const endJoystick = (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId) {
        joystickTouchId = null;
        if (joystickThumb) joystickThumb.style.transform = 'translate(0px, 0px)';
        keys.w = false;
        keys.a = false;
        keys.s = false;
        keys.d = false;
        break;
      }
    }
  };

  window.addEventListener('touchend', endJoystick);
  window.addEventListener('touchcancel', endJoystick);
}

// Touch controls for mobile aiming (ignores joystick touch)
window.addEventListener('touchmove', (e) => {
  if (isModalActive()) return;
  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    if (t.identifier !== joystickTouchId) {
      mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(raycastPlane, aimPoint);
      if (currentPhase === 'STEALTH') {
        hasAimedSinceStop = true;
      }
      break;
    }
  }
}, { passive: true });

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

// --- SUPABASE REALTIME MULTIPLAYER MANAGER ---
const supabaseManager = new SupabaseManager({
  onPlayerJoined: (data) => {
    if (data.id === myId || players.has(data.id)) return;
    if (practiceBots.length > 0) {
      clearPracticeBots();
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
        matchModifier: currentMatchModifier
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
    let p = players.get(data.id);
    if (!p) {
      p = addRemotePlayer(data.id, data.name || 'Operator', new THREE.Vector3(data.x, data.y, data.z), data.characterId || 'ajp');
    } else if (data.characterId && p.characterId !== data.characterId) {
      p.setCharacterId(data.characterId);
    }
    if (p && !p.isLocal) {
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
    if (verdict?.senderId && currentHostId && verdict.senderId !== currentHostId) return;
    if (!isLocalHost) {
      applyRoundVerdict(verdict);
    }
  },
  onRoomSettings: (settings) => {
    if (settings?.senderId && currentHostId && settings.senderId !== currentHostId) return;
    if (settings.roundTime) CONFIG.countdownSeconds = settings.roundTime;
    if (settings.maxSquad) CONFIG.maxPlayersPerRoom = settings.maxSquad;
    if (settings.arenaTheme) applyArenaTheme(settings.arenaTheme);
    if (settings.matchModifier) applyMatchModifier(settings.matchModifier);
    if (settings.squadName) {
      currentSquadName = settings.squadName;
      const title = document.getElementById('squad-room-title');
      if (title) title.innerText = esc(settings.squadName.toUpperCase());
    }
  },
  onGameReset: (data) => {
    if (data?.senderId && currentHostId && data.senderId !== currentHostId) return;
    resetGame();
  },
  onRoomStateChange: (state) => {
    if (state.players && state.max) {
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

function startRound(broadcast = true, syncEpoch = null) {
  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END' && currentPhase !== 'SHRINK') return;
  audioSystem.init();
  if (localPlayer && localPlayer.isAlive) {
    deactivateSpectatorMode();
  } else if (localPlayer && !localPlayer.isAlive) {
    activateSpectatorMode();
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

  const now = Date.now();
  const reconDuration = syncEpoch?.reconDuration || 1500;
  const stealthDuration = syncEpoch?.stealthDuration || (CONFIG.countdownSeconds * 1000);
  const serverStart = syncEpoch?.serverStartTime || now;

  if (broadcast) {
    supabaseManager.broadcastRoundStart(currentRound, {
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

  // 2. Authoritative host referee evaluates hits with generous 480ms grace window for peer lock packets
  if (isLocalHost) {
    setTimeout(() => {
      evaluateHostVerdict();
    }, 480);
  } else {
    // Watchdog fallback in case host disconnected mid-verdict
    if (revealWatchdogTimer) clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = setTimeout(() => {
      if (currentPhase === 'REVEAL') {
        console.warn('Host verdict timeout - evaluating fallback or awaiting migration');
        if (isLocalHost) {
          evaluateHostVerdict();
        }
      }
    }, 3200);
  }
}

function evaluateHostVerdict() {
  const hitList = [];
  const alivePlayers = Array.from(players.values()).filter(p => p.isAlive);

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
        ? new THREE.Vector3(lockedTarget.x, lockedTarget.y + 1.25, lockedTarget.z)
        : target.group.position.clone().add(new THREE.Vector3(0, 1.25, 0));

      const v = new THREE.Vector3().subVectors(targetPos, ray.origin);
      const proj = v.dot(ray.direction);

      if (proj > 0 && proj < ray.length) {
        const closestPoint = ray.origin.clone().add(ray.direction.clone().multiplyScalar(proj));
        const dist = closestPoint.distanceTo(targetPos);

        // Hitbox radius 0.72m - only strike the closest obstacle/player along the ray
        if (dist <= 0.72 && proj < minProj) {
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
  const isGameOver = survivors.length <= 1;
  const winnerId = isGameOver ? (survivors.length === 1 ? survivors[0].id : null) : null;
  const winnerDanceKey = isGameOver ? pickRandomVictoryDance() : null;

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
    winnerDanceKey,
    survivors: survivors.map(s => s.id)
  };

  // Broadcast authoritative verdict to all connected peers
  supabaseManager.broadcastRoundVerdict(verdict);
  applyRoundVerdict(verdict);
}

function applyRoundVerdict(verdict) {
  if (revealWatchdogTimer) {
    clearTimeout(revealWatchdogTimer);
    revealWatchdogTimer = null;
  }
  players.forEach(p => p.setLaserActive(false));

  // Score awards
  if (verdict.hits) {
    verdict.hits.forEach(({ shooterId }) => {
      const shooter = players.get(shooterId);
      if (shooter) shooter.score += 100;
    });
  }

  let someoneDied = false;
  let localPlayerEliminated = false;
  verdict.eliminatedIds.forEach(targetId => {
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

  // Track match wins and streaks when game concludes
  if (verdict.isGameOver) {
    players.forEach(p => {
      if (verdict.winnerId && p.id === verdict.winnerId) {
        p.wins = (p.wins || 0) + 1;
        p.winStreak = (p.winStreak || 0) + 1;
        p.score += 150;
      } else {
        p.winStreak = 0;
      }
      updateNameTag(p);
    });

    // Dramatic slow-motion final elimination finish
    if (someoneDied) {
      timeDilationFactor = 0.32;
      audioSystem.playSlowMoFinish();
      setTimeout(() => {
        timeDilationFactor = 1.0;
      }, 1100);
    }
  }

  updateScoreboard();

  // If local player was eliminated, activate spectator mode
  if (localPlayer && !localPlayer.isAlive && !verdict.isGameOver) {
    activateSpectatorMode();
  }

  // After animation delay, process game over or next round shrink
  setTimeout(() => {
    timeDilationFactor = 1.0;
    if (verdict.isGameOver) {
      deactivateSpectatorMode();
      const winner = verdict.winnerId ? (players.get(verdict.winnerId) || localPlayer) : null;
      presentWinner(winner, verdict.winnerDanceKey);
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
function presentWinner(winner, danceKeyOverride = null) {
  currentPhase = 'VICTORY';
  timeDilationFactor = 1.0;
  players.forEach(p => p.setLaserActive(false));

  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  // Hide ALL buttons, HUD overlays, banners, vignettes, and modals so ONLY winner name and NEXT button are visible
  document.getElementById('event-banner')?.classList.remove('active');
  document.getElementById('death-vignette')?.classList.remove('active', 'critical');
  document.getElementById('ui-overlay')?.classList.add('hidden');
  document.getElementById('name-tags-container')?.classList.add('hidden');
  document.getElementById('spectator-bar')?.classList.add('hidden');
  document.getElementById('touch-joystick-zone')?.classList.add('hidden');
  document.getElementById('lobby-modal')?.classList.remove('active');
  document.getElementById('friends-hub-modal')?.classList.add('hidden');
  document.getElementById('friends-hub-modal')?.classList.remove('active');
  document.getElementById('character-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.remove('active');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('welcome-screen')?.classList.add('hidden');

  const modal = document.getElementById('winner-modal');
  const nameDisplay = document.getElementById('winner-name-display');

  if (!winner) {
    clockPhaseLabel.innerText = 'MATCH CONCLUDED';
    clockGuidanceText.innerText = 'MUTUAL DESTRUCTION // NO SURVIVORS';
    if (nameDisplay) nameDisplay.innerText = 'DRAW';
    if (modal) modal.classList.remove('hidden');
    audioSystem.playVictoryFanfare();
    return;
  }

  clockPhaseLabel.innerText = 'MATCH CONCLUDED';
  clockGuidanceText.innerText = `${winner.name.toUpperCase()} WINS`;

  // Hide defeated opponents so spotlight is solely on the champion
  players.forEach(p => {
    if (p.id !== winner.id) {
      p.setVisible(false);
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

  // Play Victory Fanfare and Randomized Celebration Dance across all 4 dance animations
  audioSystem.playVictoryFanfare();
  const danceKey = (danceKeyOverride && VICTORY_DANCE_KEYS.includes(danceKeyOverride))
    ? danceKeyOverride
    : pickRandomVictoryDance();
  winner.playAction(danceKey, 0.2);

  // Focus high-intensity spotlight on the champion
  ringSpot.position.set(0, 10, 2);
  ringSpot.target.position.set(0, 1.2, 0);
  ringSpot.intensity = 6.0;

  // Show minimal left Winner Name and right NEXT button
  if (nameDisplay) nameDisplay.innerText = `${winner.name.toUpperCase()} WINS`;
  if (modal) modal.classList.remove('hidden');
}

function resetGame() {
  timeDilationFactor = 1.0;
  deactivateSpectatorMode();
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) winnerModal.classList.add('hidden');

  // Restore HUD overlay & name tags
  document.getElementById('ui-overlay')?.classList.remove('hidden');
  document.getElementById('name-tags-container')?.classList.remove('hidden');
  document.getElementById('touch-joystick-zone')?.classList.remove('hidden');

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
    p.setLaserActive(false);
  });

  currentRound = 1;
  arenaRadius = CONFIG.initialArenaRadius;
  if (arena) arena.resetRadius(arenaRadius);
  consecutiveStalemates = 0;

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
  supabaseManager.setReady(false);
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

function launchFriendsSquadMatch() {
  if (!isLocalHost) return;
  audioSystem.init();
  if (players.size === 1 && practiceBots.length === 0) {
    spawnPracticeBots(2);
  }
  supabaseManager.broadcastForceStart();
  closeFriendsHub();
  deployPlayerSkyDrop();
  startRound(true);
}

function handleRemoteSquadLaunch() {
  audioSystem.init();
  closeFriendsHub();
  document.getElementById('welcome-screen')?.classList.add('hidden');
  document.getElementById('mode-select-screen')?.classList.add('hidden');
  document.getElementById('character-select-screen')?.classList.add('hidden');
  deployPlayerSkyDrop();
  startRound(false);
}

function checkAllPlayersReady(playersList) {
  const count = playersList ? playersList.length : 1;
  const isSolo = (count === 1);

  if (currentPhase !== 'LOBBY' && currentPhase !== 'ROUND_END') return;

  const allReady = isSolo 
    ? isLocalReady 
    : (playersList && playersList.every(p => p.isReady === true));

  if (allReady && !readyCountdownInterval) {
    let launchCount = 3;
    const modeLabel = isSolo ? 'TRAINING SIMULATION' : 'ALL OPERATORS READY';
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
        deployPlayerSkyDrop();
        if (isSolo && practiceBots.length === 0) {
          spawnPracticeBots(2);
        }
        if (isLocalHost) {
          startRound(true);
        } else {
          startRound(false);
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

  if (!wasHost && isLocalHost) {
    showBanner('YOU ARE NOW THE SQUAD HOST', 2000);
    if (currentPhase === 'INPUT_FREEZE' || currentPhase === 'REVEAL') {
      evaluateHostVerdict();
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

  const isPrivate = state.roomId.startsWith('custom_');
  const displayTitle = isPrivate 
    ? `CUSTOM SQUAD: ${state.roomId.replace('custom_', '')}` 
    : `PUBLIC SECTOR: ${state.roomId.toUpperCase()}`;

  if (roomNameEl) roomNameEl.innerText = `CONNECTED: ${displayTitle}`;
  if (roomCountEl) roomCountEl.innerText = `${state.count}/${state.max || CONFIG.maxPlayersPerRoom} PLAYERS`;

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
    localPlayer.group.position.set(0, 0, 0);
    localPlayer.rotationY = 0;
    localPlayer.group.rotation.y = 0;
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
    isLocalReady = false;
    updateReadyButtonUI();
    supabaseManager.joinRoom(currentRoomId, {
      id: myId,
      name: playerName,
      color: 0xffcc00,
      isReady: false,
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
    CONFIG.countdownSeconds = roundTime;
    CONFIG.maxPlayersPerRoom = maxPlayers;
    applyArenaTheme(arenaTheme);
    applyMatchModifier(matchModifier);

    const code = generateRoomCode();
    currentRoomId = `custom_${code}`;

    openFriendsHub();

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
      characterId: selectedCharacterId,
      position: localPlayer.group.position
    });

    setTimeout(() => {
      supabaseManager.broadcastRoomSettings({
        squadName,
        roundTime,
        maxSquad: maxPlayers,
        arenaTheme,
        matchModifier
      });
    }, 500);

    showBanner(`PRIVATE SQUAD ESTABLISHED: ${code}`, 2500);
  } else if (deployment.type === 'join_squad') {
    const code = deployment.code;
    currentRoomId = `custom_${code}`;

    openFriendsHub();

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
  const roundTime = parseInt(document.getElementById('create-timer-select')?.value) || 5;
  const maxPlayers = parseInt(document.getElementById('create-max-players-select')?.value) || 5;
  const arenaTheme = document.getElementById('create-theme-select')?.value || 'cyber_gold';
  const matchModifier = document.getElementById('create-modifier-select')?.value || 'standard';
  pendingDeployment = { type: 'create_squad', squadName, roundTime, maxPlayers, arenaTheme, matchModifier };
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
  supabaseManager.leaveRoom();
  closeFriendsHub();
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

document.getElementById('btn-quick-play')?.addEventListener('click', () => {
  audioSystem.init();
  lobbyModal.classList.remove('active');
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
  showBanner('SWITCHED TO PUBLIC SECTOR 1', 2000);
});

document.getElementById('btn-create-private')?.addEventListener('click', () => {
  audioSystem.init();
  lobbyModal.classList.remove('active');
  const code = generateRoomCode();
  currentRoomId = `custom_${code}`;
  openFriendsHub();
  const titleEl = document.getElementById('squad-room-title');
  if (titleEl) titleEl.innerText = 'ALPHA DOGS';
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
  showBanner(`PRIVATE SQUAD ESTABLISHED: ${code}`, 2000);
});

document.getElementById('btn-join-private')?.addEventListener('click', () => {
  audioSystem.init();
  const input = document.getElementById('room-code-input');
  const code = input ? input.value.trim().toUpperCase() : '';
  if (!code) return;
  lobbyModal.classList.remove('active');
  currentRoomId = `custom_${code}`;
  openFriendsHub();
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

document.getElementById('btn-leave-room')?.addEventListener('click', () => {
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

// Winner Play Again
document.getElementById('btn-play-again')?.addEventListener('click', () => {
  if (isLocalHost) {
    resetGame();
    supabaseManager.broadcastGameReset();
  } else {
    supabaseManager.requestGameReset();
    showBanner('REQUESTED NEXT MATCH FROM HOST...', 2000);
  }
});

// --- RENDER & GAME ANIMATION LOOP ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const scaledDelta = delta * timeDilationFactor;

  const modalOpen = isModalActive();
  controls.enabled = !modalOpen;

  if (modalOpen) {
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
  }

  // Local Player Movement & Aiming locking (Free during RECON, LOBBY, and STEALTH)
  const isInputLocked = modalOpen || (currentPhase === 'INPUT_FREEZE') || (currentPhase === 'REVEAL') || (currentPhase === 'VICTORY');
  if (localPlayer && localPlayer.isAlive && !isInputLocked) {
    const moveInput = new THREE.Vector3(0, 0, 0);
    if (keys.w) moveInput.z -= 1;
    if (keys.s) moveInput.z += 1;
    if (keys.a) moveInput.x -= 1;
    if (keys.d) moveInput.x += 1;

    const isInputActive = (moveInput.lengthSq() > 0);
    const targetVelocity = new THREE.Vector3(0, 0, 0);

    if (isInputActive) {
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

      targetVelocity.copy(moveDir).multiplyScalar(CONFIG.playerSpeed);
    }

    // Natural acceleration and braking momentum (15x accel, 18x brake friction)
    const accelRate = isInputActive ? 15.0 : 18.0;
    localPlayerVelocity.lerp(targetVelocity, Math.min(1.0, accelRate * delta));

    const currentSpeed = localPlayerVelocity.length();
    const isMovingNow = (currentSpeed > 0.12);

    if (isMovingNow) {
      wasMoving = true;
      hasAimedSinceStop = false;
      localPlayer.group.position.addScaledVector(localPlayerVelocity, delta);

      // Smoothly orient player body towards movement direction
      const moveAngle = Math.atan2(localPlayerVelocity.x, localPlayerVelocity.z);
      let diff = moveAngle - localPlayer.rotationY;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;

      localPlayer.rotationY += diff * Math.min(1.0, 16.0 * delta);
      localPlayer.group.rotation.y = localPlayer.rotationY;

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
        hasAimedSinceStop = false;
        localPlayer.playAction('idle', 0.22, 1.0);
        supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, true);
      } else if (!localPlayer.activeEmoteText) {
        localPlayer.playAction('idle', 0.22, 1.0);
      }

      // After walking is done, smoothly rotate character to face the camera (unless actively aiming laser in STEALTH)
      const prevRot = localPlayer.rotationY;
      if (currentPhase === 'STEALTH' && hasAimedSinceStop) {
        localPlayer.lookAtTarget(aimPoint, delta, 16.0);
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
      if (currentPhase !== 'VICTORY') {
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
      _scratchSpecTarget.copy(targetPlayer.group.position);
      _scratchSpecTarget.y += 1.2;
      controls.target.lerp(_scratchSpecTarget, 0.08);
    } else {
      cycleSpectatorTarget(1);
    }
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

// --- NETWORK UPLINK & LATENCY MONITORING ---
function updateUplinkUI() {
  const chip = document.getElementById('hud-uplink-chip');
  const label = document.getElementById('uplink-label');
  const modeText = document.getElementById('uplink-mode-text');
  const isCloud = supabaseManager.isConfigured;

  if (chip) {
    if (isCloud) chip.classList.add('is-cloud');
    else chip.classList.remove('is-cloud');
  }
  if (label) label.innerText = isCloud ? 'CLOUD' : 'PEER';
  if (modeText) modeText.innerText = isCloud ? 'UPLINK: CLOUD WEBSOCKET (WSS)' : 'UPLINK: LOCAL PEER CHANNEL';
  const meta = document.querySelector('.uplink-status-meta');
  if (meta) {
    if (isCloud) meta.classList.add('is-cloud');
    else meta.classList.remove('is-cloud');
  }
}

document.getElementById('btn-toggle-uplink-inputs')?.addEventListener('click', () => {
  const drawer = document.getElementById('uplink-inputs-drawer');
  drawer?.classList.toggle('hidden');
});

document.getElementById('btn-save-uplink')?.addEventListener('click', async () => {
  const url = document.getElementById('cfg-supabase-url')?.value.trim();
  const key = document.getElementById('cfg-supabase-key')?.value.trim();
  if (!url || !key) {
    showBanner('ENTER SUPABASE URL & KEY', 2000);
    return;
  }
  showBanner('CONNECTING CLOUD WEBSOCKET...', 2000);
  const success = await supabaseManager.reconnectWithCredentials(url, key);
  updateUplinkUI();
  if (success) {
    showBanner('UPLINK ESTABLISHED: CLOUD WEBSOCKET', 2500);
    document.getElementById('uplink-inputs-drawer')?.classList.add('hidden');
  } else {
    showBanner('CONNECTION FAILED // CHECK CREDENTIALS', 2500);
  }
});

// Pre-fill existing credentials if in storage
const existingUrl = safeStorage.getItem('supabase_url');
const existingKey = safeStorage.getItem('supabase_anon_key');
if (existingUrl) {
  const urlInput = document.getElementById('cfg-supabase-url');
  if (urlInput) urlInput.value = existingUrl;
}
if (existingKey) {
  const keyInput = document.getElementById('cfg-supabase-key');
  if (keyInput) keyInput.value = existingKey;
}

updateUplinkUI();
supabaseManager.startPingInterval();

animate();
