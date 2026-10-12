import * as THREE from 'three';
import { assetManager } from './AssetManager.js';

export const ARENA_THEMES = {
  cyber_gold: {
    id: 'cyber_gold',
    name: 'CYBER RING',
    modelKey: 'cyber_gold',
    boundaryColor: 0xffcc00,
    midWireColor: 0xffffff,
    shieldColor: 0xffcc00,
    floorTint: 0xffffff,
    spotColor: 0xfff5e4,
    rimColor: 0xff2a5f,
    fogColor: 0x050608
  },
  fire_arena: {
    id: 'fire_arena',
    name: 'THE FOUNDRY',
    modelKey: 'fire_arena',
    boundaryColor: 0xff4500,
    midWireColor: 0xffaa00,
    shieldColor: 0xff2200,
    floorTint: 0xffffff,
    spotColor: 0xff7722,
    rimColor: 0xff3b00,
    fogColor: 0x140502
  },
  street_fight: {
    id: 'street_fight',
    name: 'IRON FIST',
    modelKey: 'street_fight',
    boundaryColor: 0x00f0ff,
    midWireColor: 0xff0066,
    shieldColor: 0x00f0ff,
    floorTint: 0xffffff,
    spotColor: 0x00d8ff,
    rimColor: 0xff0066,
    fogColor: 0x080a14
  }
};

export class Arena {
  constructor(scene, initialRadius = 12) {
    this.scene = scene;
    this.initialRadius = initialRadius;
    this.radius = initialRadius;
    this.targetRadius = initialRadius;
    this.shrinkSpeed = 2.5;
    this.isShrinking = false;
    this.themeId = 'cyber_gold';
    this.platformModels = {};
    this.currentModel = null;
    this.activeModelKey = null;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.initPlatform();
    this.initBoundary();
    this.setTheme('cyber_gold');
  }

