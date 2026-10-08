import { createClient } from '@supabase/supabase-js';

// Default / fallback configuration (Supports both Vite and Vercel Next.js integration variables)
const DEFAULT_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || localStorage.getItem('supabase_url') || 'https://mock.supabase.co';
const DEFAULT_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || 'mock-key';

export class SupabaseManager {
  constructor({ onPlayerJoined, onPlayerLeft, onPlayerMoved, onRoundSync, onReveal, onHit, onRoomStateChange, onPlayerReady, onForceStart, onLockPacket, onRoundVerdict, onRoomSettings }) {
    this.onPlayerJoined = onPlayerJoined;
    this.onPlayerLeft = onPlayerLeft;
    this.onPlayerMoved = onPlayerMoved;
    this.onRoundSync = onRoundSync;
    this.onReveal = onReveal;
    this.onHit = onHit;
    this.onRoomStateChange = onRoomStateChange;
    this.onPlayerReady = onPlayerReady;
    this.onForceStart = onForceStart;
    this.onLockPacket = onLockPacket;
    this.onRoundVerdict = onRoundVerdict;
    this.onRoomSettings = onRoomSettings;

    this.client = null;
    this.channel = null;
    this.roomId = null;
    this.myPlayerInfo = null;
    this.hostId = null;
    this.isHost = false;
    this.connectedPlayers = new Map();
    this.isConfigured = false;
    this.lastMoveTime = 0;
    this.moveThrottleMs = 50; // ~20Hz updates for fluid real-time sync

    this.initClient(DEFAULT_URL, DEFAULT_KEY);
  }

