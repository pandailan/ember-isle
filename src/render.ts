import { MAPS, LEVEL_NAMES, DIRV, DIRN, ENEMIES } from "./data";
import { state, cellAt, mobAt } from "./state";
import { $, rnd, reduceMotion } from "./util";

export const view = document.getElementById("view") as HTMLCanvasElement;
const ctx = view.getContext("2d")!;
export const amap = document.getElementById("automap") as HTMLCanvasElement;
const actx = amap.getContext("2d")!;

const W = 480, H = 360, CX = W / 2, CY = H / 2;
const HH = [260, 158, 100, 64, 41];      // half-heights of planes 0..4
const CW = [552, 336, 211, 137, 89];     // full cell width at planes 0..4
const FRONT = ["#6b5138", "#57422d", "#453424", "#33271b", "#221a11"];
const SIDE  = ["#5c452f", "#4a3826", "#3a2c1e", "#2b2117", "#1c1510"];

const px = (p: number, u: number) => CX + u * CW[p];
const TYP = (p: number) => CY - HH[p];
const BYP = (p: number) => CY + HH[p];

/* ---------- animation clock, sprite cache, ember particles ---------- */
let animT = 0;

/* ---------- procedural stone textures ---------- */
/* Irregular block courses with per-stone shading, relief edges, cracks,
   grain, and mossy variants. Deterministic, generated once. */
let wallTexCache: HTMLCanvasElement[] | null = null;

function makeWallTexture(seed: number, mossy: boolean): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d")!;
  let pi = 0;
  const pr = () => { const s = Math.sin(seed * 91.7 + (pi++) * 127.1) * 43758.5453; return s - Math.floor(s); };
  c.fillStyle = "#3a2b1b"; c.fillRect(0, 0, 128, 128); // mortar ground
  let y = 0;
  while (y < 128) {
    const rh = 17 + Math.floor(pr() * 15);
    let x = -Math.floor(pr() * 22);
    while (x < 128) {
      const bw = 20 + Math.floor(pr() * 28);
      const shade = 0.8 + pr() * 0.4;
      c.fillStyle = `rgb(${Math.round(92 * shade)},${Math.round(69 * shade)},${Math.round(47 * shade)})`;
      c.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
      c.fillStyle = "rgba(232,217,176,.07)"; c.fillRect(x + 1.5, y + 1.5, bw - 3, 2);   // top relief
      c.fillStyle = "rgba(0,0,0,.24)"; c.fillRect(x + 1.5, y + rh - 4.5, bw - 3, 3);   // under-shadow
      if (pr() < 0.18) { // a chipped corner
        c.fillStyle = "rgba(0,0,0,.2)";
        c.beginPath(); c.moveTo(x + 1.5, y + 1.5); c.lineTo(x + 8, y + 1.5); c.lineTo(x + 1.5, y + 7); c.closePath(); c.fill();
      }
      x += bw;
    }
    y += rh;
  }
  for (let k = 0; k < 3; k++) { // cracks wandering down
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1;
    c.beginPath();
    let cx0 = pr() * 128, cy0 = pr() * 60;
    c.moveTo(cx0, cy0);
    for (let s2 = 0; s2 < 4; s2++) { cx0 += (pr() - 0.5) * 26; cy0 += pr() * 20; c.lineTo(cx0, cy0); }
    c.stroke();
  }
  for (let k = 0; k < 320; k++) { // grain
    c.fillStyle = pr() < 0.5 ? "rgba(0,0,0,.1)" : "rgba(232,217,176,.05)";
    c.fillRect(pr() * 128, pr() * 128, 1.4, 1.4);
  }
  if (mossy) {
    for (let k = 0; k < 30; k++) {
      c.fillStyle = `rgba(92,122,58,${0.08 + pr() * 0.16})`;
      c.beginPath(); c.arc(pr() * 128, 55 + pr() * 73, 2 + pr() * 6, 0, 7); c.fill();
    }
  }
  return cv;
}

function wallTextures(): HTMLCanvasElement[] {
  if (!wallTexCache) wallTexCache = [
    makeWallTexture(1, false), makeWallTexture(2, false), makeWallTexture(3, false),
    makeWallTexture(4, true), makeWallTexture(5, true),
  ];
  return wallTexCache;
}

/** Stable per-cell randomness so both co-op screens dress the dungeon alike. */
const cellHash = (x: number, y: number) => ((x * 7349 + y * 9151 + x * y * 41) >>> 0);

