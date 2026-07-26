/* The WebGL world: real geometry, per-pixel point lights over normal-mapped
   procedural stone, fog, bloom, and a camera that glides instead of teleporting.
   All game logic stays untouched — this module only reads `state` each frame. */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { MAPS, TOWN_DOORS, ENEMIES } from "./data";
import { state, cellAt } from "./state";
import { biomeFor, biomeTextures, biomeNormalMaps, biomeFloorTexture, type Biome } from "./biomes";
import { net } from "./net";
import { reduceMotion, rnd } from "./util";

/* ---------- deterministic per-cell hash (matches the old renderer) ---------- */
const cellHash = (x: number, y: number) => ((x * 7349 + y * 9151 + x * y * 41) >>> 0);

/* ---------- module state ---------- */
let renderer: THREE.WebGLRenderer | null = null;
let composer: EffectComposer | null = null;
let bloom: UnrealBloomPass | null = null;
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

/* signpost labels fade out when you stand under them */
let labels: {sprite: THREE.Sprite; pos: THREE.Vector3}[] = [];

/* drifting particles: rising embers below, wandering fireflies under the sky */
let emberPoints: THREE.Points | null = null;
let emberData: Float32Array | null = null;
let emberMode: "rise" | "drift" = "rise";

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
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(480, 360), 0.65, 0.55, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return true;
}

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

const woodMat = new THREE.MeshStandardMaterial({color: 0x3a2a18, roughness: 0.9});
const ironMat = new THREE.MeshStandardMaterial({color: 0x17100a, roughness: 0.7, metalness: 0.4});
const stoneMat = new THREE.MeshStandardMaterial({color: 0x4a4640, roughness: 0.95});

