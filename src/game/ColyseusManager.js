import { Client } from 'colyseus.js';

export class ColyseusManager {
  constructor({
    onPlayerJoined,
    onPlayerLeft,
    onPlayerMoved,
    onRoundSync,
    onReveal,
    onHit,
    onStateChange,
    onElimination,
    onLaserShot
  }) {
    this.onPlayerJoined = onPlayerJoined;
    this.onPlayerLeft = onPlayerLeft;
    this.onPlayerMoved = onPlayerMoved;
    this.onRoundSync = onRoundSync;
    this.onReveal = onReveal;
    this.onHit = onHit;
    this.onStateChange = onStateChange;
    this.onElimination = onElimination;
    this.onLaserShot = onLaserShot;

    this.client = null;
    this.room = null;
    this.isConnected = false;

    // Supports Render/production wss:// URL via environment variable or fallback to localhost
    const envUrl = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_COLYSEUS_URL || import.meta.env.NEXT_PUBLIC_COLYSEUS_URL) : null;
    this.serverUrl = envUrl || (window.location.protocol === 'https:' ? `wss://${window.location.hostname}` : 'ws://localhost:2567');
  }

  async connect(roomName = 'arena_room', playerOptions = {}) {
    try {
      this.client = new Client(this.serverUrl);
      console.log(`[Colyseus] Connecting to ${this.serverUrl}...`);

      this.room = await this.client.joinOrCreate(roomName, playerOptions);
      this.isConnected = true;
      console.log(`[Colyseus] Joined room: ${this.room.id} with sessionId: ${this.room.sessionId}`);

      // Listen for players entering
      this.room.state.players.onAdd((player, sessionId) => {
        if (sessionId !== this.room.sessionId && this.onPlayerJoined) {
          this.onPlayerJoined({
            id: sessionId,
            name: player.name,
            position: { x: player.x, y: 0, z: player.z },
            action: player.action,
            isAlive: player.isAlive,
            isVisible: player.isVisible
          });
        }

        // Listen for player property updates
        player.onChange(() => {
          if (sessionId !== this.room.sessionId && this.onPlayerMoved) {
            this.onPlayerMoved({
              id: sessionId,
              position: { x: player.x, y: 0, z: player.z },
              rotationY: player.rotationY,
              action: player.action,
              isAlive: player.isAlive,
              isVisible: player.isVisible
            });
          }
        });
      });

      // Listen for players leaving
      this.room.state.players.onRemove((player, sessionId) => {
        if (this.onPlayerLeft) {
          this.onPlayerLeft(sessionId);
        }
      });

      // Listen for game room state changes
      this.room.state.listen('currentPhase', (phase) => {
        if (this.onStateChange) {
          this.onStateChange({ currentPhase: phase, currentRound: this.room.state.currentRound });
        }
      });

      this.room.state.listen('arenaRadius', (radius) => {
        if (this.onRoundSync) {
          this.onRoundSync({ arenaRadius: radius, round: this.room.state.currentRound });
        }
      });

      // Custom message listeners
      this.room.onMessage('laser_shot', (data) => {
        if (this.onLaserShot) this.onLaserShot(data);
      });

      this.room.onMessage('elimination', (data) => {
        if (this.onElimination) this.onElimination(data);
      });

      return this.room;
    } catch (err) {
      console.warn('[Colyseus] Connection failed or server not running:', err.message);
      this.isConnected = false;
      return null;
    }
  }

  sendMove(x, z, rotationY, action) {
    if (this.room && this.isConnected) {
      this.room.send('move', { x, z, rotationY, action });
    }
  }

  sendShoot(origin, target) {
    if (this.room && this.isConnected) {
      this.room.send('shoot', { origin, target });
    }
  }

  sendHit(targetId) {
    if (this.room && this.isConnected) {
      this.room.send('player_hit', { targetId });
    }
  }

  setPhase(phase) {
    if (this.room && this.isConnected) {
      this.room.send('set_phase', { phase });
    }
  }

  resetGame() {
    if (this.room && this.isConnected) {
      this.room.send('reset_game');
    }
  }

  leave() {
    if (this.room) {
      this.room.leave();
      this.isConnected = false;
    }
  }
}
