/* The WebGL world: real geometry, per-pixel point lights over normal-mapped
   procedural stone, fog, bloom, and a camera that glides instead of teleporting.
   All game logic stays untouched — this module only reads `state` each frame. */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { MAPS, TOWN_DOORS, ENEMIES } from "./data";
import { state, cellAt } from "./state";
import { biomeFor, biomeTextures, biomeNormalMaps, biomeFloorTexture, type Biome } from "./biomes";
import { ASSETS, FEATURE_ASSET, bindAssetFx } from "./assets3d";
import { net } from "./net";
import { reduceMotion, rnd } from "./util";
import { groundLevelAt, hasElevation } from "./terrain";
import { hourOf } from "./daytime";
import { sfx } from "./audio";

/* ---------- deterministic per-cell hash (matches the old renderer) ---------- */
const cellHash = (x: number, y: number) => ((x * 7349 + y * 9151 + x * y * 41) >>> 0);

const groundHAt = (wx: number, wz: number): number => groundLevelAt(state.level, wx, wz);

/* ---------- module state ---------- */
let renderer: THREE.WebGLRenderer | null = null;
let composer: EffectComposer | null = null;
let bloom: UnrealBloomPass | null = null;
let grade: ShaderPass | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let worldGroup: THREE.Group;          // rebuilt per level
let builtLevel = -99;
let playerLight: THREE.PointLight;
let ambient: THREE.AmbientLight;
let hemi: THREE.HemisphereLight;
let animT = 0;

/* dynamic light pool: the nearest flames get real PointLights */
interface LightAnchor { pos: THREE.Vector3; color: number; intensity: number; distance: number; flicker: number; phase: number; }
let anchors: LightAnchor[] = [];
const POOL_SIZE = 6;
let lightPool: THREE.PointLight[] = [];

/* things that need a per-frame look */
interface Consumable { mesh: THREE.Object3D; cellX: number; cellY: number; char: string; }
let consumables: Consumable[] = [];
let fireGroup: {lit: THREE.Object3D; cold: THREE.Object3D} | null = null;
let flameSprites: {sprite: THREE.Sprite; base: number; phase: number}[] = [];

/* mob sprite pool */
interface MobView { sprite: THREE.Sprite; shadow: THREE.Mesh; cur: THREE.Vector3; key: string; }
let mobViews: MobView[] = [];

/* ---------- in-world combat: foes square up in the corridor ---------- */
interface FoeView { key: string; hp: number; maxhp: number; boss?: boolean; }
interface FoeSprite {
  sp: THREE.Sprite; bar: THREE.Sprite; barCv: HTMLCanvasElement; barTex: THREE.CanvasTexture;
  lastHp: number; flash: number; key: string;
}
let combatFoes: FoeView[] | null = null;
let foeSprites: FoeSprite[] = [];
let pops3d: {sp: THREE.Sprite; t: number}[] = [];

/** Which living foe a viewport point (0..1 across) points at, if any. */
export function foeIndexAtX(frac: number): number | null {
  if (!camera || !foeSprites.length) return null;
  const v = new THREE.Vector3();
  let best: number | null = null, bd = 0.3;
  for (let i = 0; i < foeSprites.length; i++) {
    if (combatFoes?.[i] && combatFoes[i].hp <= 0) continue;
    v.copy(foeSprites[i].sp.position).project(camera);
    const d = Math.abs((v.x + 1) / 2 - frac);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function showCombat(foes: FoeView[] | null): void {
  combatFoes = foes;
  if (!foes) {
    for (const f of foeSprites) { scene.remove(f.sp); scene.remove(f.bar); }
    foeSprites = [];
    for (const p of pops3d) scene.remove(p.sp);
    pops3d = [];
  }
}

const POP_HUES: Record<string, string> = {crit: "#ffb44c", spell: "#8fc4e8", heal: "#9fd06a", "": "#e8d9b0"};
export function combatPop(idx: number, text: string, cls: string): void {
  const anchor = foeSprites[idx];
  if (!anchor || !scene) return;
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 48;
  const c = cv.getContext("2d")!;
  c.font = "bold 30px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.strokeStyle = "rgba(0,0,0,.8)"; c.lineWidth = 5; c.strokeText(text, 64, 24);
  c.fillStyle = POP_HUES[cls] ?? POP_HUES[""]; c.fillText(text, 64, 24);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false}));
  sp.position.copy(anchor.sp.position).add(new THREE.Vector3((rnd() - 0.5) * 0.14, 0.26, 0));
  sp.scale.set(0.42, 0.16, 1);
  scene.add(sp);
  pops3d.push({sp, t: 0});
  anchor.flash = 1; // the blow lands visibly
}

function drawFoeBar(f: FoeSprite, hp: number, maxhp: number): void {
  const c = f.barCv.getContext("2d")!;
  c.clearRect(0, 0, 64, 10);
  c.fillStyle = "rgba(10,7,5,.8)"; c.fillRect(0, 0, 64, 10);
  const k = Math.max(0, hp / maxhp);
  c.fillStyle = k > 0.5 ? "#8fae6a" : k > 0.25 ? "#e0b24c" : "#c8502f";
  c.fillRect(1.5, 1.5, 61 * k, 7);
  f.barTex.needsUpdate = true;
}

/* signpost labels fade out when you stand under them */
let labels: {sprite: THREE.Sprite; pos: THREE.Vector3}[] = [];

/* living ground cover: things that sway in the wind or shimmer wet */
let swayers: {o: THREE.Object3D; base: number; amp: number; phase: number; wx: number; wz: number}[] = [];
let shimmers: {m: THREE.MeshStandardMaterial; base: number; phase: number}[] = [];
let windK = 1; // the weather leans on the wind
function sway(o: THREE.Object3D, amp: number, wx = 0, wz = 0): void {
  swayers.push({o, base: o.rotation.z, amp, phase: rnd() * 6.28, wx, wz});
}

/* cloud shadows drifting over open ground */
let cloudMesh: THREE.Mesh | null = null;
let cloudMat: THREE.MeshBasicMaterial | null = null;
let cloudTex: THREE.CanvasTexture | null = null;
let cloudA = 0; // current target opacity, eased in frame

/* the lighthouse turns all night on its rock */
let lhBeacon: THREE.Group | null = null;
let lhBeamMat: THREE.MeshBasicMaterial | null = null;
let lhLampMat: THREE.MeshStandardMaterial | null = null;
let lhGlow: THREE.Sprite | null = null;

function buildLighthouse(px: number, pz: number): void {
  const g = new THREE.Group(); g.position.set(px, 0, pz);
  ASSETS.lighthouse({group: g, x: 0, z: 0, hash: 0, biome: biomeFor(state.level)});
  worldGroup.add(g);
}

/* gulls riding the harbor air */
interface Gull { sp: THREE.Sprite; cx: number; cz: number; r: number; h: number; speed: number; phase: number; }
let gulls: Gull[] = [];
let gullTexA: THREE.CanvasTexture | null = null;
let gullTexB: THREE.CanvasTexture | null = null;
let sunK = 0; // how much sun there is right now (updateSky)

