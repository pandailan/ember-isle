/* 2D subsystems: the automap, the painted title scene, and the monster art
   used for both combat portraits and in-world sprites. The first-person view
   itself is rendered by the WebGL engine in scene3d.ts. */

import { MAPS, LEVEL_NAMES, DIRN, ENEMIES } from "./data";
import { phaseName, WEATHER_NAMES } from "./daytime";
import { state, cellAt, mobAt } from "./state";
import { $, reduceMotion } from "./util";


export const view = document.getElementById("view") as HTMLCanvasElement;
export const amap = document.getElementById("automap") as HTMLCanvasElement;

const DPR = Math.min(window.devicePixelRatio || 1, 2);
amap.width = 120 * DPR; amap.height = 120 * DPR;
amap.style.width = "120px"; amap.style.height = "120px";
const actx = amap.getContext("2d")!;
actx.scale(DPR, DPR);

const DIRV_A = [[0, -1], [1, 0], [0, 1], [-1, 0]];

let webgl = false;
let s3d: typeof import("./scene3d") | null = null;

/** The world engine streams in behind the title screen; the page is
    interactive immediately. */
export function bootRenderer(): void {
  void import("./scene3d").then(m => {
    s3d = m;
    m.setSpriteSource(getSprite);
    webgl = m.initScene(view);
    document.getElementById("gl-loading")?.classList.add("done");
    if (!webgl) glFallback("This device does not support WebGL.");
  }).catch(() => {
    document.getElementById("gl-loading")?.classList.add("done");
    glFallback("The world failed to load — check the connection and reload.");
  });
}

function glFallback(msg: string): void {
  const c = view.getContext("2d");
  if (c) { c.fillStyle = "#120c06"; c.fillRect(0, 0, view.width, view.height);
    c.fillStyle = "#e8d9b0"; c.font = "16px serif"; c.fillText(msg, 60, 180); }
}

/** Called by game code after any move or change: refreshes labels + automap.
    The 3D view itself re-renders continuously from state. */
export function renderView(): void {
  const wname = WEATHER_NAMES[state.weather] ? " · " + WEATHER_NAMES[state.weather] : "";
  $("pos-label").textContent = (state.level === 0 || state.level === 3 || state.level === 4)
    ? `${LEVEL_NAMES[state.level]} · ${phaseName(state.clock)}${wname}`
    : LEVEL_NAMES[state.level];
  $("dir-label").textContent = DIRN[state.dir];
  if (amap.classList.contains("on")) renderAutomap();
}

export function renderAutomap(): void {
  const m = MAPS[state.level], mw = m[0].length, mh = m.length;
  const cs = Math.floor(Math.min(120 / mw, 120 / mh));
  actx.clearRect(0, 0, 120, 120);
  const vis = new Set(state.visited[state.level] ?? []);
  const ox = (120 - cs * mw) / 2, oy = (120 - cs * mh) / 2;
  const FEAT_HUE: Record<string, string> =
    {C: "#e0b24c", S: "#e8d9b0", U: "#e8d9b0", F: "#7fa8bd", B: "#c8502f", E: "#8fae6a",
     T: "#e0b24c", P: "#c8502f", M: "#7fa8bd", O: "#b8b0a0", H: "#8fae6a", G: "#e09a3c", R: "#b8a888",
     W: "#8fae6a", V: "#8fae6a", X: "#c8b0e0"};
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (!vis.has(x + "," + y)) continue;
    const c = cellAt(state.level, x, y);
    actx.fillStyle = c === "#" ? "#3a2d1c" : c === "~" ? "#16303e" : "#241c12";
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
    for (const [dx, dy] of DIRV_A) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < mw && ny < mh && (m[ny][nx] === "#" || m[ny][nx] === "~")) {
        actx.fillStyle = m[ny][nx] === "~" ? "#16303e" : "#3a2d1c";
        actx.fillRect(ox + nx * cs, oy + ny * cs, cs - 1, cs - 1);
      }
    }
  }
  const pxx = ox + state.x * cs + cs / 2, pyy = oy + state.y * cs + cs / 2, a2 = cs * 0.42;
  const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][state.dir];
  actx.fillStyle = "#e09a3c"; actx.beginPath();
  actx.moveTo(pxx + Math.cos(ang) * a2, pyy + Math.sin(ang) * a2);
  actx.lineTo(pxx + Math.cos(ang + 2.5) * a2, pyy + Math.sin(ang + 2.5) * a2);
  actx.lineTo(pxx + Math.cos(ang - 2.5) * a2, pyy + Math.sin(ang - 2.5) * a2);
  actx.closePath(); actx.fill();
}

/* ---------- in-world combat view (forwarded to the 3D engine) ---------- */
export interface FoeView { key: string; hp: number; maxhp: number; boss?: boolean; }
export function combatView(enemies: {key: string; hp: number; maxhp: number; boss?: boolean}[] | null): void {
  s3d?.showCombat(enemies ? enemies.map(e => ({key: e.key, hp: e.hp, maxhp: e.maxhp, boss: !!e.boss})) : null);
}
export function combatPop(idx: number, text: string, cls: string): void {
  s3d?.combatPop(idx, text, cls);
}

