import { app } from "./bus";
import { state, setState, loadSave, save, alive } from "./state";
import { show } from "./ui";
import { $ } from "./util";
import { openTown, showEnding, bindTownScreens } from "./town";
import { openDraft, openTavern, bindTavern } from "./tavern";
import { enterDungeon, backToDungeon, turn, step, usePotionField, bindDungeonControls, rescueParty } from "./dungeon";
import { startCombat, combatSnapshot } from "./combat";
import { initCoop } from "./coop";
import { openTradePost, bindTrade } from "./trade";
import { unlock, toggleMute, isMuted, setScene } from "./audio";

/* Wire the cross-screen bus (keeps the module graph acyclic). */
app.openTown = openTown;
app.openTavern = openTavern;
app.openDraft = openDraft;
app.enterDungeon = enterDungeon;
app.startCombat = startCombat;
app.backToDungeon = backToDungeon;
app.showEnding = showEnding;
app.turn = turn;
app.step = step;
app.usePotionField = usePotionField;
app.combatSnapshot = combatSnapshot;
app.openTrade = openTradePost;

/* ============================== TITLE ============================== */
function initTitle(): void {
  if (loadSave()) $("bt-continue").style.display = "";
  $("bt-new").onclick = () => { openDraft(); };
  $("bt-continue").onclick = () => {
    const s = loadSave();
    if (!s) { openDraft(); return; }
    setState(s);
    if (state.inDungeon) enterDungeon(false); else openTown();
  };
}

/* ============================== DEFEAT / ENDING ============================== */
function bindEndScreens(): void {
  $("bt-dead-load").onclick = () => {
    const s = loadSave();
    if (s) {
      setState(s);
      if (!alive().length) { // saved state is also a wipe: the fisherfolk intervene
        rescueParty(); save();
        openTown("Fisherfolk drag you from the stairmouth, half-alive. Half your gold pays for the trouble.");
        return;
      }
      if (state.inDungeon) enterDungeon(false); else openTown();
    } else { show("scr-title"); }
  };
  $("bt-dead-title").onclick = () => show("scr-title");
  $("bt-end-continue").onclick = () => openTown("Vhalis breathes again. The caves below are quieter now — but not empty.");
  $("bt-end-title").onclick = () => show("scr-title");
}

/* ============================== AUDIO ============================== */
function bindAudio(): void {
  const bt = $("bt-audio");
  bt.textContent = isMuted() ? "♪ off" : "♪ on";
  bt.onclick = () => { bt.textContent = toggleMute() ? "♪ off" : "♪ on"; };
  document.addEventListener("pointerdown", () => unlock(), {once: true});
  setScene("town"); // title shares the town's warmth once audio unlocks
}

/* ============================== BOOT ============================== */
initTitle();
bindTownScreens();
bindTavern();
bindDungeonControls();
bindEndScreens();
bindAudio();
bindTrade();
initCoop();

declare global { interface Window { __ei: unknown; } }
window.__ei = {
  get state() { return state; },
  startCombat, enterDungeon, openTown, openTavern, save,
};