function gullFrame(up: boolean): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = 48; cv.height = 28;
  const c = cv.getContext("2d")!;
  c.strokeStyle = "#d8dde2"; c.lineWidth = 3.4; c.lineCap = "round";
  c.beginPath();
  if (up) { c.moveTo(4, 8); c.quadraticCurveTo(15, 20, 24, 20); c.quadraticCurveTo(33, 20, 44, 8); }
  else { c.moveTo(4, 20); c.quadraticCurveTo(15, 10, 24, 12); c.quadraticCurveTo(33, 10, 44, 20); }
  c.stroke();
  c.strokeStyle = "#8a9298"; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(21, 15); c.lineTo(27, 15); c.stroke(); // body hint
  return cv;
}

/* drifting particles: rising embers below, wandering fireflies under the sky */
let emberPoints: THREE.Points | null = null;
let emberData: Float32Array | null = null;
let emberMode: "rise" | "drift" = "rise";

/* the sea: shared drifting textures for coast tiles and the open water */
let waterTexTile: THREE.CanvasTexture | null = null;
let waterTexSea: THREE.CanvasTexture | null = null;

/* the living sky: day cycle, weather, storm light, rain */
let starsMat: THREE.PointsMaterial | null = null;
let moonSpr: THREE.Sprite | null = null;
let sunSpr: THREE.Sprite | null = null;
let plScale = 1;      // sky-driven player-light multiplier (daylight dims the torch)
let skyBloom = 0.45;
let nightK = 1;       // how dark the sky is (gates stars and fireflies)
let lampK = 1;        // lamps burn only when the sun doesn't (storms count as dark)
/* emissive materials that follow the lamps: lamppost heads, glowing caps */
let dimmables: {m: THREE.MeshStandardMaterial; base: number}[] = [];
let flashV = 0; let nextFlash = 0; let thunderAt = -1;
let rain: THREE.LineSegments | null = null;
let rainOff: Float32Array | null = null;
let rainLevel = 0;
const RAIN_N = 240;

/* ---------- texture helpers ---------- */
const texCache = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
function tex(cv: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  let t = texCache.get(cv);
  if (!t) {
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    texCache.set(cv, t);
  }
  return t;
}

const glowCache: Record<string, THREE.CanvasTexture> = {};
function glowTexture(color: string): THREE.CanvasTexture {
  if (!glowCache[color]) {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
    const c = cv.getContext("2d")!;
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,.95)");
    g.addColorStop(0.25, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    glowCache[color] = new THREE.CanvasTexture(cv);
  }
  return glowCache[color];
}

let spriteSource: ((key: string) => HTMLCanvasElement) | null = null;
export function setSpriteSource(fn: (key: string) => HTMLCanvasElement): void { spriteSource = fn; }

/* ---------- the sea around the isle ---------- */
function waterCanvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d")!;
  const grad = c.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#0c1e28"); grad.addColorStop(1, "#0a1822");
  c.fillStyle = grad; c.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 26; k++) { // wave streaks, drawn wrapped so tiles join
    c.strokeStyle = `rgba(150,200,215,${(0.04 + rnd() * 0.07).toFixed(3)})`;
    c.lineWidth = 1 + rnd() * 1.4;
    const x0 = rnd() * 128, y0 = rnd() * 128, len = 20 + rnd() * 40, bow = (rnd() - 0.5) * 6;
    for (const [wx, wy] of [[0, 0], [-128, 0], [0, -128], [-128, -128]]) {
      c.beginPath(); c.moveTo(x0 + wx, y0 + wy);
      c.quadraticCurveTo(x0 + len / 2 + wx, y0 + bow + wy, x0 + len + wx, y0 + wy);
      c.stroke();
    }
  }
  for (let k = 0; k < 12; k++) { c.fillStyle = "rgba(220,235,240,.1)"; c.fillRect(rnd() * 128, rnd() * 128, 2.2, 1.2); }
  return cv;
}
let waterMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] | null = null;
function getWaterMats(): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  if (!waterMats) {
    const cv = waterCanvas();
    const mk = () => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    waterTexTile = mk();
    waterTexSea = mk(); waterTexSea.repeat.set(64, 64);
    const mkMat = (t: THREE.CanvasTexture) => new THREE.MeshStandardMaterial({
      map: t, roughness: 0.75, metalness: 0.05, emissive: 0x0c2430, emissiveIntensity: 0.55,
    });
    waterMats = [mkMat(waterTexTile), mkMat(waterTexSea)];
  }
  return waterMats;
}
const foamMat = new THREE.MeshBasicMaterial({color: 0xbfd8dc, transparent: true, opacity: 0.2, depthWrite: false});

/* ---------- door textures (facade + arch + hanging sign) ---------- */
const doorTexCache: Record<string, THREE.CanvasTexture> = {};
function doorTexture(door: string, facade: HTMLCanvasElement): THREE.CanvasTexture {
  if (doorTexCache[door]) return doorTexCache[door];
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256;
  const c = cv.getContext("2d")!;
  c.drawImage(facade, 0, 0, 256, 256);
  // arched door
  c.fillStyle = "#150d06";
  c.beginPath();
  c.moveTo(90, 256); c.lineTo(90, 150);
  c.arc(128, 150, 38, Math.PI, 0);
  c.lineTo(166, 256); c.closePath(); c.fill();
  c.strokeStyle = "#3a2a18"; c.lineWidth = 3; c.stroke();
  c.fillStyle = "#8a7a52"; c.beginPath(); c.arc(155, 200, 3.5, 0, 7); c.fill();
  // hanging sign
  c.strokeStyle = "#241a10"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(105, 78); c.lineTo(105, 62); c.moveTo(151, 78); c.lineTo(151, 62); c.stroke();
  c.fillStyle = "#241a10"; c.fillRect(88, 78, 80, 42);
  c.fillStyle = "#33271b"; c.fillRect(91, 81, 74, 36);
  c.save(); c.translate(128, 99);
  const is = 14;
  if (door === "T") {
    c.fillStyle = "#e0b24c"; c.fillRect(-is * 0.6, -is * 0.5, is, is);
    c.strokeStyle = "#e0b24c"; c.lineWidth = is * 0.2;
    c.beginPath(); c.arc(is * 0.55, 0, is * 0.4, -1.2, 1.2); c.stroke();
  } else if (door === "P") {
    c.fillStyle = "#c8502f";
    c.beginPath(); c.arc(0, is * 0.25, is * 0.6, 0, 7); c.fill();
    c.fillRect(-is * 0.2, -is * 0.7, is * 0.4, is * 0.5);
  } else if (door === "M") {
    c.strokeStyle = "#7fa8bd"; c.lineWidth = is * 0.22;
    c.beginPath(); c.arc(-is * 0.4, 0, is * 0.4, Math.PI, 0);
    c.arc(is * 0.4, 0, is * 0.4, Math.PI, 0, true); c.stroke();
  } else if (door === "O") {
    c.fillStyle = "#b8b0a0";
    c.fillRect(-is * 0.7, -is * 0.5, is * 0.5, is * 0.3);
    c.fillRect(-is * 0.2, -is * 0.15, is * 0.5, is * 0.3);
    c.fillRect(is * 0.3, is * 0.2, is * 0.5, is * 0.3);
  } else if (door === "H") {
    c.strokeStyle = "#b8c4cc"; c.lineWidth = is * 0.18;
    c.beginPath(); c.moveTo(0, -is * 0.6); c.lineTo(0, is * 0.4);
    c.moveTo(-is * 0.45, -is * 0.25); c.lineTo(is * 0.45, -is * 0.25);
    c.arc(0, is * 0.05, is * 0.5, 0.5, Math.PI - 0.5); c.stroke();
  } else if (door === "W") {
    // crescent moon over grass — the way out to the moor
    c.fillStyle = "#b8cc8a";
    c.beginPath(); c.arc(is * 0.3, -is * 0.25, is * 0.42, 0, 7); c.fill();
    c.fillStyle = "#33271b";
    c.beginPath(); c.arc(is * 0.48, -is * 0.38, is * 0.36, 0, 7); c.fill();
    c.strokeStyle = "#8fae6a"; c.lineWidth = is * 0.13;
    c.beginPath();
    c.moveTo(-is * 0.55, is * 0.6); c.lineTo(-is * 0.5, is * 0.05);
    c.moveTo(-is * 0.25, is * 0.6); c.lineTo(-is * 0.15, -is * 0.05);
    c.moveTo(is * 0.05, is * 0.6); c.lineTo(is * 0.12, is * 0.15);
    c.stroke();
  } else if (door === "V") {
    // a lit lantern — home
    c.fillStyle = "#e0b24c"; c.fillRect(-is * 0.25, -is * 0.3, is * 0.5, is * 0.6);
    c.strokeStyle = "#8a7a52"; c.lineWidth = is * 0.12;
    c.strokeRect(-is * 0.34, -is * 0.4, is * 0.68, is * 0.8);
    c.beginPath(); c.arc(0, -is * 0.4, is * 0.26, Math.PI, 0); c.stroke();
  }
  c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  doorTexCache[door] = t;
  return t;
}

