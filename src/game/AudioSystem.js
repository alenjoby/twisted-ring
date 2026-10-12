const AJP_SONG_FILES = [
  '/CHARACTER-SONG/AJP SONG 1.mp3',
  '/CHARACTER-SONG/AJP SONG 2.mp3',
  '/CHARACTER-SONG/AJP SONG 3.mp3',
  '/CHARACTER-SONG/AJP SONG 4.mp3'
];

// Web Audio API Synthesizer for procedural SFX
class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ajpPlaylistQueue = [];
    this.lastAjpSong = null;
    this.currentAjpAudio = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playCountdownTick(isFinal = false) {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const freq = isFinal ? 880 : 440;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (isFinal ? 0.35 : 0.15));

      osc.start();
      osc.stop(this.ctx.currentTime + (isFinal ? 0.35 : 0.15));
    } catch (e) {}
  }

  playLaserShot() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const t = this.ctx.currentTime;
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.25);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.start(t);
      osc.stop(t + 0.25);
    } catch (e) {}
  }

  playHitImpact() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const t = this.ctx.currentTime;
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);

      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      osc.start(t);
      osc.stop(t + 0.4);
    } catch (e) {}
  }

  playCinematicElimination() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      // Deep sub-bass impact drop
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.frequency.setValueAtTime(130, t);
      subOsc.frequency.exponentialRampToValueAtTime(28, t + 0.7);
      subGain.gain.setValueAtTime(0.65, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      subOsc.start(t);
      subOsc.stop(t + 0.7);

      // Heavy metallic strike impact
      const hitOsc = this.ctx.createOscillator();
      const hitGain = this.ctx.createGain();
      hitOsc.type = 'sawtooth';
      hitOsc.connect(hitGain);
      hitGain.connect(this.ctx.destination);
      hitOsc.frequency.setValueAtTime(340, t);
      hitOsc.frequency.exponentialRampToValueAtTime(45, t + 0.38);
      hitGain.gain.setValueAtTime(0.45, t);
      hitGain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      hitOsc.start(t);
      hitOsc.stop(t + 0.38);
    } catch (e) {}
  }

  playRingShrink() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const t = this.ctx.currentTime;
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.linearRampToValueAtTime(300, t + 0.8);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

      osc.start(t);
      osc.stop(t + 0.8);
    } catch (e) {}
  }

  playVictoryFanfare() {
    if (!this.enabled || !this.ctx) return;
    try {
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const t = this.ctx.currentTime + i * 0.12;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        osc.start(t);
        osc.stop(t + 0.35);
      });
    } catch (e) {}
  }

  playPlayerJoined() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.start(t);
      osc.stop(t + 0.22);
    } catch (e) {}
  }

  playPlayerLeft() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.18);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t);
      osc.stop(t + 0.25);
    } catch (e) {}
  }

  playReadyClick() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.start(t);
      osc.stop(t + 0.14);
    } catch (e) {}
  }

  playUnreadyClick() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.1);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch (e) {}
  }

  playForceStartWarning() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      [0, 0.14, 0.28].forEach(delay => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(680, t + delay);
        gain.gain.setValueAtTime(0.24, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.11);
        osc.start(t + delay);
        osc.stop(t + delay + 0.11);
      });
    } catch (e) {}
  }

  playFootstep(isSprint = false) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      const baseFreq = isSprint ? 135 : 105;
      const pitchJitter = (Math.random() - 0.5) * 18;
      osc.frequency.setValueAtTime(baseFreq + pitchJitter, t);
      osc.frequency.exponentialRampToValueAtTime(34, t + 0.065);

      gain.gain.setValueAtTime(isSprint ? 0.13 : 0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

      osc.start(t);
      osc.stop(t + 0.065);
    } catch (e) {}
  }

  playEmoteSound(emoteType = 'HYPE', characterId = 'ajp') {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;

      // 1. Doggesh Bhair (Playful double canine bark & yip)
      if (characterId === 'dog') {
        [0, 0.12].forEach((offset, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const startFreq = idx === 0 ? 320 : 360;
          osc.frequency.setValueAtTime(startFreq, t + offset);
          osc.frequency.exponentialRampToValueAtTime(480, t + offset + 0.035);
          osc.frequency.exponentialRampToValueAtTime(140, t + offset + 0.1);
          gain.gain.setValueAtTime(0.25, t + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.1);
          osc.start(t + offset);
          osc.stop(t + offset + 0.1);
        });
        return;
      }

      // 2. KuchuPuchu (Chirpy melodic gnome laugh wobble)
      if (characterId === 'kuchupuchu') {
        [0, 0.08, 0.16].forEach((offset, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const chirpFreq = idx === 0 ? 740 : (idx === 1 ? 1120 : 880);
          osc.frequency.setValueAtTime(chirpFreq, t + offset);
          osc.frequency.exponentialRampToValueAtTime(chirpFreq * 1.35, t + offset + 0.035);
          osc.frequency.exponentialRampToValueAtTime(chirpFreq * 0.9, t + offset + 0.075);
          gain.gain.setValueAtTime(0.24, t + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.075);
          osc.start(t + offset);
          osc.stop(t + offset + 0.075);
        });
        return;
      }

      // 3. AJP (Signature deep punchline sub-boom + hype synth airhorn)
      if (characterId === 'ajp') {
        // Deep punchline sub-boom
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.connect(subGain);
        subGain.connect(this.ctx.destination);
        subOsc.frequency.setValueAtTime(95, t);
        subOsc.frequency.exponentialRampToValueAtTime(32, t + 0.32);
        subGain.gain.setValueAtTime(0.35, t);
        subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        subOsc.start(t);
        subOsc.stop(t + 0.32);

        // Brassy hype airhorn chord
        [466.16, 622.25, 932.33].forEach(freq => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.frequency.setValueAtTime(freq, t + 0.04);
          gain.gain.setValueAtTime(0.12, t + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
          osc.start(t + 0.04);
          osc.stop(t + 0.34);
        });
        return;
      }

      // 4. Big Vegas (Retro 70s funk brass horn fanfare slide)
      if (characterId === 'big_vegas') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(349.23, t);
        osc.frequency.exponentialRampToValueAtTime(523.25, t + 0.14);
        osc.frequency.setValueAtTime(523.25, t + 0.22);
        osc.frequency.exponentialRampToValueAtTime(698.46, t + 0.36);
        gain.gain.setValueAtTime(0.24, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        osc.start(t);
        osc.stop(t + 0.42);
        return;
      }

      // 5. Knight (Heavy metallic sword unsheathe & shield strike)
      if (characterId === 'knight') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(1400, t);
        osc.frequency.exponentialRampToValueAtTime(2800, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(450, t + 0.28);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.start(t);
        osc.stop(t + 0.28);
        return;
      }

      // 6. Peasant Girl (Playful woodwind flute trill)
      if (characterId === 'peasant_girl') {
        [587.33, 659.25, 587.33, 783.99].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const start = t + idx * 0.065;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.22, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.095);
          osc.start(start);
          osc.stop(start + 0.095);
        });
        return;
      }

      // Generic Emote Fallback
      const freqs = emoteType === 'TAUNT' ? [520, 390]
        : emoteType === 'DANCE' ? [440, 554.37, 659.25]
        : emoteType === 'JUMP' ? [340, 680]
        : [587.33, 880];

      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        const start = t + idx * 0.075;
        osc.frequency.setValueAtTime(f, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
        osc.start(start);
        osc.stop(start + 0.12);
      });
    } catch (e) {}
  }

  playHeartbeat(intensity = 1.0) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      // Lub (First lower pulse)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.frequency.setValueAtTime(68, t);
      osc1.frequency.exponentialRampToValueAtTime(36, t + 0.1);
      gain1.gain.setValueAtTime(0.32 * intensity, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc1.start(t);
      osc1.stop(t + 0.1);

      // Dub (Second higher pulse 0.12s later)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.frequency.setValueAtTime(56, t + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(32, t + 0.22);
      gain2.gain.setValueAtTime(0.26 * intensity, t + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc2.start(t + 0.12);
      osc2.stop(t + 0.22);
    } catch (e) {}
  }

  playCrowdGasp() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      // Resonant formant intake swoop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(380, t);
      osc.frequency.exponentialRampToValueAtTime(740, t + 0.25);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.start(t);
      osc.stop(t + 0.32);

      // High-speed near-miss whoosh
      const whoosh = this.ctx.createOscillator();
      const wGain = this.ctx.createGain();
      whoosh.type = 'sine';
      whoosh.connect(wGain);
      wGain.connect(this.ctx.destination);
      whoosh.frequency.setValueAtTime(1250, t);
      whoosh.frequency.exponentialRampToValueAtTime(260, t + 0.28);
      wGain.gain.setValueAtTime(0.22, t);
      wGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      whoosh.start(t);
      whoosh.stop(t + 0.28);
    } catch (e) {}
  }

  playCrowdCheer() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      // Low stadium rumble
      const bass = this.ctx.createOscillator();
      const bGain = this.ctx.createGain();
      bass.type = 'sine';
      bass.connect(bGain);
      bGain.connect(this.ctx.destination);
      bass.frequency.setValueAtTime(85, t);
      bass.frequency.linearRampToValueAtTime(140, t + 0.6);
      bGain.gain.setValueAtTime(0.28, t);
      bGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      bass.start(t);
      bass.stop(t + 0.7);

      // Ascending triumphant harmony chords
      [330, 440, 554.37, 660].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(freq, t + idx * 0.04);
        gain.gain.setValueAtTime(0.14, t + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t + idx * 0.04);
        osc.stop(t + 0.65);
      });
    } catch (e) {}
  }

  playAnnouncerCue(type = 'engage') {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      if (type === 'engage') {
        // Fast energetic rising fanfare
        [440, 554.37, 659.25, 880].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const start = t + idx * 0.055;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.16, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
          osc.start(start);
          osc.stop(start + 0.22);
        });
      } else if (type === 'close_shave') {
        // Rapid dual warning ping
        [880, 1174.66].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const start = t + idx * 0.06;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.2, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
          osc.start(start);
          osc.stop(start + 0.14);
        });
      } else if (type === 'match_point') {
        // High stakes dramatic brass strike
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const start = t + idx * 0.07;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.22, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
          osc.start(start);
          osc.stop(start + 0.38);
        });
      } else if (type === 'stalemate') {
        // Tension chord resolving down
        [440, 370, 311.13].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const start = t + idx * 0.08;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.2, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.26);
          osc.start(start);
          osc.stop(start + 0.26);
        });
      }
    } catch (e) {}
  }

  playSlowMoFinish() {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(32, t + 1.05);
      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
      osc.start(t);
      osc.stop(t + 1.05);
    } catch (e) {}
  }

  getNextAjpSongUrl() {
    if (this.ajpPlaylistQueue.length === 0) {
      const pool = [...AJP_SONG_FILES];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (pool[0] === this.lastAjpSong && pool.length > 1) {
        pool.push(pool.shift());
      }
      this.ajpPlaylistQueue = pool;
    }
    const nextSong = this.ajpPlaylistQueue.shift();
    this.lastAjpSong = nextSong;
    return nextSong;
  }

  playAjpCelebration() {
    if (!this.enabled) return;
    this.stopAjpCelebration();

    try {
      const url = this.getNextAjpSongUrl();
      const audio = new Audio(url);
      audio.volume = 0.85;
      audio.loop = false;
      this.currentAjpAudio = audio;
      audio.play().catch(e => {
        console.warn('[AudioSystem] AJP song play deferred:', e);
      });
    } catch (e) {
      console.warn('[AudioSystem] Error playing AJP song:', e);
    }
  }

  stopAjpCelebration() {
    if (this.currentAjpAudio) {
      try {
        const audio = this.currentAjpAudio;
        let vol = audio.volume;
        const fadeInterval = setInterval(() => {
          vol = Math.max(0, vol - 0.15);
          audio.volume = vol;
          if (vol <= 0.05) {
            clearInterval(fadeInterval);
            audio.pause();
            audio.currentTime = 0;
          }
        }, 30);
      } catch (e) {
        try {
          this.currentAjpAudio.pause();
          this.currentAjpAudio.currentTime = 0;
        } catch (err) {}
      }
      this.currentAjpAudio = null;
    }
  }
}

export const audioSystem = new AudioSystem();

