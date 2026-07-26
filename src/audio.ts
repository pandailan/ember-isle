/* Procedural audio v2: everything is synthesized with WebAudio — no samples,
   no downloads. New in v2: a generated-impulse reverb so the caves sound like
   caves, a lookahead music scheduler playing real progressions per scene
   (chords, bass, lead, drums in battle), an echo send for melodies, and
   layered, biome-aware sound effects. */

export type Scene = "off" | "town" | "dungeon" | "deep" | "combat";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;       // reverb return
let echo: DelayNode | null = null;     // melody echo send
let echoGain: GainNode | null = null;
let muted = false;
let scene: Scene = "off";

try { muted = localStorage.getItem("ei-muted") === "1"; } catch { /* fine */ }

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
    // cavernous reverb from a generated impulse response
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 2.2, 3.5);
    wet = ctx.createGain(); wet.gain.value = 0.25;
    verb.connect(wet); wet.connect(master);
    dryVerbIn = verb;
    // echo for melodies
    echo = ctx.createDelay(1); echo.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    echo.connect(fb); fb.connect(echo);
    echoGain = ctx.createGain(); echoGain.gain.value = 0.5;
    echo.connect(echoGain); echoGain.connect(dry); echoGain.connect(verb);
  } catch { ctx = null; }
  return ctx;
}
let dryVerbIn: ConvolverNode | null = null;

function makeImpulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = c.sampleRate, len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function isMuted(): boolean { return muted; }
export function toggleMute(): boolean {
  muted = !muted;
  try { localStorage.setItem("ei-muted", muted ? "1" : "0"); } catch { /* fine */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  return muted;
}

/** iOS unlocks audio only inside a user gesture — call from a pointer handler. */
export function unlock(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
  startScheduler();
}

/* ============================== VOICES ============================== */
interface Patch { type: OscillatorType; cutoff: number; a: number; r: number; toEcho?: boolean; }

function note(freq: number, t0: number, dur: number, vol: number, patch: Patch): void {
  if (!ctx || !dry || muted || freq <= 0) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = patch.type; o.frequency.setValueAtTime(freq, t0);
  f.type = "lowpass"; f.frequency.value = patch.cutoff;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + patch.a);
  g.gain.setValueAtTime(vol, Math.max(t0 + patch.a, t0 + dur - patch.r));
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  o.connect(f); f.connect(g);
  g.connect(dry);
  if (dryVerbIn) g.connect(dryVerbIn);
  if (patch.toEcho && echo) g.connect(echo);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noiseHit(t0: number, dur: number, vol: number, freq: number, kind: BiquadFilterType = "lowpass"): void {
  if (!ctx || !dry || muted) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = kind; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(dry);
  if (dryVerbIn) g.connect(dryVerbIn);
  src.start(t0);
}

function kick(t0: number, vol = 0.5): void {
  if (!ctx || !dry || muted) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t0);
  o.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  o.connect(g); g.connect(dry);
  o.start(t0); o.stop(t0 + 0.3);
}

/* ============================== MUSIC ============================== */
/* Chords as semitone offsets from a root; progressions loop bar by bar. */
const N = (root: number, semi: number) => root * Math.pow(2, semi / 12);

interface SceneMusic {
  bpm: number;
  root: number;                 // root frequency
  bars: number[][];             // chord per bar, as semitone stacks
  scale: number[];              // melody pool (semitones)
  leadDensity: number;          // chance a melody 8th fires
  leadPatch: Patch; padPatch: Patch; bassPatch: Patch;
  drums: boolean;
  wet: number;                  // reverb level for the scene
  padVol: number; bassVol: number; leadVol: number;
}