/* ---------- floating signpost labels: the sights, marked in the night ---------- */
const SIGN_NAMES: Record<string, string> = {
  T: "The Salted Gull", P: "Provisions", M: "Temple of the Tide",
  O: "The Old Stair", H: "The Harbor", G: "Signal Fire", R: "Trading Post",
  W: "To the Moor", V: "Back to Vhalis",
};
const labelTexCache: Record<string, {t: THREE.CanvasTexture; w: number; h: number}> = {};
function labelSprite(text: string): THREE.Sprite {
  let entry = labelTexCache[text];
  if (!entry) {
    const cv = document.createElement("canvas");
    let c = cv.getContext("2d")!;
    const font = "600 26px Georgia, 'Times New Roman', serif";
    c.font = font;
    cv.width = Math.ceil(c.measureText(text).width) + 44; cv.height = 52;
    c = cv.getContext("2d")!; // resizing resets the context
    const w = cv.width, r = 10;
    c.beginPath();
    c.moveTo(4 + r, 4); c.arcTo(w - 4, 4, w - 4, 48, r); c.arcTo(w - 4, 48, 4, 48, r);
    c.arcTo(4, 48, 4, 4, r); c.arcTo(4, 4, w - 4, 4, r); c.closePath();
    c.fillStyle = "rgba(10,12,18,.82)"; c.fill();
    c.strokeStyle = "rgba(224,178,76,.65)"; c.lineWidth = 2; c.stroke();
    c.font = font; c.fillStyle = "#e8d9b0"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text, w / 2, 27);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    entry = labelTexCache[text] = {t, w: cv.width, h: cv.height};
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: entry.t, transparent: true, depthWrite: false}));
  const s = 0.0058;
  sp.scale.set(entry.w * s, entry.h * s, 1);
  return sp;
}

/* ---------- init ---------- */
export function initScene(canvas: HTMLCanvasElement): boolean {
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  } catch { return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // retina
  renderer.setSize(480, 360, false);
  // filmic rolloff: near-field hot spots compress instead of clipping to a blob
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 480 / 360, 0.05, 60);
  camera.rotation.order = "YXZ";
  worldGroup = new THREE.Group();
  scene.add(worldGroup);
  ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  hemi = new THREE.HemisphereLight(0x8090b8, 0x202018, 0);
  scene.add(hemi);
  playerLight = new THREE.PointLight(0xffc478, 14, 9, 1.8);
  playerLight.position.set(0, 0.55, 0);
  scene.add(playerLight);
  for (let i = 0; i < POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 6, 2);
    lightPool.push(l); scene.add(l);
  }
  bindAssetFx({
    flame: addFlame,
    anchor: addAnchor,
    sway,
    dim: (m, base) => dimmables.push({m, base}),
    shimmer: (m, base) => shimmers.push({m, base, phase: rnd() * 6.28}),
    consumable: (mesh, char) => consumables.push({mesh, cellX: placingX, cellY: placingY, char}),
    signalFire: (lit, cold) => { worldGroup.add(lit); worldGroup.add(cold); fireGroup = {lit, cold}; },
    beacon: (b2, bm, lm, gl) => { lhBeacon = b2; lhBeamMat = bm; lhLampMat = lm; lhGlow = gl; },
    glowTexture,
  });
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(480, 360), 0.65, 0.55, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return true;
}

/** The picturesque pass: runs after tone mapping, in display space.
    A gentle S-curve, split-toned shadows and highlights that follow the
    day, golden-hour warmth, a soft vignette, and a whisper of grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: {value: null as THREE.Texture | null},
    uTime: {value: 0}, uNight: {value: 0}, uDusk: {value: 0},
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uNight, uDusk;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c *= mix(1.07, 1.0, uNight);                                   // daylight breathes
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);                    // gentle S-curve
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = mix(vec3(0.96, 0.99, 1.04), vec3(0.88, 0.95, 1.10), uNight);
      vec3 lightTint  = mix(vec3(1.04, 1.00, 0.97), vec3(0.99, 1.00, 1.04), uNight);
      c *= mix(shadowTint, lightTint, smoothstep(0.12, 0.72, l));   // split-tone
      c *= mix(vec3(1.0), vec3(1.15, 1.01, 0.84), uDusk);           // golden hour
      c = mix(vec3(l), c, 1.14);                                     // a touch more chroma
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * (0.30 + 0.30 * uNight);                 // vignette, deeper at night
      float g = fract(sin(dot(vUv + fract(uTime * 0.37), vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.014;                                        // fine grain
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* ---------- prop builders (3D prop structs, placed by the biome rules) ---------- */
interface Prop3DCtx { group: THREE.Group; x: number; z: number; hash: number; biome: Biome; faceDir?: [number, number]; }
type Prop3D = (p: Prop3DCtx) => void;

function addAnchor(pos: THREE.Vector3, color: number, intensity: number, distance: number, flicker = 0.25): void {
  anchors.push({pos, color, intensity, distance, flicker, phase: rnd() * 6.28});
}
function addFlame(group: THREE.Group, x: number, y: number, z: number, color: string, scale: number): void {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
  sp.position.set(x, y, z); sp.scale.setScalar(scale);
  group.add(sp);
  flameSprites.push({sprite: sp, base: scale, phase: rnd() * 6.28});
}

let placingX = 0; let placingY = 0; // the cell being furnished (for consumables)

/** Impassable wilds: pick which landmark or growth claims the cell. */
function buildWilds(x: number, y: number, h: number, elev = 0): void {
  const g = new THREE.Group(); g.position.set(x, elev - 0.02, y);
  const id = h % 7 === 3 ? "ruin" : h % 3 === 0 ? "pineStand" : "boulderCluster";
  ASSETS[id]({group: g, x: 0, z: 0, hash: id === "ruin" ? h >> 1 : h, biome: biomeFor(state.level)});
  worldGroup.add(g);
}

