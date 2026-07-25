import { MAPS, LEVEL_NAMES, DIRV, DIRN } from "./data";
import { state, cellAt } from "./state";
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

function poly(pts: [number, number][], fill: string): void {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}

function drawFrontWall(d: number, l: number): void {
  const x0 = px(d, l - 0.5), x1 = px(d, l + 0.5), y0 = TYP(d), y1 = BYP(d), h = y1 - y0, w = x1 - x0;
  ctx.fillStyle = FRONT[d]; ctx.fillRect(x0, y0, w, h);
  if (d <= 3) { // stone courses fade with distance
    const rows = 5;
    ctx.strokeStyle = `rgba(0,0,0,${0.3 - d * 0.05})`; ctx.lineWidth = Math.max(1, 2.2 - d * 0.4);
    for (let k = 1; k < rows; k++) {
      const y = y0 + h * k / rows;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    for (let k = 0; k < rows; k++) {
      const ya = y0 + h * k / rows, yb = y0 + h * (k + 1) / rows;
      for (let j = (k % 2) ? 0.25 : 0.5; j < 1; j += 0.5) {
        const x = x0 + w * j;
        ctx.beginPath(); ctx.moveTo(x, ya); ctx.lineTo(x, yb); ctx.stroke();
      }
    }
  }
  const sg = ctx.createLinearGradient(0, y0, 0, y1);
  sg.addColorStop(0, "rgba(0,0,0,.34)"); sg.addColorStop(0.45, "rgba(0,0,0,0)");
  sg.addColorStop(1, "rgba(0,0,0,.2)");
  ctx.fillStyle = sg; ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
}

function drawSideWall(d: number, u: number): void {
  const xa = px(d, u), xb = px(d + 1, u);
  const yat = TYP(d), yab = BYP(d), ybt = TYP(d + 1), ybb = BYP(d + 1);
  const quad: [number, number][] = [[xa, yat], [xb, ybt], [xb, ybb], [xa, yab]];
  poly(quad, SIDE[d]);
  if (d <= 2) { // converging courses
    ctx.strokeStyle = `rgba(0,0,0,${0.26 - d * 0.05})`; ctx.lineWidth = Math.max(1, 2 - d * 0.4);
    for (let k = 1; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(xa, yat + (yab - yat) * k / 5);
      ctx.lineTo(xb, ybt + (ybb - ybt) * k / 5);
      ctx.stroke();
    }
    for (const t of [0.35, 0.7]) {
      const x = xa + (xb - xa) * t;
      ctx.beginPath();
      ctx.moveTo(x, yat + (ybt - yat) * t);
      ctx.lineTo(x, yab + (ybb - yab) * t);
      ctx.stroke();
    }
  }
  const sg = ctx.createLinearGradient(xa, 0, xb, 0);
  sg.addColorStop(0, "rgba(0,0,0,.04)"); sg.addColorStop(1, "rgba(0,0,0,.42)");
  ctx.beginPath(); ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath(); ctx.fillStyle = sg; ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xa, yat); ctx.lineTo(xa, yab); ctx.stroke();
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
  } else if (c === "B") { // the Pyrelord waits
    ctx.fillStyle = "rgba(20,10,6,.9)"; ctx.beginPath();
    ctx.moveTo(cxm, fy - s * 1.5); ctx.lineTo(cxm + s * 0.7, fy); ctx.lineTo(cxm - s * 0.7, fy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e09a3c";
    ctx.fillRect(cxm - s * 0.18, fy - s * 1.05, s * 0.1, s * 0.07);
    ctx.fillRect(cxm + s * 0.08, fy - s * 1.05, s * 0.1, s * 0.07);
    const gl = ctx.createRadialGradient(cxm, fy - s * 0.7, 4, cxm, fy - s * 0.7, s * 1.3);
    gl.addColorStop(0, "rgba(200,80,47,.3)"); gl.addColorStop(1, "rgba(200,80,47,0)");
    ctx.fillStyle = gl; ctx.fillRect(cxm - s * 1.5, fy - s * 2, s * 3, s * 2.4);
  } else if (c === "E") { // way out: daylight arch
    ctx.fillStyle = "rgba(232,217,176,.14)";
    ctx.beginPath();
    ctx.moveTo(cxm - s * 0.45, fy); ctx.lineTo(cxm - s * 0.45, fy - s * 0.9);
    ctx.arc(cxm, fy - s * 0.9, s * 0.45, Math.PI, 0);
    ctx.lineTo(cxm + s * 0.45, fy); ctx.closePath(); ctx.fill();
  }
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
    const lats: number[] = []; for (let l = -4; l <= 4; l++) lats.push(l);
    lats.sort((a, b) => Math.abs(b) - Math.abs(a));
    for (const l of lats) {
      if (isWall(d, l)) {
        if (d < 4) { // side faces toward corridor center
          if (l > 0 && !isWall(d, l - 1)) drawSideWall(d, l - 0.5);
          if (l < 0 && !isWall(d, l + 1)) drawSideWall(d, l + 0.5);
        }
        if (d >= 1) drawFrontWall(d, l);
      } else {
        const c = at(d, l);
        if (c !== "." && c !== "#" && Math.abs(l) <= 1 && d <= 3) feats.push([c, d, l]);
      }
    }
    for (const [c, fd, fl] of feats) drawFeature(c, fd, fl);
  }
  // torch glow
  const tflick = reduceMotion ? 1 : 0.92 + rnd() * 0.16;
  const tg = ctx.createRadialGradient(CX, CY + 16, 26, CX, CY + 16, 290 * tflick);
  tg.addColorStop(0, "rgba(224,154,60,.13)");
  tg.addColorStop(0.45, "rgba(224,154,60,.04)");
  tg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H);
  // darkness vignette
  const v = ctx.createRadialGradient(CX, CY, 60, CX, CY, 300);
  const a = reduceMotion ? 0.42 : 0.38 + rnd() * 0.07;
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