const MUSIC: Record<Exclude<Scene, "off">, SceneMusic> = {
  town: {
    bpm: 84, root: 146.83, // D
    bars: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]],
    scale: [0, 2, 4, 7, 9, 12, 14],
    leadDensity: 0.34,
    leadPatch: {type: "triangle", cutoff: 2400, a: 0.02, r: 0.1, toEcho: true},
    padPatch: {type: "sine", cutoff: 900, a: 0.6, r: 0.8},
    bassPatch: {type: "triangle", cutoff: 500, a: 0.03, r: 0.12},
    drums: false, wet: 0.16, padVol: 0.05, bassVol: 0.1, leadVol: 0.07,
  },
  dungeon: {
    bpm: 64, root: 110, // A minor
    bars: [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-4, 0, 3]],
    scale: [0, 3, 5, 7, 10, 12, 15],
    leadDensity: 0.16,
    leadPatch: {type: "sine", cutoff: 1800, a: 0.03, r: 0.3, toEcho: true},
    padPatch: {type: "sawtooth", cutoff: 320, a: 1.2, r: 1.4},
    bassPatch: {type: "sine", cutoff: 300, a: 0.05, r: 0.3},
    drums: false, wet: 0.34, padVol: 0.035, bassVol: 0.09, leadVol: 0.055,
  },
  deep: {
    bpm: 56, root: 98, // G phrygian menace
    bars: [[0, 1, 7], [0, 1, 7], [-2, 3, 8], [0, 1, 6]],
    scale: [0, 1, 3, 5, 7, 8, 12],
    leadDensity: 0.12,
    leadPatch: {type: "sine", cutoff: 1400, a: 0.05, r: 0.5, toEcho: true},
    padPatch: {type: "sawtooth", cutoff: 240, a: 1.6, r: 1.8},
    bassPatch: {type: "sine", cutoff: 240, a: 0.06, r: 0.4},
    drums: false, wet: 0.42, padVol: 0.045, bassVol: 0.1, leadVol: 0.05,
  },
  combat: {
    bpm: 138, root: 110,
    bars: [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [1, 4, 8]],
    scale: [0, 3, 5, 7, 10, 12],
    leadDensity: 0.3,
    leadPatch: {type: "square", cutoff: 1500, a: 0.01, r: 0.06},
    padPatch: {type: "sawtooth", cutoff: 420, a: 0.2, r: 0.3},
    bassPatch: {type: "sawtooth", cutoff: 380, a: 0.01, r: 0.08},
    drums: true, wet: 0.24, padVol: 0.03, bassVol: 0.11, leadVol: 0.05,
  },
};

let schedTimer: ReturnType<typeof setInterval> | null = null;
let nextBeat = 0;      // absolute ctx time of the next 8th note
let beatIndex = 0;     // running 8th-note counter

export function setScene(s: Scene): void {
  if (s === scene) return;
  scene = s;
  beatIndex = 0;
  if (ctx) nextBeat = ctx.currentTime + 0.1;
  if (wet && ctx && s !== "off") wet.gain.setTargetAtTime(MUSIC[s].wet, ctx.currentTime, 0.5);
}

function startScheduler(): void {
  if (schedTimer || !ctx) return;
  nextBeat = ctx.currentTime + 0.1;
  schedTimer = setInterval(() => {
    if (!ctx || muted || scene === "off") return;
    const m = MUSIC[scene];
    const eighth = 30 / m.bpm; // seconds per 8th note
    while (nextBeat < ctx.currentTime + 0.35) {
      scheduleBeat(m, nextBeat, beatIndex);
      nextBeat += eighth;
      beatIndex++;
    }
  }, 120);
}