/* ---------- level construction ---------- */
function faceToOpen(map: string[], x: number, y: number): [number, number] | null {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    if (map[y + dy]?.[x + dx] === ".") return [dx, dy];
  }
  return null;
}

export function buildLevel(): void {
  const level = state.level;
  const biome = biomeFor(level);
  const map = MAPS[level];
  const mw = map[0].length, mh = map.length;
  // reset
  scene.remove(worldGroup);
  worldGroup.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  worldGroup = new THREE.Group();
  scene.add(worldGroup);
  anchors = []; consumables = []; flameSprites = []; fireGroup = null; labels = [];
  starsMat = null; moonSpr = null; sunSpr = null; dimmables = []; swayers = []; shimmers = [];
  cloudMesh = null; cloudMat = null; gulls = [];
  lhBeacon = null; lhBeamMat = null; lhLampMat = null; lhGlow = null;
  for (const mv of mobViews) { scene.remove(mv.sprite); scene.remove(mv.shadow); }
  mobViews = [];

  // atmosphere
  const town = biome.sky;
  const isMoor = biome.id === "moor", isHarbor = biome.id === "harbor", isCove = biome.id === "cove";
  scene.fog = new THREE.FogExp2(
    isMoor ? 0x0a120e : town ? 0x0a0e1a : (biome.id === "emberdeep" ? 0x180a08 : 0x120c06),
    isMoor ? 0.085 : town ? 0.055 : 0.16);
  scene.background = new THREE.Color(isMoor ? 0x05090a : town ? 0x070b16 : 0x060403);
  ambient.intensity = town ? 0.32 : 0.28;
  ambient.color.set(isMoor ? 0x9ab8a8 : town ? 0x9aa4c8 : (biome.id === "emberdeep" ? 0xcc9070 : 0xbfa888));
  hemi.intensity = town ? 0.5 : 0;
  hemi.color.set(isMoor ? 0x7a9a8a : 0x8090b8);
  playerLight.color.set(isMoor ? 0xc3d2e6 : town ? 0xb8c4e6 : 0xffc478);
  playerLight.intensity = town ? 3.2 : 13;

  // materials from the biome bakery
  const albedos = biomeTextures(biome);
  const normals = biomeNormalMaps(biome);
  const wallMats = albedos.map((a, i) => new THREE.MeshStandardMaterial({
    map: tex(a), normalMap: new THREE.CanvasTexture(normals[i]), roughness: 0.92,
  }));
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);

  // floor & ceiling
  const ftex = tex(biomeFloorTexture(biome), true);
  ftex.repeat.set(mw, mh);
  let floorGeo: THREE.BufferGeometry;
  if (hasElevation(level)) { // the ground rolls: one vertex per cell corner, lifted by the heightfield
    const pg = new THREE.PlaneGeometry(mw, mh, mw, mh);
    pg.rotateX(-Math.PI / 2);
    pg.translate(mw / 2, 0, mh / 2);
    const vp = pg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < vp.count; i++) vp.setY(i, groundHAt(vp.getX(i), vp.getZ(i)));
    pg.computeVertexNormals();
    floorGeo = pg;
    const floor = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({map: ftex, roughness: 0.95}));
    worldGroup.add(floor);
  } else {
    const flat = new THREE.PlaneGeometry(mw, mh);
    flat.rotateX(-Math.PI / 2);
    flat.translate(mw / 2, 0, mh / 2);
    floorGeo = flat;
    worldGroup.add(new THREE.Mesh(flat, new THREE.MeshStandardMaterial({map: ftex, roughness: 0.95})));
  }
  if (town) { // it is an isle: open sea runs to the horizon under every sky
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), getWaterMats()[1]);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(mw / 2, -0.05, mh / 2);
    worldGroup.add(sea);
    // the isle's lighthouse, out on its rock
    if (isHarbor) buildLighthouse(mw * 0.72, -7.5);
    else if (isMoor) buildLighthouse(mw + 6.5, mh * 0.32);
    else if (isCove) buildLighthouse(mw + 5, -3);
  }
  if (!town) {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh),
      new THREE.MeshStandardMaterial({color: biome.id === "emberdeep" ? 0x241210 : 0x201610, roughness: 1}));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(mw / 2, 1, mh / 2);
    worldGroup.add(ceil);
  } else {
    // stars & moon
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      const a = rnd() * Math.PI * 2, e = rnd() * Math.PI * 0.45;
      starPos[i * 3] = mw / 2 + Math.cos(a) * Math.cos(e) * 40;
      starPos[i * 3 + 1] = 3 + Math.sin(e) * 40;
      starPos[i * 3 + 2] = mh / 2 + Math.sin(a) * Math.cos(e) * 40;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starsMat = new THREE.PointsMaterial({color: 0xe8d9b0, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8});
    worldGroup.add(new THREE.Points(starGeo, starsMat));
    moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture("rgba(225,228,215,.9)"), transparent: true}));
    moonSpr.position.set(mw / 2 + 18, 16, mh / 2 - 30); moonSpr.scale.setScalar(4);
    worldGroup.add(moonSpr);
    sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture("rgba(255,214,140,.95)"), transparent: true, opacity: 0}));
    sunSpr.scale.setScalar(6);
    worldGroup.add(sunSpr);
    // cloud shadows: a soft dark field sliding across the ground
    if (!cloudTex) {
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256;
      const c2 = cv.getContext("2d")!;
      for (let k = 0; k < 9; k++) {
        const bx = rnd() * 256, by = rnd() * 256, br = 22 + rnd() * 44;
        for (const [ox, oy] of [[0, 0], [-256, 0], [0, -256], [-256, -256]]) {
          const g2 = c2.createRadialGradient(bx + ox, by + oy, 2, bx + ox, by + oy, br);
          g2.addColorStop(0, "rgba(255,255,255,.42)");
          g2.addColorStop(1, "rgba(255,255,255,0)");
          c2.fillStyle = g2; c2.fillRect(0, 0, 256, 256);
        }
      }
      cloudTex = new THREE.CanvasTexture(cv);
      cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
      cloudTex.repeat.set(2.2, 2.2);
    }
    cloudMat = new THREE.MeshBasicMaterial({color: 0x000000, alphaMap: cloudTex, transparent: true, opacity: 0, depthWrite: false});
    const cloudGeo = floorGeo.clone(); // shadows hug the rolling ground
    cloudGeo.translate(0, 0.045, 0);
    cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    worldGroup.add(cloudMesh);
    // gulls ride the air over harbor and cove
    if (biome.id === "harbor" || biome.id === "cove") {
      if (!gullTexA) { gullTexA = new THREE.CanvasTexture(gullFrame(true)); gullTexB = new THREE.CanvasTexture(gullFrame(false)); }
      const n = biome.id === "harbor" ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: gullTexA, transparent: true, opacity: 0, depthWrite: false}));
        sp.scale.set(0.5, 0.29, 1);
        worldGroup.add(sp);
        gulls.push({sp, cx: mw / 2 + (rnd() - 0.5) * 4, cz: mh / 2 + (rnd() - 0.5) * 4,
                    r: 2.5 + rnd() * 3.5, h: 3 + rnd() * 2.5, speed: 0.14 + rnd() * 0.1, phase: rnd() * 6.28});
      }
    }
  }

  // walls, doors, wall props
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const ch = map[y][x];
    const isDoor = town && TOWN_DOORS.includes(ch);
    const solidWall = ch === "#" || isDoor;
    if (!solidWall) continue;
    const h = cellHash(x, y);
    const elev = groundHAt(x + 0.5, y + 0.5);
    const perimeter = x === 0 || y === 0 || x === mw - 1 || y === mh - 1;
    if ((isMoor || isCove) && !isDoor && !perimeter) { // the open wilds build no masonry
      buildWilds(x, y, h, elev);
      continue;
    }
    // buildings rise to different heights; the moor keeps only the town's seaward wall
    let hgt = 1;
    if (isHarbor) hgt = perimeter ? 1.12 : 1.02 + (h % 5) * 0.11;
    else if (isMoor || isCove) hgt = 1.12;
    if (isDoor) hgt = Math.max(hgt, 1.05);
    const wall = new THREE.Mesh(wallGeo, wallMats[h % wallMats.length]);
    wall.scale.y = hgt;
    wall.position.set(x + 0.5, elev + hgt / 2 - 0.02, y + 0.5);
    worldGroup.add(wall);
    // doors greet every open side, so gates read from both directions
    const faces = isDoor
      ? ([[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]).filter(([dx, dy]) => map[y + dy]?.[x + dx] === ".")
      : [];
    const roofed = isHarbor && !perimeter;
    if (roofed) {
      const ridgeAlongZ = faces.length ? faces[0][0] !== 0 : h % 2 === 1; // door ridges parallel the facade
      const rg = new THREE.Group(); rg.position.set(x + 0.5, elev + hgt + 0.16, y + 0.5);
      ASSETS.roof({group: rg, x, z: y, hash: h, biome, ridgeAlongZ});
      worldGroup.add(rg);
      if (h % 3 === 0) {
        const cg = new THREE.Group();
        cg.position.set(x + 0.5 + (ridgeAlongZ ? 0 : 0.2), elev + hgt + 0.28, y + 0.5 + (ridgeAlongZ ? 0.2 : 0));
        ASSETS.chimney({group: cg, x, z: y, hash: h, biome});
        worldGroup.add(cg);
      }
    }
    if (isDoor) {
      for (const face of faces) {
        const dt = doorTexture(ch, albedos[h % albedos.length]);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98),
          new THREE.MeshStandardMaterial({map: dt, roughness: 0.9}));
        plane.position.set(x + 0.5 + face[0] * 0.505, elev + 0.5, y + 0.5 + face[1] * 0.505);
        plane.lookAt(x + 0.5 + face[0] * 2, elev + 0.5, y + 0.5 + face[1] * 2);
        worldGroup.add(plane);
        if (face === faces[0]) { // one door lamp is plenty, even on a two-faced gate
          const lpos = new THREE.Vector3(x + 0.5 + face[0] * 0.55, elev + 0.62, y + 0.5 + face[1] * 0.55);
          addFlame(worldGroup, lpos.x - face[1] * 0.22, lpos.y, lpos.z - face[0] * 0.22, "rgba(250,190,90,.85)", 0.2);
          addAnchor(lpos, 0xffc06a, 3.5, 4, 0.08);
        }
      }
      const name = faces.length ? SIGN_NAMES[ch] : undefined;
      if (name) { // the sight, clearly marked
        const sp = labelSprite(name);
        sp.position.set(x + 0.5 + faces[0][0] * 0.6, elev + hgt + (roofed ? 0.72 : 0.4), y + 0.5 + faces[0][1] * 0.6);
        worldGroup.add(sp);
        labels.push({sprite: sp, pos: sp.position.clone()});
      }
    } else { // plain walls of any biome dress themselves from the biome's wall props
      const face = faceToOpen(map, x, y);
      if (face) {
        for (const place of biome.wallProps) {
          if (h % place.mod !== place.rem) continue;
          const pg2 = new THREE.Group(); pg2.position.y = elev;
          worldGroup.add(pg2);
          ASSETS[place.id]?.({group: pg2, x, z: y, hash: h, biome, faceDir: face});
          break;
        }
      }
    }
  }

  // floor props & features
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const ch = map[y][x];
    if (ch === "#" || (town && TOWN_DOORS.includes(ch))) continue;
    const h = cellHash(x, y);
    if (ch === ".") {
      for (const place of biome.floorProps) {
        if (h % place.mod !== place.rem) continue;
        const pg2 = new THREE.Group(); pg2.position.y = groundHAt(x + 0.5, y + 0.5);
        worldGroup.add(pg2);
        ASSETS[place.id]?.({group: pg2, x, z: y, hash: h, biome});
        break;
      }
      continue;
    }
    buildFeature(ch, x, y, biome);
  }
  // embers or fireflies
  if (biome.sparks !== "none") {
    const firefly = biome.sparks === "firefly";
    emberMode = firefly ? "drift" : "rise";
    const n = biome.sparks === "heavy-ember" ? 60 : firefly ? 42 : 34;
    emberData = new Float32Array(n * 4); // x,y,z, speed (rise) or phase (drift)
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) respawnEmber(i, mw, mh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    emberPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: firefly ? 0xa8e070 : 0xff9040, size: firefly ? 0.07 : 0.035,
      map: glowTexture(firefly ? "rgba(190,235,130,.9)" : "rgba(255,150,60,.9)"),
      transparent: true, opacity: firefly ? 0.8 : 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    worldGroup.add(emberPoints);
  } else { emberPoints = null; emberData = null; }

  builtLevel = level;
  // snap the camera on arrival in a new place
  camera.position.set(state.x + 0.5, 0.5 + groundHAt(state.x + 0.5, state.y + 0.5), state.y + 0.5);
  camera.rotation.y = yawFor(state.dir);
}

