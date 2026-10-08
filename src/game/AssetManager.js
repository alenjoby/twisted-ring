import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CACHE_NAME = 'twisted-ring-assets-v1';

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

class AssetManager {
  constructor() {
    this.fbxLoader = new FBXLoader();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.baseModel = null;
    this.arenaModel = null;
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
      { key: 'baseModel', url: '/assets/Pistol Idle.fbx', type: 'fbx' },
      { key: 'walk', url: '/assets/Walk.fbx', type: 'clip' },
      { key: 'run', url: '/assets/Running.fbx', type: 'clip' },
      { key: 'shoot', url: '/assets/Shooting.fbx', type: 'clip' },
      { key: 'death', url: '/assets/Standing React Death Backward.fbx', type: 'clip' },
      { key: 'dance', url: '/assets/Dancing Twerk.fbx', type: 'clip' }
    ];

    let loadedCount = 0;
    const total = assets.length;

    const checkComplete = () => {
      loadedCount++;
      const pct = Math.floor((loadedCount / total) * 100);
      if (onProgress) onProgress(pct);

      if (loadedCount === total) {
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
              tex.flipY = false;
              if (item.isSrgb) {
                tex.colorSpace = THREE.SRGBColorSpace;
              }
              this.textures[item.key] = tex;
              checkComplete();
            },
            undefined,
            (err) => {
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
        } else if (item.type === 'fbx') {
          const buffer = await fetchCachedBuffer(item.url);
          const fbx = this.fbxLoader.parse(buffer, '');
          this.baseModel = fbx;
          if (fbx.animations && fbx.animations.length > 0) {
            this.clips['idle'] = fbx.animations[0];
            this.clips['idle'].name = 'idle';
          }
          checkComplete();
        } else if (item.type === 'clip') {
          const buffer = await fetchCachedBuffer(item.url);
          const animFbx = this.fbxLoader.parse(buffer, '');
          if (animFbx.animations && animFbx.animations.length > 0) {
            const clip = animFbx.animations[0];
            clip.name = item.key;
            this.clips[item.key] = clip;
          }
          checkComplete();
        }
      } catch (err) {
        console.warn(`[AssetManager] Error loading ${item.key}, fallback to regular loader`, err);
        // Fallback to standard loader
        if (item.type === 'fbx' || item.type === 'clip') {
          this.fbxLoader.load(item.url, (fbx) => {
            if (item.type === 'fbx') {
              this.baseModel = fbx;
              if (fbx.animations && fbx.animations.length > 0) {
                this.clips['idle'] = fbx.animations[0];
                this.clips['idle'].name = 'idle';
              }
            } else {
              if (fbx.animations && fbx.animations.length > 0) {
                this.clips[item.key] = fbx.animations[0];
                this.clips[item.key].name = item.key;
              }
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
