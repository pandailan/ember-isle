/* Procedural card portraits: every card gets a painted face, deterministic
   from its id, dressed by class and framed by rarity. Canvas only — no assets. */

import { RARITY_HUES } from "./cards";

interface FaceSpec { id: string; cls: string; rarity: number; }

/** Deterministic PRNG seeded from the card id. */
function seeded(id: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < id.length; i++) { s ^= id.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>= 0;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const SKINS = ["#c9a582", "#b58a63", "#8a6244", "#e0bb96", "#6e4a33"];
const HAIRS = ["#2a2018", "#4a3220", "#6e5638", "#8a8078", "#b8562e", "#d8c8a0", "#3a3f4a"];
const GARB: Record<string, string> = {
  Knight: "#5a626e", Paladin: "#8a7a52", Ranger: "#4a5a38",
  Rogue: "#3a3430", Cleric: "#b8b0a0", Sorcerer: "#4a3a5e",
};

const cache = new Map<string, HTMLCanvasElement>();

export function portraitCanvas(f: FaceSpec): HTMLCanvasElement {
  const key = f.id + "|" + f.cls + "|" + f.rarity;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = 96; cv.height = 96;
  const c = cv.getContext("2d")!;
  const r = seeded(f.id);
  const skin = SKINS[Math.floor(r() * SKINS.length)];
  const hair = HAIRS[Math.floor(r() * HAIRS.length)];
  const garb = GARB[f.cls] ?? "#5a5248";
  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const f2 = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f2(n >> 16)},${f2((n >> 8) & 255)},${f2(n & 255)})`;
  };

  // backdrop: a candlelit wash tinted by rarity
  const g = c.createRadialGradient(48, 40, 6, 48, 48, 64);
  g.addColorStop(0, "#3a2c1c"); g.addColorStop(1, "#17110b");
  c.fillStyle = g; c.fillRect(0, 0, 96, 96);
  c.fillStyle = RARITY_HUES[f.rarity] + "22"; c.fillRect(0, 0, 96, 96);

  // shoulders
  c.fillStyle = garb;
  c.beginPath(); c.moveTo(10, 96); c.quadraticCurveTo(48, 62 + r() * 6, 86, 96); c.closePath(); c.fill();
  c.fillStyle = shade(garb, 0.7);
  c.fillRect(44, 74, 8, 22); // collar shadow

  // head
  const hw = 15 + r() * 3, hh = 19 + r() * 3, hy = 42 + r() * 4;
  c.fillStyle = skin;
  c.beginPath(); c.ellipse(48, hy, hw, hh, 0, 0, 7); c.fill();
  c.fillStyle = shade(skin, 0.82); // jaw shadow
  c.beginPath(); c.ellipse(48, hy + hh * 0.45, hw * 0.8, hh * 0.32, 0, 0, Math.PI); c.fill();
  // ears
  c.fillStyle = skin;
  c.beginPath(); c.ellipse(48 - hw, hy + 2, 3, 5, 0, 0, 7); c.fill();
  c.beginPath(); c.ellipse(48 + hw, hy + 2, 3, 5, 0, 0, 7); c.fill();

  // eyes
  const ey = hy - 2 + r() * 3, ex = 6.5 + r() * 1.5;
  const eyeHue = ["#3a2e20", "#2e3e50", "#3c5032", "#54402a"][Math.floor(r() * 4)];
  for (const s of [-1, 1]) {
    c.fillStyle = "#efe6d8";
    c.beginPath(); c.ellipse(48 + s * ex, ey, 3.4, 2.3, 0, 0, 7); c.fill();
    c.fillStyle = eyeHue;
    c.beginPath(); c.arc(48 + s * ex + (r() - 0.5), ey, 1.7, 0, 7); c.fill();
    c.strokeStyle = shade(skin, 0.6); c.lineWidth = 1.4; // brow
    c.beginPath(); c.moveTo(48 + s * (ex - 3.4), ey - 4.6); c.lineTo(48 + s * (ex + 3.2), ey - 5.4 - r() * 1.4); c.stroke();
  }
  // nose & mouth
  c.strokeStyle = shade(skin, 0.66); c.lineWidth = 1.3;
  c.beginPath(); c.moveTo(48, ey + 2); c.lineTo(46.6 + r() * 2.6, ey + 7.5); c.stroke();
  c.strokeStyle = "#7a4a3c"; c.lineWidth = 1.6;
  const smile = (r() - 0.4) * 3;
  c.beginPath(); c.moveTo(43, ey + 12); c.quadraticCurveTo(48, ey + 12 + smile, 53, ey + 12); c.stroke();
  // scar or freckles for character
  if (r() < 0.22) {
    c.strokeStyle = shade(skin, 0.62); c.lineWidth = 1;
    const sx = 48 + (r() < 0.5 ? -8 : 8);
    c.beginPath(); c.moveTo(sx, ey - 6); c.lineTo(sx + 2, ey + 4); c.stroke();
  }

  // hair (under any headgear)
  c.fillStyle = hair;
  const style = r();
  if (style > 0.18) { // not bald
    c.beginPath(); c.ellipse(48, hy - hh * 0.55, hw + 1.5, hh * 0.62, 0, Math.PI, 0); c.fill();
    if (style > 0.62) { // long
      c.fillRect(48 - hw - 1.5, hy - 6, 5, hh + (r() * 8));
      c.fillRect(48 + hw - 3.5, hy - 6, 5, hh + (r() * 8));
    }
  }
  if (r() < 0.3) { // beard
    c.fillStyle = hair;
    c.beginPath(); c.ellipse(48, hy + hh * 0.72, hw * 0.72, hh * 0.42, 0, 0, Math.PI); c.fill();
  }

  // class headgear
  c.fillStyle = garb;
  if (f.cls === "Knight") {
    c.fillStyle = "#6a7280";
    c.beginPath(); c.ellipse(48, hy - hh * 0.5, hw + 2.5, hh * 0.7, 0, Math.PI, 0); c.fill();
    c.fillRect(48 - hw - 2.5, hy - hh * 0.5, 4, hh * 0.9);
    c.fillRect(48 + hw - 1.5, hy - hh * 0.5, 4, hh * 0.9);
    c.fillStyle = "#8a929e"; c.fillRect(44, hy - hh - 6, 8, 7); // crest
  } else if (f.cls === "Paladin") {
    c.strokeStyle = "#d8c06a"; c.lineWidth = 3;
    c.beginPath(); c.arc(48, hy - hh * 0.35, hw + 1, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  } else if (f.cls === "Ranger") {
    c.fillStyle = "#3c4a2e";
    c.beginPath(); c.ellipse(48, hy - hh * 0.55, hw + 3, hh * 0.6, 0, Math.PI, 0); c.fill();
    c.strokeStyle = "#8fae6a"; c.lineWidth = 2; // feather
    c.beginPath(); c.moveTo(60, hy - hh * 0.8); c.quadraticCurveTo(68, hy - hh - 6, 64, hy - hh - 12); c.stroke();
  } else if (f.cls === "Rogue") {
    c.fillStyle = "#2c2824";
    c.beginPath(); c.ellipse(48, hy - hh * 0.45, hw + 3, hh * 0.72, 0, Math.PI * 0.92, Math.PI * 0.08, false); c.fill();
  } else if (f.cls === "Cleric") {
    c.strokeStyle = "#b8b0a0"; c.lineWidth = 2.4;
    c.beginPath(); c.arc(48, hy - hh * 0.3, hw + 2, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
    c.fillStyle = "#7fa8bd"; c.beginPath(); c.arc(48, hy - hh - 3, 2.2, 0, 7); c.fill();
  } else if (f.cls === "Sorcerer") {
    c.fillStyle = "#3a2e4e";
    c.beginPath(); c.moveTo(48 - hw - 5, hy - hh * 0.4);
    c.lineTo(48 + hw + 5, hy - hh * 0.4);
    c.lineTo(48 + 4 + (r() - 0.5) * 8, hy - hh - 16); c.closePath(); c.fill();
    c.fillStyle = "#c8b0e0";
    c.beginPath(); c.arc(40 + r() * 16, hy - hh - 2 - r() * 6, 1.1, 0, 7); c.fill();
  }

  // rarity frame + candle vignette
  c.strokeStyle = RARITY_HUES[f.rarity]; c.lineWidth = 2.5;
  c.strokeRect(1.5, 1.5, 93, 93);
  const v = c.createRadialGradient(48, 48, 34, 48, 48, 68);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(5,3,2,.55)");
  c.fillStyle = v; c.fillRect(0, 0, 96, 96);

  cache.set(key, cv);
  return cv;
}

export function drawPortraitTo(target: HTMLCanvasElement, f: FaceSpec): void {
  const src = portraitCanvas(f);
  const c = target.getContext("2d")!;
  c.imageSmoothingEnabled = true;
  c.clearRect(0, 0, target.width, target.height);
  c.drawImage(src, 0, 0, target.width, target.height);
}

/** Paint every `.cardface` canvas under root from its data attributes. */
export function paintFaces(root: HTMLElement): void {
  root.querySelectorAll<HTMLCanvasElement>("canvas.cardface").forEach(cv => {
    drawPortraitTo(cv, {id: cv.dataset.face ?? "", cls: cv.dataset.cls ?? "", rarity: Number(cv.dataset.rarity ?? 0)});
  });
}