function respawnEmber(i: number, mw: number, mh: number): void {
  if (!emberData) return;
  emberData[i * 4] = rnd() * mw;
  emberData[i * 4 + 1] = emberMode === "drift" ? 0.12 + rnd() * 0.55 : rnd() * 0.9;
  emberData[i * 4 + 2] = rnd() * mh;
  emberData[i * 4 + 3] = emberMode === "drift" ? rnd() * 6.28 : 0.12 + rnd() * 0.25;
}

function buildFeature(ch: string, x: number, y: number, biome: Biome): void {
  const elev = groundHAt(x + 0.5, y + 0.5);
  const g = new THREE.Group();
  g.position.set(x, elev, y);
  const cx = 0.5, cz = 0.5;
  if (ch === "~") { // the sea at the isle's edge (terrain, not an asset)
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), getWaterMats()[0]);
    tile.rotation.x = -Math.PI / 2; tile.position.set(cx, 0.02, cz);
    g.add(tile);
    const map = MAPS[state.level];
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const n = map[y + dy]?.[x + dx];
      if (n === undefined || n === "~") continue;
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(dx ? 0.09 : 1, dx ? 1 : 0.09), foamMat);
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(cx + dx * 0.455, 0.028, cz + dy * 0.455);
      g.add(foam);
    }
  } else {
    const id = FEATURE_ASSET[ch];
    if (id) {
      placingX = x; placingY = y;
      ASSETS[id]({group: g, x, z: y, hash: cellHash(x, y), biome, up: ch === "U"});
    }
  }
  if (biome.sky && SIGN_NAMES[ch]) { // plaza sights get their name in the air too
    const sp = labelSprite(SIGN_NAMES[ch]);
    sp.position.set(cx, 1.18, cz);
    g.add(sp);
    labels.push({sprite: sp, pos: new THREE.Vector3(x + cx, elev + 1.18, y + cz)});
  }
  worldGroup.add(g);
}

