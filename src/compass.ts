/* A compass rose for the walking view: the card swings so the facing cardinal
   sits under the fixed needle, like a handheld compass. Pure DOM/SVG with no
   renderer dependency — build one on any host element, call face() on turns. */

import type { Dir } from "./types";
import { DIRN } from "./data";

const CARD_SVG = `
<svg viewBox="0 0 64 64" width="100%" height="100%" role="img">
  <circle cx="32" cy="32" r="29" fill="#15100a" stroke="#3a2d1c" stroke-width="2"/>
  <path d="M32 2 L28.6 9 L35.4 9 Z" fill="#e09a3c"/>
  <g class="card">
    <circle cx="32" cy="32" r="24" fill="none" stroke="#2a2114" stroke-width="1"/>
    <path d="M32 10 L29.4 18 L34.6 18 Z" fill="#e09a3c"/>
    <path d="M32 54 L29.4 46 L34.6 46 Z" fill="#4a3a24"/>
    <path d="M10 32 L18 29.4 L18 34.6 Z" fill="#4a3a24"/>
    <path d="M54 32 L46 29.4 L46 34.6 Z" fill="#4a3a24"/>
    <text x="32" y="27" text-anchor="middle" fill="#e09a3c">N</text>
    <text x="43" y="36" text-anchor="middle" fill="#a3916c">E</text>
    <text x="32" y="47" text-anchor="middle" fill="#a3916c">S</text>
    <text x="21" y="36" text-anchor="middle" fill="#a3916c">W</text>
  </g>
</svg>`;

export class CompassRose {
  private readonly host: HTMLElement;
  private readonly card: SVGGElement;
  /** Cumulative angle, so 270° → 0° turns the short way instead of spinning back. */
  private angle = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    host.classList.add("rose");
    host.innerHTML = CARD_SVG;
    this.card = host.querySelector<SVGGElement>(".card")!;
    this.face(0);
  }

  /** Rotate the card so the given facing sits under the needle. The letters
      counter-rotate via CSS (see .rose rules) so they stay upright. */
  face(dir: Dir): void {
    const target = -dir * 90;
    const delta = ((target - this.angle) % 360 + 540) % 360 - 180;
    this.angle += delta;
    this.card.style.setProperty("--rot", `${this.angle}deg`);
    this.host.setAttribute("aria-label", `Facing ${DIRN[dir]}`);
  }
}
