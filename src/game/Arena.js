import * as THREE from 'three';
import { assetManager } from './AssetManager.js';

export class Arena {
  constructor(scene, initialRadius = 12) {
    this.scene = scene;
    this.initialRadius = initialRadius;
    this.radius = initialRadius;
    this.targetRadius = initialRadius;
    this.shrinkSpeed = 2.5;
    this.isShrinking = false;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.initPlatform();
    this.initBoundary();
  }

  initPlatform() {
    if (assetManager.arenaModel) {
      // Use the provided 3D GLB model
      this.arenaModel = assetManager.arenaModel;
      
      // The walkable floor of areana.glb has a radius of ~0.85 in model units
      // and a surface height of Y = -0.0874 in model units.
      const floorModelRadius = 0.85;
      const scale = this.initialRadius / floorModelRadius;
      this.arenaModel.scale.setScalar(scale);

      // Align model so center is at (0, 0) and the walkable floor surface is EXACTLY at Y = 0
      this.arenaModel.position.x = 0;
      this.arenaModel.position.z = 0;
      this.arenaModel.position.y = 0.0874 * scale;
      
      this.arenaModel.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = true;
          // Ensure double sided rendering for arena materials
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });
      
      this.group.add(this.arenaModel);
    } else {
      console.error("Critical: areana.glb failed to load. The arena floor will be missing.");
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
