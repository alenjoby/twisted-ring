import * as THREE from 'three';

/**
 * Sets up dual-stick mobile controls (Left-Thumb 360-degree Move Stick,
 * Right-Thumb 360-degree Laser Aim Stick, and Direct Arena Tap/Slide Aiming)
 * while preventing single-finger OrbitControls camera spin conflicts.
 */
export function setupMobileControls({
  controls,
  camera,
  rendererDom,
  analogMove,
  aimPoint,
  getLocalPlayer,
  isModalActive,
  updateAimFromScreenCoords
}) {
  // 1. Prevent single-finger touch from spinning OrbitControls while aiming or walking.
  // Two-finger pinch/drag still zooms and rotates the camera smoothly.
  if (controls) {
    controls.touches = {
      ONE: null,
      TWO: THREE.TOUCH.DOLLY_ROTATE
    };
  }

  const joystickZone = document.getElementById('touch-joystick-zone');
  const joystickThumb = document.getElementById('touch-joystick-thumb');
  const aimZone = document.getElementById('touch-aim-zone');
  const aimThumb = document.getElementById('touch-aim-thumb');

  let moveTouchId = null;
  const moveOrigin = { x: 0, y: 0 };
  const MAX_RADIUS = 38;

  let aimStickTouchId = null;
  const aimOrigin = { x: 0, y: 0 };
  const AIM_MAX_RADIUS = 38;

  const resetMoveJoystick = () => {
    moveTouchId = null;
    analogMove.active = false;
    analogMove.x = 0;
    analogMove.z = 0;
    if (joystickThumb) {
      joystickThumb.style.transform = 'translate(0px, 0px)';
    }
  };

  const resetAimJoystick = () => {
    aimStickTouchId = null;
    analogMove.aimStickActive = false;
    if (aimThumb) {
      aimThumb.style.transform = 'translate(0px, 0px)';
    }
  };

  // 2. Left-Thumb 360-Degree Analog Move Stick (#touch-joystick-zone)
  if (joystickZone) {
    joystickZone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (moveTouchId !== null) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        moveTouchId = touch.identifier;
        moveOrigin.x = touch.clientX;
        moveOrigin.y = touch.clientY;
        analogMove.active = true;
        analogMove.x = 0;
        analogMove.z = 0;
        if (joystickThumb) {
          joystickThumb.style.transform = 'translate(0px, 0px)';
        }
      },
      { passive: false }
    );

    joystickZone.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (moveTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === moveTouchId) {
            const dx = t.clientX - moveOrigin.x;
            const dy = t.clientY - moveOrigin.y;
            const dist = Math.hypot(dx, dy);
            const clampedDist = Math.min(dist, MAX_RADIUS);
            const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;

            const thumbX = Math.cos(angle) * clampedDist;
            const thumbY = Math.sin(angle) * clampedDist;
            if (joystickThumb) {
              joystickThumb.style.transform = `translate(${thumbX}px, ${thumbY}px)`;
            }

            const normDist = Math.min(1, dist / MAX_RADIUS);
            if (normDist < 0.12) {
              analogMove.x = 0;
              analogMove.z = 0;
            } else {
              const rescaled = (normDist - 0.12) / (1 - 0.12);
              analogMove.x = Math.cos(angle) * rescaled;
              analogMove.z = Math.sin(angle) * rescaled;
            }
            break;
          }
        }
      },
      { passive: false }
    );

    const onMoveEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === moveTouchId) {
          resetMoveJoystick();
          break;
        }
      }
    };

    joystickZone.addEventListener('touchend', onMoveEnd);
    joystickZone.addEventListener('touchcancel', onMoveEnd);
  }

  // 3. Right-Thumb 360-Degree Laser Aim Stick (#touch-aim-zone)
  const applyAimStickVector = (dx, dy) => {
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, AIM_MAX_RADIUS);
    const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;

    const thumbX = Math.cos(angle) * clampedDist;
    const thumbY = Math.sin(angle) * clampedDist;
    if (aimThumb) {
      aimThumb.style.transform = `translate(${thumbX}px, ${thumbY}px)`;
    }

    if (dist > 5) {
      const localPlayer = getLocalPlayer ? getLocalPlayer() : null;
      if (localPlayer && localPlayer.isAlive) {
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        camForward.y = 0;
        if (camForward.lengthSq() < 0.0001) {
          camForward.set(0, 0, -1);
        } else {
          camForward.normalize();
        }
        const camRight = new THREE.Vector3()
          .crossVectors(camForward, new THREE.Vector3(0, 1, 0))
          .normalize();

        const normX = dx / dist;
        const normY = dy / dist;
        const worldAimDir = new THREE.Vector3()
          .addScaledVector(camRight, normX)
          .addScaledVector(camForward, -normY)
          .normalize();

        aimPoint.set(
          localPlayer.group.position.x + worldAimDir.x * 10,
          0,
          localPlayer.group.position.z + worldAimDir.z * 10
        );
        localPlayer.rotationY = Math.atan2(worldAimDir.x, worldAimDir.z);
        localPlayer.group.rotation.y = localPlayer.rotationY;
      }
    }
  };

  if (aimZone) {
    aimZone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (aimStickTouchId !== null) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        aimStickTouchId = touch.identifier;
        analogMove.aimStickActive = true;
        aimOrigin.x = touch.clientX;
        aimOrigin.y = touch.clientY;
        if (aimThumb) {
          aimThumb.style.transform = 'translate(0px, 0px)';
        }
      },
      { passive: false }
    );

    aimZone.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (aimStickTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === aimStickTouchId) {
            applyAimStickVector(t.clientX - aimOrigin.x, t.clientY - aimOrigin.y);
            break;
          }
        }
      },
      { passive: false }
    );

    const onAimEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === aimStickTouchId) {
          resetAimJoystick();
          break;
        }
      }
    };

    aimZone.addEventListener('touchend', onAimEnd);
    aimZone.addEventListener('touchcancel', onAimEnd);
  }

  // 4. Direct Arena Tap / Slide Aiming (Touching anywhere on the 3D Arena Floor/Enemy)
  const isHudElement = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(
      target.closest(
        '.hud-header, .hud-footer, #touch-joystick-zone, #touch-aim-zone, #spectator-bar'
      )
    );
  };

  const handleArenaTouchAim = (e) => {
    if (isModalActive && isModalActive()) return;

    // Collect active non-joystick touches
    const arenaTouches = [];
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (t.identifier === moveTouchId || t.identifier === aimStickTouchId) continue;
      arenaTouches.push(t);
    }

    // Only aim when exactly 1 non-joystick touch is active so 2-finger pinch-zoom works unimpeded
    if (arenaTouches.length !== 1) return;

    const touch = arenaTouches[0];
    if (isHudElement(touch.target)) return;

    if (updateAimFromScreenCoords) {
      updateAimFromScreenCoords(touch.clientX, touch.clientY);
    }

    const localPlayer = getLocalPlayer ? getLocalPlayer() : null;
    if (localPlayer && localPlayer.isAlive) {
      const adx = aimPoint.x - localPlayer.group.position.x;
      const adz = aimPoint.z - localPlayer.group.position.z;
      if (Math.hypot(adx, adz) > 0.05) {
        localPlayer.rotationY = Math.atan2(adx, adz);
        localPlayer.group.rotation.y = localPlayer.rotationY;
      }
    }
  };

  if (rendererDom) {
    rendererDom.addEventListener('touchstart', handleArenaTouchAim, { passive: true });
    rendererDom.addEventListener('touchmove', handleArenaTouchAim, { passive: true });
  } else {
    window.addEventListener('touchstart', handleArenaTouchAim, { passive: true });
    window.addEventListener('touchmove', handleArenaTouchAim, { passive: true });
  }

  return {
    resetMoveJoystick,
    resetAimJoystick
  };
}
