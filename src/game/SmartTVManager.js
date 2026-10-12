import * as THREE from 'three';

/**
 * SmartTVManager:
 * 1. Smart TV Environment Detection (Samsung Tizen, LG webOS, Android TV, Fire TV, etc.)
 * 2. 10-Foot UI Mode & TV 60 FPS GPU Clamping
 * 3. TV Remote D-Pad Navigation (Arrow keys + OK + Back keycode handling)
 * 4. Full Gamepad API Integration (Dual-stick Xbox / PlayStation / Bluetooth TV controllers)
 */

export function isSmartTV() {
  const ua = (navigator.userAgent || '').toLowerCase();
  return (
    ua.includes('smart-tv') ||
    ua.includes('smarttv') ||
    ua.includes('tizen') ||
    ua.includes('webos') ||
    ua.includes('web0s') ||
    ua.includes('appletv') ||
    ua.includes('googletv') ||
    ua.includes('android tv') ||
    ua.includes('crkey') ||
    ua.includes('aftb') ||
    ua.includes('aftm') ||
    ua.includes('hbbtv') ||
    ua.includes('viera') ||
    ua.includes('netcast') ||
    ua.includes('pov_tv')
  );
}

export class SmartTVManager {
  constructor(options = {}) {
    this.analogMove = options.analogMove;
    this.aimPoint = options.aimPoint;
    this.camera = options.camera;
    this.getLocalPlayer = options.getLocalPlayer;
    this.renderer = options.renderer;

    this.isTV = isSmartTV();
    this.gamepadConnected = false;
    this.lastDpadNavTime = 0;
    this.lastButtonPress = {};
    this.focusedEl = null;

    this.init();
  }

  init() {
    if (this.isTV) {
      document.body.classList.add('smart-tv-mode');
      console.log('[SmartTVManager] Smart TV detected. 10-Foot UI mode enabled.');

      // Clamp TV pixel ratio for steady 60 FPS on TV chipsets
      if (this.renderer) {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      }

      // Register Tizen TV media/input keys if running on Samsung Tizen
      if (window.tizen && window.tizen.tvinputdevice) {
        try {
          window.tizen.tvinputdevice.registerKey('MediaPlayPause');
        } catch (e) {}
      }
    }

    this.setupTVRemoteListeners();
    this.setupGamepadListeners();
  }