/* ---------- the living sky ---------- */
interface SkyKey { h: number; sky: number; fog: number; amb: number; ambI: number; hemiI: number; stars: number; sun: number; pl: number; fogD: number; }
const SKY_KEYS: SkyKey[] = [
  {h: 0,    sky: 0x070b16, fog: 0x0a0e1a, amb: 0x9aa4c8, ambI: 0.30, hemiI: 0.5,  stars: 1,    sun: 0,    pl: 1,    fogD: 1},
  {h: 4.5,  sky: 0x070b16, fog: 0x0a0e1a, amb: 0x9aa4c8, ambI: 0.30, hemiI: 0.5,  stars: 1,    sun: 0,    pl: 1,    fogD: 1},
  {h: 6.2,  sky: 0x3a3048, fog: 0x463850, amb: 0xc8a89c, ambI: 0.44, hemiI: 0.75, stars: 0.3,  sun: 0.3,  pl: 0.7,  fogD: 0.9},
  {h: 8,    sky: 0x7e96bc, fog: 0x8ea6c4, amb: 0xe8dcc4, ambI: 0.74, hemiI: 1.15, stars: 0,    sun: 1,    pl: 0.25, fogD: 0.6},
  {h: 13,   sky: 0x93b4da, fog: 0xa4bcd6, amb: 0xf2e9d6, ambI: 0.88, hemiI: 1.3,  stars: 0,    sun: 1,    pl: 0.2,  fogD: 0.5},
  {h: 17.5, sky: 0x9a7484, fog: 0xb08e80, amb: 0xf0cfa4, ambI: 0.72, hemiI: 1.0,  stars: 0,    sun: 0.85, pl: 0.35, fogD: 0.7},
  {h: 19.5, sky: 0x3c2c44, fog: 0x4a3850, amb: 0xc8a8ac, ambI: 0.46, hemiI: 0.7,  stars: 0.45, sun: 0.12, pl: 0.7,  fogD: 0.85},
  {h: 21,   sky: 0x070b16, fog: 0x0a0e1a, amb: 0x9aa4c8, ambI: 0.30, hemiI: 0.5,  stars: 1,    sun: 0,    pl: 1,    fogD: 1},
  {h: 24,   sky: 0x070b16, fog: 0x0a0e1a, amb: 0x9aa4c8, ambI: 0.30, hemiI: 0.5,  stars: 1,    sun: 0,    pl: 1,    fogD: 1},
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
const _sky = new THREE.Color(), _fogC = new THREE.Color(), _amb = new THREE.Color();
const MOOR_TINT = new THREE.Color(0.85, 1.0, 0.92);

function updateSky(dt: number, biome: Biome): void {
  const h = hourOf(state.clock ?? 1230);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  const L = (x: number, y: number) => x + (y - x) * t;
  _sky.copy(_ca.set(a.sky)).lerp(_cb.set(b.sky), t);
  _fogC.copy(_ca.set(a.fog)).lerp(_cb.set(b.fog), t);
  _amb.copy(_ca.set(a.amb)).lerp(_cb.set(b.amb), t);
  let ambI = L(a.ambI, b.ambI), hemiI = L(a.hemiI, b.hemiI);
  let stars = L(a.stars, b.stars), sun = L(a.sun, b.sun);
  plScale = L(a.pl, b.pl);
  let fogD = L(a.fogD, b.fogD) * (biome.id === "moor" ? 0.08 : 0.055);
  // the weather leans on everything
  const w = state.weather ?? "clear";
  if (w === "mist") { fogD *= 2.4; stars *= 0.25; sun *= 0.5; ambI *= 0.92; }
  else if (w === "rain") { fogD *= 1.7; stars *= 0.15; sun *= 0.35; ambI *= 0.8; _sky.multiplyScalar(0.72); _fogC.multiplyScalar(0.78); }
  else if (w === "storm") { fogD *= 2.0; stars = 0; sun *= 0.12; ambI *= 0.62; _sky.multiplyScalar(0.5); _fogC.multiplyScalar(0.55); }
  if (biome.id === "moor") { _sky.multiply(MOOR_TINT); _fogC.multiply(MOOR_TINT); }
  // storm flashes: the world blinks white, thunder follows
  if (w === "storm" && !reduceMotion) {
    if (animT > nextFlash) {
      flashV = 1;
      thunderAt = animT + 0.5 + rnd() * 1.6;
      nextFlash = animT + 5 + rnd() * 9;
    }
    flashV *= Math.exp(-dt * 6);
    if (thunderAt > 0 && animT >= thunderAt) { sfx("thunder"); thunderAt = -1; }
    ambI += flashV * 1.5; hemiI += flashV * 1.8;
    _sky.lerp(_ca.set(0xcdd6e8), flashV * 0.6);
  } else flashV = 0;
  (scene.background as THREE.Color).copy(_sky);
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(_fogC); fog.density = fogD;
  ambient.color.copy(_amb); ambient.intensity = ambI;
  hemi.intensity = hemiI;
  skyBloom = 0.3 + 0.15 * plScale;
  nightK = stars;
  lampK = Math.min(1, Math.max(0, 1 - sun * 1.15));
  sunK = sun;
  // distinct cloud shadows need direct light; overcast weather washes them out
  cloudA = w === "clear" ? 0.16 * sun + 0.06 * stars : w === "mist" ? 0 : 0.04;
  windK = w === "storm" ? 2 : w === "rain" ? 1.4 : w === "mist" ? 0.7 : 1;
  // lights across the sky
  const mw = MAPS[state.level][0].length, mh = MAPS[state.level].length;
  if (starsMat) starsMat.opacity = 0.8 * stars;
  if (sunSpr) {
    const ts = Math.min(1, Math.max(0, (h - 5.5) / 13));
    sunSpr.position.set(mw / 2 + (1 - 2 * ts) * 30, 2.5 + Math.sin(ts * Math.PI) * 24, mh / 2 - 32);
    sunSpr.material.opacity = sun;
  }
  if (moonSpr) {
    const tm = Math.min(1, Math.max(0, (((h - 18) + 24) % 24) / 12));
    moonSpr.position.set(mw / 2 + (1 - 2 * tm) * 28, 3 + Math.sin(tm * Math.PI) * 22, mh / 2 - 30);
    moonSpr.material.opacity = Math.min(1, stars * 1.3);
  }
}

function ensureRain3d(): void {
  if (rain) return;
  rainOff = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    rainOff[i * 3] = (rnd() - 0.5) * 13;
    rainOff[i * 3 + 1] = rnd() * 2.4;
    rainOff[i * 3 + 2] = (rnd() - 0.5) * 13;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN_N * 6), 3));
  rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({color: 0x9cb4c8, transparent: true, opacity: 0}));
  rain.frustumCulled = false;
  scene.add(rain);
}

/* ---------- per-frame update ---------- */
const yawFor = (dir: number) => [0, -Math.PI / 2, Math.PI, Math.PI / 2][dir];

