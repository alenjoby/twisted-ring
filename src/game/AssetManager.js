import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CACHE_NAME = 'twisted-ring-assets-v5';

async function fetchCachedBuffer(url) {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        return await cached.arrayBuffer();
      }
      const response = await fetch(url);
      if (response.ok) {
        cache.put(url, response.clone()).catch(() => {});
        return await response.arrayBuffer();
      }
    } catch (e) {
      console.warn(`[AssetManager] Cache lookup failed for ${url}, fetching direct`, e);
    }
  }
  const res = await fetch(url);
  return await res.arrayBuffer();
}

async function fetchCachedBlobUrl(url) {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        const blob = await cached.blob();
        return URL.createObjectURL(blob);
      }
      const response = await fetch(url);
      if (response.ok) {
        cache.put(url, response.clone()).catch(() => {});
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn(`[AssetManager] Cache blob lookup failed for ${url}`, e);
    }
  }
  return url;
}

function tagClipMetadata(clip, inPlace) {
  if (!clip) return clip;
  clip.userData = { inPlace: !!inPlace };
  return clip;
}

export const VICTORY_DANCE_KEYS = [
  'dance_breakdance',
  'dance_swing',
  'dance_headspin',
  'dance_twerk'
];

export const DRAW_ANIM_KEYS = [
  'draw_crying',
  'draw_punching',
  'draw_zombie_crawl'
];

