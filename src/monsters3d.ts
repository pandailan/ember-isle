/* Canonical 3D monster rigs: every creature the isle fields, built from
   primitives and animated through simple named parts. Keyed by the ENEMIES
   key, swap-friendly like the asset library. Each rig stands at its group
   origin (feet on the ground), facing +Z; the engine yaws it toward the
   party, drives idle ticks, and plays the generic lunge/flinch/death moves. */
import * as THREE from "three";

export interface MonsterRig {
  group: THREE.Group;
  /** idle life; t is world time, ph a per-instance phase offset */
  tick(t: number, ph: number): void;
  /** how this creature dies: solid things fall, soft things melt */
  die: "fall" | "melt";
  /** tint the hide toward the hit-flash and back (k = 0..1) */
  flash(k: number): void;
  /** fade the whole body (fallen foes linger as shades) */
  fade(o: number): void;
}
export type MonsterFactory = () => MonsterRig;

/* ---------- rig-building helpers ---------- */
interface Kit {
  g: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  mat(c: number, rough?: number, emissive?: number, ei?: number): THREE.MeshStandardMaterial;
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh;
  ball(m: THREE.Material, r: number, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number): THREE.Mesh;
  cyl(m: THREE.Material, r1: number, r2: number, h: number, x: number, y: number, z: number): THREE.Mesh;
  cone(m: THREE.Material, r: number, h: number, x: number, y: number, z: number): THREE.Mesh;
  eyes(x: number, y: number, z: number, color: number, r?: number): THREE.Mesh[];
}
function kit(): Kit {
  const g = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  return {
    g, mats,
    mat(c, rough = 0.9, emissive = 0, ei = 0) {
      const m = new THREE.MeshStandardMaterial({color: c, roughness: rough, transparent: true,
        emissive, emissiveIntensity: ei});
      mats.push(m); return m;
    },
    box: (m, w, h, d, x, y, z) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z),
    ball(m, r, x, y, z, sx = 1, sy = 1, sz = 1) {
      const b = add(new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), m), x, y, z);
      b.scale.set(sx, sy, sz); return b;
    },
    cyl: (m, r1, r2, h, x, y, z) => add(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 7), m), x, y, z),
    cone: (m, r, h, x, y, z) => add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), m), x, y, z),
    eyes(x, y, z, color, r = 0.016) {
      const m = new THREE.MeshStandardMaterial({color: 0x000000, emissive: color,
        emissiveIntensity: 1.6, transparent: true});
      mats.push(m as THREE.MeshStandardMaterial);
      return [-1, 1].map(s => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), m);
        e.position.set(x * s, y, z); g.add(e); return e;
      });
    },
  };
}

/** Wrap a built kit into the rig contract with shared flash/fade plumbing. */
function rig(k: Kit, die: MonsterRig["die"], tick: MonsterRig["tick"]): MonsterRig {
  const bases = k.mats.map(m => m.color.clone());
  const emis = k.mats.map(m => m.emissiveIntensity);
  return {
    group: k.g, die, tick,
    flash(f) {
      for (let i = 0; i < k.mats.length; i++) {
        const m = k.mats[i];
        m.color.copy(bases[i]).lerp(_white, f * 0.85);
        m.emissiveIntensity = emis[i] + f * 0.6;
      }
    },
    fade(o) { for (const m of k.mats) m.opacity = o; },
  };
}
const _white = new THREE.Color(0xffcaba);