const spriteCache: Record<string, HTMLCanvasElement> = {};
function getSprite(key: string): HTMLCanvasElement {
  if (!spriteCache[key]) {
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 96;
    drawMonster(cv, key, ENEMIES[key]?.hue ?? "#8a7a52");
    spriteCache[key] = cv;
  }
  return spriteCache[key];
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: string; }
let sparks: Spark[] = [];
function updateSparks(dt: number): void {
  if (sparks.length < 22 && rnd() < 0.35)
    sparks.push({x: rnd() * W, y: H - 10 - rnd() * 50, vx: (rnd() - 0.5) * 8,
                 vy: -(10 + rnd() * 16), life: 0, max: 2.5 + rnd() * 3,
                 hue: rnd() < 0.7 ? "224,154,60" : "200,80,47"});
  for (const s of sparks) {
    s.life += dt;
    s.x += s.vx * dt + Math.sin(animT * 2 + s.y * 0.05) * 8 * dt;
    s.y += s.vy * dt;
  }
  sparks = sparks.filter(s => s.life < s.max && s.y > -10);
}
function drawSparks(): void {
  for (const s of sparks) {
    const a = Math.sin(Math.PI * s.life / s.max) * 0.55;
    const r = 1.1 + Math.sin(s.life * 7) * 0.4;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4);
    g.addColorStop(0, `rgba(${s.hue},${a})`);
    g.addColorStop(1, `rgba(${s.hue},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(s.x - r * 4, s.y - r * 4, r * 8, r * 8);
  }
}

function poly(pts: [number, number][], fill: string): void {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}

const DEPTH_DIM = [0, 0.1, 0.3, 0.5, 0.66];

function drawFrontWall(d: number, l: number, wx: number, wy: number): void {
  const x0 = px(d, l - 0.5), x1 = px(d, l + 0.5), y0 = TYP(d), y1 = BYP(d), h = y1 - y0, w = x1 - x0;
  const tex = wallTextures()[cellHash(wx, wy) % 5];
  const tiles = w > 190 ? 2 : 1; // near faces get two texture tiles to stay crisp
  for (let t = 0; t < tiles; t++) ctx.drawImage(tex, x0 + (w / tiles) * t, y0, w / tiles, h);
  ctx.fillStyle = `rgba(8,5,3,${DEPTH_DIM[d]})`; ctx.fillRect(x0, y0, w, h);
  const sg = ctx.createLinearGradient(0, y0, 0, y1);
  sg.addColorStop(0, "rgba(0,0,0,.3)"); sg.addColorStop(0.45, "rgba(0,0,0,0)");
  sg.addColorStop(1, "rgba(0,0,0,.18)");
  ctx.fillStyle = sg; ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
}

function drawSideWall(d: number, u: number, wx: number, wy: number): void {
  const xa = px(d, u), xb = px(d + 1, u);
  const yat = TYP(d), yab = BYP(d), ybt = TYP(d + 1), ybb = BYP(d + 1);
  const tex = wallTextures()[cellHash(wx, wy) % 5];
  const strips = d <= 1 ? 12 : 8; // perspective-mapped texture strips
  const sw = tex.width / strips;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xa, yat); ctx.lineTo(xb, ybt); ctx.lineTo(xb, ybb); ctx.lineTo(xa, yab);
  ctx.closePath(); ctx.clip(); // smooth sloped edges — strips overdraw, the clip trims
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips, t1 = (i + 1) / strips;
    const sx0 = xa + (xb - xa) * t0, sx1 = xa + (xb - xa) * t1;
    const syT = Math.min(yat + (ybt - yat) * t0, yat + (ybt - yat) * t1);
    const syB = Math.max(yab + (ybb - yab) * t0, yab + (ybb - yab) * t1);
    ctx.drawImage(tex, i * sw, 0, sw, tex.height, sx0, syT, sx1 - sx0 + 0.6, syB - syT);
  }
  ctx.fillStyle = `rgba(8,5,3,${DEPTH_DIM[d] + 0.08})`; ctx.fill();
  const sg = ctx.createLinearGradient(xa, 0, xb, 0);
  sg.addColorStop(0, "rgba(0,0,0,.05)"); sg.addColorStop(1, "rgba(0,0,0,.4)");
  ctx.fillStyle = sg; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xa, yat); ctx.lineTo(xa, yab); ctx.stroke();
}

/** A wall-mounted torch: bracket, breathing flame, and a pool of light. */
function drawTorch(d: number, u: number, wx: number, wy: number): void {
  const xa = px(d, u), xb = px(d + 1, u);
  const tx = xa + (xb - xa) * 0.5;
  const yt = TYP(d) + (TYP(d + 1) - TYP(d)) * 0.5;
  const yb = BYP(d) + (BYP(d + 1) - BYP(d)) * 0.5;
  const ty = yt + (yb - yt) * 0.34;
  const s = HH[Math.min(d + 1, 4)] * (d === 0 ? 0.42 : 0.55);
  const phase = (cellHash(wx, wy) % 97) / 97 * 6.28;
  const fl = reduceMotion ? 1 : 0.85 + 0.22 * Math.sin(animT * 9 + phase) + 0.08 * Math.sin(animT * 23 + phase * 2);
  // pool of light on the stone
  const glow = ctx.createRadialGradient(tx, ty, 1, tx, ty, s * 2.6 * fl);
  glow.addColorStop(0, "rgba(240,180,80,.28)");
  glow.addColorStop(0.5, "rgba(224,154,60,.12)");
  glow.addColorStop(1, "rgba(224,154,60,0)");
  ctx.fillStyle = glow; ctx.fillRect(tx - s * 3, ty - s * 3, s * 6, s * 6);
  // bracket
  ctx.fillStyle = "#20150b";
  ctx.fillRect(tx - s * 0.07, ty, s * 0.14, s * 0.55);
  ctx.fillRect(tx - s * 0.16, ty + s * 0.5, s * 0.32, s * 0.1);
  // flame
  const fh = s * 0.65 * fl;
  const fg = ctx.createRadialGradient(tx, ty - fh * 0.35, 0, tx, ty - fh * 0.35, fh);
  fg.addColorStop(0, "rgba(255,242,190,.95)");
  fg.addColorStop(0.35, "rgba(242,172,64,.85)");
  fg.addColorStop(0.7, "rgba(200,80,40,.4)");
  fg.addColorStop(1, "rgba(200,80,40,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(tx, ty - fh * 0.35, fh * 0.5, fh * 0.85, (reduceMotion ? 0 : Math.sin(animT * 11 + phase) * 0.12), 0, Math.PI * 2);
  ctx.fill();
}

/** A dark timber crossing the corridor ceiling between two depth planes. */
function drawBeam(d: number): void {
  const xt = (t: number, u: number) => px(d, u) + (px(d + 1, u) - px(d, u)) * t;
  const yt = (t: number) => TYP(d) + (TYP(d + 1) - TYP(d)) * t;
  const t0 = 0.12, t1 = 0.34;
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.moveTo(xt(t0, -0.55), yt(t0)); ctx.lineTo(xt(t0, 0.55), yt(t0));
  ctx.lineTo(xt(t1, 0.55), yt(t1)); ctx.lineTo(xt(t1, -0.55), yt(t1));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xt(t1, -0.55), yt(t1)); ctx.lineTo(xt(t1, 0.55), yt(t1)); ctx.stroke();
  ctx.strokeStyle = "rgba(232,217,176,.05)";
  ctx.beginPath(); ctx.moveTo(xt(t0, -0.55), yt(t0)); ctx.lineTo(xt(t0, 0.55), yt(t0)); ctx.stroke();
}

/** Puddles that catch the torchlight, rubble, and cracked flagstones. */
function drawFloorProps(d: number, l: number, wx: number, wy: number): void {
  const h = cellHash(wx, wy);
  const s = HH[Math.min(d + 1, 4)];
  const cxm = CX + l * (CW[d] + CW[Math.min(d + 1, 4)]) / 2;
  const fy = CY + HH[Math.min(d + 1, 4)] * 0.9;
  if (h % 5 === 0) { // standing water
    ctx.fillStyle = "rgba(24,38,52,.6)";
    ctx.beginPath(); ctx.ellipse(cxm + ((h % 13) - 6) * s * 0.03, fy - s * 0.1, s * 0.55, s * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    const sh = reduceMotion ? 0.5 : 0.3 + 0.5 * Math.abs(Math.sin(animT * 1.8 + h));
    ctx.fillStyle = `rgba(150,180,205,${0.1 + 0.12 * sh})`;
    ctx.beginPath(); ctx.ellipse(cxm - s * 0.13, fy - s * 0.13, s * 0.2, s * 0.045, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(224,154,60,${0.06 + 0.09 * sh})`;
    ctx.beginPath(); ctx.ellipse(cxm + s * 0.16, fy - s * 0.08, s * 0.17, s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
    if (!reduceMotion) { // a drop falls from the dark above
      const dp = (animT * (0.35 + (h % 5) * 0.08) + h * 0.13) % 3;
      if (dp < 0.3) {
        const t2 = dp / 0.3;
        const ceilY = CY - HH[Math.min(d + 1, 4)] * 0.9;
        const dropY = ceilY + (fy - s * 0.1 - ceilY) * t2;
        ctx.fillStyle = "rgba(170,200,220,.5)";
        ctx.fillRect(cxm - 0.7, dropY, 1.4, Math.max(2, s * 0.06));
      }
    }
  } else if (h % 7 === 3) { // rubble
    for (let i = 0; i < 4; i++) {
      const p2 = ((h >> (i * 3)) % 17) / 17;
      ctx.fillStyle = `rgb(${70 + p2 * 30 | 0},${55 + p2 * 22 | 0},${42 + p2 * 15 | 0})`;
      ctx.beginPath();
      ctx.ellipse(cxm + (p2 - 0.5) * s * 0.85, fy - s * 0.06 - (i % 2) * s * 0.05,
        s * (0.06 + p2 * 0.07), s * (0.04 + p2 * 0.045), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (h % 6 === 1) { // cracked flagstone
    ctx.strokeStyle = "rgba(0,0,0,.32)"; ctx.lineWidth = Math.max(1, s * 0.028);
    ctx.beginPath();
    ctx.moveTo(cxm - s * 0.4, fy - s * 0.04);
    ctx.lineTo(cxm - s * 0.1, fy - s * 0.16);
    ctx.lineTo(cxm + s * 0.22, fy - s * 0.09);
    ctx.stroke();
  }
}

function drawFeature(c: string, d: number, l: number): void {
  const cxm = CX + l * (CW[d] + CW[Math.min(d + 1, 4)]) / 2;
  const s = HH[Math.min(d + 1, 4)];               // scale unit
  const fy = CY + HH[Math.min(d + 1, 4)] * 0.9;   // ground line
  ctx.save();
  if (c === "C") { // chest
    ctx.fillStyle = "#7a5a2c"; ctx.fillRect(cxm - s * 0.5, fy - s * 0.55, s, s * 0.55);
    ctx.fillStyle = "#9a7a3c"; ctx.fillRect(cxm - s * 0.5, fy - s * 0.72, s, s * 0.2);
    ctx.fillStyle = "#e0b24c"; ctx.fillRect(cxm - s * 0.08, fy - s * 0.5, s * 0.16, s * 0.2);
  } else if (c === "S" || c === "U") { // stairs
    for (let i = 0; i < 4; i++) {
      const t = i / 4, w2 = s * (0.9 - t * 0.5);
      ctx.fillStyle = c === "S" ? `rgba(10,7,5,${0.5 + t * 0.5})` : `rgba(224,154,60,${0.12 + t * 0.1})`;
      ctx.fillRect(cxm - w2 / 2, fy - s * 0.16 * (i + 1), w2, s * 0.16);
    }
  } else if (c === "F") { // fountain
    ctx.fillStyle = "#3d5a6b"; ctx.beginPath();
    ctx.ellipse(cxm, fy - s * 0.2, s * 0.55, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7fa8bd"; ctx.beginPath();
    ctx.ellipse(cxm, fy - s * 0.24, s * 0.4, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    const gl = ctx.createRadialGradient(cxm, fy - s * 0.5, 2, cxm, fy - s * 0.5, s * 0.8);
    gl.addColorStop(0, "rgba(127,168,189,.35)"); gl.addColorStop(1, "rgba(127,168,189,0)");
    ctx.fillStyle = gl; ctx.fillRect(cxm - s, fy - s * 1.4, s * 2, s * 1.6);
  } else if (c === "B") { // the Pyrelord waits, breathing light
    const pulse = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(animT * 2.6);
    ctx.fillStyle = "rgba(20,10,6,.9)"; ctx.beginPath();
    ctx.moveTo(cxm, fy - s * 1.5); ctx.lineTo(cxm + s * 0.7, fy); ctx.lineTo(cxm - s * 0.7, fy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e09a3c";
    ctx.fillRect(cxm - s * 0.18, fy - s * 1.05, s * 0.1, s * 0.07);
    ctx.fillRect(cxm + s * 0.08, fy - s * 1.05, s * 0.1, s * 0.07);
    const gl = ctx.createRadialGradient(cxm, fy - s * 0.7, 4, cxm, fy - s * 0.7, s * 1.5 * pulse);
    gl.addColorStop(0, `rgba(200,80,47,${0.34 * pulse})`); gl.addColorStop(1, "rgba(200,80,47,0)");
    ctx.fillStyle = gl; ctx.fillRect(cxm - s * 1.8, fy - s * 2.3, s * 3.6, s * 2.8);
  } else if (c === "E") { // way out: daylight arch with a falling shaft of light
    const shimmer = reduceMotion ? 0 : Math.sin(animT * 1.7) * 0.03;
    ctx.fillStyle = `rgba(232,217,176,${0.16 + shimmer})`;
    ctx.beginPath();
    ctx.moveTo(cxm - s * 0.45, fy); ctx.lineTo(cxm - s * 0.45, fy - s * 0.9);
    ctx.arc(cxm, fy - s * 0.9, s * 0.45, Math.PI, 0);
    ctx.lineTo(cxm + s * 0.45, fy); ctx.closePath(); ctx.fill();
    const ray = ctx.createLinearGradient(0, fy - s * 1.3, 0, fy + s * 0.6);
    ray.addColorStop(0, `rgba(232,217,176,${0.12 + shimmer})`);
    ray.addColorStop(1, "rgba(232,217,176,0)");
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(cxm - s * 0.45, fy - s * 1.3); ctx.lineTo(cxm + s * 0.45, fy - s * 1.3);
    ctx.lineTo(cxm + s * 1.0, fy + s * 0.6); ctx.lineTo(cxm - s * 1.0, fy + s * 0.6);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** A monster pack standing in the corridor, bobbing in the torchlight. */
function drawMob(key: string, d: number, l: number, wx: number, wy: number): void {
  const s = HH[Math.min(d + 1, 4)];
  const cxm = CX + l * (CW[d] + CW[Math.min(d + 1, 4)]) / 2;
  const fy = CY + HH[Math.min(d + 1, 4)] * 0.9;
  const size = s * 1.7;
  const bob = reduceMotion ? 0 : Math.sin(animT * 2.6 + wx * 7 + wy * 13) * s * 0.05;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.42)";
  ctx.beginPath(); ctx.ellipse(cxm, fy, size * 0.3, size * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  const hue = ENEMIES[key]?.hue ?? "#8a7a52";
  const gl = ctx.createRadialGradient(cxm, fy - size * 0.45, 2, cxm, fy - size * 0.45, size * 0.7);
  gl.addColorStop(0, hue + "2e"); gl.addColorStop(1, hue + "00");
  ctx.fillStyle = gl; ctx.fillRect(cxm - size, fy - size * 1.2, size * 2, size * 1.4);
  ctx.globalAlpha = [1, 1, 0.95, 0.82, 0.65][d];
  ctx.drawImage(getSprite(key), cxm - size / 2, fy - size + bob, size, size);
  ctx.restore();
}

export function renderView(): void {
  // ceiling
  let g = ctx.createLinearGradient(0, 0, 0, CY);
  g.addColorStop(0, "#040302"); g.addColorStop(1, "#1a1209");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, CY);
  // floor
  g = ctx.createLinearGradient(0, CY, 0, H);
  g.addColorStop(0, "#130d07"); g.addColorStop(1, "#342718");
  ctx.fillStyle = g; ctx.fillRect(0, CY, W, H);
  // perspective seams: flagstone rows and ceiling beams
  for (let p = 4; p >= 1; p--) {
    const a = 0.06 + (4 - p) * 0.05;
    ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, BYP(p)); ctx.lineTo(W, BYP(p)); ctx.stroke();
    ctx.strokeStyle = `rgba(232,217,176,${a * 0.28})`;
    ctx.beginPath(); ctx.moveTo(0, TYP(p)); ctx.lineTo(W, TYP(p)); ctx.stroke();
  }
  // converging flagstone joints
  ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 1;
  for (let u = -3.5; u <= 3.5; u++) {
    ctx.beginPath(); ctx.moveTo(px(4, u), BYP(4)); ctx.lineTo(px(0, u), BYP(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px(4, u), TYP(4)); ctx.lineTo(px(0, u), TYP(0)); ctx.stroke();
  }

  const f = DIRV[state.dir], r = DIRV[(state.dir + 1) % 4];
  const at = (d: number, l: number) =>
    cellAt(state.level, state.x + f[0] * d + r[0] * l, state.y + f[1] * d + r[1] * l);
  const isWall = (d: number, l: number) => at(d, l) === "#";

  for (let d = 4; d >= 0; d--) {
    const feats: [string, number, number][] = [];
    const props: [number, number, number, number][] = [];
    const beams: number[] = [];
    const mobsHere: [string, number, number, number, number][] = [];
    const lats: number[] = []; for (let l = -4; l <= 4; l++) lats.push(l);
    lats.sort((a, b) => Math.abs(b) - Math.abs(a));
    for (const l of lats) {
      const wx = state.x + f[0] * d + r[0] * l, wy = state.y + f[1] * d + r[1] * l;
      if (isWall(d, l)) {
        if (d < 4) { // side faces toward corridor center, some carrying torches
          if (l > 0 && !isWall(d, l - 1)) {
            drawSideWall(d, l - 0.5, wx, wy);
            if (d <= 2 && cellHash(wx, wy) % 3 === 0) drawTorch(d, l - 0.5, wx, wy);
          }
          if (l < 0 && !isWall(d, l + 1)) {
            drawSideWall(d, l + 0.5, wx, wy);
            if (d <= 2 && cellHash(wx, wy) % 3 === 0) drawTorch(d, l + 0.5, wx, wy);
          }
        }
        if (d >= 1) drawFrontWall(d, l, wx, wy);
      } else {
        const c = at(d, l);
        // (you don't see the arch you're standing in)
        if (c !== "." && c !== "#" && Math.abs(l) <= 1 && d <= 3 && !(c === "E" && d === 0 && l === 0))
          feats.push([c, d, l]);
        if (Math.abs(l) <= 2 && d >= 1 && d <= 3) props.push([d, l, wx, wy]);
        if (l === 0 && d >= 1 && d <= 3 && cellHash(wx, wy) % 4 === 2) beams.push(d);
        if (Math.abs(l) <= 2 && d >= 1 && d <= 3) {
          const mob = mobAt(state.level, wx, wy);
          if (mob) mobsHere.push([mob.key, d, l, wx, wy]);
        }
      }
    }
    for (const bd of beams) drawBeam(bd);
    for (const [pd, pl, wx, wy] of props) drawFloorProps(pd, pl, wx, wy);
    for (const [c, fd, fl] of feats) drawFeature(c, fd, fl);
    for (const [k, md, ml, wx, wy] of mobsHere) drawMob(k, md, ml, wx, wy);
  }
  // drifting embers
  drawSparks();
  // torch glow — a slow breath rather than random jitter
  const tflick = reduceMotion ? 1 : 0.94 + 0.06 * Math.sin(animT * 5.3) + 0.03 * Math.sin(animT * 13.7);
  const tg = ctx.createRadialGradient(CX, CY + 16, 26, CX, CY + 16, 290 * tflick);
  tg.addColorStop(0, "rgba(224,154,60,.13)");
  tg.addColorStop(0.45, "rgba(224,154,60,.04)");
  tg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H);
  // darkness vignette
  const v = ctx.createRadialGradient(CX, CY, 60, CX, CY, 300);
  const a = reduceMotion ? 0.42 : 0.40 + 0.035 * Math.sin(animT * 4.1);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.55, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  $("pos-label").textContent = LEVEL_NAMES[state.level];
  $("dir-label").textContent = DIRN[state.dir];
  if (amap.classList.contains("on")) renderAutomap();
}

export function renderAutomap(): void {
  const m = MAPS[state.level], mw = m[0].length, mh = m.length;
  const cs = Math.floor(Math.min(120 / mw, 120 / mh));
  actx.clearRect(0, 0, 120, 120);
  const vis = new Set(state.visited[state.level]);
  const ox = (120 - cs * mw) / 2, oy = (120 - cs * mh) / 2;
  const FEAT_HUE: Record<string, string> =
    {C:"#e0b24c", S:"#e8d9b0", U:"#e8d9b0", F:"#7fa8bd", B:"#c8502f", E:"#8fae6a"};
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (!vis.has(x + "," + y)) continue;
    const c = cellAt(state.level, x, y);
    actx.fillStyle = c === "#" ? "#3a2d1c" : "#241c12";
    actx.fillRect(ox + x * cs, oy + y * cs, cs - 1, cs - 1);
    if (FEAT_HUE[c]) {
      actx.fillStyle = FEAT_HUE[c];
      actx.fillRect(ox + x * cs + cs * 0.25, oy + y * cs + cs * 0.25, cs * 0.5 - 1, cs * 0.5 - 1);
    }
    if (mobAt(state.level, x, y)) {
      actx.fillStyle = "#c8502f";
      actx.beginPath();
      actx.arc(ox + x * cs + cs / 2, oy + y * cs + cs / 2, cs * 0.28, 0, Math.PI * 2);
      actx.fill();
    }
    // reveal walls adjacent to visited floor
    for (const [dx, dy] of DIRV) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < mw && ny < mh && m[ny][nx] === "#") {
        actx.fillStyle = "#3a2d1c";
        actx.fillRect(ox + nx * cs, oy + ny * cs, cs - 1, cs - 1);
      }
    }
  }
  // player arrow
  const pxx = ox + state.x * cs + cs / 2, pyy = oy + state.y * cs + cs / 2, a2 = cs * 0.42;
  const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][state.dir];
  actx.fillStyle = "#e09a3c"; actx.beginPath();
  actx.moveTo(pxx + Math.cos(ang) * a2, pyy + Math.sin(ang) * a2);
  actx.lineTo(pxx + Math.cos(ang + 2.5) * a2, pyy + Math.sin(ang + 2.5) * a2);
  actx.lineTo(pxx + Math.cos(ang - 2.5) * a2, pyy + Math.sin(ang - 2.5) * a2);
  actx.closePath(); actx.fill();
}

export function drawMonster(cv: HTMLCanvasElement, key: string, hue: string): void {
  const c = cv.getContext("2d")!, s = cv.width; c.clearRect(0, 0, s, s);
  c.save(); c.translate(s / 2, s / 2); c.scale(s / 96, s / 96);
  const g = c.createRadialGradient(0, 4, 4, 0, 4, 44);
  g.addColorStop(0, hue + "44"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(-48, -48, 96, 96);
  const dark = "#0d0906", mid = "#1e150c";
  const eye = (x: number, y: number, r: number, col?: string) => {
    c.fillStyle = col || hue; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.fillStyle = col || hue; c.globalAlpha = .3; c.beginPath(); c.arc(x, y, r * 2.2, 0, 7); c.fill(); c.globalAlpha = 1;
  };
  if (key === "rat") {
    c.strokeStyle = mid; c.lineWidth = 4; c.beginPath(); c.moveTo(18, 22); c.quadraticCurveTo(42, 18, 38, -6); c.stroke();
    c.fillStyle = dark; c.beginPath(); c.ellipse(2, 12, 24, 15, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(-20, 2, 13, 10, -.4, 0, 7); c.fill();
    c.beginPath(); c.arc(-16, -9, 5, 0, 7); c.arc(-25, -6, 5, 0, 7); c.fill();
    eye(-26, 2, 2.4, "#d94f35");
  } else if (key === "sli") {
    c.fillStyle = "#27401f"; c.beginPath();
    c.moveTo(-28, 20); c.quadraticCurveTo(-30, -14, -8, -16); c.quadraticCurveTo(2, -26, 12, -14);
    c.quadraticCurveTo(30, -10, 28, 20); c.closePath(); c.fill();
    c.fillStyle = "rgba(232,217,176,.14)"; c.beginPath(); c.ellipse(-10, -6, 7, 4, -.5, 0, 7); c.fill();
    eye(-6, 4, 3, "#9fd06a"); eye(8, 4, 3, "#9fd06a");
  } else if (key === "gob") {
    c.fillStyle = dark; c.beginPath(); c.arc(0, 2, 17, 0, 7); c.fill();
    c.beginPath(); c.moveTo(-14, -4); c.lineTo(-34, -12); c.lineTo(-14, 6); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(14, -4); c.lineTo(34, -12); c.lineTo(14, 6); c.closePath(); c.fill();
    c.fillStyle = mid; c.beginPath(); c.moveTo(-8, 14); c.lineTo(8, 14); c.lineTo(0, 22); c.closePath(); c.fill();
    eye(-6, -1, 2.6); eye(6, -1, 2.6);
  } else if (key === "ske") {
    c.fillStyle = "#c9bfa8"; c.beginPath(); c.arc(0, -4, 16, 0, 7); c.fill();
    c.fillRect(-10, 8, 20, 10);
    c.fillStyle = "#0a0705"; c.beginPath(); c.arc(-6, -6, 4.4, 0, 7); c.arc(6, -6, 4.4, 0, 7); c.fill();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-3, 6); c.lineTo(3, 6); c.closePath(); c.fill();
    c.strokeStyle = "#0a0705"; c.lineWidth = 1.6;
    for (let x = -7; x <= 7; x += 3.5) { c.beginPath(); c.moveTo(x, 9); c.lineTo(x, 17); c.stroke(); }
    eye(-6, -6, 1.6, "#7fa8bd"); eye(6, -6, 1.6, "#7fa8bd");
  } else if (key === "orc") {
    c.fillStyle = dark; c.beginPath(); c.arc(0, -2, 18, 0, 7); c.fill();
    c.fillRect(-15, 8, 30, 12);
    c.fillStyle = "#c9bfa8";
    c.beginPath(); c.moveTo(-11, 12); c.lineTo(-8, 12); c.lineTo(-9.5, 2); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(11, 12); c.lineTo(8, 12); c.lineTo(9.5, 2); c.closePath(); c.fill();
    eye(-7, -6, 2.8, "#d97a35"); eye(7, -6, 2.8, "#d97a35");
  } else if (key === "wra") {
    c.fillStyle = "rgba(20,26,32,.92)"; c.beginPath();
    c.moveTo(0, -30); c.quadraticCurveTo(22, -18, 18, 6);
    c.quadraticCurveTo(24, 20, 14, 26); c.lineTo(10, 18); c.lineTo(4, 28); c.lineTo(-2, 18);
    c.lineTo(-8, 28); c.lineTo(-14, 20); c.quadraticCurveTo(-24, 12, -18, -6);
    c.quadraticCurveTo(-20, -20, 0, -30); c.closePath(); c.fill();
    c.fillStyle = "#05070a"; c.beginPath(); c.ellipse(0, -8, 10, 12, 0, 0, 7); c.fill();
    eye(-4, -9, 2.2, "#a8cce0"); eye(4, -9, 2.2, "#a8cce0");
  } else if (key === "cul") {
    c.fillStyle = dark; c.beginPath();
    c.moveTo(0, -28); c.quadraticCurveTo(20, -16, 16, 30); c.lineTo(-16, 30);
    c.quadraticCurveTo(-20, -16, 0, -28); c.closePath(); c.fill();
    c.fillStyle = "#060403"; c.beginPath(); c.ellipse(0, -10, 9, 11, 0, 0, 7); c.fill();
    c.fillStyle = "#c8502f"; c.beginPath(); c.arc(0, 10, 3.4, 0, 7); c.fill();
    c.strokeStyle = "#c8502f"; c.globalAlpha = .4; c.beginPath(); c.arc(0, 10, 6, 0, 7); c.stroke(); c.globalAlpha = 1;
    eye(-3.5, -11, 1.8, "#e09a3c"); eye(3.5, -11, 1.8, "#e09a3c");
  } else if (key === "gol") {
    c.fillStyle = "#3d3a35"; c.fillRect(-16, -24, 32, 22);
    c.fillRect(-22, -2, 44, 26);
    c.fillStyle = "#2a2724"; c.fillRect(-30, -2, 9, 22); c.fillRect(21, -2, 9, 22);
    c.strokeStyle = "#e09a3c"; c.lineWidth = 1.6; c.globalAlpha = .75;
    c.beginPath(); c.moveTo(-6, 4); c.lineTo(0, 12); c.lineTo(-3, 20); c.stroke();
    c.beginPath(); c.moveTo(6, 2); c.lineTo(4, 10); c.stroke(); c.globalAlpha = 1;
    eye(-7, -14, 3, "#e09a3c"); eye(7, -14, 3, "#e09a3c");
  } else { // boss: Pyrelord Vhal
    for (let i = 0; i < 7; i++) { // crown of flame
      const x = -18 + i * 6;
      c.fillStyle = i % 2 ? "#e09a3c" : "#c8502f"; c.globalAlpha = .85;
      c.beginPath(); c.moveTo(x - 2.6, -22); c.quadraticCurveTo(x, (-34 - (i % 3) * 4), x + 2.6, -22); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
    c.strokeStyle = dark; c.lineWidth = 5;
    c.beginPath(); c.moveTo(-16, -16); c.quadraticCurveTo(-32, -24, -30, -40); c.stroke();
    c.beginPath(); c.moveTo(16, -16); c.quadraticCurveTo(32, -24, 30, -40); c.stroke();
    c.fillStyle = dark; c.beginPath(); c.arc(0, -8, 18, 0, 7); c.fill();
    c.beginPath(); c.moveTo(-26, 30); c.quadraticCurveTo(0, 8, 26, 30); c.lineTo(-26, 30); c.closePath(); c.fill();
    c.fillStyle = mid; c.beginPath(); c.moveTo(-9, 4); c.lineTo(9, 4); c.lineTo(0, 12); c.closePath(); c.fill();
    eye(-7, -10, 3.2, "#e09a3c"); eye(7, -10, 3.2, "#e09a3c");
  }
  c.restore();
}

/* ============================== TITLE SCENE ============================== */
/* A painted view of Vhalis at night: moonlit sea, the island's silhouette,
   and the Ember glowing beneath the water. */
const prand = (i: number) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };

export function renderTitle(): void {
  const tc = document.getElementById("title-canvas") as HTMLCanvasElement | null;
  if (!tc) return;
  const c = tc.getContext("2d")!;
  const TW = tc.width, TH = tc.height, HOR = TH * 0.62;
  // night sky
  let g = c.createLinearGradient(0, 0, 0, HOR);
  g.addColorStop(0, "#070b14"); g.addColorStop(1, "#1a1410");
  c.fillStyle = g; c.fillRect(0, 0, TW, HOR);
  // stars
  for (let i = 0; i < 40; i++) {
    const tw = reduceMotion ? 0.7 : 0.4 + 0.6 * Math.abs(Math.sin(animT * (0.5 + prand(i + 9)) + i));
    c.fillStyle = `rgba(232,217,176,${0.5 * tw * prand(i + 40)})`;
    c.fillRect(prand(i) * TW, prand(i + 80) * HOR * 0.85, 1.4, 1.4);
  }
  // moon
  c.fillStyle = "rgba(220,222,210,.85)";
  c.beginPath(); c.arc(TW * 0.78, TH * 0.18, 13, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#0b0f18";
  c.beginPath(); c.arc(TW * 0.78 + 5, TH * 0.18 - 3, 11, 0, Math.PI * 2); c.fill();
  // sea
  g = c.createLinearGradient(0, HOR, 0, TH);
  g.addColorStop(0, "#101822"); g.addColorStop(1, "#070a10");
  c.fillStyle = g; c.fillRect(0, HOR, TW, TH - HOR);
  // the Ember, burning beneath the bay
  const pulse = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(animT * 1.3);
  const em = c.createRadialGradient(TW * 0.42, TH * 0.9, 4, TW * 0.42, TH * 0.9, 90 * pulse);
  em.addColorStop(0, `rgba(200,80,47,${0.5 * pulse})`);
  em.addColorStop(0.4, `rgba(224,154,60,${0.22 * pulse})`);
  em.addColorStop(1, "rgba(224,154,60,0)");
  c.fillStyle = em; c.fillRect(0, HOR, TW, TH - HOR);
  // wave glints
  for (let i = 0; i < 26; i++) {
    const y = HOR + 6 + prand(i + 7) * (TH - HOR - 10);
    const ph = reduceMotion ? 0.5 : Math.sin(animT * (0.8 + prand(i)) + i * 2);
    const wgl = i % 3 === 0 ? "224,154,60" : "180,190,200";
    c.fillStyle = `rgba(${wgl},${0.06 + 0.1 * Math.abs(ph)})`;
    c.fillRect(prand(i + 30) * TW + ph * 6, y, 12 + prand(i) * 22, 1.2);
  }
  // island silhouette with the Old Stair's tower
  c.fillStyle = "#0a0805";
  c.beginPath();
  c.moveTo(TW * 0.04, HOR + 1);
  c.quadraticCurveTo(TW * 0.14, HOR - TH * 0.16, TW * 0.28, HOR - TH * 0.1);
  c.lineTo(TW * 0.31, HOR - TH * 0.3); c.lineTo(TW * 0.345, HOR - TH * 0.3); // tower
  c.lineTo(TW * 0.36, HOR - TH * 0.09);
  c.quadraticCurveTo(TW * 0.5, HOR - TH * 0.05, TW * 0.56, HOR + 1);
  c.closePath(); c.fill();
  // one lit window in the tavern tower
  const win = reduceMotion ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(animT * 3 + 1));
  c.fillStyle = `rgba(224,154,60,${win})`;
  c.fillRect(TW * 0.325, HOR - TH * 0.26, 3, 4);
  // rising embers from the bay
  for (let i = 0; i < 8; i++) {
    const ph = (reduceMotion ? 0.4 : (animT * (0.12 + prand(i) * 0.1) + prand(i + 3)) % 1);
    const ex = TW * 0.42 + Math.sin((ph * 5 + i) * 2) * 30 * prand(i + 5);
    const ey = TH * 0.95 - ph * (TH * 0.55);
    c.fillStyle = `rgba(224,154,60,${(1 - ph) * 0.5})`;
    c.fillRect(ex, ey, 1.6, 1.6);
  }
}

/* ============================== RENDER LOOP ============================== */
let loopStarted = false;
export function startRenderLoop(): void {
  if (loopStarted || reduceMotion) { if (reduceMotion) renderTitle(); return; }
  loopStarted = true;
  let last = 0, acc = 0;
  const frame = (ts: number): void => {
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
    animT += dt; acc += dt;
    if (acc >= 1 / 30) { // 30fps is plenty for torchlight
      acc = 0;
      const scr = document.querySelector(".screen.on")?.id;
      if (scr === "scr-dungeon" && state) { updateSparks(dt * 2); renderView(); }
      else if (scr === "scr-title") renderTitle();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
