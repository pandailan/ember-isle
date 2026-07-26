/* Biomes: everything that gives a level its look — wall material, floor and
   ceiling (or open sky), ambient light, drifting particles, and which props
   the world dresses itself with. Rendering is data-driven from these structs. */

export interface WallTexSpec {
  style: "stone" | "house";
  base: [number, number, number];   // material color
  mortar: string;
  blockW: [number, number];
  blockH: [number, number];
  crackDensity: number;             // cracks per tile
  mossColor?: string;               // last two variants grow this
  veinColor?: string;               // molten seams baked into the stone
  variants: number;
}

export interface PropPlacement {
  id: string;        // key into the PROPS registry
  mod: number;       // placed where cellHash % mod === rem
  rem: number;
  offPath?: boolean; // never on the corridor center line
}

export interface Biome {
  id: string;
  sky: boolean;                                    // open night sky instead of a ceiling
  ceiling: {top: string; bottom: string};
  floor: {top: string; bottom: string};
  /** Lightmap ambient: what the world looks like where no light reaches. */
  ambientTop: string;
  ambientHorizon: string;
  ambientBottom: string;
  /** The party's own light (color + reach), drawn at the view's heart. */
  playerLight: {color: string; radius: number};
  sparks: "ember" | "heavy-ember" | "none";
  beams: boolean;                                  // timber ceiling beams
  tex: WallTexSpec;
  wallProps: PropPlacement[];
  floorProps: PropPlacement[];
}

export const BIOMES: Record<string, Biome> = {
  harbor: {
    id: "harbor",
    sky: true,
    ceiling: {top: "#070b16", bottom: "#1c1a18"},
    floor: {top: "#14161d", bottom: "#2b2c33"},
    ambientTop: "rgb(196,202,220)",       // the sky lights itself
    ambientHorizon: "rgb(138,144,164)",
    ambientBottom: "rgb(124,130,150)",
    playerLight: {color: "rgba(200,210,235,.3)", radius: 380},
    sparks: "none",
    beams: false,
    tex: {style: "house", base: [107, 99, 85], mortar: "#241a10",
          blockW: [20, 48], blockH: [17, 32], crackDensity: 0, variants: 3},
    wallProps: [],
    floorProps: [
      {id: "lamppost", mod: 6, rem: 2, offPath: true},
      {id: "crate", mod: 7, rem: 3, offPath: true},
      {id: "puddle", mod: 5, rem: 0},
    ],
  },
  caves: {
    id: "caves",
    sky: false,
    ceiling: {top: "#040302", bottom: "#1a1209"},
    floor: {top: "#130d07", bottom: "#342718"},
    ambientTop: "rgb(108,94,78)",
    ambientHorizon: "rgb(116,100,84)",
    ambientBottom: "rgb(112,98,80)",
    playerLight: {color: "rgba(255,200,120,.55)", radius: 360},
    sparks: "ember",
    beams: true,
    tex: {style: "stone", base: [92, 69, 47], mortar: "#3a2b1b",
          blockW: [20, 48], blockH: [17, 32], crackDensity: 3,
          mossColor: "rgba(92,122,58,", variants: 5},
    wallProps: [{id: "torch", mod: 3, rem: 0}],
    floorProps: [
      {id: "puddle", mod: 5, rem: 0},
      {id: "rubble", mod: 7, rem: 3},
      {id: "crack", mod: 6, rem: 1},
      {id: "mushrooms", mod: 9, rem: 4, offPath: true},
    ],
  },
  emberdeep: {
    id: "emberdeep",
    sky: false,
    ceiling: {top: "#0a0405", bottom: "#1c0d08"},
    floor: {top: "#160a07", bottom: "#38201a"},
    ambientTop: "rgb(88,66,60)",
    ambientHorizon: "rgb(100,72,64)",
    ambientBottom: "rgb(118,82,70)",    // the floor remembers the fire below
    playerLight: {color: "rgba(255,185,105,.5)", radius: 330},
    sparks: "heavy-ember",
    beams: false,
    tex: {style: "stone", base: [66, 54, 52], mortar: "#241416",
          blockW: [26, 56], blockH: [20, 36], crackDensity: 5,
          veinColor: "rgba(200,80,47,.5)", variants: 4},
    wallProps: [
      {id: "torch", mod: 6, rem: 0},
      {id: "embervein", mod: 5, rem: 1},
    ],
    floorProps: [
      {id: "embervent", mod: 6, rem: 0},
      {id: "rubble", mod: 5, rem: 1},
      {id: "crack", mod: 4, rem: 2},
    ],
  },
};

