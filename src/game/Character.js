import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export class Character {
  constructor({ scene, id, name, isLocal = false, color = 0xffcc00, assetManager }) {
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.isLocal = isLocal;
    this.color = color;
    this.assetManager = assetManager;

    this.position = new THREE.Vector3(0, 0, 0);
    this.rotationY = 0;
    this.aimTarget = new THREE.Vector3(0, 0, 0);

    this.isAlive = true;
    this.isVisible = true;
    this.score = 0;
    this.currentActionName = 'idle';
    this.isHost = false;
    this.isReady = false;
    this.laserActive = false;
    this.readyAura = null;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.mixer = null;
    this.actions = {};
    this.modelLoaded = false;
    this.blasterMesh = null;
    this.rightHandBone = null;

    this.initModelFromAssets();
    this.initHUD();
  }

  initModelFromAssets() {
    if (!this.assetManager || !this.assetManager.baseModel) return;

    // Instantly clone base model using SkeletonUtils for butter-smooth multi-character performance!
    this.fbxModel = cloneSkeleton(this.assetManager.baseModel);

    // Precise bounding box scale
    const box = new THREE.Box3().setFromObject(this.fbxModel);
    const size = new THREE.Vector3();
    box.getSize(size);

    const targetHeight = 2.45; // Heroic scale, clearly visible
    const scale = size.y > 0.001 ? (targetHeight / size.y) : 0.012;
    this.fbxModel.scale.setScalar(scale);

    // Mixamo characters are naturally grounded at y = 0
    this.fbxModel.position.y = 0;

    // Apply texture with tactical PBR tuning
    this.fbxModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = new THREE.MeshStandardMaterial({
          map: this.assetManager.textures['map'] || null,
          normalMap: this.assetManager.textures['normalMap'] || null,
          roughnessMap: this.assetManager.textures['metalnessMap'] || null,
          color: 0xffffff,
          roughness: 0.6,
          metalness: 0.15
        });
        child.material.needsUpdate = true;
      }
    });

    // Locate Right Hand Bone to attach blaster & laser
    this.rightHandBone = this.fbxModel.getObjectByName('mixamorigRightHand');
    if (this.rightHandBone) {
      this.attachBlasterAndLaser(this.rightHandBone);
    }

    // Set up AnimationMixer with pre-cached clips
    this.mixer = new THREE.AnimationMixer(this.fbxModel);

    for (const [key, clip] of Object.entries(this.assetManager.clips)) {
      const action = this.mixer.clipAction(clip);
      if (key === 'death' || key === 'shoot') {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
    }

    if (this.actions['idle']) {
      this.actions['idle'].play();
    }

    this.group.add(this.fbxModel);
    this.modelLoaded = true;
  }

  attachBlasterAndLaser(handBone) {
    this.blasterMesh = new THREE.Group();

    // Matte tactical blaster frame
    const frameGeo = new THREE.BoxGeometry(0.09, 0.13, 0.34);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x171a21,
      metalness: 0.85,
      roughness: 0.25
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.03, 0.14);

    // Upper barrel
    const barrelGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.24, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x2b313d,
      metalness: 0.95,
      roughness: 0.15
    });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0, 0.28);

    // Glowing tactical muzzle emitter
    const muzzleGeo = new THREE.SphereGeometry(0.028, 8, 8);
    const laserColorHex = this.isLocal ? 0xffcc00 : 0xff2a5f;
    const muzzleMat = new THREE.MeshBasicMaterial({ color: laserColorHex });
    this.muzzleMesh = new THREE.Mesh(muzzleGeo, muzzleMat);
    this.muzzleMesh.position.set(0, 0, 0.39);

    this.laserLength = 32;
    const beamGeo = new THREE.CylinderGeometry(0.022, 0.022, this.laserLength, 8);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, this.laserLength / 2);

    this.beamMat = new THREE.MeshBasicMaterial({
      color: laserColorHex,
      transparent: true,
      opacity: 0.92
    });
    this.laserBeam = new THREE.Mesh(beamGeo, this.beamMat);
    // Add laser beam to scene instead of hand bone to avoid animation twisting
    this.scene.add(this.laserBeam);

    this.blasterMesh.add(frame, barrel, this.muzzleMesh);
    this.blasterMesh.rotation.x = Math.PI / 2; // match pistol hand grip

    handBone.add(this.blasterMesh);

    // Laser tip impact dot
    const dotGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: laserColorHex });
    this.laserDot = new THREE.Mesh(dotGeo, dotMat);
    this.scene.add(this.laserDot);
  }

  initHUD() {
    // 3D Tactical ready ring aura projected on the floor under the character (Y = 0.02)
    const auraGeo = new THREE.RingGeometry(0.55, 0.72, 32);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, // Tactical neon green
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    this.readyAura = new THREE.Mesh(auraGeo, auraMat);
    this.readyAura.rotation.x = Math.PI / 2;
    this.readyAura.position.y = 0.02;
    this.readyAura.visible = false;
    this.group.add(this.readyAura);
  }

  setReady(isReady) {
    this.isReady = !!isReady;
    if (this.readyAura) {
      this.readyAura.visible = this.isReady && this.isAlive && this.isVisible;
    }
  }

  playAction(name, duration = 0.16) {
    if (this.currentActionName === name) return;
    const prevAction = this.actions[this.currentActionName];
    const newAction = this.actions[name];

    if (newAction && this.mixer) {
      newAction.reset();
      newAction.fadeIn(duration).play();
      if (prevAction) {
        prevAction.fadeOut(duration);
      }
      this.currentActionName = name;
    } else {
      this.currentActionName = name;
    }
  }

  lookAtTarget(targetPos) {
    this.aimTarget.copy(targetPos);
    const dir = new THREE.Vector3().subVectors(targetPos, this.group.position);
    dir.y = 0;
    if (dir.lengthSq() > 0.001) {
      dir.normalize();
      const angle = Math.atan2(dir.x, dir.z);
      this.rotationY = angle;
      this.group.rotation.y = angle;
    }
    this.updateLaser();
  }

  setLaserActive(active) {
    this.laserActive = !!active;
    this.updateLaser();
  }

  updateLaser() {
    if (!this.isAlive || !this.laserBeam) {
      if (this.laserBeam) this.laserBeam.visible = false;
      if (this.laserDot) this.laserDot.visible = false;
      return;
    }

    const shouldShow = this.laserActive && (this.isLocal || this.isVisible);
    this.laserBeam.visible = shouldShow;
    if (this.laserDot) {
      this.laserDot.visible = shouldShow;
    }

    if (shouldShow) {
      const ray = this.getLaserRay();
      
      // Position the beam at the origin and point it along the direction
      this.laserBeam.position.copy(ray.origin);
      // LookAt targets a point along the direction
      this.laserBeam.lookAt(ray.origin.clone().add(ray.direction));
      
      const dotPos = ray.origin.clone().add(ray.direction.clone().multiplyScalar(this.laserLength));
      if (this.laserDot) {
        this.laserDot.position.copy(dotPos);
      }
    }
  }

  getLaserRay() {
    const origin = new THREE.Vector3();
    
    // Calculate a stable shoulder/gun position instead of using bone world positions 
    // which can be corrupted by Mixamo scaling
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotationY).normalize();
    const right = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotationY).normalize();
    
    // Offset: 1.35m up (chest/shoulder), 0.3m forward, 0.2m right
    origin.copy(this.group.position)
          .add(new THREE.Vector3(0, 1.35, 0))
          .add(forward.clone().multiplyScalar(0.3))
          .add(right.clone().multiplyScalar(0.2));

    return { origin, direction: forward, length: this.laserLength };
  }

  triggerShoot() {
    this.playAction('shoot', 0.04);

    if (this.beamMat) {
      this.beamMat.color.setHex(0xffffff);
      this.laserBeam.scale.set(3, 3, 1);

      setTimeout(() => {
        if (this.beamMat) {
          this.beamMat.color.setHex(this.isLocal ? 0xffcc00 : 0xff2a5f);
          this.laserBeam.scale.set(1, 1, 1);
        }
      }, 160);
    }
  }

  die() {
    this.isAlive = false;
    this.laserActive = false;
    this.playAction('death', 0.1);
    if (this.laserBeam) this.laserBeam.visible = false;
    if (this.laserDot) this.laserDot.visible = false;
    if (this.readyAura) this.readyAura.visible = false;
  }

  revive(spawnPos) {
    this.isAlive = true;
    this.laserActive = false;
    this.group.position.copy(spawnPos);
    this.group.rotation.set(0, 0, 0);
    this.playAction('idle', 0.2);
    this.updateLaser();
    if (this.readyAura) this.readyAura.visible = this.isReady;
  }

  setVisible(visible) {
    this.isVisible = !!visible;
    this.group.visible = this.isVisible;
    if (this.laserBeam) this.laserBeam.visible = this.isVisible && this.isAlive && this.laserActive;
    if (this.laserDot) this.laserDot.visible = this.isVisible && this.isAlive && this.laserActive;
    if (this.readyAura) this.readyAura.visible = this.isVisible && this.isAlive && this.isReady;
  }

  setStealth(isInStealth) {
    if (this.isLocal) {
      this.group.visible = true;
      if (this.laserBeam) this.laserBeam.visible = this.laserActive;
    } else {
      if (isInStealth) {
        this.createGhostSilhouette();
      } else {
        this.removeGhostSilhouette();
      }
      this.group.visible = !isInStealth;
      if (this.laserBeam) this.laserBeam.visible = !isInStealth && this.laserActive;
      if (this.laserDot) this.laserDot.visible = !isInStealth && this.laserActive;
      if (this.readyAura) this.readyAura.visible = !isInStealth && this.isReady;
    }
    this.isVisible = this.group.visible;
  }

  createGhostSilhouette() {
    this.removeGhostSilhouette();
    if (!this.fbxModel) return;
    try {
      this.ghostMesh = cloneSkeleton(this.fbxModel);
      const holoMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.38,
        wireframe: true,
        depthWrite: false
      });
      this.ghostMesh.traverse((child) => {
        if (child.isMesh) {
          child.material = holoMat;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
      this.ghostMesh.position.copy(this.group.position);
      this.ghostMesh.rotation.copy(this.group.rotation);
      this.ghostMesh.scale.copy(this.fbxModel.scale);
      this.scene.add(this.ghostMesh);
    } catch (e) {
      console.warn('Ghost silhouette fallback', e);
    }
  }

  removeGhostSilhouette() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      this.ghostMesh = null;
    }
  }

  animateSkyDrop(onComplete) {
    this.group.position.y = 12.0;
    this.skyDrop = {
      active: true,
      progress: 0,
      duration: 0.85,
      startY: 12.0,
      targetY: 0.0,
      onComplete
    };
  }

  createLandingShockwave() {
    const shockGeo = new THREE.RingGeometry(0.3, 0.45, 32);
    shockGeo.rotateX(Math.PI / 2);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    const shockRing = new THREE.Mesh(shockGeo, shockMat);
    shockRing.position.set(this.group.position.x, 0.03, this.group.position.z);
    this.scene.add(shockRing);

    let t = 0;
    const shockInterval = setInterval(() => {
      t += 0.05;
      const scale = 1 + t * 4;
      shockRing.scale.set(scale, scale, scale);
      shockMat.opacity = Math.max(0, 0.9 * (1 - t));
      if (t >= 1) {
        clearInterval(shockInterval);
        this.scene.remove(shockRing);
        shockGeo.dispose();
        shockMat.dispose();
      }
    }, 16);
  }

  update(delta) {
    if (this.skyDrop && this.skyDrop.active) {
      this.skyDrop.progress += delta / this.skyDrop.duration;
      if (this.skyDrop.progress >= 1) {
        this.skyDrop.progress = 1;
        this.skyDrop.active = false;
        this.group.position.y = this.skyDrop.targetY;
        this.createLandingShockwave();
        if (this.skyDrop.onComplete) this.skyDrop.onComplete();
      } else {
        const p = this.skyDrop.progress * this.skyDrop.progress;
        this.group.position.y = THREE.MathUtils.lerp(this.skyDrop.startY, this.skyDrop.targetY, p);
      }
    }

    if (this.mixer) {
      this.mixer.update(delta);
    }
    this.updateLaser();
  }

  dispose() {
    this.removeGhostSilhouette();
    this.scene.remove(this.group);
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.group.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }
}
