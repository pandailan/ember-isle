/* Props: everything the world is dressed with, as data. A PropDef draws its
   solid geometry in the albedo pass, may declare a light source that feeds the
   lightmap, and may draw a glow after lighting so flames and embers bloom. */

export interface PropCtx {
  ctx: CanvasRenderingContext2D;
  /** floor anchor: cell center x, ground line y, scale unit */
  cx: number; fy: number; s: number;
  /** wall-mounted anchor (torches, veins): mount point + lean direction */
  tx: number; my: number; tilt: number;
  /** face rect for wall-covering props */
  x0: number; y0: number; w: number; h: number;
  t: number;            // animation clock (seconds)
  hash: number;         // stable per-cell randomness
  still: boolean;       // prefers-reduced-motion
}

export interface PropLight { x: number; y: number; r: number; color: string; }

export interface PropDef {
  wall?: boolean;                                // mounts on wall faces instead of the floor
  draw(p: PropCtx): void;                        // albedo geometry
  light?(p: PropCtx): PropLight | null;          // contribution to the lightmap
  glow?(p: PropCtx): void;                       // emissive pass, after lighting
}

const flicker = (p: PropCtx, speed = 9): number =>
  p.still ? 1 : 0.85 + 0.22 * Math.sin(p.t * speed + p.hash % 7) + 0.08 * Math.sin(p.t * speed * 2.6 + p.hash % 13);

function torchTip(p: PropCtx): {x: number; y: number} {
  return {x: p.tx + Math.sin(p.tilt) * p.s * 0.62, y: p.my - Math.cos(p.tilt) * p.s * 0.62};
}

