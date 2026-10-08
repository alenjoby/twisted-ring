# App Audit & Gameplay Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 10 critical game logic, networking, and combat issues identified in the lead developer audit, including solo practice bot auto-fill, mobile touch movement, single-target laser occlusion, multi-round spectator persistence, and bulletproof room switching.

**Architecture:** 
- Fix `SupabaseManager` cleanup routines to prevent orphaned `BroadcastChannel` listeners and ensure immediate UI roster updates on ready toggles.
- Refactor `main.js` state machine to isolate pre-deployed character models, persist spectator cameras across multi-round elimination, and handle host migration during round transitions.
- Implement closest-target raycast occlusion in `evaluateHostVerdict`.
- Add an autonomous Practice Bot spawner when player count < 2 so the game is immediately playable and testable solo.
- Add an on-screen touch joystick for mobile devices.

**Tech Stack:** Three.js, SkeletonUtils, Supabase Realtime, Web Audio API, Vite, CSS3.

---

## Files to Modify

| File | Changes |
| :--- | :--- |
| `src/game/SupabaseManager.js` | Unconditional `leaveRoom()` before room change; ready event synchronization; host migration timer resumption |
| `src/main.js` | Pre-deployment visibility; spectator retention; closest-target laser occlusion; bot auto-fill for solo testing; mobile touch joystick support |
| `index.html` | Add virtual touch joystick element for mobile; update non-host victory prompt |
| `src/style.css` | Styling for mobile touch joystick, host waiting status in victory modal |

---

## Tasks

- [ ] **Task 1: Multiplayer Network Stability & Room Switching Cleanup**
  - Make `leaveRoom()` in `SupabaseManager.js` unconditional so `BroadcastChannel` instances are cleanly closed.
  - Update `onPlayerReady` in `main.js` to immediately refresh `#friends-roster-grid` and `#lobby-players-list`.
  - Handle host migration during `SHRINK` phase so matches never freeze.

- [ ] **Task 2: Game State Lifecycle, Spectator Retention & Model Scale Fixes**
  - Hide local character model and name tag until `deployPlayerSkyDrop()` is called.
  - Only deactivate spectator mode in `startRound()` if `localPlayer.isAlive === true`.
  - Fix compound model scaling in `presentWinner()` by storing immutable `baseScale`.
  - Prevent non-host "Next Match" desync by routing reset through the host.
  - Add `#loading-screen` to `isModalActive()`.

- [ ] **Task 3: Combat Accuracy & Closest-Target Laser Occlusion**
  - Sort ray hits by distance along the ray (`proj`) so the first player hit blocks the laser from piercing through to players behind.

- [ ] **Task 4: Practice Bot Spawner for Solo Play & Testing**
  - Allow 1 player to launch match in Public or Friends mode.
  - Spawn AI training dummy bots with randomized dodging and aiming so single players can experience full rounds.

- [ ] **Task 5: Mobile Virtual Joystick & Touch Controls**
  - Add responsive on-screen floating touch joystick for mobile devices so phone/tablet users can move WASD.

- [ ] **Task 6: Verification, Emoji Audit, Build & Git Push**
  - Run zero-emoji verification script.
  - Run `npm run build` to confirm zero errors.
  - Commit and push to repository `https://github.com/alenjoby/twisted-ring.git` on branch `main`.