/* ---------- monster art (portraits + world sprites) ---------- */
const spriteCache: Record<string, HTMLCanvasElement> = {};
export function getSprite(key: string): HTMLCanvasElement {
  if (!spriteCache[key]) {
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 96;
    drawMonster(cv, key, ENEMIES[key]?.hue ?? "#8a7a52");
    spriteCache[key] = cv;
  }
  return spriteCache[key];
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
  } else if (key === "wlf") {
    c.strokeStyle = mid; c.lineWidth = 4;
    c.beginPath(); c.moveTo(22, 10); c.quadraticCurveTo(38, 4, 34, -10); c.stroke(); // tail
    c.fillStyle = "#1a2028";
    c.beginPath(); c.ellipse(4, 8, 22, 12, 0, 0, 7); c.fill();                        // body
    c.beginPath(); c.ellipse(-18, -4, 12, 9, -0.3, 0, 7); c.fill();                   // head
    c.beginPath(); c.moveTo(-28, -6); c.lineTo(-36, -2); c.lineTo(-26, 0); c.closePath(); c.fill(); // snout
    c.beginPath(); c.moveTo(-20, -12); c.lineTo(-16, -22); c.lineTo(-12, -12); c.closePath(); c.fill(); // ear
    c.beginPath(); c.moveTo(-12, -12); c.lineTo(-8, -20); c.lineTo(-4, -11); c.closePath(); c.fill();
    for (const lx of [-8, 2, 12]) c.fillRect(lx, 16, 3.5, 8);                          // legs
    eye(-22, -6, 2.2, "#b8d0e0");
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
const prand = (i: number) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };
let animT = 0;
let titleScaled = false;

export function renderTitle(): void {
  const tc = document.getElementById("title-canvas") as HTMLCanvasElement | null;
  if (!tc) return;
  if (!titleScaled) {
    tc.width = 480 * DPR; tc.height = 220 * DPR;
    tc.getContext("2d")!.scale(DPR, DPR);
    titleScaled = true;
  }
  const c = tc.getContext("2d")!;
  const TW = 480, TH = 220, HOR = TH * 0.62;
  let g = c.createLinearGradient(0, 0, 0, HOR);
  g.addColorStop(0, "#070b14"); g.addColorStop(1, "#1a1410");
  c.fillStyle = g; c.fillRect(0, 0, TW, HOR);
  for (let i = 0; i < 40; i++) {
    const tw = reduceMotion ? 0.7 : 0.4 + 0.6 * Math.abs(Math.sin(animT * (0.5 + prand(i + 9)) + i));
    c.fillStyle = `rgba(232,217,176,${0.5 * tw * prand(i + 40)})`;
    c.fillRect(prand(i) * TW, prand(i + 80) * HOR * 0.85, 1.4, 1.4);
  }
  c.fillStyle = "rgba(220,222,210,.85)";
  c.beginPath(); c.arc(TW * 0.78, TH * 0.18, 13, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#0b0f18";
  c.beginPath(); c.arc(TW * 0.78 + 5, TH * 0.18 - 3, 11, 0, Math.PI * 2); c.fill();
  g = c.createLinearGradient(0, HOR, 0, TH);
  g.addColorStop(0, "#101822"); g.addColorStop(1, "#070a10");
  c.fillStyle = g; c.fillRect(0, HOR, TW, TH - HOR);
  const pulse = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(animT * 1.3);
  const em = c.createRadialGradient(TW * 0.42, TH * 0.9, 4, TW * 0.42, TH * 0.9, 90 * pulse);
  em.addColorStop(0, `rgba(200,80,47,${0.5 * pulse})`);
  em.addColorStop(0.4, `rgba(224,154,60,${0.22 * pulse})`);
  em.addColorStop(1, "rgba(224,154,60,0)");
  c.fillStyle = em; c.fillRect(0, HOR, TW, TH - HOR);
  for (let i = 0; i < 26; i++) {
    const y = HOR + 6 + prand(i + 7) * (TH - HOR - 10);
    const ph = reduceMotion ? 0.5 : Math.sin(animT * (0.8 + prand(i)) + i * 2);
    const wgl = i % 3 === 0 ? "224,154,60" : "180,190,200";
    c.fillStyle = `rgba(${wgl},${0.06 + 0.1 * Math.abs(ph)})`;
    c.fillRect(prand(i + 30) * TW + ph * 6, y, 12 + prand(i) * 22, 1.2);
  }
  c.fillStyle = "#0a0805";
  c.beginPath();
  c.moveTo(TW * 0.04, HOR + 1);
  c.quadraticCurveTo(TW * 0.14, HOR - TH * 0.16, TW * 0.28, HOR - TH * 0.1);
  c.lineTo(TW * 0.31, HOR - TH * 0.3); c.lineTo(TW * 0.345, HOR - TH * 0.3);
  c.lineTo(TW * 0.36, HOR - TH * 0.09);
  c.quadraticCurveTo(TW * 0.5, HOR - TH * 0.05, TW * 0.56, HOR + 1);
  c.closePath(); c.fill();
  const win = reduceMotion ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(animT * 3 + 1));
  c.fillStyle = `rgba(224,154,60,${win})`;
  c.fillRect(TW * 0.325, HOR - TH * 0.26, 3, 4);
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
  if (loopStarted) return;
  loopStarted = true;
  let last = 0, acc = 0;
  const step2 = (ts: number): void => {
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
    animT += dt; acc += dt;
    const scr = document.querySelector(".screen.on")?.id;
    if (scr === "scr-dungeon" && state && webgl && s3d) {
      s3d.frame(dt);                     // the world glides at full rate
      if (acc >= 0.25 && amap.classList.contains("on")) { renderAutomap(); }
      if (acc >= 0.25) acc = 0;
    } else if (scr === "scr-title" && acc >= 1 / 30) {
      acc = 0; renderTitle();
    }
    requestAnimationFrame(step2);
  };
  requestAnimationFrame(step2);
}