export function pickShuffledDrawAnims(count = 3) {
  const pool = [...DRAW_ANIM_KEYS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

let _lastPickedDanceKey = null;
export function pickRandomVictoryDance(excludeKey = _lastPickedDanceKey) {
  const pool = VICTORY_DANCE_KEYS.filter(k => k !== excludeKey);
  const chosen = pool[Math.floor(Math.random() * pool.length)] || VICTORY_DANCE_KEYS[0];
  _lastPickedDanceKey = chosen;
  return chosen;
}

export const CHARACTER_DATA = {
  'ajp': {
    id: 'ajp',
    name: 'AJP',
    url: '/CHARACTERS/AJP.fbx',
    danceKey: 'dance_breakdance',
    danceName: 'BREAKDANCE UPROCK'
  },
  'dog': {
    id: 'dog',
    name: 'DOGGESH BHAIR',
    url: '/assets/Pistol Idle.fbx',
    danceKey: 'dance_twerk',
    danceName: 'VICTORY TWERK'
  },
  'big_vegas': {
    id: 'big_vegas',
    name: 'BIG VEGAS',
    url: '/CHARACTERS/Big Vegas.fbx',
    danceKey: 'dance_headspin',
    danceName: 'HEADSPIN CYCLONE'
  },
  'knight': {
    id: 'knight',
    name: 'KNIGHT',
    url: '/CHARACTERS/Knight D Pelegrini.fbx',
    danceKey: 'dance_swing',
    danceName: 'VICTORY SWING'
  },
  'peasant_girl': {
    id: 'peasant_girl',
    name: 'PEASANT GIRL',
    url: '/CHARACTERS/Peasant Girl.fbx',
    danceKey: 'dance_swing',
    danceName: 'FREESTYLE SWING'
  },
  'kuchupuchu': {
    id: 'kuchupuchu',
    name: 'KUCHUPUCHU',
    url: '/CHARACTERS/KuchuPuchu.fbx',
    danceKey: 'dance_breakdance',
    danceName: 'GNOME BREAKDANCE'
  },
  'thankan_chettan': {
    id: 'thankan_chettan',
    name: 'THANKAN CHETTAN',
    url: '/CHARACTERS/Thankan-Chettan.fbx',
    danceKey: 'dance_breakdance',
    danceName: 'CHETTAN POWER DANCE'
  }
};

class AssetManager {
  constructor() {
    this.fbxLoader = new FBXLoader();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.baseModel = null;
    this.arenaModel = null;
    this.arenaModels = {};
    this.arenaRawModels = {};
    this.characterModels = {};
    this.textures = {};
    this.clips = {};
    this.loaded = false;
  }

  async loadAll(onProgress, onComplete, onError) {
    const assets = [
      // Dog Character PBR Textures (flipY: false)
      { key: 'map', url: '/assets/texture_0.jpg', type: 'texture', isSrgb: true, flipY: false },
      { key: 'metalnessMap', url: '/assets/texture_1.jpg', type: 'texture', isSrgb: false, flipY: false },
      { key: 'normalMap', url: '/assets/texture_2.jpg', type: 'texture', isSrgb: false, flipY: false },
      // AJP High-Resolution PBR Textures from /CHARACTERS/Character-Textures (flipY: true)
      { key: 'ajp_map', url: '/CHARACTERS/Character-Textures/AJP-TEXTURE_01.png', type: 'texture', isSrgb: true, flipY: true },
      { key: 'ajp_metalness', url: '/CHARACTERS/Character-Textures/AJP-TEXTURE_02.png', type: 'texture', isSrgb: false, flipY: true },
      { key: 'ajp_normal', url: '/CHARACTERS/Character-Textures/AJP-TEXTURE_03.png', type: 'texture', isSrgb: false, flipY: true },
      { key: 'ajp_roughness', url: '/CHARACTERS/Character-Textures/AJP-TEXTURE_04.png', type: 'texture', isSrgb: false, flipY: true },
      // KuchuPuchu Character PBR Texture (flipY: true)
      { key: 'kuchupuchu_map', url: '/CHARACTERS/Character-Textures/KuchuPuchu_texture.png', type: 'texture', isSrgb: true, flipY: true },
      // Cyber Ring Arena (Original GLTF)
      { key: 'arena', url: '/assets/areana.glb', type: 'gltf' },
      // Fire Arena ("The Foundry") FBX and PBR Textures
      { key: 'tex_fire_diffuse', url: encodeURI('/ARENA/fire arena/Meshy_AI_The_Foundry_Arena_1012131932_texture.png'), type: 'texture', isSrgb: true, flipY: true },
      { key: 'tex_fire_normal', url: encodeURI('/ARENA/fire arena/Meshy_AI_The_Foundry_Arena_1012131932_texture_normal.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'tex_fire_metallic', url: encodeURI('/ARENA/fire arena/Meshy_AI_The_Foundry_Arena_1012131932_texture_metallic.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'tex_fire_roughness', url: encodeURI('/ARENA/fire arena/Meshy_AI_The_Foundry_Arena_1012131932_texture_roughness.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'arena_fire', url: encodeURI('/ARENA/fire arena/Meshy_AI_The_Foundry_Arena_1012131932_texture.fbx'), type: 'arena_fbx', arenaId: 'fire_arena' },
      // Street Fight Arena ("Iron Fist") FBX and PBR Textures
      { key: 'tex_street_diffuse', url: encodeURI('/ARENA/StreetFight_Arena/Meshy_AI_Iron_Fist_Arena_1011231729_texture.png'), type: 'texture', isSrgb: true, flipY: true },
      { key: 'tex_street_normal', url: encodeURI('/ARENA/StreetFight_Arena/Meshy_AI_Iron_Fist_Arena_1011231729_texture_normal.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'tex_street_metallic', url: encodeURI('/ARENA/StreetFight_Arena/Meshy_AI_Iron_Fist_Arena_1011231729_texture_metallic.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'tex_street_roughness', url: encodeURI('/ARENA/StreetFight_Arena/Meshy_AI_Iron_Fist_Arena_1011231729_texture_roughness.png'), type: 'texture', isSrgb: false, flipY: true },
      { key: 'arena_street', url: encodeURI('/ARENA/StreetFight_Arena/Meshy_AI_Iron_Fist_Arena_1011231729_texture.fbx'), type: 'arena_fbx', arenaId: 'street_fight' },
      // Selectable Characters (AJP, Doggesh Bhair, Big Vegas, Knight, Peasant Girl, KuchuPuchu)
      { key: 'char_ajp', url: '/CHARACTERS/AJP.fbx', type: 'character', charId: 'ajp' },
      { key: 'char_dog', url: '/assets/Pistol Idle.fbx', type: 'character', charId: 'dog' },
      { key: 'char_big_vegas', url: '/CHARACTERS/Big Vegas.fbx', type: 'character', charId: 'big_vegas' },
      { key: 'char_knight', url: '/CHARACTERS/Knight D Pelegrini.fbx', type: 'character', charId: 'knight' },
      { key: 'char_peasant_girl', url: '/CHARACTERS/Peasant Girl.fbx', type: 'character', charId: 'peasant_girl' },
      { key: 'char_kuchupuchu', url: '/CHARACTERS/KuchuPuchu.fbx', type: 'character', charId: 'kuchupuchu' },
      { key: 'char_thankan_chettan', url: '/CHARACTERS/Thankan-Chettan.fbx', type: 'character', charId: 'thankan_chettan' },
      // Basic Locomotion Pack Animations (shared across all 5 characters including Doggesh Bhair)
      { key: 'idle', url: '/ANIMATIONS/Basic Locomotion Pack/idle.fbx', type: 'clip', inPlace: true },
      { key: 'walk', url: '/ANIMATIONS/Basic Locomotion Pack/walking.fbx', type: 'clip', inPlace: true },
      { key: 'strafeLeft', url: '/ANIMATIONS/Basic Locomotion Pack/left strafe walking.fbx', type: 'clip', inPlace: true },
      { key: 'strafeRight', url: '/ANIMATIONS/Basic Locomotion Pack/right strafe walking.fbx', type: 'clip', inPlace: true },
      { key: 'turnLeft', url: '/ANIMATIONS/Basic Locomotion Pack/left turn 90.fbx', type: 'clip', inPlace: true },
      { key: 'turnRight', url: '/ANIMATIONS/Basic Locomotion Pack/right turn 90.fbx', type: 'clip', inPlace: true },
      { key: 'run', url: '/assets/Running.fbx', type: 'clip', inPlace: true },
      { key: 'jump', url: '/ANIMATIONS/Basic Locomotion Pack/jump.fbx', type: 'clip', inPlace: true },
      { key: 'shoot', url: '/assets/Shooting.fbx', type: 'clip', inPlace: true },
      { key: 'death', url: '/assets/Standing React Death Backward.fbx', type: 'clip', inPlace: false },
      // Victory Dance Animation Pool (Available to ALL characters randomly)
      { key: 'dance_breakdance', url: '/ANIMATIONS/Breakdance Uprock Var 2.fbx', type: 'clip', inPlace: true },
      { key: 'dance_swing', url: '/ANIMATIONS/DANCE 2 - Swing Dancing.fbx', type: 'clip', inPlace: true },
      { key: 'dance_headspin', url: '/ANIMATIONS/DANCE 3 - Headspin Start.fbx', type: 'clip', inPlace: true },
      { key: 'dance_twerk', url: '/assets/Dancing Twerk.fbx', type: 'clip', inPlace: true },
      // Draw Screen Animation Pool (crying, Punching, Zombie Crawl)
      { key: 'draw_crying', url: '/ANIMATIONS/draw animations/crying.fbx', type: 'clip', inPlace: true },
      { key: 'draw_punching', url: '/ANIMATIONS/draw animations/Punching.fbx', type: 'clip', inPlace: true },
      { key: 'draw_zombie_crawl', url: '/ANIMATIONS/draw animations/Zombie Crawl.fbx', type: 'clip', inPlace: true }
    ];

    let loadedCount = 0;
    const total = assets.length;

    const checkComplete = () => {
      loadedCount++;
      const pct = Math.floor((loadedCount / total) * 100);
      if (onProgress) onProgress(pct);

      if (loadedCount === total) {
        if (!this.clips['dance']) {
          this.clips['dance'] = this.clips['dance_breakdance'] || this.clips['dance_twerk'];
        }

        // Configure Cyber Gold Arena
        if (this.arenaModel) {
          this.arenaModels['cyber_gold'] = this.arenaModel;
        }

        // Configure Fire Arena ("The Foundry") with full PBR textures
        const fireModel = this.arenaRawModels['fire_arena'];
        if (fireModel) {
          const fireMat = new THREE.MeshStandardMaterial({
            map: this.textures['tex_fire_diffuse'] || null,
            normalMap: this.textures['tex_fire_normal'] || null,
            metalnessMap: this.textures['tex_fire_metallic'] || null,
            roughnessMap: this.textures['tex_fire_roughness'] || null,
            metalness: 0.85,
            roughness: 0.65,
            side: THREE.DoubleSide
          });
          fireMat.userData.origNormalMap = this.textures['tex_fire_normal'] || null;
          fireMat.userData.origMetalnessMap = this.textures['tex_fire_metallic'] || null;
          fireMat.userData.origRoughnessMap = this.textures['tex_fire_roughness'] || null;

          fireModel.traverse((c) => {
            if (c.isMesh) {
              c.material = fireMat;
              c.receiveShadow = true;
              c.castShadow = false;
              c.matrixAutoUpdate = false;
              c.updateMatrix();
            }
          });
          this.arenaModels['fire_arena'] = fireModel;
        }

        // Configure Street Fight Arena ("Iron Fist") with full PBR textures
        const streetModel = this.arenaRawModels['street_fight'];
        if (streetModel) {
          const streetMat = new THREE.MeshStandardMaterial({
            map: this.textures['tex_street_diffuse'] || null,
            normalMap: this.textures['tex_street_normal'] || null,
            metalnessMap: this.textures['tex_street_metallic'] || null,
            roughnessMap: this.textures['tex_street_roughness'] || null,
            metalness: 0.75,
            roughness: 0.55,
            side: THREE.DoubleSide
          });
          streetMat.userData.origNormalMap = this.textures['tex_street_normal'] || null;
          streetMat.userData.origMetalnessMap = this.textures['tex_street_metallic'] || null;
          streetMat.userData.origRoughnessMap = this.textures['tex_street_roughness'] || null;

          streetModel.traverse((c) => {
            if (c.isMesh) {
              c.material = streetMat;
              c.receiveShadow = true;
              c.castShadow = false;
              c.matrixAutoUpdate = false;
              c.updateMatrix();
            }
          });
          this.arenaModels['street_fight'] = streetModel;
        }

        this.loaded = true;
        if (onComplete) onComplete();
      }
    };

    // Load each asset with local persistent Cache Storage support
    for (const item of assets) {
      try {
        if (item.type === 'texture') {
          const blobUrl = await fetchCachedBlobUrl(item.url);
          this.textureLoader.load(
            blobUrl,
            (tex) => {
              if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
              tex.flipY = item.flipY !== undefined ? item.flipY : true;
              if (item.isSrgb) {
                tex.colorSpace = THREE.SRGBColorSpace;
              }
              tex.generateMipmaps = true;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              this.textures[item.key] = tex;
              checkComplete();
            },
            undefined,
            (err) => {
              if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
              console.warn(`[AssetManager] Texture ${item.key} failed:`, err);
              checkComplete();
            }
          );
        } else if (item.type === 'gltf') {
          const buffer = await fetchCachedBuffer(item.url);
          this.gltfLoader.parse(
            buffer,
            '',
            (gltf) => {
              this.arenaModel = gltf.scene;
              checkComplete();
            },
            (err) => {
              console.error('[AssetManager] Arena GLTF parse error:', err);
              checkComplete();
            }
          );
        } else if (item.type === 'character') {
          const buffer = await fetchCachedBuffer(item.url);
          const fbx = this.fbxLoader.parse(buffer, '');
          this.characterModels[item.charId] = fbx;
          if (!this.baseModel || item.charId === 'ajp') {
            this.baseModel = fbx;
          }
          checkComplete();
        } else if (item.type === 'arena_fbx') {
          const buffer = await fetchCachedBuffer(item.url);
          const fbx = this.fbxLoader.parse(buffer, '');
          fbx.traverse((c) => {
            if (c.isMesh && c.geometry) {
              c.geometry = mergeVertices(c.geometry, 0.001);
            }
          });
          this.arenaRawModels[item.arenaId] = fbx;
          checkComplete();
        } else if (item.type === 'clip') {
          const buffer = await fetchCachedBuffer(item.url);
          const animFbx = this.fbxLoader.parse(buffer, '');
          if (animFbx.animations && animFbx.animations.length > 0) {
            const clip = tagClipMetadata(animFbx.animations[0], item.inPlace !== false);
            clip.name = item.key;
            this.clips[item.key] = clip;
          }
          checkComplete();
        }
      } catch (err) {
        console.warn(`[AssetManager] Error loading ${item.key}, fallback to regular loader`, err);
        // Fallback to standard loader
        if (item.type === 'character') {
          this.fbxLoader.load(item.url, (fbx) => {
            this.characterModels[item.charId] = fbx;
            if (!this.baseModel || item.charId === 'ajp') {
              this.baseModel = fbx;
            }
            checkComplete();
          }, undefined, () => checkComplete());
        } else if (item.type === 'arena_fbx') {
          this.fbxLoader.load(item.url, (fbx) => {
            fbx.traverse((c) => {
              if (c.isMesh && c.geometry) {
                c.geometry = mergeVertices(c.geometry, 0.001);
              }
            });
            this.arenaRawModels[item.arenaId] = fbx;
            checkComplete();
          }, undefined, () => checkComplete());
        } else if (item.type === 'clip') {
          this.fbxLoader.load(item.url, (fbx) => {
            if (fbx.animations && fbx.animations.length > 0) {
              const clip = tagClipMetadata(fbx.animations[0], item.inPlace !== false);
              clip.name = item.key;
              this.clips[item.key] = clip;
            }
            checkComplete();
          }, undefined, () => checkComplete());
        } else {
          checkComplete();
        }
      }
    }
  }
}

export const assetManager = new AssetManager();