function scheduleBeat(m: SceneMusic, t: number, beat: number): void {
  const bar = Math.floor(beat / 8) % m.bars.length;
  const chord = m.bars[bar];
  const inBar = beat % 8;
  // pad: one breath per bar
  if (inBar === 0) {
    for (const semi of chord) note(N(m.root, semi) * 2, t, (30 / m.bpm) * 8.5, m.padVol, m.padPatch);
  }
  // bass: roots on the pulse (combat drives eighths, elsewhere halves)
  const bassOn = m.drums ? true : inBar % 4 === 0;
  if (bassOn) note(N(m.root, chord[0]), t, m.drums ? 0.16 : 1.1, m.bassVol, m.bassPatch);
  // lead: wandering phrase notes from the scale
  if (Math.random() < m.leadDensity && inBar !== 0) {
    const semi = m.scale[Math.floor(Math.random() * m.scale.length)];
    const octave = Math.random() < 0.3 ? 4 : 2;
    note(N(m.root, semi) * octave, t, m.drums ? 0.14 : 0.9, m.leadVol, m.leadPatch);
  }
  // drums (combat only)
  if (m.drums) {
    if (inBar === 0 || inBar === 4) kick(t, 0.4);
    if (inBar === 2 || inBar === 6) noiseHit(t, 0.09, 0.16, 1800, "bandpass");
    if (inBar % 2 === 1) noiseHit(t, 0.03, 0.06, 6000, "highpass");
  }
}

/* ============================== SFX ============================== */
export type Sfx =
  | "step" | "bump" | "hit" | "crit" | "spell" | "heal" | "chest" | "stairs"
  | "fountain" | "combat" | "victory" | "defeat" | "levelup" | "recruit" | "tap";

export function sfx(name: Sfx): void {
  if (!ensure() || muted || !ctx) return;
  const t = ctx.currentTime;
  const q = (f: number, dur: number, type: OscillatorType, vol: number, delay = 0, patch?: Partial<Patch>) =>
    note(f, t + delay, dur, vol, {type, cutoff: patch?.cutoff ?? 2500, a: patch?.a ?? 0.008, r: patch?.r ?? dur * 0.6, toEcho: patch?.toEcho});
  switch (name) {
    case "step":    noiseHit(t, 0.05, scene === "town" ? 0.16 : 0.1, scene === "town" ? 900 : 480); break;
    case "bump":    q(75, 0.12, "square", 0.16); noiseHit(t, 0.08, 0.2, 220); break;
    case "hit":     noiseHit(t, 0.08, 0.3, 1900); q(150, 0.12, "sawtooth", 0.15); noiseHit(t + 0.02, 0.05, 0.12, 4000, "highpass"); break;
    case "crit":    noiseHit(t, 0.12, 0.36, 2600); q(300, 0.2, "sawtooth", 0.2); q(90, 0.24, "sine", 0.25); break;
    case "spell":   q(220, 0.35, "sawtooth", 0.15, 0, {toEcho: true}); noiseHit(t + 0.05, 0.3, 0.1, 3200, "bandpass"); break;
    case "heal":    [523, 659, 784].forEach((f, i) => q(f, 0.3, "sine", 0.13, i * 0.09, {toEcho: true})); break;
    case "chest":   [880, 1175, 1568].forEach((f, i) => q(f, 0.14, "triangle", 0.15, i * 0.07)); noiseHit(t, 0.06, 0.1, 700); break;
    case "stairs":  [200, 150, 110].forEach((f, i) => q(f, 0.2, "triangle", 0.14, i * 0.12)); break;
    case "fountain":[660, 880, 990, 1320].forEach((f, i) => q(f, 0.35, "sine", 0.07, i * 0.08, {toEcho: true})); break;
    case "combat":  q(110, 0.5, "sawtooth", 0.2); q(55, 0.7, "sine", 0.3); noiseHit(t, 0.35, 0.2, 800); break;
    case "victory": [392, 523, 659, 784].forEach((f, i) => q(f, 0.32, "triangle", 0.15, i * 0.12, {toEcho: true})); break;
    case "defeat":  [220, 185, 147, 110].forEach((f, i) => q(f, 0.55, "triangle", 0.14, i * 0.25)); break;
    case "levelup": [523, 659, 784, 1047].forEach((f, i) => q(f, 0.22, "square", 0.07, i * 0.08, {cutoff: 1800})); break;
    case "recruit": [392, 494, 587, 784].forEach((f, i) => q(f, 0.24, "triangle", 0.12, i * 0.09)); break;
    case "tap":     q(700, 0.04, "sine", 0.05); break;
  }
}
