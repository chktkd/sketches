/**
 * 手続き生成の効果音。音源ファイルは使わず、WebAudio だけで鳴らす。
 * ブラウザの自動再生制限のため、最初のユーザー操作で start() する。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineOsc: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private hydroGain!: GainNode;
  private noise!: AudioBuffer;
  private lastThud = 0;
  private lastClatter = 0;
  muted: boolean;

  constructor(private readonly storageKey: string) {
    let m = false;
    try {
      m = localStorage.getItem(storageKey) === '1';
    } catch {
      /* 保存できなくても動かす */
    }
    this.muted = m;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    // ノイズバッファ（ホワイトノイズ 2 秒）
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // エンジン: 低い鋸波 2 本 + ローパス
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    for (const [f, type] of [
      [34, 'sawtooth'],
      [51, 'square'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = type === 'square' ? 0.35 : 0.6;
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // 油圧のうなり: バンドパスのノイズ
    const hs = ctx.createBufferSource();
    hs.buffer = this.noise;
    hs.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 3;
    this.hydroGain = ctx.createGain();
    this.hydroGain.gain.value = 0;
    hs.connect(bp).connect(this.hydroGain).connect(this.master);
    hs.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(this.storageKey, m ? '1' : '0');
    } catch {
      /* 保存できなくても動かす */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** load: 0..1 エンジンの負荷、move: 0..1 走行、arm: 0..1 腕の動き */
  update(load: number, move: number, arm: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 0.55 + load * 0.35 + move * 0.25;
    this.engineOsc[0]!.frequency.setTargetAtTime(30 + rpm * 26, t, 0.1);
    this.engineOsc[1]!.frequency.setTargetAtTime(46 + rpm * 38, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(240 + rpm * 520 + load * 300, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.085 + load * 0.06 + move * 0.03, t, 0.15);
    this.hydroGain.gain.setTargetAtTime(arm * 0.035, t, 0.08);
  }

  private burst(
    freq: number,
    q: number,
    gain: number,
    dur: number,
    type: BiquadFilterType = 'lowpass',
    pitchDrop = 0
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    if (pitchDrop)
      f.frequency.exponentialRampToValueAtTime(
        Math.max(40, freq * pitchDrop),
        ctx.currentTime + dur
      );
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(ctx.currentTime, Math.random());
    s.stop(ctx.currentTime + dur + 0.05);
  }

  /** 重い衝撃: strength 0..1, near 0..1（カメラからの近さ） */
  thud(strength: number, near: number) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastThud < 0.045) return;
    this.lastThud = now;
    const g = strength * (0.25 + near * 0.75);
    this.burst(260 + strength * 500, 0.8, 0.5 * g, 0.35 + strength * 0.5, 'lowpass', 0.12);
    // 低音のドスン
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90 + strength * 40, now);
    o.frequency.exponentialRampToValueAtTime(28, now + 0.35);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.55 * g, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);
    o.connect(og).connect(this.master);
    o.start(now);
    o.stop(now + 0.45);
  }

  /** コンクリート片が転がるカラカラ音 */
  clatter(strength: number, near: number) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClatter < 0.03) return;
    this.lastClatter = now;
    this.burst(1800 + Math.random() * 2600, 2.5, 0.08 * strength * near, 0.07, 'bandpass');
  }

  /** ビルの崩壊: 長い地鳴り */
  rumble(strength: number, near: number) {
    if (!this.ctx || this.muted) return;
    this.burst(180, 0.7, 0.55 * strength * (0.3 + 0.7 * near), 2.6, 'lowpass', 0.25);
    this.burst(900, 0.6, 0.2 * strength * near, 1.4, 'lowpass', 0.2);
  }
}