export function biomeFor(level: number): Biome {
  if (level === 0) return BIOMES.harbor;
  if (level >= 2) return BIOMES.emberdeep;
  return BIOMES.caves;
}

/* ============================== TEXTURE BAKERY ============================== */
const texCache: Record<string, HTMLCanvasElement[]> = {};

function bakeTexture(spec: WallTexSpec, variant: number): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d")!;
  let pi = 0;
  const seed = variant + 1;
  const pr = () => { const s = Math.sin(seed * 91.7 + (pi++) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const [br, bg, bb] = spec.base;

  if (spec.style === "house") {
    c.fillStyle = `rgb(${br},${bg},${bb})`; c.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 60; k++) {
      c.fillStyle = `rgba(${br - 17 + pr() * 40 | 0},${bg - 15 + pr() * 34 | 0},${bb - 15 + pr() * 28 | 0},.25)`;
      c.beginPath(); c.arc(pr() * 128, pr() * 128, 4 + pr() * 12, 0, 7); c.fill();
    }
    c.fillStyle = spec.mortar;
    c.fillRect(0, 0, 128, 9); c.fillRect(0, 119, 128, 9);
    c.fillRect(0, 0, 8, 128); c.fillRect(120, 0, 8, 128);
    c.fillRect(60, 0, 7, 128);
    if (pr() < 0.7) {
      c.save(); c.translate(34, 64); c.rotate(pr() < 0.5 ? 0.5 : -0.5);
      c.fillRect(-6, -60, 7, 120); c.restore();
    }
    if (pr() < 0.8) { // warm-lit window
      const wxp = 76 + pr() * 18, wyp = 26 + pr() * 40;
      c.fillStyle = spec.mortar; c.fillRect(wxp - 3, wyp - 3, 30, 34);
      c.fillStyle = `rgba(240,180,80,${0.75 + pr() * 0.2})`; c.fillRect(wxp, wyp, 24, 28);
      c.fillStyle = spec.mortar;
      c.fillRect(wxp + 10.5, wyp, 3, 28); c.fillRect(wxp, wyp + 12.5, 24, 3);
    }
    for (let k = 0; k < 200; k++) {
      c.fillStyle = pr() < 0.5 ? "rgba(0,0,0,.08)" : "rgba(232,217,176,.04)";
      c.fillRect(pr() * 128, pr() * 128, 1.4, 1.4);
    }
    return cv;
  }

  // stone
  c.fillStyle = spec.mortar; c.fillRect(0, 0, 128, 128);
  let y = 0;
  while (y < 128) {
    const rh = spec.blockH[0] + Math.floor(pr() * (spec.blockH[1] - spec.blockH[0]));
    let x = -Math.floor(pr() * 22);
    while (x < 128) {
      const bw = spec.blockW[0] + Math.floor(pr() * (spec.blockW[1] - spec.blockW[0]));
      const shade = 0.8 + pr() * 0.4;
      c.fillStyle = `rgb(${Math.round(br * shade)},${Math.round(bg * shade)},${Math.round(bb * shade)})`;
      c.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
      c.fillStyle = "rgba(232,217,176,.07)"; c.fillRect(x + 1.5, y + 1.5, bw - 3, 2);
      c.fillStyle = "rgba(0,0,0,.24)"; c.fillRect(x + 1.5, y + rh - 4.5, bw - 3, 3);
      if (pr() < 0.18) {
        c.fillStyle = "rgba(0,0,0,.2)";
        c.beginPath(); c.moveTo(x + 1.5, y + 1.5); c.lineTo(x + 8, y + 1.5); c.lineTo(x + 1.5, y + 7); c.closePath(); c.fill();
      }
      x += bw;
    }
    y += rh;
  }
  for (let k = 0; k < spec.crackDensity; k++) {
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1;
    c.beginPath();
    let cx0 = pr() * 128, cy0 = pr() * 60;
    c.moveTo(cx0, cy0);
    for (let s2 = 0; s2 < 4; s2++) { cx0 += (pr() - 0.5) * 26; cy0 += pr() * 20; c.lineTo(cx0, cy0); }
    c.stroke();
  }
  for (let k = 0; k < 320; k++) {
    c.fillStyle = pr() < 0.5 ? "rgba(0,0,0,.1)" : "rgba(232,217,176,.05)";
    c.fillRect(pr() * 128, pr() * 128, 1.4, 1.4);
  }
  if (spec.mossColor && variant >= spec.variants - 2) {
    for (let k = 0; k < 30; k++) {
      c.fillStyle = `${spec.mossColor}${(0.08 + pr() * 0.16).toFixed(2)})`;
      c.beginPath(); c.arc(pr() * 128, 55 + pr() * 73, 2 + pr() * 6, 0, 7); c.fill();
    }
  }
  if (spec.veinColor) { // molten seams sleeping in the rock
    for (let k = 0; k < 2; k++) {
      c.strokeStyle = spec.veinColor; c.lineWidth = 1.6;
      c.beginPath();
      let vx = pr() * 128, vy = pr() * 30;
      c.moveTo(vx, vy);
      for (let s2 = 0; s2 < 5; s2++) { vx += (pr() - 0.5) * 30; vy += 14 + pr() * 14; c.lineTo(vx, vy); }
      c.stroke();
    }
  }
  return cv;
}

