import colyseus from "colyseus";
const { Server } = colyseus;
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

const httpServer = createServer(app);
const gameServer = new Server({
  server: httpServer
});

// Register our Party game room
gameServer.define("arena_room", ArenaRoom);

gameServer.listen(port).then(() => {
  console.log(`\n🎮 Colyseus Party Arena Server listening on ws://localhost:${port}\n`);
}).catch((err) => {
  console.error("Failed to start Colyseus server:", err);
});
