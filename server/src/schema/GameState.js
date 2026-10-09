import { Schema, defineTypes, MapSchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  constructor() {
    super();
    this.name = "Player";
    this.x = 0;
    this.z = 0;
    this.rotationY = 0;
    this.action = "idle";
    this.isAlive = true;
    this.isVisible = true;
    this.score = 0;
  }
}

defineTypes(PlayerState, {
  name: "string",
  x: "number",
  z: "number",
  rotationY: "number",
  action: "string",
  isAlive: "boolean",
  isVisible: "boolean",
  score: "number"
});

export class GameRoomState extends Schema {
  constructor() {
    super();
    this.currentPhase = "LOBBY"; // 'LOBBY' | 'STEALTH' | 'REVEAL' | 'SHRINK' | 'VICTORY'
    this.countdown = 5;
    this.currentRound = 1;
    this.arenaRadius = 10.5;
    this.players = new MapSchema();
  }
}

defineTypes(GameRoomState, {
  currentPhase: "string",
  countdown: "number",
  currentRound: "number",
  arenaRadius: "number",
  players: { map: PlayerState }
});