export function biomeTextures(biome: Biome): HTMLCanvasElement[] {
  if (!texCache[biome.id]) {
    texCache[biome.id] = Array.from({length: biome.tex.variants}, (_, i) => bakeTexture(biome.tex, i));
  }
  return texCache[biome.id];
}

/* Normal maps derived from albedo luminance (sobel over a height guess), so
   point lights rake across the stone relief. */
const normalCache: Record<string, HTMLCanvasElement[]> = {};

export function bakeNormalMap(albedo: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const w = albedo.width, h = albedo.height;
  const src = albedo.getContext("2d")!.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (src[i * 4] * 0.4 + src[i * 4 + 1] * 0.4 + src[i * 4 + 2] * 0.2) / 255;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(w, h);
  const at = (x: number, y: number) => lum[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * w + x) * 4;
    img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
    img.data[i + 2] = inv * 255;
    img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export function biomeNormalMaps(biome: Biome): HTMLCanvasElement[] {
  if (!normalCache[biome.id]) {
    normalCache[biome.id] = biomeTextures(biome).map(t => bakeNormalMap(t));
  }
  return normalCache[biome.id];
}

/** A tiling floor texture per biome (flagstones / cobbles / scorched basalt). */
const floorCache: Record<string, HTMLCanvasElement> = {};
export function biomeFloorTexture(biome: Biome): HTMLCanvasElement {
  if (!floorCache[biome.id]) {
    const spec: WallTexSpec = {...biome.tex, style: "stone",
      base: biome.id === "harbor" ? [64, 66, 76] : biome.tex.base.map(v => Math.round(v * 0.72)) as [number, number, number],
      blockW: [24, 44], blockH: [24, 44], crackDensity: biome.tex.crackDensity + 1, variants: 1,
      mossColor: undefined, veinColor: biome.tex.veinColor};
    floorCache[biome.id] = bakeTexture(spec, 0);
  }
  return floorCache[biome.id];
}