const PROPS3D: Record<string, Prop3D> = {
  torch(p) {
    const [fx, fz] = p.faceDir!;
    const bx = p.x + 0.5 + fx * 0.44, bz = p.z + 0.5 + fz * 0.44;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.28, 6), woodMat);
    shaft.position.set(bx + fx * -0.03, 0.62, bz + fz * -0.03);
    shaft.rotation.z = fx * -0.4; shaft.rotation.x = fz * 0.4;
    p.group.add(shaft);
    const tip = new THREE.Vector3(bx - fx * 0.1, 0.78, bz - fz * 0.1);
    addFlame(p.group, tip.x, tip.y, tip.z, "rgba(242,150,40,.9)", 0.34);
    addAnchor(tip, 0xffab4a, 6, 5, 0.3);
  },
  embervein(p) {
    const [fx, fz] = p.faceDir!;
    const pos = new THREE.Vector3(p.x + 0.5 + fx * 0.46, 0.5, p.z + 0.5 + fz * 0.46);
    addFlame(p.group, pos.x, pos.y, pos.z, "rgba(220,70,30,.55)", 0.5);
    addAnchor(pos, 0xdd5522, 3.2, 4, 0.5);
  },
  lamppost(p) {
    const px2 = p.x + 0.28, pz2 = p.z + 0.28;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.95, 6), ironMat);
    pole.position.set(px2, 0.48, pz2); p.group.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({color: 0xffc86a, emissive: 0xffa838, emissiveIntensity: 2.4});
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.09), lampMat);
    lamp.position.set(px2, 0.95, pz2); p.group.add(lamp);
    addAnchor(new THREE.Vector3(px2, 0.95, pz2), 0xffc06a, 5, 5.5, 0.06);
  },
  crate(p) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), woodMat);
    box.position.set(p.x + 0.72, 0.13, p.z + 0.3); box.rotation.y = (p.hash % 7) / 7;
    p.group.add(box);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 8),
      new THREE.MeshStandardMaterial({color: 0x46362a, roughness: 0.85}));
    barrel.position.set(p.x + 0.35, 0.15, p.z + 0.68); p.group.add(barrel);
  },
  puddle(p) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 18),
      new THREE.MeshStandardMaterial({color: 0x1a2836, roughness: 0.08, metalness: 0.85}));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x + 0.5 + ((p.hash % 13) - 6) * 0.02, 0.005, p.z + 0.5);
    p.group.add(disc);
  },
  rubble(p) {
    for (let i = 0; i < 4; i++) {
      const s = 0.03 + ((p.hash >> (i * 3)) % 17) / 17 * 0.05;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMat);
      rock.position.set(p.x + 0.25 + ((p.hash >> i) % 11) / 11 * 0.5, s * 0.8, p.z + 0.25 + ((p.hash >> (i + 3)) % 11) / 11 * 0.5);
      rock.rotation.set(i, p.hash % 7, 0);
      p.group.add(rock);
    }
  },
  crack(p) { /* engraved in the floor texture's spirit — skipped in 3D */ },
  mushrooms(p) {
    const capMat = new THREE.MeshStandardMaterial({color: 0x5a7a8a, emissive: 0x58c8f0, emissiveIntensity: 1.1});
    for (let i = 0; i < 3; i++) {
      const mh = 0.06 + ((p.hash >> (i * 2)) % 4) * 0.015;
      const mx = p.x + 0.35 + ((p.hash >> i) % 7) / 7 * 0.3, mz = p.z + 0.35 + ((p.hash >> (i + 2)) % 7) / 7 * 0.3;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, mh, 5),
        new THREE.MeshStandardMaterial({color: 0x3d4a52}));
      stem.position.set(mx, mh / 2, mz); p.group.add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.035, 7), capMat);
      cap.position.set(mx, mh + 0.012, mz); p.group.add(cap);
    }
    addAnchor(new THREE.Vector3(p.x + 0.5, 0.12, p.z + 0.5), 0x66c8ee, 1.6, 2.5, 0.35);
  },
  embervent(p) {
    const pos = new THREE.Vector3(p.x + 0.5, 0.02, p.z + 0.5);
    addFlame(p.group, pos.x, 0.06, pos.z, "rgba(255,110,40,.6)", 0.42);
    addAnchor(pos, 0xff6428, 3.5, 3.5, 0.6);
  },
  tree(p) {
    // a windswept moor pine, leaning off the path
    const th = 0.5 + ((p.hash >> 2) % 5) * 0.09;
    const tx = p.x + 0.22 + ((p.hash % 7) / 7) * 0.2, tz = p.z + 0.22 + (((p.hash >> 3) % 7) / 7) * 0.2;
    const lean = (((p.hash >> 5) % 9) - 4) * 0.03;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, th, 6), woodMat);
    trunk.position.set(tx, th / 2, tz); trunk.rotation.z = lean;
    p.group.add(trunk);
    const folMat = new THREE.MeshStandardMaterial({color: 0x16261a, roughness: 0.95});
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24 + ((p.hash >> 4) % 4) * 0.03, 0.5 + th * 0.5, 7), folMat);
    cone.position.set(tx + lean * th, th + 0.2, tz);
    p.group.add(cone);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.3 + ((p.hash >> 6) % 4) * 0.03, 0.34, 7), folMat);
    skirt.position.set(tx + lean * th * 0.6, th * 0.72, tz);
    p.group.add(skirt);
  },
};

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
  for (const mv of mobViews) { scene.remove(mv.sprite); scene.remove(mv.shadow); }
  mobViews = [];

  // atmosphere
  const town = biome.sky;
  const isMoor = biome.id === "moor", isHarbor = biome.id === "harbor";
  scene.fog = new THREE.FogExp2(
    isMoor ? 0x0a120e : town ? 0x0a0e1a : (biome.id === "emberdeep" ? 0x180a08 : 0x120c06),
    isMoor ? 0.085 : town ? 0.055 : 0.16);
  scene.background = new THREE.Color(isMoor ? 0x05090a : town ? 0x070b16 : 0x060403);
  ambient.intensity = town ? 0.32 : 0.28;
  ambient.color.set(isMoor ? 0x9ab8a8 : town ? 0x9aa4c8 : (biome.id === "emberdeep" ? 0xcc9070 : 0xbfa888));
  hemi.intensity = town ? 0.5 : 0;
  hemi.color.set(isMoor ? 0x7a9a8a : 0x8090b8);
  playerLight.color.set(isMoor ? 0xc3d2e6 : town ? 0xb8c4e6 : 0xffc478);
  playerLight.intensity = town ? 5 : 13;

  // materials from the biome bakery
  const albedos = biomeTextures(biome);
  const normals = biomeNormalMaps(biome);
  const wallMats = albedos.map((a, i) => new THREE.MeshStandardMaterial({
    map: tex(a), normalMap: new THREE.CanvasTexture(normals[i]), roughness: 0.92,
  }));
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  // pitched roofs: a flattened triangular prism, ridge along X (caps close the gables)
  const roofGeo = new THREE.CylinderGeometry(0.66, 0.66, 1.08, 3, 1, false, Math.PI / 2);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.scale(1, 0.55, 1);
  const roofMats = [0x5a3c30, 0x3c4450, 0x54452c].map(rc =>
    new THREE.MeshStandardMaterial({color: rc, roughness: 0.92}));
  const chimGeo = new THREE.BoxGeometry(0.13, 0.34, 0.13);

  // floor & ceiling
  const ftex = tex(biomeFloorTexture(biome), true);
  ftex.repeat.set(mw, mh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh),
    new THREE.MeshStandardMaterial({map: ftex, roughness: 0.95}));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(mw / 2, 0, mh / 2);
  worldGroup.add(floor);
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
    worldGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({color: 0xe8d9b0, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8})));
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture("rgba(225,228,215,.9)"), transparent: true}));
    moon.position.set(mw / 2 + 18, 16, mh / 2 - 30); moon.scale.setScalar(4);
    worldGroup.add(moon);
  }

  // walls, doors, wall props
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const ch = map[y][x];
    const isDoor = town && TOWN_DOORS.includes(ch);
    const solidWall = ch === "#" || isDoor;
    if (!solidWall) continue;
    const h = cellHash(x, y);
    const perimeter = x === 0 || y === 0 || x === mw - 1 || y === mh - 1;
    // buildings rise to different heights; moor walls are rocky outcrops
    let hgt = 1;
    if (isHarbor) hgt = perimeter ? 1.12 : 1.02 + (h % 5) * 0.11;
    else if (isMoor) hgt = 0.55 + (h % 7) * 0.07; // low outcrops you can see over
    if (isDoor) hgt = Math.max(hgt, 1.05);
    const wall = new THREE.Mesh(wallGeo, wallMats[h % wallMats.length]);
    wall.scale.y = hgt;
    wall.position.set(x + 0.5, hgt / 2, y + 0.5);
    worldGroup.add(wall);
    // doors greet every open side, so gates read from both directions
    const faces = isDoor
      ? ([[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]).filter(([dx, dy]) => map[y + dy]?.[x + dx] === ".")
      : [];
    const roofed = isHarbor && !perimeter;
    if (roofed) {
      const roof = new THREE.Mesh(roofGeo, roofMats[h % roofMats.length]);
      roof.position.set(x + 0.5, hgt + 0.18, y + 0.5);
      const ridgeAlongZ = faces.length ? faces[0][0] !== 0 : h % 2 === 1; // door ridges parallel the facade
      if (ridgeAlongZ) roof.rotation.y = Math.PI / 2;
      worldGroup.add(roof);
      if (h % 3 === 0) {
        const chim = new THREE.Mesh(chimGeo, stoneMat);
        chim.position.set(x + 0.5 + (ridgeAlongZ ? 0 : 0.2), hgt + 0.3, y + 0.5 + (ridgeAlongZ ? 0.2 : 0));
        worldGroup.add(chim);
      }
    } else if (isMoor && h % 4 === 0) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), stoneMat);
      rock.position.set(x + 0.5, hgt + 0.1, y + 0.5);
      rock.rotation.set(h % 5, h % 7, 0); rock.scale.set(1.1, 0.65, 1.1);
      worldGroup.add(rock);
    }
    if (isDoor) {
      for (const face of faces) {
        const dt = doorTexture(ch, albedos[h % albedos.length]);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98),
          new THREE.MeshStandardMaterial({map: dt, roughness: 0.9}));
        plane.position.set(x + 0.5 + face[0] * 0.505, 0.5, y + 0.5 + face[1] * 0.505);
        plane.lookAt(x + 0.5 + face[0] * 2, 0.5, y + 0.5 + face[1] * 2);
        worldGroup.add(plane);
        if (face === faces[0]) { // one door lamp is plenty, even on a two-faced gate
          const lpos = new THREE.Vector3(x + 0.5 + face[0] * 0.55, 0.62, y + 0.5 + face[1] * 0.55);
          addFlame(worldGroup, lpos.x - face[1] * 0.22, lpos.y, lpos.z - face[0] * 0.22, "rgba(250,190,90,.85)", 0.2);
          addAnchor(lpos, 0xffc06a, 3.5, 4, 0.08);
        }
      }
      const name = faces.length ? SIGN_NAMES[ch] : undefined;
      if (name) { // the sight, clearly marked
        const sp = labelSprite(name);
        sp.position.set(x + 0.5 + faces[0][0] * 0.6, hgt + (roofed ? 0.72 : 0.4), y + 0.5 + faces[0][1] * 0.6);
        worldGroup.add(sp);
        labels.push({sprite: sp, pos: sp.position.clone()});
      }
    } else if (!town) {
      const face = faceToOpen(map, x, y);
      if (face) {
        for (const place of biome.wallProps) {
          if (h % place.mod !== place.rem) continue;
          PROPS3D[place.id]?.({group: worldGroup, x, z: y, hash: h, biome, faceDir: face});
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
        PROPS3D[place.id]?.({group: worldGroup, x, z: y, hash: h, biome});
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
  camera.position.set(state.x + 0.5, 0.5, state.y + 0.5);
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
  const g = new THREE.Group();
  g.position.set(x, 0, y);
  const cx = 0.5, cz = 0.5;
  if (ch === "C") {
    const chest = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3),
      new THREE.MeshStandardMaterial({color: 0x7a5a2c, roughness: 0.8}));
    body.position.set(cx, 0.12, cz);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 8, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({color: 0x9a7a3c, roughness: 0.8}));
    lid.rotation.z = Math.PI / 2; lid.position.set(cx, 0.24, cz);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.02),
      new THREE.MeshStandardMaterial({color: 0xe0b24c, emissive: 0xa07820, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.3}));
    lock.position.set(cx, 0.14, cz + 0.16);
    chest.add(body, lid, lock);
    g.add(chest);
    consumables.push({mesh: chest, cellX: x, cellY: y, char: "C"});
  } else if (ch === "S" || ch === "U") {
    for (let i = 0; i < 4; i++) {
      const stepM = new THREE.Mesh(new THREE.BoxGeometry(0.8 - i * 0.12, 0.08, 0.24), stoneMat);
      stepM.position.set(cx, ch === "S" ? 0.04 + i * 0.02 : 0.08 + i * 0.14, cz - 0.3 + i * 0.2);
      g.add(stepM);
    }
    if (ch === "U") addAnchor(new THREE.Vector3(x + cx, 0.8, y + cz), 0xffc478, 2, 3, 0.1);
  } else if (ch === "F") {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.22, 12), stoneMat);
    basin.position.set(cx, 0.11, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.26, 12),
      new THREE.MeshStandardMaterial({color: 0x7fa8bd, emissive: 0x3888b8, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.6}));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.225, cz);
    g.add(basin, water);
    addAnchor(new THREE.Vector3(x + cx, 0.5, y + cz), 0x60b8e0, 3, 4, 0.15);
  } else if (ch === "B") {
    const bossM = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 7),
      new THREE.MeshStandardMaterial({color: 0x140a06, roughness: 0.9}));
    bossM.position.set(cx, 0.45, cz);
    const eyeMat = new THREE.MeshStandardMaterial({color: 0xffb44c, emissive: 0xff9020, emissiveIntensity: 3});
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
      eye.position.set(cx + dx, 0.68, cz + 0.24);
      g.add(eye);
    }
    g.add(bossM);
    addAnchor(new THREE.Vector3(x + cx, 0.6, y + cz), 0xdd4422, 5, 5, 0.5);
    consumables.push({mesh: g, cellX: x, cellY: y, char: "B"});
  } else if (ch === "E") {
    addFlame(worldGroup, x + cx, 0.7, y + cz, "rgba(210,220,235,.5)", 0.6);
    addAnchor(new THREE.Vector3(x + cx, 0.7, y + cz), 0xc8d4e8, 3, 4, 0.05);
  } else if (ch === "G") {
    const lit = new THREE.Group(), cold = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 6, 12), stoneMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.04, cz);
    g.add(ring);
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 5), woodMat);
      log.position.set(cx, 0.14, cz); log.rotation.z = 0.9; log.rotation.y = i * 2.1;
      g.add(log);
    }
    addFlame(lit, x + cx, 0.35, y + cz, "rgba(250,170,60,.95)", 0.55);
    addAnchor(new THREE.Vector3(x + cx, 0.4, y + cz), 0xffa040, 7, 6, 0.35);
    worldGroup.add(lit); worldGroup.add(cold);
    fireGroup = {lit, cold};
  } else if (ch === "R") {
    for (const dx of [-0.35, 0.35]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5), woodMat);
      post.position.set(cx + dx, 0.4, cz); g.add(post);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.34), woodMat);
    counter.position.set(cx, 0.15, cz); g.add(counter);
    const canopyCv = document.createElement("canvas"); canopyCv.width = 64; canopyCv.height = 16;
    const cc = canopyCv.getContext("2d")!;
    for (let i = 0; i < 8; i++) { cc.fillStyle = i % 2 ? "#8a3a28" : "#b8a888"; cc.fillRect(i * 8, 0, 8, 16); }
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34),
      new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(canopyCv), side: THREE.DoubleSide, roughness: 0.9}));
    canopy.rotation.x = -0.5; canopy.position.set(cx, 0.86, cz + 0.05);
    g.add(canopy);
  }
  if (biome.sky && SIGN_NAMES[ch]) { // plaza sights get their name in the air too
    const sp = labelSprite(SIGN_NAMES[ch]);
    sp.position.set(cx, 1.18, cz);
    g.add(sp);
    labels.push({sprite: sp, pos: new THREE.Vector3(x + cx, 1.18, y + cz)});
  }
  worldGroup.add(g);
}