  initClient(url, key) {
    if (url && key && url.includes('supabase.co') && key !== 'mock-key') {
      try {
        this.client = createClient(url, key, {
          realtime: {
            params: {
              eventsPerSecond: 40
            }
          }
        });
        this.isConfigured = true;
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_anon_key', key);
        console.log('[Supabase] Initialized successfully with remote project');
      } catch (err) {
        console.warn('[Supabase] Init error:', err);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
      console.log('[Supabase] Running in local peer channel fallback mode (configure keys in Lobby for global network)');
    }
  }

  // Set local player info before connecting
  setPlayerInfo(info) {
    this.myPlayerInfo = info;
    if (this.myPlayerInfo && !this.myPlayerInfo.joinedAt) {
      this.myPlayerInfo.joinedAt = Date.now();
    }
  }

  // Join a Room (Public or Private) with strict 5-player limit
  async joinRoom(roomId, playerInfo = null) {
    if (playerInfo) this.myPlayerInfo = playerInfo;
    if (this.myPlayerInfo && !this.myPlayerInfo.joinedAt) {
      this.myPlayerInfo.joinedAt = Date.now();
    }
    if (this.channel) {
      await this.leaveRoom();
    }

    this.roomId = roomId;
    console.log(`[Supabase] Connecting to room: ${roomId}`);

    if (this.isConfigured && this.client) {
      // Real Supabase Channel
      this.channel = this.client.channel(`twisted_${roomId}`, {
        config: {
          presence: { key: this.myPlayerInfo.id },
          broadcast: { self: false }
        }
      });

      // 1. Presence Sync (tracks who is in the room, max 5)
      this.channel
        .on('presence', { event: 'sync' }, () => {
          const state = this.channel.presenceState();
          const activeList = [];

          for (const key in state) {
            const presences = state[key];
            if (presences && presences.length > 0) {
              const p = presences[0];
              activeList.push(p);
              if (p.id !== this.myPlayerInfo.id && !this.connectedPlayers.has(p.id)) {
                this.connectedPlayers.set(p.id, p);
                if (this.onPlayerJoined) this.onPlayerJoined(p);
              } else if (p.id !== this.myPlayerInfo.id && this.connectedPlayers.has(p.id)) {
                const existing = this.connectedPlayers.get(p.id);
                Object.assign(existing, p);
              }
            }
          }

          // Check if anyone left
          for (const [id, player] of this.connectedPlayers.entries()) {
            if (!activeList.find(p => p.id === id)) {
              this.connectedPlayers.delete(id);
              if (this.onPlayerLeft) this.onPlayerLeft(id);
            }
          }

          // Deterministic Host Election: Sort by joinedAt ascending, tiebreak with id
          activeList.sort((a, b) => {
            const tA = a.joinedAt || 0;
            const tB = b.joinedAt || 0;
            if (tA !== tB) return tA - tB;
            return (a.id || '').localeCompare(b.id || '');
          });

          this.hostId = activeList.length > 0 ? activeList[0].id : this.myPlayerInfo.id;
          this.isHost = (this.myPlayerInfo.id === this.hostId);

          activeList.forEach(p => {
            p.isHost = (p.id === this.hostId);
          });

          if (this.onRoomStateChange) {
            this.onRoomStateChange({
              roomId: this.roomId,
              count: activeList.length,
              max: 5,
              players: activeList,
              hostId: this.hostId,
              isHost: this.isHost
            });
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          newPresences.forEach(p => {
            if (p.id !== this.myPlayerInfo.id && !this.connectedPlayers.has(p.id)) {
              this.connectedPlayers.set(p.id, p);
              if (this.onPlayerJoined) this.onPlayerJoined(p);
            }
          });
        })
        .on('presence', { event: 'leave' }, () => {
          // Note: channel.track() emits a transient leave+join pair during ready state updates.
          // True player departures are authoritatively handled in 'sync' above to prevent false disconnects.
        });

      // 2. Broadcast Events (Movement, Aim, Shooting, Round Sync, Ready, Force Start, Lock, Verdict, Settings)
      this.channel
        .on('broadcast', { event: 'player-moved' }, ({ payload }) => {
          if (this.onPlayerMoved) this.onPlayerMoved(payload);
        })
        .on('broadcast', { event: 'round-sync' }, ({ payload }) => {
          if (this.onRoundSync) this.onRoundSync(payload);
        })
        .on('broadcast', { event: 'reveal-fire' }, ({ payload }) => {
          if (this.onReveal) this.onReveal(payload);
        })
        .on('broadcast', { event: 'player-hit' }, ({ payload }) => {
          if (this.onHit) this.onHit(payload);
        })
        .on('broadcast', { event: 'player-ready' }, ({ payload }) => {
          if (this.onPlayerReady) this.onPlayerReady(payload);
        })
        .on('broadcast', { event: 'force-start' }, ({ payload }) => {
          if (this.onForceStart) this.onForceStart(payload);
        })
        .on('broadcast', { event: 'lock-packet' }, ({ payload }) => {
          if (this.onLockPacket) this.onLockPacket(payload);
        })
        .on('broadcast', { event: 'round-verdict' }, ({ payload }) => {
          if (this.onRoundVerdict) this.onRoundVerdict(payload);
        })
        .on('broadcast', { event: 'room-settings' }, ({ payload }) => {
          if (this.onRoomSettings) this.onRoomSettings(payload);
        });

      // Subscribe and track presence
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track(this.myPlayerInfo);
          console.log(`[Supabase] Successfully tracked presence in ${roomId}`);
        }
      });
    } else {
      // Local BroadcastChannel fallback for multi-tab testing
      this.setupLocalFallback(roomId);
    }
  }

  setupLocalFallback(roomId) {
    try {
      this.localBc = new BroadcastChannel(`twisted_party_${roomId}`);
      this.localBc.onmessage = (event) => {
        const { type, data } = event.data;
        if (!data || data.id === this.myPlayerInfo?.id) return;

        if (type === 'player-joined') {
          if (!this.connectedPlayers.has(data.id)) {
            this.connectedPlayers.set(data.id, data);
            if (this.onPlayerJoined) this.onPlayerJoined(data);
            this.syncLocalRoomState();
          }
          // Respond back to newcomer so they receive our presence immediately
          this.localBc.postMessage({
            type: 'player-present',
            data: this.myPlayerInfo
          });
        } else if (type === 'player-present') {
          if (!this.connectedPlayers.has(data.id)) {
            this.connectedPlayers.set(data.id, data);
            if (this.onPlayerJoined) this.onPlayerJoined(data);
            this.syncLocalRoomState();
          }
        } else if (type === 'player-moved') {
          if (this.onPlayerMoved) this.onPlayerMoved(data);
        } else if (type === 'round-sync') {
          if (this.onRoundSync) this.onRoundSync(data);
        } else if (type === 'reveal-fire') {
          if (this.onReveal) this.onReveal(data);
        } else if (type === 'player-ready') {
          const p = this.connectedPlayers.get(data.id);
          if (p) p.isReady = data.isReady;
          if (this.onPlayerReady) this.onPlayerReady(data);
          this.syncLocalRoomState();
        } else if (type === 'force-start') {
          if (this.onForceStart) this.onForceStart(data);
        } else if (type === 'lock-packet') {
          if (this.onLockPacket) this.onLockPacket(data);
        } else if (type === 'round-verdict') {
          if (this.onRoundVerdict) this.onRoundVerdict(data);
        } else if (type === 'room-settings') {
          if (this.onRoomSettings) this.onRoomSettings(data);
        } else if (type === 'player-left') {
          if (data && data.id === this.myPlayerInfo?.id) return;
          this.connectedPlayers.delete(data.id);
          if (this.onPlayerLeft) this.onPlayerLeft(data.id);
          this.syncLocalRoomState();
        }
      };

      // Announce presence locally
      setTimeout(() => {
        this.localBc.postMessage({
          type: 'player-joined',
          data: this.myPlayerInfo
        });
      }, 300);

      this.syncLocalRoomState();
    } catch (e) {
      console.warn('BroadcastChannel not supported', e);
    }
  }

  syncLocalRoomState() {
    const activeList = [this.myPlayerInfo, ...Array.from(this.connectedPlayers.values())];
    activeList.sort((a, b) => {
      const tA = a.joinedAt || 0;
      const tB = b.joinedAt || 0;
      if (tA !== tB) return tA - tB;
      return (a.id || '').localeCompare(b.id || '');
    });

    this.hostId = activeList.length > 0 ? activeList[0].id : this.myPlayerInfo.id;
    this.isHost = (this.myPlayerInfo.id === this.hostId);

    activeList.forEach(p => {
      p.isHost = (p.id === this.hostId);
    });

    if (this.onRoomStateChange) {
      this.onRoomStateChange({
        roomId: this.roomId,
        count: activeList.length,
        max: 5,
        players: activeList,
        hostId: this.hostId,
        isHost: this.isHost
      });
    }
  }

  // Toggle or set ready state for local player
  async setReady(isReady) {
    if (!this.myPlayerInfo) return;
    this.myPlayerInfo.isReady = isReady;

    if (this.channel && this.isConfigured) {
      await this.channel.track(this.myPlayerInfo);
      this.channel.send({
        type: 'broadcast',
        event: 'player-ready',
        payload: { id: this.myPlayerInfo.id, isReady }
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'player-ready',
        data: { id: this.myPlayerInfo.id, isReady }
      });
    }
  }

  // Throttled movement broadcast (20Hz)
  broadcastMovement(pos, rotY) {
    if (!this.myPlayerInfo) return;
    const now = performance.now();
    if (now - this.lastMoveTime < this.moveThrottleMs) return;
    this.lastMoveTime = now;

    const payload = {
      id: this.myPlayerInfo.id,
      name: this.myPlayerInfo.name,
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      rotY: Math.round(rotY * 100) / 100
    };

    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'player-moved',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'player-moved',
        data: payload
      });
    }
  }

  broadcastRoundStart(round) {
    const payload = { round, initiator: this.myPlayerInfo.id };
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'round-sync',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'round-sync',
        data: payload
      });
    }
  }

  broadcastReveal(payload) {
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'reveal-fire',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'reveal-fire',
        data: payload
      });
    }
  }

  broadcastForceStart() {
    const payload = { initiator: this.myPlayerInfo.id, hostId: this.hostId };
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'force-start',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'force-start',
        data: payload
      });
    }
  }

  broadcastLockPacket(payload) {
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'lock-packet',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'lock-packet',
        data: payload
      });
    }
  }

  broadcastRoundVerdict(payload) {
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'round-verdict',
        payload
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'round-verdict',
        data: payload
      });
    }
  }

  broadcastRoomSettings(settings) {
    if (this.channel && this.isConfigured) {
      this.channel.send({
        type: 'broadcast',
        event: 'room-settings',
        payload: settings
      });
    } else if (this.localBc) {
      this.localBc.postMessage({
        type: 'room-settings',
        data: settings
      });
    }
  }

  async leaveRoom() {
    if (this.channel) {
      if (this.isConfigured) {
        await this.channel.untrack();
        await this.channel.unsubscribe();
      }
      this.channel = null;
    }
    if (this.localBc) {
      this.localBc.postMessage({
        type: 'player-left',
        data: { id: this.myPlayerInfo?.id }
      });
      this.localBc.close();
      this.localBc = null;
    }
    this.connectedPlayers.clear();
    this.roomId = null;
  }
}
