/* ============================== THE ASSET LIBRARY ==============================
   Every 3D object in the world lives here as a named factory in ASSETS —
   canonical, alphabetized, one entry per thing. The engine (scene3d.ts) only
   PLACES assets; it never builds geometry for world objects itself.

   To replace an asset: rewrite its factory (or return a loaded GLTF scene's
   group instead of primitives) — nothing else changes. Every factory:
     - draws into `p.group`, within the 1×1 cell footprint based at (p.x, p.z)
       (structure assets draw at local 0..1 and are positioned by the engine);
     - registers engine effects through the injected `fx` sink (flames, light
       anchors, wind sway, daylight dimming, wet shimmer, consumables, beacons)
       instead of touching engine internals.
   Shared materials live in PALETTE so a re-skin is one edit.
   =============================================================================== */

import * as THREE from "three";
import { BIOMES, type Biome } from "./biomes";

/* ---------- the engine-effects sink (bound once by scene3d) ---------- */
export interface FxSink {
  /** Additive glow sprite that breathes like fire; coords are in `group`'s space. */
  flame(group: THREE.Object3D, x: number, y: number, z: number, color: string, scale: number): void;
  /** A candidate point light (world position); the nearest few win real lights. */
  anchor(pos: THREE.Vector3, color: number, intensity: number, distance: number, flicker?: number): void;
  /** Register wind sway on an object; wx/wz feed the traveling gust wave. */
  sway(o: THREE.Object3D, amp: number, wx?: number, wz?: number): void;
  /** Emissive material that dies in daylight (lamps, glowing caps). */
  dim(m: THREE.MeshStandardMaterial, base: number): void;
  /** Emissive material with a wet glint. */
  shimmer(m: THREE.MeshStandardMaterial, base: number): void;
  /** Object that vanishes once its map cell is consumed (chests, the boss). */
  consumable(mesh: THREE.Object3D, char: string): void;
  /** The signal fire's lit/cold halves (visibility follows the co-op link). */
  signalFire(lit: THREE.Group, cold: THREE.Group): void;
  /** The lighthouse beacon parts, animated by the engine at night. */
  beacon(beacon: THREE.Group, beamMat: THREE.MeshBasicMaterial, lampMat: THREE.MeshStandardMaterial, glow: THREE.Sprite): void;
  /** Shared radial glow texture bake. */
  glowTexture(color: string): THREE.Texture;
}

let fx: FxSink = null as unknown as FxSink;
export function bindAssetFx(sink: FxSink): void { fx = sink; }

/* ---------- factory context ---------- */
export interface AssetCtx {
  group: THREE.Group;               // draw into this
  x: number; z: number;             // cell base in the group's space
  hash: number;                     // deterministic per-cell variation
  biome: Biome;
  faceDir?: [number, number];       // wall props: which way the open side faces
  up?: boolean;                     // stairs: ascending?
  ridgeAlongZ?: boolean;            // roofs: ridge orientation
}
export type AssetFactory = (p: AssetCtx) => void;

/* ---------- PALETTE: shared materials (one edit re-skins the isle) ---------- */
export const PALETTE = {
  wood: new THREE.MeshStandardMaterial({color: 0x3a2a18, roughness: 0.9}),
  barrel: new THREE.MeshStandardMaterial({color: 0x46362a, roughness: 0.85}),
  iron: new THREE.MeshStandardMaterial({color: 0x17100a, roughness: 0.7, metalness: 0.4}),
  stone: new THREE.MeshStandardMaterial({color: 0x4a4640, roughness: 0.95}),
  boulder: new THREE.MeshStandardMaterial({color: 0x333a30, roughness: 0.98}),
  ruin: new THREE.MeshStandardMaterial({color: 0x413e36, roughness: 0.97}),
  menhir: new THREE.MeshStandardMaterial({color: 0x262b22, roughness: 1}),
  wildFoliage: new THREE.MeshStandardMaterial({color: 0x16261a, roughness: 0.95}),
  bone: new THREE.MeshStandardMaterial({color: 0xb8ad98, roughness: 0.9}),
  sack: new THREE.MeshStandardMaterial({color: 0x8a7a58, roughness: 0.95}),
  reed: new THREE.MeshStandardMaterial({color: 0x46562c, roughness: 0.95}),
  heatherLeaf: new THREE.MeshStandardMaterial({color: 0x3c4c2c, roughness: 0.95}),
  roofs: [0x5a3c30, 0x3c4450, 0x54452c].map(c => new THREE.MeshStandardMaterial({color: c, roughness: 0.92})),
  bannerCloths: [0x8a3a28, 0x2e4a68, 0x4e5a2e, 0x6a4a78],
  tuftHues: {cove: 0x6a683c, harbor: 0x465430, default: 0x44562e} as Record<string, number>,
};