  initPlatform() {
    // 1. Cyber Ring GLB
    const cyberModel = (assetManager.arenaModels && assetManager.arenaModels['cyber_gold']) || assetManager.arenaModel;
    if (cyberModel) {
      const floorModelRadius = 0.85;
      const scale = this.initialRadius / floorModelRadius;
      cyberModel.scale.setScalar(scale);
      cyberModel.position.set(0, 0.0874 * scale, 0);
      cyberModel.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = false;
          child.matrixAutoUpdate = false;
          child.updateMatrix();
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });
      this.platformModels['cyber_gold'] = cyberModel;
    }

    // 2. Fire Arena ("The Foundry") FBX
    const fireModel = assetManager.arenaModels && assetManager.arenaModels['fire_arena'];
    if (fireModel) {
      const fireScale = 0.22;
      fireModel.scale.setScalar(fireScale);
      // Floor center is at Y = -20.7090, placed flush at Y = 0.00
      fireModel.position.set(0, 20.7090 * fireScale, 0);
      fireModel.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = false;
          child.matrixAutoUpdate = false;
          child.updateMatrix();
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });
      this.platformModels['fire_arena'] = fireModel;
    }

    // 3. Street Fight Arena ("Iron Fist") FBX
    const streetModel = assetManager.arenaModels && assetManager.arenaModels['street_fight'];
    if (streetModel) {
      const streetScale = 0.22;
      streetModel.scale.setScalar(streetScale);
      // Floor center is at Y = -15.1504, placed flush at Y = 0.00
      streetModel.position.set(0, 15.1504 * streetScale, 0);
      streetModel.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = false;
          child.matrixAutoUpdate = false;
          child.updateMatrix();
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });
      this.platformModels['street_fight'] = streetModel;
    }
  }

  initBoundary() {
    // Ground perimeter containment ring - sits right on the arena floor (Y = 0.04)
    const groundRingGeo = new THREE.TorusGeometry(this.initialRadius, 0.08, 16, 96);
    this.boundaryMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00, // Tactical glowing gold
      transparent: true,
      opacity: 0.95
    });
    this.boundaryMesh = new THREE.Mesh(groundRingGeo, this.boundaryMat);
    this.boundaryMesh.rotation.x = Math.PI / 2;
    this.boundaryMesh.position.y = 0.04; // Snapped directly to the floor surface
    this.group.add(this.boundaryMesh);

    // Mid barrier laser wire (Y = 0.8)
    const midRingGeo = new THREE.TorusGeometry(this.initialRadius, 0.035, 16, 96);
    this.midBoundaryMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, // White-hot laser wire
      transparent: true,
      opacity: 0.85
    });
    this.midBoundaryMesh = new THREE.Mesh(midRingGeo, this.midBoundaryMat);
    this.midBoundaryMesh.rotation.x = Math.PI / 2;
    this.midBoundaryMesh.position.y = 0.8;
    this.group.add(this.midBoundaryMesh);

    // Cylindrical holographic containment shield (faint glowing perimeter wall)
    const shieldGeo = new THREE.CylinderGeometry(this.initialRadius, this.initialRadius, 1.6, 64, 1, true);
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, this.shieldMat);
    this.shieldMesh.position.y = 0.8;
    this.group.add(this.shieldMesh);

    this.posts = []; // Clean boundary without bulky procedural pillars obscuring the 3D model
  }

  setTheme(themeId) {
    if (themeId === 'volcanic_core') themeId = 'fire_arena';
    if (themeId === 'sky_citadel') themeId = 'street_fight';

    const theme = ARENA_THEMES[themeId] || ARENA_THEMES.cyber_gold;
    this.themeId = theme.id;
    const modelKey = theme.modelKey || theme.id;

    if (this.activeModelKey !== modelKey) {
      if (this.currentModel) {
        this.group.remove(this.currentModel);
      }
      const nextModel = this.platformModels[modelKey] || this.platformModels['cyber_gold'];
      if (nextModel) {
        this.currentModel = nextModel;
        this.arenaModel = nextModel;
        this.group.add(this.currentModel);
        this.activeModelKey = modelKey;
      }
    }

    if (this.boundaryMat) this.boundaryMat.color.setHex(theme.boundaryColor);
    if (this.midBoundaryMat) this.midBoundaryMat.color.setHex(theme.midWireColor);
    if (this.shieldMat) this.shieldMat.color.setHex(theme.shieldColor);

    if (this.currentModel && modelKey === 'cyber_gold') {
      this.currentModel.traverse((child) => {
        if (child.isMesh && child.material && child.material.color) {
          child.material.color.setHex(theme.floorTint);
        }
      });
    }

    return theme;
  }

  shrinkTo(newRadius) {
    this.targetRadius = Math.max(3.8, newRadius);
    this.isShrinking = true;
  }

  resetRadius(newRadius = 12) {
    this.initialRadius = newRadius;
    this.radius = newRadius;
    this.targetRadius = newRadius;
    this.isShrinking = false;
    if (this.boundaryMesh) this.boundaryMesh.scale.set(1, 1, 1);
    if (this.midBoundaryMesh) this.midBoundaryMesh.scale.set(1, 1, 1);
    if (this.shieldMesh) this.shieldMesh.scale.set(1, 1, 1);
  }

  isInside(x, z, margin = 0.8) {
    const dist = Math.sqrt(x * x + z * z);
    return dist <= (this.radius - margin);
  }

  // Strict boundary enforcement: strictly prevents characters from going outside!
  clampPosition(position, margin = 0.8) {
    const maxR = Math.max(1.2, this.radius - margin);
    const dist = Math.sqrt(position.x * position.x + position.z * position.z);
    if (dist > maxR && dist > 0.0001) {
      position.x = (position.x / dist) * maxR;
      position.z = (position.z / dist) * maxR;
    }
  }

  // Smoothly pushes players inward when the ring contracts
  repelInward(position, delta, margin = 0.9) {
    const maxR = Math.max(1.2, this.radius - margin);
    const dist = Math.sqrt(position.x * position.x + position.z * position.z);
    if (dist > maxR) {
      const repelSpeed = 6.0 * delta;
      const factor = (dist - maxR) * 3.0 + 1.0;
      position.x -= (position.x / dist) * repelSpeed * factor;
      position.z -= (position.z / dist) * repelSpeed * factor;
    }
  }

  update(delta) {
    if (this.isShrinking) {
      if (this.radius > this.targetRadius) {
        this.radius -= this.shrinkSpeed * delta;
        if (this.radius <= this.targetRadius) {
          this.radius = this.targetRadius;
          this.isShrinking = false;
        }
      } else if (this.radius < this.targetRadius) {
        this.radius += this.shrinkSpeed * delta;
        if (this.radius >= this.targetRadius) {
          this.radius = this.targetRadius;
          this.isShrinking = false;
        }
      }

      const scale = this.radius / this.initialRadius;
      if (this.boundaryMesh) this.boundaryMesh.scale.set(scale, scale, 1);
      if (this.midBoundaryMesh) this.midBoundaryMesh.scale.set(scale, scale, 1);
      if (this.shieldMesh) this.shieldMesh.scale.set(scale, 1, scale);
    }

    // Boundary glow pulse
    const pulse = 0.85 + 0.15 * Math.sin(Date.now() * 0.006);
    if (this.boundaryMat) this.boundaryMat.opacity = pulse;
    if (this.midBoundaryMat) this.midBoundaryMat.opacity = pulse * 0.85;
    if (this.shieldMat) this.shieldMat.opacity = 0.08 + 0.08 * Math.sin(Date.now() * 0.004);
  }
}