export function frame(dt: number): void {
  if (!renderer || !composer || !state) return;
  animT += dt;
  if (builtLevel !== state.level) buildLevel();
  const biome = biomeFor(state.level);
  if (biome.sky) updateSky(dt, biome); else flashV = 0;

  // camera glide (eye height rides the terrain)
  const target = new THREE.Vector3(state.x + 0.5, 0.5 + groundHAt(state.x + 0.5, state.y + 0.5), state.y + 0.5);
  const targetYaw = yawFor(state.dir);
  if (reduceMotion || camera.position.distanceTo(target) > 3) {
    camera.position.copy(target);
    camera.rotation.y = targetYaw;
  } else {
    const k = 1 - Math.exp(-dt * 9);
    camera.position.lerp(target, k);
    let dy = targetYaw - camera.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    camera.rotation.y += dy * k;
  }
  // subtle breathing bob over the ground height
  camera.position.y = 0.5 + groundHAt(camera.position.x, camera.position.z)
    + (reduceMotion ? 0 : Math.sin(animT * 1.7) * 0.006);
  playerLight.position.copy(camera.position).add(new THREE.Vector3(0, 0.06, 0));
  const plBase = biome.sky ? 3.2 * plScale : 13;
  playerLight.intensity = reduceMotion ? plBase
    : plBase * (0.93 + 0.07 * Math.sin(animT * 5.3) + 0.03 * Math.sin(animT * 13.7));

  // in daylight the lamps go out (underground never sees the sun)
  const lightMul = biome.sky ? lampK : 1;
  // dynamic light pool: nearest anchors win
  const sorted = anchors.slice().sort((a, b) =>
    a.pos.distanceToSquared(camera.position) - b.pos.distanceToSquared(camera.position));
  for (let i = 0; i < POOL_SIZE; i++) {
    const l = lightPool[i], a = sorted[i];
    if (!a) { l.intensity = 0; continue; }
    l.position.copy(a.pos);
    l.color.set(a.color);
    l.distance = a.distance;
    const fl = reduceMotion ? 1 : 1 - a.flicker / 2 + a.flicker * Math.sin(animT * 9 + a.phase) * 0.5;
    l.intensity = a.intensity * fl * lightMul;
  }
  // flames breathe, and gutter out under the sun
  for (const f of flameSprites) {
    f.sprite.material.opacity = lightMul;
    if (!reduceMotion) f.sprite.scale.setScalar(f.base * (0.85 + 0.2 * Math.sin(animT * 8 + f.phase)));
  }
  for (const dm of dimmables) dm.m.emissiveIntensity = dm.base * (0.1 + 0.9 * lightMul);
  // the sea drifts
  if (!reduceMotion && waterTexTile && waterTexSea) {
    waterTexTile.offset.x += dt * 0.012; waterTexTile.offset.y += dt * 0.004;
    waterTexSea.offset.x += dt * 0.003; waterTexSea.offset.y += dt * 0.001;
  }
  // the wind moves what grows in gusts that travel across the ground
  if (!reduceMotion) {
    const gust = 0.45 + 0.8 * Math.max(0, Math.sin(animT * 0.21)) * windK;
    for (const sw of swayers) {
      const wave = Math.sin(animT * 1.5 - sw.wx * 0.45 - sw.wz * 0.3 + sw.phase * 0.4);
      sw.o.rotation.z = sw.base + sw.amp * wave * gust;
    }
    for (const sh of shimmers) sh.m.emissiveIntensity = sh.base * (0.75 + 0.35 * Math.sin(animT * 2.2 + sh.phase));
    foamMat.opacity = 0.16 + 0.05 * Math.sin(animT * 1.3);
  }
  // cloud shadows slide with the wind
  if (cloudMat && cloudTex) {
    cloudMat.opacity += (cloudA - cloudMat.opacity) * (1 - Math.exp(-dt * 0.8));
    if (!reduceMotion) { cloudTex.offset.x += dt * 0.0065 * windK; cloudTex.offset.y += dt * 0.0022 * windK; }
  }
  // the lighthouse wakes with the dark, and its beams walk the sea
  if (lhBeacon && lhBeamMat && lhLampMat && lhGlow) {
    const on = Math.min(1, Math.max(0, (nightK - 0.12) / 0.35));
    if (!reduceMotion) lhBeacon.rotation.y = animT * 0.55;
    lhBeamMat.opacity = 0.13 * on;
    lhLampMat.emissiveIntensity = 0.3 + 2.6 * on;
    lhGlow.material.opacity = 0.85 * on;
  }
  // gulls circle on the day's air, wings answering in turn
  for (const gl of gulls) {
    const a = animT * gl.speed + gl.phase;
    gl.sp.position.set(gl.cx + Math.cos(a) * gl.r, gl.h + Math.sin(a * 2.3) * 0.4, gl.cz + Math.sin(a) * gl.r);
    gl.sp.material.opacity = 0.85 * sunK;
    gl.sp.material.map = ((animT * 4 + gl.phase) % 1) < 0.5 ? gullTexA : gullTexB;
  }
  // signposts fade out when you stand beneath them
  for (const lb of labels) {
    const d = lb.pos.distanceTo(camera.position);
    lb.sprite.material.opacity = Math.min(1, Math.max(0, (d - 1.45) / 0.9));
  }
  // consumables vanish when consumed
  for (const c of consumables) {
    c.mesh.visible = cellAt(state.level, c.cellX, c.cellY) === c.char;
  }
  // the signal fire lights when the link does
  if (fireGroup) {
    const lit = net.role === "host" || net.connected;
    fireGroup.lit.visible = lit; fireGroup.cold.visible = !lit;
  }
  // an active fight owns the corridor: foes fan out one cell ahead
  if (combatFoes) {
    const fwd = new THREE.Vector3(-Math.sin(camera.rotation.y), 0, -Math.cos(camera.rotation.y));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const centre = camera.position.clone().add(fwd.clone().multiplyScalar(1.45));
    while (foeSprites.length < combatFoes.length) {
      const i = foeSprites.length;
      const fv = combatFoes[i];
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({transparent: true}));
      if (spriteSource) {
        const t = new THREE.CanvasTexture(spriteSource(fv.boss ? "boss" : fv.key));
        t.colorSpace = THREE.SRGBColorSpace;
        sp.material.map = t; sp.material.needsUpdate = true;
      }
      const barCv = document.createElement("canvas"); barCv.width = 64; barCv.height = 10;
      const barTex = new THREE.CanvasTexture(barCv);
      const bar = new THREE.Sprite(new THREE.SpriteMaterial({map: barTex, transparent: true, depthWrite: false}));
      bar.scale.set(0.4, 0.062, 1);
      scene.add(sp); scene.add(bar);
      const fs: FoeSprite = {sp, bar, barCv, barTex, lastHp: fv.hp, flash: 0, key: fv.key};
      drawFoeBar(fs, fv.hp, fv.maxhp);
      foeSprites.push(fs);
    }
    const n = combatFoes.length;
    for (let i = 0; i < n; i++) {
      const fv = combatFoes[i], fs = foeSprites[i];
      const lateral = n === 1 ? 0 : (i / (n - 1) - 0.5) * Math.min(0.95, 0.42 * n);
      const depth = (i % 2) * 0.28;
      const base = fv.boss ? 1.0 : 0.62;
      const pos = centre.clone().add(right.clone().multiplyScalar(lateral)).add(fwd.clone().multiplyScalar(depth));
      const alive2 = fv.hp > 0;
      const bob = reduceMotion || !alive2 ? 0 : Math.sin(animT * 2.4 + i * 2.2) * 0.02;
      const fgh = groundHAt(pos.x, pos.z);
      fs.sp.position.set(pos.x, fgh + (fv.boss ? 0.52 : 0.36) + bob, pos.z);
      if (fv.hp < fs.lastHp) fs.flash = 1;
      fs.lastHp = fv.hp;
      if (!reduceMotion) fs.flash = Math.max(0, fs.flash - dt * 3.2);
      else fs.flash = 0;
      fs.sp.scale.setScalar(base * (1 + fs.flash * 0.18));
      fs.sp.material.color.setRGB(1, 1 - fs.flash * 0.55, 1 - fs.flash * 0.55);
      fs.sp.material.opacity = alive2 ? 1 : 0.12; // the fallen fade to shade
      drawFoeBar(fs, fv.hp, fv.maxhp);
      fs.bar.position.set(pos.x, fgh + (fv.boss ? 1.06 : 0.68), pos.z);
      fs.bar.visible = alive2;
    }
  }
  // floating damage numbers rise and fade
  for (let i = pops3d.length - 1; i >= 0; i--) {
    const p = pops3d[i];
    p.t += dt;
    p.sp.position.y += dt * 0.45;
    p.sp.material.opacity = Math.max(0, 1 - p.t / 0.95);
    if (p.t > 0.95) { scene.remove(p.sp); pops3d.splice(i, 1); }
  }
  // mobs: sprite pool reconciled to state, gliding toward their cells
  const mobs = state.mobs?.[state.level] ?? [];
  while (mobViews.length < mobs.length) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({transparent: true}));
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10),
      new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.45}));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(sprite); scene.add(shadow);
    mobViews.push({sprite, shadow, cur: new THREE.Vector3(), key: ""});
  }
  for (let i = 0; i < mobViews.length; i++) {
    const mv = mobViews[i], mob = mobs[i];
    if (!mob || combatFoes) { mv.sprite.visible = false; mv.shadow.visible = false; continue; }
    if (mv.key !== mob.key && spriteSource) {
      mv.key = mob.key;
      const t = new THREE.CanvasTexture(spriteSource(mob.key));
      t.colorSpace = THREE.SRGBColorSpace;
      mv.sprite.material.map = t; mv.sprite.material.needsUpdate = true;
    }
    const tgt = new THREE.Vector3(mob.x + 0.5, 0.34, mob.y + 0.5);
    if (mv.cur.lengthSq() === 0 || mv.cur.distanceTo(tgt) > 3) mv.cur.copy(tgt);
    else mv.cur.lerp(tgt, reduceMotion ? 1 : 1 - Math.exp(-dt * 6));
    const bob = reduceMotion ? 0 : Math.sin(animT * 2.6 + mob.x * 7 + mob.y * 13) * 0.02;
    const mgh = groundHAt(mv.cur.x, mv.cur.z);
    mv.sprite.position.set(mv.cur.x, mgh + 0.34 + bob, mv.cur.z);
    mv.sprite.scale.setScalar(0.62);
    mv.sprite.visible = true;
    mv.shadow.position.set(mv.cur.x, mgh + 0.011, mv.cur.z);
    mv.shadow.visible = true;
    const hue = ENEMIES[mob.key]?.hue;
    if (hue) mv.sprite.material.color.set(0xffffff);
  }
  // rising embers / wandering fireflies
  if (emberPoints && emberData) {
    if (emberMode === "drift") { // fireflies belong to the dark
      (emberPoints.material as THREE.PointsMaterial).opacity = 0.8 * Math.min(1, nightK + 0.05);
    }
    const pos = emberPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const mw = MAPS[state.level][0].length, mh = MAPS[state.level].length;
    for (let i = 0; i < pos.count; i++) {
      if (emberMode === "drift") {
        const ph = emberData[i * 4 + 3];
        let fx = emberData[i * 4] + Math.sin(animT * 0.55 + ph * 1.7) * 0.4;
        let fy = emberData[i * 4 + 1] + Math.sin(animT * 0.9 + ph) * 0.1;
        let fz = emberData[i * 4 + 2] + Math.cos(animT * 0.45 + ph * 2.3) * 0.4;
        const ddx = fx - camera.position.x, ddz = fz - camera.position.z;
        if (ddx * ddx + ddz * ddz < 0.36) { // one at the lens is a lantern in the eye
          respawnEmber(i, mw, mh);
          fx = emberData[i * 4]; fy = emberData[i * 4 + 1]; fz = emberData[i * 4 + 2];
        }
        pos.setXYZ(i, fx, fy, fz);
        continue;
      }
      emberData[i * 4 + 1] += emberData[i * 4 + 3] * dt;
      if (emberData[i * 4 + 1] > 0.95) respawnEmber(i, mw, mh);
      pos.setXYZ(i,
        emberData[i * 4] + Math.sin(animT + i) * 0.04,
        emberData[i * 4 + 1],
        emberData[i * 4 + 2]);
    }
    pos.needsUpdate = true;
  }
  // rain: a curtain of short streaks falling around the party
  const wWeather = state.weather ?? "clear";
  const wantRain = biome.sky && (wWeather === "rain" || wWeather === "storm")
    ? (wWeather === "storm" ? 1 : 0.55) : 0;
  rainLevel += (wantRain - rainLevel) * (1 - Math.exp(-dt * 1.8));
  if (rainLevel > 0.02) {
    ensureRain3d();
    rain!.visible = true;
    (rain!.material as THREE.LineBasicMaterial).opacity = 0.35 * rainLevel;
    const speed = 5 + 3.5 * rainLevel;
    const slant = wWeather === "storm" ? 0.45 : 0.12;
    const vp = rain!.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < RAIN_N; i++) {
      rainOff![i * 3 + 1] -= speed * dt;
      if (rainOff![i * 3 + 1] < 0) {
        rainOff![i * 3] = (rnd() - 0.5) * 13;
        rainOff![i * 3 + 1] = 2 + rnd();
        rainOff![i * 3 + 2] = (rnd() - 0.5) * 13;
      }
      const rx = camera.position.x + rainOff![i * 3], ry = rainOff![i * 3 + 1], rz = camera.position.z + rainOff![i * 3 + 2];
      vp.setXYZ(i * 2, rx, ry, rz);
      vp.setXYZ(i * 2 + 1, rx - slant * 0.35, ry - 0.14 - 0.08 * rainLevel, rz);
    }
    vp.needsUpdate = true;
  } else if (rain) rain.visible = false;
  if (bloom) bloom.strength = biome.sky ? skyBloom : 0.7;
  if (grade) {
    grade.uniforms.uTime.value = animT;
    if (biome.sky) {
      grade.uniforms.uNight.value = nightK;
      // golden hour: the sun low but risen — warmth swells, then fades with height
      const up = Math.max(0, Math.min(1, (sunK - 0.03) / 0.15));
      const high = Math.max(0, Math.min(1, (sunK - 0.55) / 0.3));
      grade.uniforms.uDusk.value = up * (1 - high);
    } else { grade.uniforms.uNight.value = 0.35; grade.uniforms.uDusk.value = 0.15; } // torchlight is its own hour
  }
  composer.render();
}