/* =========================== MONSTERS (alphabetical) =========================== */
export const MONSTERS: Record<string, MonsterFactory> = {

  boss() { // Pyrelord Vhal: a crowned furnace given legs
    const k = kit();
    const hide = k.mat(0x341e16, 0.9), horn = k.mat(0xb0a284, 0.75);
    const fire = k.mat(0xe09a3c, 0.5, 0xff7020, 1.4);
    k.box(hide, 0.4, 0.42, 0.24, 0, 0.62, 0);            // furnace chest
    k.box(fire, 0.3, 0.05, 0.02, 0, 0.66, 0.12);         // molten seam
    k.box(fire, 0.2, 0.04, 0.02, 0, 0.54, 0.12);
    k.box(hide, 0.13, 0.4, 0.15, -0.11, 0.2, 0);         // legs
    k.box(hide, 0.13, 0.4, 0.15, 0.11, 0.2, 0);
    const armL = k.box(hide, 0.11, 0.4, 0.13, -0.28, 0.6, 0);
    const armR = k.box(hide, 0.11, 0.4, 0.13, 0.28, 0.6, 0);
    armL.geometry.translate(0, -0.14, 0); armL.position.y = 0.76;
    armR.geometry.translate(0, -0.14, 0); armR.position.y = 0.76;
    const head = k.ball(hide, 0.13, 0, 0.95, 0);
    void head;
    const hl = k.cone(horn, 0.045, 0.2, -0.11, 1.08, 0); hl.rotation.z = 0.5;
    const hr = k.cone(horn, 0.045, 0.2, 0.11, 1.08, 0); hr.rotation.z = -0.5;
    const crown = [-0.06, 0, 0.06].map((x, i) =>
      k.cone(fire, 0.035, 0.12 + (i === 1 ? 0.06 : 0), x, 1.12, 0));
    k.eyes(0.05, 0.96, 0.115, 0xffb040, 0.022);
    return rig(k, "fall", (t, ph) => {
      k.g.scale.y = 1 + Math.sin(t * 1.4 + ph) * 0.012;
      for (let i = 0; i < crown.length; i++) crown[i].scale.y = 0.9 + 0.25 * Math.sin(t * 7 + i * 2.1 + ph);
      armL.rotation.x = Math.sin(t * 1.4 + ph) * 0.08;
      armR.rotation.x = -Math.sin(t * 1.4 + ph) * 0.08;
      fire.emissiveIntensity = 1.2 + 0.5 * Math.sin(t * 5.3 + ph);
    });
  },

  cul() { // Ember Cultist: a robe with a burning heart
    const k = kit();
    const robe = k.mat(0x481810, 0.97), trim = k.mat(0x1c0c08, 0.97);
    const ember = k.mat(0xc8502f, 0.5, 0xff6a28, 1.3);
    const body = k.cyl(robe, 0.1, 0.19, 0.5, 0, 0.25, 0);
    void body;
    k.cyl(trim, 0.19, 0.2, 0.04, 0, 0.03, 0);
    k.ball(robe, 0.095, 0, 0.56, 0);                     // hood
    k.ball(trim, 0.075, 0, 0.545, 0.035);                // the dark inside it
    k.ball(ember, 0.028, 0, 0.4, 0.17);                  // pendant
    const staff = k.cyl(trim, 0.014, 0.014, 0.6, 0.17, 0.32, 0.04);
    const tip = k.ball(ember, 0.035, 0.17, 0.65, 0.04);
    k.eyes(0.032, 0.56, 0.09, 0xffa040);
    return rig(k, "fall", (t, ph) => {
      k.g.rotation.z = Math.sin(t * 1.1 + ph) * 0.03;
      tip.scale.setScalar(1 + 0.2 * Math.sin(t * 4.4 + ph));
      staff.rotation.x = Math.sin(t * 1.1 + ph) * 0.05;
      ember.emissiveIntensity = 1.1 + 0.4 * Math.sin(t * 3.7 + ph);
    });
  },

  gob() { // Goblin: small, mean, armed with somebody's table leg
    const k = kit();
    const skin = k.mat(0x4e5624, 0.95), rag = k.mat(0x322416, 0.97), wood = k.mat(0x281c10, 0.95);
    k.box(skin, 0.09, 0.2, 0.1, -0.06, 0.1, 0);          // legs
    k.box(skin, 0.09, 0.2, 0.1, 0.06, 0.1, 0);
    k.box(rag, 0.24, 0.2, 0.16, 0, 0.3, 0);              // ragged jerkin
    const head = k.ball(skin, 0.105, 0, 0.5, 0.02);
    const earL = k.cone(skin, 0.035, 0.12, -0.12, 0.54, 0); earL.rotation.z = 1.2;
    const earR = k.cone(skin, 0.035, 0.12, 0.12, 0.54, 0); earR.rotation.z = -1.2;
    const arm = k.box(skin, 0.06, 0.24, 0.07, 0.17, 0.36, 0);
    arm.geometry.translate(0, -0.08, 0);
    const club = k.box(wood, 0.05, 0.24, 0.05, 0.17, 0.2, 0.06);
    k.box(skin, 0.06, 0.22, 0.07, -0.16, 0.28, 0);
    k.eyes(0.045, 0.51, 0.095, 0xf0d040);
    return rig(k, "fall", (t, ph) => {
      k.g.rotation.z = Math.sin(t * 2.1 + ph) * 0.04;
      head.rotation.y = Math.sin(t * 0.9 + ph) * 0.3;
      arm.rotation.x = -0.25 + Math.sin(t * 2.1 + ph) * 0.12;
      club.rotation.x = -0.25 + Math.sin(t * 2.1 + ph) * 0.12;
    });
  },

  gol() { // Stone Golem: masonry that remembered how to stand
    const k = kit();
    const stone = k.mat(0x4e4e4c, 0.98), dark = k.mat(0x3a3a38, 0.98);
    const core = k.mat(0xc8502f, 0.6, 0xff6828, 1.2);
    k.box(dark, 0.34, 0.18, 0.24, 0, 0.09, 0);           // pedestal legs
    const torso = k.box(stone, 0.4, 0.34, 0.26, 0, 0.42, 0);
    void torso;
    k.box(core, 0.16, 0.05, 0.02, 0, 0.45, 0.135);       // the burning seam
    k.box(stone, 0.14, 0.3, 0.16, -0.3, 0.42, 0);        // slab arms
    k.box(stone, 0.14, 0.3, 0.16, 0.3, 0.42, 0);
    k.box(dark, 0.16, 0.12, 0.14, 0, 0.66, 0);           // head block
    k.eyes(0.04, 0.68, 0.075, 0xffa040, 0.02);
    return rig(k, "melt", (t, ph) => {
      k.g.scale.y = 1 + Math.sin(t * 0.7 + ph) * 0.008;
      core.emissiveIntensity = 1.0 + 0.45 * Math.sin(t * 2.2 + ph);
    });
  },

  rat() { // Cave Rat: fast, low, and far too confident
    const k = kit();
    const fur = k.mat(0x453b28, 0.97), pink = k.mat(0x6e5048, 0.92);
    const body = k.ball(fur, 0.13, 0, 0.12, -0.02, 1, 0.8, 1.5);
    const head = k.ball(fur, 0.07, 0, 0.13, 0.17);
    k.cone(pink, 0.02, 0.07, 0, 0.12, 0.26).rotation.x = Math.PI / 2;
    const earL = k.cone(pink, 0.04, 0.06, -0.05, 0.21, 0.13);
    const earR = k.cone(pink, 0.04, 0.06, 0.05, 0.21, 0.13);
    void earL; void earR; void head;
    const tail = k.cyl(pink, 0.008, 0.014, 0.24, 0, 0.1, -0.24);
    tail.rotation.x = 1.2;
    k.eyes(0.035, 0.17, 0.23, 0xff5040, 0.012);
    return rig(k, "fall", (t, ph) => {
      body.scale.y = 0.8 + Math.sin(t * 6 + ph) * 0.04;
      tail.rotation.z = Math.sin(t * 3.3 + ph) * 0.4;
    });
  },

  ske() { // Skeleton: patient bones with a soldier's habits
    const k = kit();
    const bone = k.mat(0x8e8676, 0.92), iron = k.mat(0x3e3a36, 0.7);
    k.cyl(bone, 0.02, 0.02, 0.22, -0.05, 0.11, 0);       // shins
    k.cyl(bone, 0.02, 0.02, 0.22, 0.05, 0.11, 0);
    k.box(bone, 0.14, 0.06, 0.08, 0, 0.24, 0);           // pelvis
    k.cyl(bone, 0.018, 0.018, 0.18, 0, 0.36, 0);         // spine
    for (let i = 0; i < 3; i++) k.box(bone, 0.2 - i * 0.03, 0.025, 0.12, 0, 0.34 + i * 0.05, 0); // ribs
    const skull = k.ball(bone, 0.075, 0, 0.52, 0);
    void skull;
    k.box(bone, 0.06, 0.035, 0.05, 0, 0.465, 0.02);      // jaw
    const armR = k.cyl(bone, 0.015, 0.015, 0.22, 0.14, 0.38, 0);
    armR.geometry.translate(0, -0.08, 0); armR.rotation.z = -0.25;
    k.cyl(bone, 0.015, 0.015, 0.22, -0.13, 0.34, 0).rotation.z = 0.2;
    const sword = k.box(iron, 0.02, 0.26, 0.035, 0.19, 0.26, 0.03);
    k.eyes(0.028, 0.53, 0.062, 0x80c8e8, 0.014);
    return rig(k, "fall", (t, ph) => {
      k.g.rotation.z = Math.sin(t * 7 + ph) * 0.008;    // the rattle
      k.g.rotation.y = Math.sin(t * 0.7 + ph) * 0.06;
      sword.rotation.x = Math.sin(t * 1.6 + ph) * 0.08;
    });
  },

  sli() { // Green Slime: a puddle with appetite
    const k = kit();
    const goo = k.mat(0x577a46, 0.35);
    goo.opacity = 0.88;
    const blob = k.ball(goo, 0.2, 0, 0.13, 0, 1, 0.68, 1);
    const inner = k.ball(k.mat(0x2e4a22, 0.5), 0.1, 0, 0.11, 0, 1, 0.6, 1);
    k.eyes(0.06, 0.18, 0.14, 0x203018, 0.02);
    return rig(k, "melt", (t, ph) => {
      const s = Math.sin(t * 2.6 + ph);
      blob.scale.set(1 + s * 0.06, 0.68 - s * 0.05, 1 + s * 0.06);
      inner.position.y = 0.11 + s * 0.012;
    });
  },

  wlf() { // Moor Wolf: grey hunger on four feet
    const k = kit();
    const fur = k.mat(0x4a545e, 0.97), dark = k.mat(0x333c44, 0.97);
    k.ball(fur, 0.13, 0, 0.22, -0.05, 1, 0.85, 1.7);     // body
    k.ball(fur, 0.11, 0, 0.24, 0.16, 1, 0.95, 1);        // chest
    const head = new THREE.Group(); head.position.set(0, 0.3, 0.26); k.g.add(head);
    const hb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), fur); head.add(hb);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.12), dark);
    muzzle.position.set(0, -0.02, 0.09); head.add(muzzle);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 6), dark);
      ear.position.set(0.05 * s, 0.09, -0.01); head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5),
        new THREE.MeshStandardMaterial({color: 0x000000, emissive: 0xe0a040, emissiveIntensity: 1.7, transparent: true}));
      eye.position.set(0.045 * s, 0.02, 0.075); head.add(eye);
      k.mats.push(eye.material as THREE.MeshStandardMaterial);
    }
    for (const [lx, lz] of [[-0.08, 0.14], [0.08, 0.14], [-0.08, -0.18], [0.08, -0.18]])
      k.cyl(dark, 0.022, 0.026, 0.2, lx, 0.1, lz);
    const tail = k.cyl(fur, 0.015, 0.035, 0.2, 0, 0.24, -0.3);
    tail.rotation.x = 0.9;
    return rig(k, "fall", (t, ph) => {
      head.rotation.x = Math.sin(t * 1.3 + ph) * 0.1;
      head.rotation.y = Math.sin(t * 0.8 + ph + 2) * 0.22;
      tail.rotation.z = Math.sin(t * 2.8 + ph) * 0.3;
      k.g.scale.y = 1 + Math.sin(t * 2.2 + ph) * 0.015;  // breathing
    });
  },

  wra() { // Cave Wraith: a cold draught wearing a cowl
    const k = kit();
    const shroud = k.mat(0x394c5c, 0.85);
    shroud.opacity = 0.72;
    const cowl = k.mat(0x2c3a46, 0.85);
    const body = k.cyl(shroud, 0.06, 0.2, 0.42, 0, 0.31, 0);
    void body;
    k.ball(cowl, 0.085, 0, 0.55, 0);
    k.ball(k.mat(0x10161c, 0.95), 0.066, 0, 0.545, 0.03);
    const armL = k.cyl(shroud, 0.02, 0.045, 0.2, -0.13, 0.4, 0.05); armL.rotation.z = 0.7;
    const armR = k.cyl(shroud, 0.02, 0.045, 0.2, 0.13, 0.4, 0.05); armR.rotation.z = -0.7;
    k.eyes(0.028, 0.55, 0.075, 0x8fd8f0, 0.015);
    return rig(k, "melt", (t, ph) => {
      k.g.position.y = Math.sin(t * 1.7 + ph) * 0.035 + 0.04; // it never touches the ground
      k.g.rotation.z = Math.sin(t * 1.1 + ph) * 0.05;
      armL.rotation.z = 0.7 + Math.sin(t * 1.4 + ph) * 0.12;
      armR.rotation.z = -0.7 - Math.sin(t * 1.4 + ph + 1) * 0.12;
    });
  },

  orc() { // Orc Raider: shoulders first, questions never
    const k = kit();
    const skin = k.mat(0x5e3c22, 0.95), leather = k.mat(0x281d12, 0.97), iron = k.mat(0x36322e, 0.7);
    k.box(skin, 0.11, 0.24, 0.12, -0.08, 0.12, 0);       // legs
    k.box(skin, 0.11, 0.24, 0.12, 0.08, 0.12, 0);
    k.box(leather, 0.32, 0.26, 0.2, 0, 0.37, 0);         // harness chest
    k.box(iron, 0.12, 0.06, 0.16, -0.19, 0.5, 0);        // shoulder plate
    const head = k.ball(skin, 0.11, 0, 0.6, 0.02);
    void head;
    k.cone(k.mat(0xe8e0cc, 0.7), 0.016, 0.05, -0.045, 0.56, 0.1);  // tusks
    k.cone(k.mat(0xe8e0cc, 0.7), 0.016, 0.05, 0.045, 0.56, 0.1);
    const arm = k.box(skin, 0.09, 0.3, 0.1, 0.22, 0.42, 0);
    arm.geometry.translate(0, -0.1, 0);
    const axeH = k.cyl(leather, 0.016, 0.016, 0.34, 0.24, 0.22, 0.05);
    const axe = k.box(iron, 0.14, 0.1, 0.02, 0.24, 0.36, 0.05);
    k.box(skin, 0.09, 0.28, 0.1, -0.21, 0.36, 0);
    k.eyes(0.045, 0.62, 0.1, 0xd05030, 0.015);
    return rig(k, "fall", (t, ph) => {
      k.g.scale.y = 1 + Math.sin(t * 1.6 + ph) * 0.015;
      k.g.rotation.z = Math.sin(t * 1.6 + ph) * 0.025;
      arm.rotation.x = Math.sin(t * 1.6 + ph) * 0.1;
      axeH.rotation.x = Math.sin(t * 1.6 + ph) * 0.1;
      axe.rotation.x = Math.sin(t * 1.6 + ph) * 0.1;
    });
  },
};

/** Build a rig for an enemy key; unknown keys get a goblin so nothing vanishes. */
export function makeMonster(key: string): MonsterRig {
  return (MONSTERS[key] ?? MONSTERS.gob)();
}
