// Web Audio API Synthesizer for procedural SFX
class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
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
      if (characterId === 'dog') {
        // Synthesized double bark for Doggesh Bhair
        [0, 0.13].forEach((offset, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          const startFreq = idx === 0 ? 310 : 350;
          osc.frequency.setValueAtTime(startFreq, t + offset);
          osc.frequency.exponentialRampToValueAtTime(460, t + offset + 0.035);
          osc.frequency.exponentialRampToValueAtTime(140, t + offset + 0.1);
          gain.gain.setValueAtTime(0.22, t + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.1);
          osc.start(t + offset);
          osc.stop(t + offset + 0.1);
        });
        return;
      }

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
}

export const audioSystem = new AudioSystem();