export const PROPS: Record<string, PropDef> = {

  /* ---------- wall props ---------- */
  torch: {
    wall: true,
    draw(p) {
      const {ctx, s} = p;
      ctx.fillStyle = "#17100a";
      ctx.fillRect(p.tx - s * 0.11, p.my - s * 0.06, s * 0.22, s * 0.24);
      ctx.save(); ctx.translate(p.tx, p.my); ctx.rotate(p.tilt);
      ctx.fillStyle = "#3a2a18"; ctx.fillRect(-s * 0.055, -s * 0.62, s * 0.11, s * 0.68);
      ctx.fillStyle = "#57422d"; ctx.fillRect(-s * 0.085, -s * 0.74, s * 0.17, s * 0.16);
      ctx.restore();
    },
    light(p) {
      const tip = torchTip(p);
      return {x: tip.x, y: tip.y, r: p.s * 3.4 * flicker(p), color: "rgba(255,190,100,.9)"};
    },
    glow(p) {
      const {ctx, s} = p;
      const tip = torchTip(p);
      const fh = s * 0.55 * flicker(p);
      const fg = ctx.createRadialGradient(tip.x, tip.y - fh * 0.4, 0, tip.x, tip.y - fh * 0.4, fh);
      fg.addColorStop(0, "rgba(255,242,190,.95)");
      fg.addColorStop(0.35, "rgba(242,172,64,.85)");
      fg.addColorStop(0.7, "rgba(200,80,40,.4)");
      fg.addColorStop(1, "rgba(200,80,40,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(tip.x, tip.y - fh * 0.4, fh * 0.45, fh * 0.8,
        (p.still ? 0 : Math.sin(p.t * 11 + p.hash % 11) * 0.12) + p.tilt * 0.4, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  embervein: {
    wall: true,
    draw() { /* the seam itself is baked into the basalt texture */ },
    light(p) {
      const pulse = p.still ? 1 : 0.7 + 0.3 * Math.sin(p.t * 1.6 + p.hash % 17);
      return {x: p.x0 + p.w / 2, y: p.y0 + p.h * 0.6, r: p.w * 0.9 * pulse, color: "rgba(220,90,50,.5)"};
    },
    glow(p) {
      const {ctx} = p;
      const pulse = p.still ? 0.8 : 0.55 + 0.45 * Math.sin(p.t * 1.6 + p.hash % 17);
      ctx.strokeStyle = `rgba(255,120,60,${0.35 * pulse})`;
      ctx.lineWidth = Math.max(1, p.w * 0.012);
      ctx.beginPath();
      let vx = p.x0 + p.w * 0.3, vy = p.y0 + p.h * 0.15;
      ctx.moveTo(vx, vy);
      for (let i = 0; i < 4; i++) {
        vx += (((p.hash >> (i * 2)) % 7) - 3) / 3 * p.w * 0.18;
        vy += p.h * 0.18;
        ctx.lineTo(vx, vy);
      }
      ctx.stroke();
    },
  },

  /* ---------- floor props ---------- */
  lamppost: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      const lh = s * 1.5;
      ctx.fillStyle = "#1a1410";
      ctx.fillRect(cx - s * 0.035, fy - lh, s * 0.07, lh);
      ctx.fillRect(cx - s * 0.12, fy - lh, s * 0.24, s * 0.05);
    },
    light(p) {
      return {x: p.cx, y: p.fy - p.s * 1.38, r: p.s * 2.6, color: "rgba(240,200,130,.8)"};
    },
    glow(p) {
      const {ctx, cx, fy, s} = p;
      const ly = fy - s * 1.5 + s * 0.12;
      ctx.fillStyle = "#f0c060";
      ctx.fillRect(cx - s * 0.045, ly - s * 0.06, s * 0.09, s * 0.12);
    },
  },

  crate: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      ctx.fillStyle = "#3a2c1c"; ctx.fillRect(cx - s * 0.3, fy - s * 0.34, s * 0.34, s * 0.34);
      ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(cx - s * 0.3, fy - s * 0.34, s * 0.34, s * 0.34);
      ctx.fillStyle = "#46362a";
      ctx.beginPath(); ctx.ellipse(cx + s * 0.22, fy - s * 0.18, s * 0.14, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(cx + s * 0.22, fy - s * 0.26, s * 0.14, s * 0.05, 0, 0, Math.PI * 2); ctx.stroke();
    },
  },

  puddle: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      ctx.fillStyle = "rgba(24,38,52,.55)";
      ctx.beginPath();
      ctx.ellipse(cx + ((p.hash % 13) - 6) * s * 0.03, fy - s * 0.1, s * 0.5, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    glow(p) { // moon- or torch-light caught on the surface, plus the odd drop
      const {ctx, cx, fy, s} = p;
      const sh = p.still ? 0.5 : 0.3 + 0.5 * Math.abs(Math.sin(p.t * 1.7 + p.hash));
      ctx.fillStyle = `rgba(170,195,215,${0.1 + 0.12 * sh})`;
      ctx.beginPath(); ctx.ellipse(cx - s * 0.12, fy - s * 0.13, s * 0.19, s * 0.045, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(224,154,60,${0.05 + 0.08 * sh})`;
      ctx.beginPath(); ctx.ellipse(cx + s * 0.15, fy - s * 0.08, s * 0.16, s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
      if (!p.still) {
        const dp = (p.t * (0.35 + (p.hash % 5) * 0.08) + p.hash * 0.13) % 3;
        if (dp < 0.3) {
          const t2 = dp / 0.3;
          const ceilY = fy - s * 1.8;
          ctx.fillStyle = "rgba(170,200,220,.5)";
          ctx.fillRect(cx - 0.7, ceilY + (fy - s * 0.1 - ceilY) * t2, 1.4, Math.max(2, s * 0.06));
        }
      }
    },
  },

  rubble: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      for (let i = 0; i < 4; i++) {
        const p2 = ((p.hash >> (i * 3)) % 17) / 17;
        ctx.fillStyle = `rgb(${70 + p2 * 30 | 0},${55 + p2 * 22 | 0},${42 + p2 * 15 | 0})`;
        ctx.beginPath();
        ctx.ellipse(cx + (p2 - 0.5) * s * 0.85, fy - s * 0.06 - (i % 2) * s * 0.05,
          s * (0.06 + p2 * 0.07), s * (0.04 + p2 * 0.045), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },

  crack: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      ctx.strokeStyle = "rgba(0,0,0,.32)"; ctx.lineWidth = Math.max(1, s * 0.028);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, fy - s * 0.04);
      ctx.lineTo(cx - s * 0.1, fy - s * 0.16);
      ctx.lineTo(cx + s * 0.22, fy - s * 0.09);
      ctx.stroke();
    },
  },

  mushrooms: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * s * 0.14 + ((p.hash >> i) % 5 - 2) * s * 0.03;
        const mh = s * (0.1 + ((p.hash >> (i * 2)) % 4) * 0.02);
        ctx.fillStyle = "#3d4a52";
        ctx.fillRect(cx + off - s * 0.012, fy - mh - s * 0.04, s * 0.024, mh);
        ctx.fillStyle = "#5a7a8a";
        ctx.beginPath(); ctx.ellipse(cx + off, fy - mh - s * 0.04, s * 0.05, s * 0.032, 0, 0, Math.PI * 2); ctx.fill();
      }
    },
    light(p) {
      const pulse = p.still ? 1 : 0.75 + 0.25 * Math.sin(p.t * 1.2 + p.hash % 23);
      return {x: p.cx, y: p.fy - p.s * 0.12, r: p.s * 1.2 * pulse, color: "rgba(110,190,220,.45)"};
    },
    glow(p) {
      const {ctx, cx, fy, s} = p;
      const pulse = p.still ? 0.8 : 0.55 + 0.45 * Math.sin(p.t * 1.2 + p.hash % 23);
      ctx.fillStyle = `rgba(140,220,255,${0.28 * pulse})`;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * s * 0.14 + ((p.hash >> i) % 5 - 2) * s * 0.03;
        const mh = s * (0.1 + ((p.hash >> (i * 2)) % 4) * 0.02);
        ctx.beginPath(); ctx.ellipse(cx + off, fy - mh - s * 0.04, s * 0.045, s * 0.028, 0, 0, Math.PI * 2); ctx.fill();
      }
    },
  },

  embervent: {
    draw(p) {
      const {ctx, cx, fy, s} = p;
      ctx.strokeStyle = "rgba(10,5,4,.7)"; ctx.lineWidth = Math.max(1.2, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.35, fy - s * 0.05);
      ctx.lineTo(cx - s * 0.05, fy - s * 0.14);
      ctx.lineTo(cx + s * 0.3, fy - s * 0.07);
      ctx.stroke();
    },
    light(p) {
      const pulse = p.still ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(p.t * 2.2 + p.hash % 19));
      return {x: p.cx, y: p.fy - p.s * 0.1, r: p.s * 1.6 * pulse, color: "rgba(255,110,50,.65)"};
    },
    glow(p) {
      const {ctx, cx, fy, s} = p;
      const pulse = p.still ? 0.8 : 0.45 + 0.55 * Math.abs(Math.sin(p.t * 2.2 + p.hash % 19));
      ctx.strokeStyle = `rgba(255,140,70,${0.5 * pulse})`;
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.35, fy - s * 0.05);
      ctx.lineTo(cx - s * 0.05, fy - s * 0.14);
      ctx.lineTo(cx + s * 0.3, fy - s * 0.07);
      ctx.stroke();
    },
  },
};