const grassHue = (biome: Biome) => PALETTE.tuftHues[biome.id] ?? PALETTE.tuftHues.default;

/* =========================== ASSETS (alphabetical) =========================== */
export const ASSETS: Record<string, AssetFactory> = {

  banner(p) { // dyed cloth hung on a facade
    const [dx, dz] = p.faceDir!;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.5),
      new THREE.MeshStandardMaterial({color: PALETTE.bannerCloths[p.hash % PALETTE.bannerCloths.length], roughness: 0.9, side: THREE.DoubleSide}));
    cloth.position.set(p.x + 0.5 + dx * 0.515, 0.6, p.z + 0.5 + dz * 0.515);
    cloth.lookAt(p.x + 0.5 + dx * 2, 0.6, p.z + 0.5 + dz * 2);
    p.group.add(cloth);
    fx.sway(cloth, 0.05, p.x, p.z);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 5), PALETTE.wood);
    rod.position.set(p.x + 0.5 + dx * 0.53, 0.88, p.z + 0.5 + dz * 0.53);
    if (dx !== 0) rod.rotation.x = Math.PI / 2; else rod.rotation.z = Math.PI / 2;
    p.group.add(rod);
  },

  barrow(p) { // a burial mound with a doorway older than the town
    const h = p.hash;
    const cx = p.x + 0.7, cz = p.z + 0.7; // mounded into its corner of the cell
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 7), PALETTE.wildFoliage);
    mound.position.set(cx, -0.19, cz); mound.scale.y = 0.95;
    p.group.add(mound);
    const a = (h % 4) * Math.PI / 2; // the door faces a cardinal, picked by the stone's memory
    const dx = Math.cos(a), dz = Math.sin(a);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), PALETTE.menhir);
      post.position.set(cx + dx * 0.28 - dz * side * 0.075, 0.1, cz + dz * 0.28 + dx * side * 0.075);
      p.group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.05, 0.08), PALETTE.menhir);
    lintel.position.set(cx + dx * 0.28, 0.22, cz + dz * 0.28);
    lintel.rotation.y = Math.PI / 2 - a;
    p.group.add(lintel);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.16),
      new THREE.MeshBasicMaterial({color: 0x050604}));
    dark.position.set(cx + dx * 0.285, 0.09, cz + dz * 0.285);
    dark.lookAt(cx + dx * 2, 0.09, cz + dz * 2);
    p.group.add(dark);
  },

  bones(p) { // someone came this far
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4), PALETTE.bone);
      b.rotation.set(Math.PI / 2, 0, (p.hash >> i) % 7);
      b.position.set(p.x + 0.62 + ((p.hash >> (i * 2)) % 6) / 6 * 0.2, 0.015,
                     p.z + 0.28 + ((p.hash >> (i + 2)) % 6) / 6 * 0.2);
      p.group.add(b);
    }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 6), PALETTE.bone);
    skull.position.set(p.x + 0.7, 0.04, p.z + 0.35);
    p.group.add(skull);
  },

  bossIdol(p) { // the Pyrelord, waiting
    const cx = p.x - Math.floor(p.x) + 0.5, cz = 0.5;
    const bossM = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 7),
      new THREE.MeshStandardMaterial({color: 0x140a06, roughness: 0.9}));
    bossM.position.set(cx, 0.45, cz);
    const eyeMat = new THREE.MeshStandardMaterial({color: 0xffb44c, emissive: 0xff9020, emissiveIntensity: 3});
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
      eye.position.set(cx + dx, 0.68, cz + 0.24);
      p.group.add(eye);
    }
    p.group.add(bossM);
    fx.anchor(new THREE.Vector3(p.x + 0.5, 0.6, p.z + 0.5), 0xdd4422, 5, 5, 0.5);
    fx.consumable(p.group, "B");
  },

  boulderCluster(p) { // a low cluster of mossy rocks with growth between
    const h = p.hash;
    for (let i = 0; i < 4; i++) {
      const r = 0.08 + ((h >> (i * 2)) % 5) * 0.026;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), PALETTE.boulder);
      rock.position.set(p.x + 0.2 + ((h >> i) % 7) / 7 * 0.58, r * 0.55, p.z + 0.2 + ((h >> (i + 3)) % 7) / 7 * 0.58);
      rock.rotation.set(i + h % 5, h % 7, 0); rock.scale.y = 0.72;
      p.group.add(rock);
    }
    ASSETS.tuft({...p, hash: h >> 2});
    ASSETS.pebbles({...p, hash: h >> 4});
  },

  cairn(p) { // stacked stones: someone marked the way
    const h = p.hash;
    const cx = p.x + 0.25 + ((h >> 2) % 7) / 7 * 0.5, cz = p.z + 0.25 + ((h >> 5) % 7) / 7 * 0.5;
    let y = 0;
    for (let i = 0; i < 4 + (h % 2); i++) {
      const r = 0.085 - i * 0.016, th = 0.05 - i * 0.006;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, th, 7), PALETTE.stone);
      s.position.set(cx + (((h >> i) % 5) - 2) * 0.008, y + th / 2, cz + (((h >> (i + 3)) % 5) - 2) * 0.008);
      s.rotation.y = (h >> i) % 7;
      p.group.add(s);
      y += th;
    }
  },

  cart(p) { // a handcart left by the road
    const cx2 = p.x + 0.66, cz2 = p.z + 0.34;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.4), PALETTE.wood);
    bed.position.set(cx2, 0.16, cz2); bed.rotation.y = (p.hash % 7) / 7 - 0.5; bed.rotation.z = 0.12;
    p.group.add(bed);
    for (const dx of [-0.15, 0.15]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 10), PALETTE.wood);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(cx2 + dx, 0.08, cz2 - 0.03);
      p.group.add(wheel);
    }
  },

  chest(p) { // banded, locked, patient
    const cx = 0.5, cz = 0.5;
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
    p.group.add(chest);
    fx.consumable(chest, "C");
  },

  chimney(p) { // engine positions the group at the roof line
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.13), PALETTE.stone);
    p.group.add(chim);
  },

  crack() { /* engraved in the floor texture's spirit — skipped in 3D */ },

  crate(p) { // a crate and a barrel, dockside clutter
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), PALETTE.wood);
    box.position.set(p.x + 0.76, 0.1, p.z + 0.26); box.rotation.y = (p.hash % 7) / 7;
    p.group.add(box);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.24, 8), PALETTE.barrel);
    barrel.position.set(p.x + 0.3, 0.12, p.z + 0.74);
    p.group.add(barrel);
  },

  embervein(p) { // molten rock breathing through a wall seam
    const [dx, dz] = p.faceDir!;
    const pos = new THREE.Vector3(p.x + 0.5 + dx * 0.46, 0.5, p.z + 0.5 + dz * 0.46);
    fx.flame(p.group, pos.x, pos.y, pos.z, "rgba(220,70,30,.55)", 0.5);
    fx.anchor(pos, 0xdd5522, 3.2, 4, 0.5);
  },

  embervent(p) { // fire from below, hissing through the floor
    const pos = new THREE.Vector3(p.x + 0.5, 0.02, p.z + 0.5);
    fx.flame(p.group, pos.x, 0.06, pos.z, "rgba(255,110,40,.6)", 0.42);
    fx.anchor(pos, 0xff6428, 3.5, 3.5, 0.6);
  },

  exitLight(p) { // daylight spilling down the way out
    fx.flame(p.group, 0.5, 0.7, 0.5, "rgba(210,220,235,.5)", 0.6);
    fx.anchor(new THREE.Vector3(p.x + 0.5, 0.7, p.z + 0.5), 0xc8d4e8, 3, 4, 0.05);
  },

  fountain(p) { // a spring of cold, clear water
    const cx = 0.5, cz = 0.5;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.22, 12), PALETTE.stone);
    basin.position.set(cx, 0.11, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.26, 12),
      new THREE.MeshStandardMaterial({color: 0x7fa8bd, emissive: 0x3888b8, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.2}));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.225, cz);
    p.group.add(basin, water);
    fx.anchor(new THREE.Vector3(p.x + 0.5, 0.95, p.z + 0.5), 0x60b8e0, 1.1, 3.2, 0.12);
  },

  heather(p) { // moor heather: low green with purple sparks
    const g2 = new THREE.Group();
    const bloom2 = new THREE.MeshStandardMaterial({color: 0x8a6a9a, roughness: 0.9, emissive: 0x4a3458, emissiveIntensity: 0.25});
    const bx = 0.2 + ((p.hash >> 3) % 9) / 9 * 0.6, bz = 0.2 + ((p.hash >> 6) % 9) / 9 * 0.6;
    for (let i = 0; i < 3; i++) {
      const px2 = ((p.hash >> (i * 2)) % 7) / 7 * 0.16 - 0.08, pz2 = ((p.hash >> (i + 3)) % 7) / 7 * 0.16 - 0.08;
      const tuftM = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), PALETTE.heatherLeaf);
      tuftM.position.set(px2, 0.03, pz2); tuftM.scale.y = 0.65; g2.add(tuftM);
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), bloom2);
      bl.position.set(px2, 0.075, pz2); g2.add(bl);
    }
    g2.position.set(p.x + bx, 0, p.z + bz);
    p.group.add(g2);
    fx.sway(g2, 0.035, p.x + bx, p.z + bz);
  },

  lamppost(p) { // town light on an iron pole
    const px2 = p.x + 0.28, pz2 = p.z + 0.28;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.95, 6), PALETTE.iron);
    pole.position.set(px2, 0.48, pz2); p.group.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({color: 0xffc86a, emissive: 0xffa838, emissiveIntensity: 2.4});
    fx.dim(lampMat, 2.4);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.09), lampMat);
    lamp.position.set(px2, 0.95, pz2); p.group.add(lamp);
    fx.anchor(new THREE.Vector3(px2, 0.95, pz2), 0xffc06a, 5, 5.5, 0.06);
  },

  lighthouse(p) { // the isle's lamp, on its rock in the sea
    // the rock it stands on
    for (const [ox, oz, r] of [[0, 0, 1.25], [0.9, 0.5, 0.8], [-0.8, -0.4, 0.7]] as [number, number, number][]) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), PALETTE.boulder);
      rock.position.set(ox, r * 0.3, oz); rock.scale.y = 0.6;
      p.group.add(rock);
    }
    // banded tower
    const bands = [0xb8b0a2, 0x9a3c2c, 0xb8b0a2];
    for (let i = 0; i < 3; i++) {
      const r0 = 0.82 - i * 0.14, r1 = 0.68 - i * 0.14;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1.75, 10),
        new THREE.MeshStandardMaterial({color: bands[i], roughness: 0.9}));
      seg.position.y = 0.7 + 1.75 * i + 0.875;
      p.group.add(seg);
    }
    // gallery + lantern room
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 10), PALETTE.iron);
    gallery.position.y = 0.7 + 5.25 + 0.08;
    p.group.add(gallery);
    const lampMat = new THREE.MeshStandardMaterial({color: 0xffe9b0, emissive: 0xffc860, emissiveIntensity: 0.3});
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.55, 8), lampMat);
    lantern.position.y = 0.7 + 5.25 + 0.44;
    p.group.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.4, 8), PALETTE.iron);
    cap.position.y = 0.7 + 5.25 + 0.92;
    p.group.add(cap);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: fx.glowTexture("rgba(255,220,140,.9)"), transparent: true, opacity: 0, depthWrite: false}));
    glow.position.y = 0.7 + 5.25 + 0.44;
    glow.scale.setScalar(2.2);
    p.group.add(glow);
    // two opposed beams that the night turns
    const beacon = new THREE.Group();
    beacon.position.y = 0.7 + 5.25 + 0.44;
    const beamMat = new THREE.MeshBasicMaterial({color: 0xfff0c2, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide});
    const beamGeo = new THREE.ConeGeometry(1.5, 16, 10, 1, true);
    beamGeo.translate(0, -8, 0);
    beamGeo.rotateX(Math.PI / 2); // the beam lies flat, reaching outward
    for (const rot of [0, Math.PI]) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.rotation.y = rot;
      beacon.add(beam);
    }
    p.group.add(beacon);
    fx.beacon(beacon, beamMat, lampMat, glow);
  },

  log(p) { // a fallen trunk going soft with moss
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.045, 0.4, 6), PALETTE.wood);
    trunk.rotation.z = Math.PI / 2; trunk.rotation.y = (p.hash % 9) / 9 * 3;
    trunk.position.set(p.x + 0.5 + ((p.hash % 5) - 2) * 0.05, 0.04, p.z + 0.78);
    p.group.add(trunk);
  },

  menhir(p) { // a leaning stone somebody raised long ago
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4 + (p.hash % 4) * 0.05, 0.07), PALETTE.menhir);
    stone.position.set(p.x + 0.78, 0.2, p.z + 0.78);
    stone.rotation.set((((p.hash >> 3) % 5) - 2) * 0.04, (p.hash % 7) / 7 * 3, ((p.hash % 5) - 2) * 0.06);
    p.group.add(stone);
  },

  mushrooms(p) { // pale caps that keep their own light
    const capMat = new THREE.MeshStandardMaterial({color: 0x5a7a8a, emissive: 0x58c8f0, emissiveIntensity: 1.1});
    fx.dim(capMat, 1.1);
    for (let i = 0; i < 3; i++) {
      const mh = 0.06 + ((p.hash >> (i * 2)) % 4) * 0.015;
      const mx = p.x + 0.35 + ((p.hash >> i) % 7) / 7 * 0.3, mz = p.z + 0.35 + ((p.hash >> (i + 2)) % 7) / 7 * 0.3;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, mh, 5),
        new THREE.MeshStandardMaterial({color: 0x3d4a52}));
      stem.position.set(mx, mh / 2, mz); p.group.add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.035, 7), capMat);
      cap.position.set(mx, mh + 0.012, mz); p.group.add(cap);
    }
    fx.anchor(new THREE.Vector3(p.x + 0.5, 0.12, p.z + 0.5), 0x66c8ee, 1.6, 2.5, 0.35);
  },

  pebbles(p) { // a scatter of small stones
    for (let i = 0; i < 4 + (p.hash % 3); i++) {
      const r = 0.018 + ((p.hash >> (i * 2)) % 5) * 0.009;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), PALETTE.boulder);
      st.position.set(p.x + 0.15 + ((p.hash >> i) % 11) / 11 * 0.7, r * 0.6,
                      p.z + 0.15 + ((p.hash >> (i + 3)) % 11) / 11 * 0.7);
      st.rotation.set(i, p.hash % 7, 0); st.scale.y = 0.7;
      p.group.add(st);
    }
  },

  pineStand(p) { // a stand of pines too dense to push through
    const h = p.hash;
    for (let i = 0; i < 3; i++) {
      const th = 0.4 + ((h >> (i * 2)) % 4) * 0.08;
      const tx = p.x + 0.22 + ((h >> i) % 5) / 5 * 0.56, tz = p.z + 0.22 + ((h >> (i + 3)) % 5) / 5 * 0.56;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.042, th, 5), PALETTE.wood);
      trunk.position.set(tx, th / 2, tz); p.group.add(trunk);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17 + ((h >> (i + 4)) % 4) * 0.022, 0.44 + th * 0.45, 7), PALETTE.wildFoliage);
      cone.position.set(tx, th + 0.16, tz); p.group.add(cone);
      fx.sway(cone, 0.018, tx, tz);
    }
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 5), PALETTE.wildFoliage);
    bush.position.set(p.x + 0.5, 0.09, p.z + 0.5); bush.scale.y = 0.6;
    p.group.add(bush);
  },

  puddle(p) { // rain that stayed behind
    const pm = new THREE.MeshStandardMaterial({color: 0x1a2836, roughness: 0.08, metalness: 0.85,
      emissive: 0x0e2028, emissiveIntensity: 0.5});
    fx.shimmer(pm, 0.5);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16 + ((p.hash >> 3) % 5) * 0.02, 16), pm);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x + 0.5 + ((p.hash % 13) - 6) * 0.02, 0.005, p.z + 0.5);
    p.group.add(disc);
  },

  reeds(p) { // marsh grass in a wind-bent clump
    const g2 = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const bh = 0.11 + ((p.hash >> i) % 5) * 0.03;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.01, bh, 4), PALETTE.reed);
      blade.position.set(((p.hash >> (i * 2)) % 9) / 9 * 0.24 - 0.12, bh / 2, ((p.hash >> (i + 4)) % 7) / 7 * 0.2 - 0.1);
      blade.rotation.z = (((p.hash >> i) % 7) - 3) * 0.05;
      g2.add(blade);
    }
    g2.position.set(p.x + 0.26, 0, p.z + 0.72);
    p.group.add(g2);
    fx.sway(g2, 0.1, p.x, p.z);
  },

  roof(p) { // pitched prism with closed gables; engine positions the group at the roof line
    const geo = new THREE.CylinderGeometry(0.66, 0.66, 1.08, 3, 1, false, Math.PI / 2);
    geo.rotateZ(Math.PI / 2);
    geo.scale(1, 0.55, 1);
    const roof = new THREE.Mesh(geo, PALETTE.roofs[p.hash % PALETTE.roofs.length]);
    if (p.ridgeAlongZ) roof.rotation.y = Math.PI / 2;
    p.group.add(roof);
  },

  rubble(p) { // fallen stone, fist-sized
    for (let i = 0; i < 4; i++) {
      const s = 0.03 + ((p.hash >> (i * 3)) % 17) / 17 * 0.05;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), PALETTE.stone);
      rock.position.set(p.x + 0.25 + ((p.hash >> i) % 11) / 11 * 0.5, s * 0.8, p.z + 0.25 + ((p.hash >> (i + 3)) % 11) / 11 * 0.5);
      rock.rotation.set(i, p.hash % 7, 0);
      p.group.add(rock);
    }
  },

  ruin(p) { // a landmark left by older hands
    const h = p.hash;
    const kind = h % 3;
    if (kind === 0) { // the corner of a house no one remembers
      const walls: [number, number, number, number, number][] = [
        [0.28, 0.18, 0.5, 0.09, 0.55 + (h % 4) * 0.08],
        [0.16, 0.36, 0.09, 0.42, 0.4 + ((h >> 2) % 4) * 0.07],
        [0.72, 0.7, 0.34, 0.09, 0.2 + ((h >> 4) % 3) * 0.06],
      ];
      for (const [wx, wz, ww, wd, wh] of walls) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), PALETTE.ruin);
        wall.position.set(p.x + wx, wh / 2, p.z + wz);
        p.group.add(wall);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(ww * 0.55, 0.07, wd * 0.9), PALETTE.ruin);
        cap.position.set(p.x + wx + ww * 0.12, wh + 0.035, p.z + wz);
        cap.rotation.y = ((h >> 3) % 5 - 2) * 0.06;
        p.group.add(cap);
      }
    } else if (kind === 1) { // a doorway that outlived its door
      const tall = 0.72 + (h % 3) * 0.06;
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, tall, 0.13), PALETTE.ruin);
      p1.position.set(p.x + 0.3, tall / 2, p.z + 0.5); p.group.add(p1);
      const short = tall * 0.45;
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, short, 0.13), PALETTE.ruin);
      p2.position.set(p.x + 0.7, short / 2, p.z + 0.5); p2.rotation.z = 0.05; p.group.add(p2);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.15), PALETTE.ruin);
      lintel.position.set(p.x + 0.38, tall + 0.02, p.z + 0.5); lintel.rotation.z = -0.35; p.group.add(lintel);
    } else { // a shrine slab, knelt-at once, tilted now
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.42), PALETTE.ruin);
      plinth.position.set(p.x + 0.5, 0.06, p.z + 0.5); p.group.add(plinth);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.08), PALETTE.ruin);
      slab.position.set(p.x + 0.5, 0.34, p.z + 0.52);
      slab.rotation.x = 0.18; slab.rotation.z = ((h >> 2) % 5 - 2) * 0.05;
      p.group.add(slab);
    }
    ASSETS.pebbles({...p, hash: h >> 3, biome: BIOMES.moor});
    ASSETS.tuft({...p, hash: h >> 5, biome: BIOMES.moor});
  },

  sacks(p) { // grain sacks slumped against a wall
    for (let i = 0; i < 2 + (p.hash % 2); i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.075 + ((p.hash >> i) % 4) * 0.012, 7, 6), PALETTE.sack);
      s.position.set(p.x + 0.25 + ((p.hash >> (i * 2)) % 5) / 5 * 0.24, 0.07,
                     p.z + 0.66 + ((p.hash >> (i + 3)) % 4) / 4 * 0.16);
      s.scale.y = 0.62;
      p.group.add(s);
    }
  },

  signalFire(p) { // the co-op beacon: stone ring, stacked logs, a fire that answers the link
    const cx = 0.5, cz = 0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 6, 12), PALETTE.stone);
    ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.04, cz);
    p.group.add(ring);
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 5), PALETTE.wood);
      log.position.set(cx, 0.14, cz); log.rotation.z = 0.9; log.rotation.y = i * 2.1;
      p.group.add(log);
    }
    const lit = new THREE.Group(), cold = new THREE.Group();
    fx.flame(lit, p.x + cx, 0.35, p.z + cz, "rgba(250,170,60,.95)", 0.55);
    fx.anchor(new THREE.Vector3(p.x + cx, 0.4, p.z + cz), 0xffa040, 7, 6, 0.35);
    fx.signalFire(lit, cold);
  },

  stairs(p) { // steps worn smooth, going down (or climbing back up)
    const cx = 0.5, cz = 0.5;
    for (let i = 0; i < 4; i++) {
      const stepM = new THREE.Mesh(new THREE.BoxGeometry(0.8 - i * 0.12, 0.08, 0.24), PALETTE.stone);
      stepM.position.set(cx, p.up ? 0.08 + i * 0.14 : 0.04 + i * 0.02, cz - 0.3 + i * 0.2);
      p.group.add(stepM);
    }
    if (p.up) fx.anchor(new THREE.Vector3(p.x + cx, 0.8, p.z + cz), 0xffc478, 2, 3, 0.1);
  },

  stalagmite(p) { // the cave grows teeth
    for (let i = 0; i < 2 + (p.hash % 2); i++) {
      const sh = 0.08 + ((p.hash >> (i * 2)) % 6) * 0.035;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035 + ((p.hash >> i) % 3) * 0.014, sh, 6), PALETTE.stone);
      spike.position.set(p.x + 0.2 + ((p.hash >> (i * 3)) % 8) / 8 * 0.28, sh / 2,
                         p.z + 0.6 + ((p.hash >> (i + 5)) % 6) / 6 * 0.24);
      p.group.add(spike);
    }
  },

  stoneCircle(p) { // a ring of standing stones, patient as the hills
    const h = p.hash;
    const n = 6 + (h % 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (h % 7) / 7;
      const sh = 0.2 + ((h >> (i % 5)) % 4) * 0.05;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, sh, 0.055), PALETTE.menhir);
      s.position.set(p.x + 0.5 + Math.cos(a) * 0.36, sh / 2 - 0.01, p.z + 0.5 + Math.sin(a) * 0.36);
      s.rotation.set((((h >> i) % 5) - 2) * 0.05, a + Math.PI / 2, (((h >> (i + 2)) % 5) - 2) * 0.07);
      p.group.add(s);
    }
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 8), PALETTE.menhir);
    altar.position.set(p.x + 0.5, 0.025, p.z + 0.5);
    p.group.add(altar);
  },

  torch(p) { // wall-bracket fire
    const [dx, dz] = p.faceDir!;
    const bx = p.x + 0.5 + dx * 0.44, bz = p.z + 0.5 + dz * 0.44;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.28, 6), PALETTE.wood);
    shaft.position.set(bx + dx * -0.03, 0.62, bz + dz * -0.03);
    shaft.rotation.z = dx * -0.4; shaft.rotation.x = dz * 0.4;
    p.group.add(shaft);
    const tip = new THREE.Vector3(bx - dx * 0.1, 0.78, bz - dz * 0.1);
    fx.flame(p.group, tip.x, tip.y, tip.z, "rgba(242,150,40,.9)", 0.34);
    fx.anchor(tip, 0xffab4a, 6, 5, 0.3);
  },

  tradeStall(p) { // the trading post's striped counter
    const cx = 0.5, cz = 0.5;
    for (const dx of [-0.35, 0.35]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5), PALETTE.wood);
      post.position.set(cx + dx, 0.4, cz); p.group.add(post);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.34), PALETTE.wood);
    counter.position.set(cx, 0.15, cz); p.group.add(counter);
    const canopyCv = document.createElement("canvas"); canopyCv.width = 64; canopyCv.height = 16;
    const cc = canopyCv.getContext("2d")!;
    for (let i = 0; i < 8; i++) { cc.fillStyle = i % 2 ? "#8a3a28" : "#b8a888"; cc.fillRect(i * 8, 0, 8, 16); }
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34),
      new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(canopyCv), side: THREE.DoubleSide, roughness: 0.9}));
    canopy.rotation.x = -0.5; canopy.position.set(cx, 0.86, cz + 0.05);
    p.group.add(canopy);
  },

  tree(p) { // a windswept moor pine, leaning off the path
    const th = 0.5 + ((p.hash >> 2) % 5) * 0.09;
    const tx = p.x + 0.22 + ((p.hash % 7) / 7) * 0.2, tz = p.z + 0.22 + (((p.hash >> 3) % 7) / 7) * 0.2;
    const lean = (((p.hash >> 5) % 9) - 4) * 0.03;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, th, 6), PALETTE.wood);
    trunk.position.set(tx, th / 2, tz); trunk.rotation.z = lean;
    p.group.add(trunk);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24 + ((p.hash >> 4) % 4) * 0.03, 0.5 + th * 0.5, 7), PALETTE.wildFoliage);
    cone.position.set(tx + lean * th, th + 0.2, tz);
    p.group.add(cone);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.3 + ((p.hash >> 6) % 4) * 0.03, 0.34, 7), PALETTE.wildFoliage);
    skirt.position.set(tx + lean * th * 0.6, th * 0.72, tz);
    p.group.add(skirt);
  },

  tuft(p) { // a knot of grass that answers the wind
    const mat = new THREE.MeshStandardMaterial({color: grassHue(p.biome), roughness: 0.95});
    const g2 = new THREE.Group();
    const bx = 0.2 + ((p.hash >> 2) % 9) / 9 * 0.6, bz = 0.2 + ((p.hash >> 5) % 9) / 9 * 0.6;
    for (let i = 0; i < 5; i++) {
      const bh = 0.05 + ((p.hash >> i) % 4) * 0.02;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.008, bh, 3), mat);
      blade.position.set(((p.hash >> (i * 2)) % 7) / 7 * 0.1 - 0.05, bh / 2, ((p.hash >> (i + 4)) % 7) / 7 * 0.1 - 0.05);
      blade.rotation.z = (((p.hash >> i) % 5) - 2) * 0.09;
      g2.add(blade);
    }
    g2.position.set(p.x + bx, 0, p.z + bz);
    p.group.add(g2);
    fx.sway(g2, 0.08, p.x + bx, p.z + bz);
  },

  vaultDoor(p) { // the folded door out of a vault: an arch of pale light
    const cx = 0.5, cz = 0.5;
    for (const dx of [-0.26, 0.26]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.92, 0.1), PALETTE.stone);
      post.position.set(cx + dx, 0.46, cz); p.group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 0.12), PALETTE.stone);
    lintel.position.set(cx, 0.94, cz); p.group.add(lintel);
    fx.flame(p.group, cx, 0.5, cz, "rgba(200,176,224,.55)", 0.55);
    fx.anchor(new THREE.Vector3(p.x + cx, 0.55, p.z + cz), 0xc8b0e0, 4, 4.5, 0.15);
  },
  watchtower(p) { // a hollow tower still watching the water
    const h = p.hash;
    const cx = p.x + 0.74, cz = p.z + 0.74; // it keeps to its corner of the cell
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 1.8, 9, 1, true), PALETTE.ruin);
    body.position.set(cx, 0.9, cz);
    p.group.add(body);
    const n = 6; // the crown, part-fallen
    for (let i = 0; i < n; i++) {
      if ((h >> i) % 3 === 0) continue;
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11 + ((h >> i) % 3) * 0.03, 0.06), PALETTE.ruin);
      m.position.set(cx + Math.cos(a) * 0.17, 1.84, cz + Math.sin(a) * 0.17);
      m.rotation.y = -a;
      p.group.add(m);
    }
    const da = (h % 4) * Math.PI / 2;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.26), new THREE.MeshBasicMaterial({color: 0x050604}));
    door.position.set(cx + Math.cos(da) * 0.215, 0.14, cz + Math.sin(da) * 0.215);
    door.lookAt(cx + Math.cos(da) * 2, 0.14, cz + Math.sin(da) * 2);
    p.group.add(door);
    for (let i = 0; i < 4; i++) { // fallen crown-stones in the grass
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.07), PALETTE.ruin);
      r.position.set(p.x + 0.15 + ((h >> (i * 2)) % 7) / 7 * 0.5, 0.03, p.z + 0.15 + ((h >> (i * 2 + 3)) % 7) / 7 * 0.5);
      r.rotation.y = (h >> i) % 7;
      p.group.add(r);
    }
  },

  wreck(p) { // a hull the sea gave back, keel to the sky
    const h = p.hash;
    const g2 = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 8, 1), PALETTE.wood);
    hull.rotation.z = Math.PI / 2; hull.scale.y = 0.6; hull.position.y = 0.1;
    g2.add(hull);
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.035, 0.045), PALETTE.iron);
    keel.position.y = 0.2;
    g2.add(keel);
    for (const e of [-1, 1]) { // ribs the tide stripped bare
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), PALETTE.wood);
      rib.position.set(e * (0.33 + ((h >> 3) % 3) * 0.02), 0.1, e * 0.03);
      rib.rotation.z = e * 0.5;
      g2.add(rib);
    }
    g2.position.set(p.x + 0.5, 0, p.z + 0.5);
    g2.rotation.y = (h % 7) + 0.4;
    p.group.add(g2);
  },

};

/** Which asset stages each map feature character. */
export const FEATURE_ASSET: Record<string, string> = {
  C: "chest", S: "stairs", U: "stairs", F: "fountain", B: "bossIdol",
  E: "exitLight", G: "signalFire", R: "tradeStall", X: "vaultDoor",
};
