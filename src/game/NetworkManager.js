import Pusher from 'pusher-js';

export class NetworkManager {
  constructor({ onPlayerJoined, onPlayerMoved, onRoundSync, onReveal, onReset }) {
    this.onPlayerJoined = onPlayerJoined;
    this.onPlayerMoved = onPlayerMoved;
    this.onRoundSync = onRoundSync;
    this.onReveal = onReveal;
    this.onReset = onReset;

    this.pusher = null;
    this.channel = null;
    this.isPusherConnected = false;

    // Local tab-to-tab real-time network using BroadcastChannel
    this.localBroadcast = new BroadcastChannel('twisted_party_ring');
    this.localBroadcast.onmessage = (e) => this.handleMessage(e.data);
  }

  initPusher(appKey, cluster, channelName = 'presence-twisted-ring') {
    if (!appKey) return;
    try {
      this.pusher = new Pusher(appKey, {
        cluster: cluster || 'mt1',
        channelAuthorization: {
          endpoint: '/api/pusher/auth',
          transport: 'jsonp'
        }
      });

      this.channel = this.pusher.subscribe(channelName);
      this.channel.bind('pusher:subscription_succeeded', () => {
        this.isPusherConnected = true;
        console.log('Connected to Pusher channel:', channelName);
      });

      this.channel.bind('client-player-moved', (data) => this.handleMessage({ type: 'player-moved', ...data }));
      this.channel.bind('client-round-sync', (data) => this.handleMessage({ type: 'round-sync', ...data }));
      this.channel.bind('client-reveal', (data) => this.handleMessage({ type: 'reveal', ...data }));
    } catch (err) {
      console.warn('Pusher initialization error:', err);
    }
  }

  broadcast(message) {
    // Send via local broadcast channel
    this.localBroadcast.postMessage(message);

    // Send via Pusher if connected
    if (this.channel && this.isPusherConnected) {
      try {
        if (message.type === 'player-moved') {
          this.channel.trigger('client-player-moved', message);
        } else if (message.type === 'round-sync') {
          this.channel.trigger('client-round-sync', message);
        } else if (message.type === 'reveal') {
          this.channel.trigger('client-reveal', message);
        }
      } catch (e) {}
    }
  }

  handleMessage(data) {
    if (!data || !data.type) return;

    if (data.type === 'player-joined' && this.onPlayerJoined) {
      this.onPlayerJoined(data);
    } else if (data.type === 'player-moved' && this.onPlayerMoved) {
      this.onPlayerMoved(data);
    } else if (data.type === 'round-sync' && this.onRoundSync) {
      this.onRoundSync(data);
    } else if (data.type === 'reveal' && this.onReveal) {
      this.onReveal(data);
    } else if (data.type === 'reset' && this.onReset) {
      this.onReset(data);
    }
  }
}