  setupTVRemoteListeners() {
    window.addEventListener('keydown', (e) => {
      const keyCode = e.keyCode || e.which;

      // Smart TV Back Keys: KeyCode 10009 (Tizen), 461 (webOS), 27 (Escape), 8 (Backspace)
      if (keyCode === 10009 || keyCode === 461 || e.key === 'Escape') {
        const handled = this.handleBackKey();
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // If a modal or menu is active, handle D-Pad spatial navigation
      const activeModal = this.getActiveModal();
      if (activeModal || document.body.classList.contains('smart-tv-mode')) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          // If in an active combat stealth phase and no modal is open, let arrow keys move character
          if (!activeModal && document.getElementById('ui-overlay')?.classList.contains('hidden') === false) {
            return;
          }

          e.preventDefault();
          this.navigateSpatial(e.key, activeModal || document.body);
          return;
        }

        if (e.key === 'Enter') {
          if (this.focusedEl && typeof this.focusedEl.click === 'function') {
            e.preventDefault();
            this.focusedEl.click();
          }
        }
      }
    });
  }

  handleBackKey() {
    // Priority 1: Winner Modal (Leave / Rematch)
    const winnerModal = document.getElementById('winner-modal');
    if (winnerModal && !winnerModal.classList.contains('hidden')) {
      document.getElementById('btn-victory-leave')?.click();
      return true;
    }

    // Priority 2: Lobby Modal
    const lobbyModal = document.getElementById('lobby-modal');
    if (lobbyModal && lobbyModal.classList.contains('active')) {
      document.getElementById('btn-close-lobby')?.click();
      return true;
    }

    // Priority 3: Friends Hub Modal
    const friendsModal = document.getElementById('friends-hub-modal');
    if (friendsModal && !friendsModal.classList.contains('hidden')) {
      document.getElementById('btn-close-friends-hub')?.click();
      return true;
    }

    // Priority 4: Character Select Screen
    const charSelect = document.getElementById('character-select-screen');
    if (charSelect && !charSelect.classList.contains('hidden')) {
      document.getElementById('btn-char-select-back')?.click();
      return true;
    }

    // Priority 5: Mode Select Screen
    const modeSelect = document.getElementById('mode-select-screen');
    if (modeSelect && !modeSelect.classList.contains('hidden')) {
      modeSelect.classList.add('hidden');
      document.getElementById('welcome-screen')?.classList.remove('hidden');
      return true;
    }

    return false;
  }

  getActiveModal() {
    const ids = [
      'winner-modal',
      'friends-hub-modal',
      'lobby-modal',
      'character-select-screen',
      'mode-select-screen',
      'welcome-screen'
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden') && el.classList.contains('active') !== false) {
        if (id === 'lobby-modal' && !el.classList.contains('active')) continue;
        return el;
      }
    }
    return null;
  }

  navigateSpatial(direction, container) {
    const candidates = Array.from(
      container.querySelectorAll('button:not(.hidden):not([disabled]), input:not(.hidden):not([disabled]), select:not(.hidden), .char-card:not(.hidden), [tabindex="0"]')
    ).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
    });

    if (candidates.length === 0) return;

    if (!this.focusedEl || !candidates.includes(this.focusedEl)) {
      this.focusedEl = candidates[0];
      this.focusedEl.focus();
      this.highlightFocused(this.focusedEl);
      return;
    }

    const currentRect = this.focusedEl.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestTarget = null;
    let bestScore = Infinity;

    for (const target of candidates) {
      if (target === this.focusedEl) continue;
      const targetRect = target.getBoundingClientRect();
      const targetCenter = {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.top + targetRect.height / 2
      };

      const dx = targetCenter.x - currentCenter.x;
      const dy = targetCenter.y - currentCenter.y;

      // Filter by direction
      let isCorrectDir = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      if (direction === 'ArrowUp' && dy < -5) {
        isCorrectDir = true;
        primaryDist = -dy;
        secondaryDist = Math.abs(dx);
      } else if (direction === 'ArrowDown' && dy > 5) {
        isCorrectDir = true;
        primaryDist = dy;
        secondaryDist = Math.abs(dx);
      } else if (direction === 'ArrowLeft' && dx < -5) {
        isCorrectDir = true;
        primaryDist = -dx;
        secondaryDist = Math.abs(dy);
      } else if (direction === 'ArrowRight' && dx > 5) {
        isCorrectDir = true;
        primaryDist = dx;
        secondaryDist = Math.abs(dy);
      }

      if (isCorrectDir) {
        const score = primaryDist + secondaryDist * 2.2;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = target;
        }
      }
    }

    if (bestTarget) {
      this.focusedEl = bestTarget;
      this.focusedEl.focus();
      this.highlightFocused(this.focusedEl);
    }
  }

  highlightFocused(el) {
    document.querySelectorAll('.tv-focused').forEach(node => node.classList.remove('tv-focused'));
    if (el) el.classList.add('tv-focused');
  }

  setupGamepadListeners() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadConnected = true;
      console.log(`[SmartTVManager] Gamepad connected: ${e.gamepad.id}`);
      document.body.classList.add('gamepad-active');
    });

    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = false;
      console.log('[SmartTVManager] Gamepad disconnected');
    });
  }

  /**
   * Called every animation frame in animate()
   */
  update(delta) {
    if (!navigator.getGamepads) return;

    const gamepads = navigator.getGamepads();
    let pad = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        pad = gamepads[i];
        break;
      }
    }
    if (!pad) return;

    const DEADZONE = 0.16;

    // 1. Left Analog Stick (Movement)
    let stickX = pad.axes[0] || 0;
    let stickY = pad.axes[1] || 0;

    // D-Pad buttons fallback for movement (Buttons 12: Up, 13: Down, 14: Left, 15: Right)
    if (pad.buttons[14]?.pressed) stickX = -1;
    if (pad.buttons[15]?.pressed) stickX = 1;
    if (pad.buttons[12]?.pressed) stickY = -1;
    if (pad.buttons[13]?.pressed) stickY = 1;

    const moveMag = Math.hypot(stickX, stickY);
    if (moveMag > DEADZONE) {
      const norm = (moveMag - DEADZONE) / (1 - DEADZONE);
      const angle = Math.atan2(stickY, stickX);
      this.analogMove.active = true;
      this.analogMove.x = Math.cos(angle) * norm;
      this.analogMove.z = Math.sin(angle) * norm;
    } else if (!this.analogMove.touchActive) {
      this.analogMove.active = false;
      this.analogMove.x = 0;
      this.analogMove.z = 0;
    }

    // 2. Right Analog Stick (360-Degree Laser Aiming)
    const aimX = pad.axes[2] || 0;
    const aimY = pad.axes[3] || 0;
    const aimMag = Math.hypot(aimX, aimY);

    if (aimMag > DEADZONE) {
      const localPlayer = this.getLocalPlayer ? this.getLocalPlayer() : null;
      if (localPlayer && this.camera && this.aimPoint) {
        const camForward = new THREE.Vector3();
        this.camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();

        const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
        const normX = aimX / aimMag;
        const normY = aimY / aimMag;

        const worldAimDir = new THREE.Vector3()
          .addScaledVector(camRight, normX)
          .addScaledVector(camForward, -normY)
          .normalize();

        this.aimPoint.set(
          localPlayer.group.position.x + worldAimDir.x * 12,
          0,
          localPlayer.group.position.z + worldAimDir.z * 12
        );

        localPlayer.rotationY = Math.atan2(worldAimDir.x, worldAimDir.z);
        localPlayer.group.rotation.y = localPlayer.rotationY;
        this.analogMove.aimStickActive = true;
      }
    }

    // 3. Gamepad Button Actions
    const checkBtn = (index, callback) => {
      const isPressed = pad.buttons[index] && pad.buttons[index].pressed;
      const wasPressed = this.lastButtonPress[index] || false;
      if (isPressed && !wasPressed) {
        callback();
      }
      this.lastButtonPress[index] = isPressed;
    };

    // Button 0 (A / Cross): Confirm / Primary Action / Ready Up / Rematch
    checkBtn(0, () => {
      const activeModal = this.getActiveModal();
      if (activeModal && this.focusedEl) {
        this.focusedEl.click();
      } else {
        const rematchBtn = document.getElementById('btn-play-again');
        const readyBtn = document.getElementById('btn-ready-toggle');
        const enterBtn = document.getElementById('btn-enter-game');
        const deployBtn = document.getElementById('btn-confirm-operator');

        if (rematchBtn && !document.getElementById('winner-modal')?.classList.contains('hidden')) {
          rematchBtn.click();
        } else if (deployBtn && !document.getElementById('character-select-screen')?.classList.contains('hidden')) {
          deployBtn.click();
        } else if (enterBtn && !document.getElementById('welcome-screen')?.classList.contains('hidden')) {
          enterBtn.click();
        } else if (readyBtn && !document.getElementById('ui-overlay')?.classList.contains('hidden')) {
          readyBtn.click();
        }
      }
    });

    // Button 1 (B / Circle): Cancel / Back
    checkBtn(1, () => {
      this.handleBackKey();
    });

    // Button 2 (X / Square): Toggle Demo Bots
    checkBtn(2, () => {
      document.getElementById('btn-toggle-demo-bots')?.click();
    });

    // Button 3 (Y / Triangle): Host Start Match
    checkBtn(3, () => {
      document.getElementById('btn-hud-host-start')?.click();
    });

    // Button 9 (Start / Menu): Toggle Rooms / Lobby Modal
    checkBtn(9, () => {
      const lobbyBtn = document.getElementById('btn-lobby');
      if (lobbyBtn) lobbyBtn.click();
    });
  }
}
