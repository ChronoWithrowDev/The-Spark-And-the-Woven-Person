// Gentle ambient sound: a soft blue-green pad plus small warm chimes
// when a spark arrives or goes out. Entirely synthesised — no assets.

export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padNodes: Array<OscillatorNode | AudioBufferSourceNode> = [];
  enabled = false;

  private ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.ensure();
    if (!this.ctx || !this.master) return;
    if (on) {
      void this.ctx.resume();
      if (this.padNodes.length === 0) this.startPad();
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 1.6);
    } else {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.6);
    }
  }

  private startPad() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    // low, quiet detuned sines — a deep blue-green hum
    const freqs = [73.4, 110, 146.8, 220.5];
    const gains = [0.05, 0.042, 0.028, 0.012];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * (1 + (i % 2 === 0 ? 0.0012 : -0.0015));
      const g = ctx.createGain();
      g.gain.value = gains[i];
      // very slow amplitude breathing
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.023;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = gains[i] * 0.45;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(master);
      osc.start();
      lfo.start();
      this.padNodes.push(osc, lfo);
    });
    // soft filtered air
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 360;
    const ng = ctx.createGain();
    ng.gain.value = 0.02;
    noise.connect(lp);
    lp.connect(ng);
    ng.connect(master);
    noise.start();
    this.padNodes.push(noise);
  }

  /** A small warm chime — pitch loosely tied to the spark's hue. */
  chime(hue: number, soft = false, quick = false) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const base = 440 + ((hue * 7.3) % 220);
    const now = ctx.currentTime;
    [1, 2.01].forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * mult;
      const g = ctx.createGain();
      const peak = (quick ? 0.024 : soft ? 0.05 : 0.1) / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.025);
      const decay = quick ? 1.0 : soft ? 1.6 : 2.6;
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g);
      g.connect(this.master as GainNode);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    });
  }

  /** The watch, alone in the field: a very quiet tick. */
  tick() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 2100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.018, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** The watch closes: a warm, open chord. */
  forge() {
    if (!this.enabled) return;
    [0, 0.09, 0.2].forEach((d, i) => {
      setTimeout(() => this.chime([44, 20, 60][i]), d * 1000);
    });
  }

  dispose() {
    for (const n of this.padNodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.padNodes = [];
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
}
