import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

class AssetManager {
  constructor() {
    this.fbxLoader = new FBXLoader();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.baseModel = null;
    this.arenaModel = null;
    this.texture = null;
    this.clips = {};
    this.loaded = false;
  }

  loadAll(onProgress, onComplete, onError) {
    const assets = [
      { key: 'map', url: '/assets/texture_0.jpg', type: 'texture' },
      { key: 'metal', url: '/assets/texture_1.jpg', type: 'texture' },
      { key: 'normal', url: '/assets/texture_2.jpg', type: 'texture' },
      { key: 'arena', url: '/assets/areana.glb', type: 'gltf' },
      { key: 'baseModel', url: '/assets/Pistol Idle.fbx', type: 'fbx' },
      { key: 'walk', url: '/assets/Walk.fbx', type: 'fbx_clip' },
      { key: 'run', url: '/assets/Running.fbx', type: 'fbx_clip' },
      { key: 'shoot', url: '/assets/Shooting.fbx', type: 'fbx_clip' },
      { key: 'death', url: '/assets/Standing React Death Backward.fbx', type: 'fbx_clip' },
      { key: 'dance', url: '/assets/Dancing Twerk.fbx', type: 'fbx_clip' }
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

    // 1. Textures
    const textureUrls = [
      { key: 'map', url: '/assets/texture_0.jpg', isSrgb: true },
      { key: 'metalnessMap', url: '/assets/texture_1.jpg', isSrgb: false },
      { key: 'normalMap', url: '/assets/texture_2.jpg', isSrgb: false }
    ];
    this.textures = {};

    textureUrls.forEach((texData) => {
      this.textureLoader.load(
        texData.url,
        (tex) => {
          tex.flipY = false;
          if (texData.isSrgb) {
            tex.colorSpace = THREE.SRGBColorSpace;
          }
          this.textures[texData.key] = tex;
          checkComplete();
        },
        undefined,
        (err) => {
          console.warn(`Texture ${texData.key} failed`, err);
          checkComplete();
        }
      );
    });

    // 1.5 Arena Model (GLTF)
    this.gltfLoader.load(
      '/assets/areana.glb',
      (gltf) => {
        this.arenaModel = gltf.scene;
        checkComplete();
      },
      undefined,
      (err) => {
        console.error('Arena model failed to load', err);
        checkComplete(); // Keep going even if it fails
      }
    );

    // 2. Base Model (Pistol Idle)
    this.fbxLoader.load(
      '/assets/Pistol Idle.fbx',
      (fbx) => {
        this.baseModel = fbx;
        if (fbx.animations && fbx.animations.length > 0) {
          this.clips['idle'] = fbx.animations[0];
          this.clips['idle'].name = 'idle';
        }
        checkComplete();
      },
      undefined,
      (err) => {
        console.error('Base model failed to load', err);
        if (onError) onError(err);
      }
    );

    // 3. Animation Clips
    const clipList = [
      { key: 'walk', url: '/assets/Walk.fbx' },
      { key: 'run', url: '/assets/Running.fbx' },
      { key: 'shoot', url: '/assets/Shooting.fbx' },
      { key: 'death', url: '/assets/Standing React Death Backward.fbx' },
      { key: 'dance', url: '/assets/Dancing Twerk.fbx' }
    ];

    clipList.forEach(item => {
      this.fbxLoader.load(
        item.url,
        (animFbx) => {
          if (animFbx.animations && animFbx.animations.length > 0) {
            const clip = animFbx.animations[0];
            clip.name = item.key;
            this.clips[item.key] = clip;
          }
          checkComplete();
        },
        undefined,
        (err) => {
          console.warn(`Clip ${item.key} failed`, err);
          checkComplete();
        }
      );
    });
  }
}

export const assetManager = new AssetManager();