/* ---------- per-frame update ---------- */
const yawFor = (dir: number) => [0, -Math.PI / 2, Math.PI, Math.PI / 2][dir];

export function frame(dt: number): void {
  if (!renderer || !composer || !state) return;
  animT += dt;
  if (builtLevel !== state.level) buildLevel();
  const biome = biomeFor(state.level);

  // camera glide
  const target = new THREE.Vector3(state.x + 0.5, 0.5, state.y + 0.5);
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
  // subtle breathing bob
  if (!reduceMotion) camera.position.y = 0.5 + Math.sin(animT * 1.7) * 0.006;
  playerLight.position.copy(camera.position).add(new THREE.Vector3(0, 0.06, 0));
  if (!reduceMotion) playerLight.intensity = (biome.sky ? 5 : 13) * (0.93 + 0.07 * Math.sin(animT * 5.3) + 0.03 * Math.sin(animT * 13.7));

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
    l.intensity = a.intensity * fl;
  }
  // flames breathe
  if (!reduceMotion) for (const f of flameSprites) {
    f.sprite.scale.setScalar(f.base * (0.85 + 0.2 * Math.sin(animT * 8 + f.phase)));
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
    if (!mob) { mv.sprite.visible = false; mv.shadow.visible = false; continue; }
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
    mv.sprite.position.set(mv.cur.x, 0.34 + bob, mv.cur.z);
    mv.sprite.scale.setScalar(0.62);
    mv.sprite.visible = true;
    mv.shadow.position.set(mv.cur.x, 0.011, mv.cur.z);
    mv.shadow.visible = true;
    const hue = ENEMIES[mob.key]?.hue;
    if (hue) mv.sprite.material.color.set(0xffffff);
  }
  // rising embers / wandering fireflies
  if (emberPoints && emberData) {
    const pos = emberPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const mw = MAPS[state.level][0].length, mh = MAPS[state.level].length;
    for (let i = 0; i < pos.count; i++) {
      if (emberMode === "drift") {
        const ph = emberData[i * 4 + 3];
        pos.setXYZ(i,
          emberData[i * 4] + Math.sin(animT * 0.55 + ph * 1.7) * 0.4,
          emberData[i * 4 + 1] + Math.sin(animT * 0.9 + ph) * 0.1,
          emberData[i * 4 + 2] + Math.cos(animT * 0.45 + ph * 2.3) * 0.4);
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
  if (bloom) bloom.strength = biome.sky ? 0.45 : 0.7;
  composer.render();
}
