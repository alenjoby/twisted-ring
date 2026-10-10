import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CACHE_NAME = 'twisted-ring-assets-v3';

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

export const CHARACTER_DATA = {
  'ajp': {
    id: 'ajp',
    name: 'AJP',
    title: 'CYBER OPERATIVE',
    role: 'TACTICAL / ASSAULT',
    url: '/CHARACTERS/AJP.fbx',
    danceKey: 'dance_breakdance',
    danceName: 'BREAKDANCE UPROCK',
    desc: 'Elite high-mobility operative with advanced cybernetic reflex targeting.'
  },
  'big_vegas': {
    id: 'big_vegas',
    name: 'BIG VEGAS',
    title: 'HEAVY ENFORCER',
    role: 'VANGUARD / HEAVY',
    url: '/CHARACTERS/Big Vegas.fbx',
    danceKey: 'dance_headspin',
    danceName: 'HEADSPIN CYCLONE',
    desc: 'Heavyweight enforcer commanding deep perimeter suppression lanes.'
  },
  'knight': {
    id: 'knight',
    name: 'KNIGHT PELEGRINI',
    title: 'IRON PALADIN',
    role: 'DEFENDER / STRATEGIST',
    url: '/CHARACTERS/Knight D Pelegrini.fbx',
    danceKey: 'dance_swing',
    danceName: 'VICTORY SWING',
    desc: 'Armored sector champion with centuries of combat precision and resolve.'
  },
  'peasant_girl': {
    id: 'peasant_girl',
    name: 'PEASANT GIRL',
    title: 'SHADOW RUNNER',
    role: 'INFILTRATOR / SPEED',
    url: '/CHARACTERS/Peasant Girl.fbx',
    danceKey: 'dance_twerk',
    danceName: 'TACTICAL CELEBRATION',
    desc: 'Lightweight agile scout excelling at rapid crossfire redirection.'
  }
};

class AssetManager {
  constructor() {
    this.fbxLoader = new FBXLoader();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.baseModel = null;
    this.arenaModel = null;
    this.characterModels = {};
    this.textures = {};
    this.clips = {};
    this.loaded = false;
  }

  async loadAll(onProgress, onComplete, onError) {
    const assets = [
      { key: 'map', url: '/assets/texture_0.jpg', type: 'texture', isSrgb: true },
      { key: 'metalnessMap', url: '/assets/texture_1.jpg', type: 'texture', isSrgb: false },
      { key: 'normalMap', url: '/assets/texture_2.jpg', type: 'texture', isSrgb: false },
      { key: 'arena', url: '/assets/areana.glb', type: 'gltf' },
      // All 4 Selectable Characters
      { key: 'char_ajp', url: '/CHARACTERS/AJP.fbx', type: 'character', charId: 'ajp' },
      { key: 'char_big_vegas', url: '/CHARACTERS/Big Vegas.fbx', type: 'character', charId: 'big_vegas' },
      { key: 'char_knight', url: '/CHARACTERS/Knight D Pelegrini.fbx', type: 'character', charId: 'knight' },
      { key: 'char_peasant_girl', url: '/CHARACTERS/Peasant Girl.fbx', type: 'character', charId: 'peasant_girl' },
      // Locomotion Animations
      { key: 'idle', url: '/ANIMATIONS/Basic Locomotion Pack/idle.fbx', type: 'clip', inPlace: true },
      { key: 'walk', url: '/ANIMATIONS/Basic Locomotion Pack/walking.fbx', type: 'clip', inPlace: true },
      { key: 'strafeLeft', url: '/ANIMATIONS/Basic Locomotion Pack/left strafe walking.fbx', type: 'clip', inPlace: true },
      { key: 'strafeRight', url: '/ANIMATIONS/Basic Locomotion Pack/right strafe walking.fbx', type: 'clip', inPlace: true },
      { key: 'run', url: '/assets/Running.fbx', type: 'clip', inPlace: true },
      { key: 'jump', url: '/ANIMATIONS/Basic Locomotion Pack/jump.fbx', type: 'clip', inPlace: true },
      { key: 'shoot', url: '/assets/Shooting.fbx', type: 'clip', inPlace: true },
      { key: 'death', url: '/assets/Standing React Death Backward.fbx', type: 'clip', inPlace: false },
      // Distinct Victory Dance Animations
      { key: 'dance_breakdance', url: '/ANIMATIONS/Breakdance Uprock Var 2.fbx', type: 'clip', inPlace: true },
      { key: 'dance_swing', url: '/ANIMATIONS/DANCE 2 - Swing Dancing.fbx', type: 'clip', inPlace: true },
      { key: 'dance_headspin', url: '/ANIMATIONS/DANCE 3 - Headspin Start.fbx', type: 'clip', inPlace: true },
      { key: 'dance_twerk', url: '/assets/Dancing Twerk.fbx', type: 'clip', inPlace: true }
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
              tex.flipY = false;
              if (item.isSrgb) {
                tex.colorSpace = THREE.SRGBColorSpace;
              }
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
