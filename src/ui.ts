import type { Member, EnemyInst } from "./types";
import { state } from "./state";
import { $ } from "./util";
import { drawMonster } from "./render";

export let currentScreen = "scr-title";

export function show(id: string): void {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  currentScreen = id;
}

export function plaqueHTML(m: Member): string {
  return `<div class="plaque${m.down ? " down" : ""}">
    <span class="pname">${m.name}</span>
    <div class="bar hp"><i style="width:${Math.max(0, 100 * m.hp / m.maxhp)}%"></i></div>
    ${m.maxmp > 0 ? `<div class="bar mp"><i style="width:${Math.max(0, 100 * m.mp / m.maxmp)}%"></i></div>` : ""}
    <span class="pnum">${m.down ? "fallen" : `${m.hp}/${m.maxhp}${m.maxmp > 0 ? " · " + m.mp + "m" : ""}`} · L${m.lvl}</span>
  </div>`;
}

export function renderPlaques(elId: string): void {
  $(elId).innerHTML = state.party.map(m => plaqueHTML(m)).join("");
}

export function renderFoesData(enemies: EnemyInst[]): void {
  $("foes").innerHTML = enemies.map(e => `
    <div class="foe${e.hp <= 0 ? " dead" : ""}${e.boss ? " boss" : ""}" style="--sig:${e.hue}">
      <canvas class="portrait" width="112" height="112"></canvas>
      <span class="fname">${e.n}</span>
      <div class="bar hp" style="width:100%"><i style="width:${Math.max(0, 100 * e.hp / e.maxhp)}%"></i></div>
    </div>`).join("");
  document.querySelectorAll<HTMLCanvasElement>("#foes .foe .portrait").forEach((cv, i) => {
    const e = enemies[i];
    drawMonster(cv, e.boss ? "boss" : e.key, e.hue);
  });
}

export function redrawCombatLog(lines: string[]): void {
  $("combat-log").innerHTML = lines
    .map((l, i) => i < lines.length - 1 ? `<div class="old" style="color:var(--parch-dim)">${l}</div>` : `<div>${l}</div>`)
    .join("");
}
