/* Procedural audio: every sound is synthesized with WebAudio, so the game
   stays a single self-contained file with no asset downloads. */

type Scene = "off" | "town" | "dungeon" | "combat";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let scene: Scene = "off";
let musicTimer: ReturnType<typeof setInterval> | null = null;
let droneOsc: OscillatorNode[] = [];
let droneGain: GainNode | null = null;

try { muted = localStorage.getItem("ei-muted") === "1"; } catch { /* fine */ }

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
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
  if (!musicTimer) startMusic();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, glideTo?: number): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noiseBurst(dur: number, filterFreq: number, vol: number, delay = 0): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filterFreq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

export type Sfx =
  | "step" | "bump" | "hit" | "crit" | "spell" | "heal" | "chest" | "stairs"
  | "fountain" | "combat" | "victory" | "defeat" | "levelup" | "recruit" | "tap";

export function sfx(name: Sfx): void {
  if (!ensure() || muted) return;
  switch (name) {
    case "step":    noiseBurst(0.06, 500, 0.12); break;
    case "bump":    tone(80, 0.12, "square", 0.15); noiseBurst(0.08, 220, 0.2); break;
    case "hit":     noiseBurst(0.09, 1800, 0.3); tone(160, 0.12, "sawtooth", 0.14, 0, 70); break;
    case "crit":    noiseBurst(0.12, 2600, 0.38); tone(300, 0.2, "sawtooth", 0.2, 0, 60); break;
    case "spell":   tone(220, 0.3, "sawtooth", 0.16, 0, 900); noiseBurst(0.25, 3000, 0.1, 0.05); break;
    case "heal":    [523, 659, 784].forEach((f, i) => tone(f, 0.25, "sine", 0.14, i * 0.09)); break;
    case "chest":   [880, 1175, 1568].forEach((f, i) => tone(f, 0.12, "triangle", 0.16, i * 0.07)); break;
    case "stairs":  [200, 150, 110].forEach((f, i) => tone(f, 0.18, "triangle", 0.15, i * 0.12)); break;
    case "fountain":[660, 880, 990, 1320].forEach((f, i) => tone(f, 0.3, "sine", 0.08, i * 0.08)); break;
    case "combat":  tone(110, 0.4, "sawtooth", 0.2, 0, 55); noiseBurst(0.3, 900, 0.2); break;
    case "victory": [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, "triangle", 0.16, i * 0.12)); break;
    case "defeat":  [220, 185, 147, 110].forEach((f, i) => tone(f, 0.5, "triangle", 0.15, i * 0.25)); break;
    case "levelup": [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "square", 0.08, i * 0.08)); break;
    case "recruit": [392, 494, 587, 784].forEach((f, i) => tone(f, 0.22, "triangle", 0.13, i * 0.09)); break;
    case "tap":     tone(700, 0.04, "sine", 0.05); break;
  }
}

/* ============================== AMBIENT MUSIC ============================== */
/* A low two-oscillator drone plus sparse plucked notes: minor pentatonic in
   the dark, a warmer major lilt in town, a driving pulse in battle. */
const SCALES: Record<Exclude<Scene, "off">, number[]> = {
  dungeon: [110, 130.8, 146.8, 164.8, 196],           // A minor pentatonic
  town:    [146.8, 164.8, 185, 220, 246.9],           // D-ish, warmer
  combat:  [110, 116.5, 146.8, 164.8, 174.6],         // phrygian menace
};

function stopDrone(): void {
  for (const o of droneOsc) { try { o.stop(); } catch { /* ok */ } }
  droneOsc = []; droneGain = null;
}

function startDrone(base: number): void {
  if (!ctx || !master) return;
  stopDrone();
  droneGain = ctx.createGain(); droneGain.gain.value = 0.05;
  droneGain.connect(master);
  for (const detune of [0, 3]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth"; o.frequency.value = base / 2; o.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260;
    o.connect(f); f.connect(droneGain);
    o.start(); droneOsc.push(o);
  }
}

export function setScene(s: Scene): void {
  if (s === scene) return;
  scene = s;
  if (!ctx) return; // will start on unlock()
  if (s === "off") { stopDrone(); return; }
  startDrone(SCALES[s][0]);
}

function startMusic(): void {
  if (musicTimer) return;
  if (scene !== "off" && ctx) startDrone(SCALES[scene as Exclude<Scene, "off">][0]);
  musicTimer = setInterval(() => {
    if (!ctx || muted || scene === "off") return;
    const scale = SCALES[scene as Exclude<Scene, "off">];
    const chance = scene === "combat" ? 0.75 : 0.3;
    if (Math.random() < chance) {
      const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      const type: OscillatorType = scene === "town" ? "triangle" : "sine";
      tone(f, scene === "combat" ? 0.22 : 1.4, type, scene === "combat" ? 0.09 : 0.06);
    }
  }, scene === "combat" ? 300 : 900);
}
