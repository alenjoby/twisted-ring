# Realtime Multiplayer Latency & Game Loop Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all perceived lag, rubber-banding, GC pauses, and round desynchronization in Twisted Ring's real-time multiplayer stack.

**Architecture:** Replace client-side drift with host-epoch synchronized countdowns, introduce zero-allocation scratch vector pooling in Three.js render loops, implement unthrottled stop packet delivery with 26x responsive position and 28x aim lerping, enforce a 500ms lock-packet grace window for authoritative referee evaluation, and add an in-game Network Uplink modal for live cloud WebSocket configuration.

**Tech Stack:** Three.js, Supabase Realtime (WebSockets), Vite, ES6 Modules.

---

### Task 1: Zero-Allocation Math & Garbage Collection Optimization

**Files:**
- Modify: `src/game/Character.js:215-265`
- Modify: `src/main.js:1530-1640`

- [ ] **Step 1: Add scratch vectors to Character.js**
Define module-level reusable scratch vectors `_scratchForward`, `_scratchRight`, `_scratchOrigin`, `_scratchRayTarget`, and `_scratchDotPos`. Refactor `getLaserRay()` and `updateLaser()` to mutate these scratch objects instead of allocating new `THREE.Vector3` instances on every frame.

- [ ] **Step 2: Eliminate redundant updateLaser() calls**
Remove `p.updateLaser()` from the remote player loop in `src/main.js`, as it is already invoked authoritatively within `p.update(delta)`.

- [ ] **Step 3: Cache viewport dimensions and scratch vectors in main.js**
Pre-allocate `_scratchHeadPos` for the floating name tag projector. Cache `windowWidth` and `windowHeight` on `resize` events rather than reading DOM window properties 60 times a second for every player.

- [ ] **Step 4: Verify build and compile**
Run `npm run build` to verify clean compilation without syntax errors.

---

### Task 2: Movement Snappiness, Immediate Stop Packets, and Responsive Lerping

**Files:**
- Modify: `src/game/SupabaseManager.js:385-420`
- Modify: `src/main.js:1470-1550`
- Modify: `src/main.js:1590-1620`

- [ ] **Step 1: Implement forced unthrottled stop packet delivery**
In `SupabaseManager.js`, add `broadcastMovement(pos, rotY, force = false)`. If `force === true`, bypass `this.moveThrottleMs` and transmit immediately.

- [ ] **Step 2: Detect movement key release in main.js**
Track `wasMoving` state. On the exact frame movement stops (`wasMoving && moveInput.lengthSq() === 0`), dispatch `supabaseManager.broadcastMovement(localPlayer.group.position, localPlayer.rotationY, true)`.

- [ ] **Step 3: Increase remote interpolation responsiveness**
In `main.js`:
- Increase position smoothing factor from `14.0 * delta` to `26.0 * delta`.
- If `dist < 0.04m`, snap position immediately to `targetPos` and ensure `p.playAction('idle', 0.18)` engages without ice-skate gliding.
- Increase aim rotation factor from `12.0 * delta` to `28.0 * delta` so remote laser aiming tracks in near real-time.

- [ ] **Step 4: Verify build and compile**
Run `npm run build` to ensure clean compilation.

---

### Task 3: Authoritative Host-Epoch Round Clock Synchronization

**Files:**
- Modify: `src/game/SupabaseManager.js:415-435`
- Modify: `src/main.js:590-675`

- [ ] **Step 1: Include timing epoch in round-sync packet**
In `SupabaseManager.js`, update `broadcastRoundStart(round, startTime, stealthDuration)` to include `serverStartTime: Date.now()`, `reconDuration: 1500`, and `stealthDuration: CONFIG.countdownSeconds * 1000`.

- [ ] **Step 2: Sync clients to host timestamp epoch**
In `src/main.js`:
When receiving `onRoundSync`, calculate the exact phase and remaining milliseconds from `Date.now() - syncData.serverStartTime`. Compute remaining countdown seconds using `Math.max(0, Math.ceil((stealthEndTime - Date.now()) / 1000))` instead of uncoordinated local `setInterval` ticks.

- [ ] **Step 3: Host-driven lock phase signal**
When the host stealth countdown expires, broadcast an authoritative `phase-lock` event. All clients immediately freeze inputs and dispatch their frozen coordinates in `lock-packet`.

- [ ] **Step 4: Verify build and compile**
Run `npm run build`.

---

### Task 4: Authoritative Referee Lock-Packet Grace Window

**Files:**
- Modify: `src/main.js:675-760`

- [ ] **Step 1: Store locked coordinates per player**
Create `lockedPlayerCoords = new Map()`. When `onLockPacket` arrives, store `{ x, y, z, rotY }` in `lockedPlayerCoords`.

- [ ] **Step 2: Extend host verdict grace window to 500ms**
In `executeReveal()`, increase host referee timeout from 280ms to 500ms to allow network latency and Supabase WebSocket relay transit.

- [ ] **Step 3: Use locked packet coordinates for raycasting**
In `evaluateHostVerdict()`, for each shooter and target, look up their coordinates in `lockedPlayerCoords`. Construct rays and target positions from these authoritative coordinates, with a graceful fallback to their current mesh positions only if a peer's lock packet was completely dropped.

- [ ] **Step 4: Verify build and compile**
Run `npm run build`.

---

### Task 5: In-Game Network Health & Cloud Uplink Modal

**Files:**
- Modify: `index.html:330-410`
- Modify: `src/game/SupabaseManager.js:70-98`
- Modify: `src/main.js:1330-1450`

- [ ] **Step 1: Add Network Uplink modal and HUD status pill**
Add a network status badge in the HUD and Lobby: "UPLINK: CLOUD WSS" (green) or "UPLINK: LOCAL PEER" (amber). Add a clean configuration drawer in the lobby modal allowing users to paste their Supabase Project URL and Anon Key with a "CONNECT" button.

- [ ] **Step 2: Implement dynamic client reconnection**
In `SupabaseManager.js`, implement `reconnectWithCredentials(url, key)`. Store valid credentials in `safeStorage` so they persist across reloads.

- [ ] **Step 3: Add ping / latency estimator**
Add a lightweight ping-pong broadcast packet every 4 seconds to display real-time latency (RTT ms) on the HUD.

- [ ] **Step 4: Verify build, test emojis, and commit**
Run emoji audit script, run `npm run build`, and commit changes.
