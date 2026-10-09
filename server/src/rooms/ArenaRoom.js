import colyseus from "colyseus";
const { Room } = colyseus;
import { GameRoomState, PlayerState } from "../schema/GameState.js";

const CONFIG = {
  countdownSeconds: 5,
  initialArenaRadius: 10.5,
  shrinkPerRound: 2.2,
  minArenaRadius: 2.5
};

export class ArenaRoom extends Room {
  maxClients = 8;

  onCreate(options) {
    this.setState(new GameRoomState());

    // Message handler: player movement
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive) return;

      if (typeof data.x === 'number') player.x = data.x;
      if (typeof data.z === 'number') player.z = data.z;
      if (typeof data.rotationY === 'number') player.rotationY = data.rotationY;
      if (typeof data.action === 'string') player.action = data.action;
    });

    // Message handler: laser shoot event
    this.onMessage("shoot", (client, data) => {
      this.broadcast("laser_shot", {
        shooterId: client.sessionId,
        origin: data.origin,
        target: data.target
      }, { except: client });
    });

    // Message handler: player hit / eliminate
    this.onMessage("player_hit", (client, data) => {
      const target = this.state.players.get(data.targetId);
      if (target && target.isAlive) {
        target.isAlive = false;
        target.action = 'death';
        const shooter = this.state.players.get(client.sessionId);
        if (shooter) shooter.score += 100;
        this.broadcast("elimination", { victimId: data.targetId, killerId: client.sessionId });
      }
    });

    // Message handler: manual phase change or reset request from host
    this.onMessage("set_phase", (client, data) => {
      if (data.phase) {
        this.setPhase(data.phase);
      }
    });

    this.onMessage("reset_game", () => {
      this.resetMatch();
    });

    // Server-side authoritative tick: 20 times per second
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / 20);
  }

  onJoin(client, options) {
    const player = new PlayerState();
    player.name = options.name || `Doggo #${client.sessionId.slice(0, 4)}`;
    
    // Spawn randomly within inner ring
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (this.state.arenaRadius * 0.65);
    player.x = Math.cos(angle) * r;
    player.z = Math.sin(angle) * r;
    player.rotationY = angle + Math.PI;

    this.state.players.set(client.sessionId, player);
    console.log(`Player joined: ${player.name} (${client.sessionId})`);
  }

  onLeave(client) {
    console.log(`Player left: ${client.sessionId}`);
    this.state.players.delete(client.sessionId);
  }

  setPhase(phase) {
    this.state.currentPhase = phase;
    if (phase === 'STEALTH') {
      this.state.countdown = CONFIG.countdownSeconds;
      this.state.players.forEach((p) => {
        p.isVisible = false;
      });
    } else if (phase === 'REVEAL') {
      this.state.players.forEach((p) => {
        p.isVisible = true;
      });
    } else if (phase === 'SHRINK') {
      this.state.arenaRadius = Math.max(
        CONFIG.minArenaRadius,
        this.state.arenaRadius - CONFIG.shrinkPerRound
      );
      this.state.currentRound += 1;
    }
  }

  resetMatch() {
    this.state.currentPhase = 'LOBBY';
    this.state.countdown = CONFIG.countdownSeconds;
    this.state.currentRound = 1;
    this.state.arenaRadius = CONFIG.initialArenaRadius;
    this.state.players.forEach((p) => {
      p.isAlive = true;
      p.isVisible = true;
      p.action = 'idle';
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 5;
      p.x = Math.cos(angle) * r;
      p.z = Math.sin(angle) * r;
    });
  }

  update(deltaTime) {
    // Check ring bounds elimination
    const maxDistSq = this.state.arenaRadius * this.state.arenaRadius;
    this.state.players.forEach((p, sessionId) => {
      if (p.isAlive && this.state.currentPhase !== 'LOBBY') {
        const distSq = p.x * p.x + p.z * p.z;
        if (distSq > maxDistSq) {
          p.isAlive = false;
          p.action = 'death';
          this.broadcast("elimination", { victimId: sessionId, reason: 'ring_out' });
        }
      }
    });
  }
}
