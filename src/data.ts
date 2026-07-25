import type { ClassDef, SpellDef, RosterEntry, EnemyDef, ChestLoot } from "./types";

export const CLASSES: Record<string, ClassDef> = {
  Knight:  {hp:34, mp:0,  atk:9, def:7, spd:5, g:{hp:7,mp:0,atk:2,def:2,spd:1}, spells:[]},
  Paladin: {hp:30, mp:8,  atk:8, def:6, spd:4, g:{hp:6,mp:2,atk:2,def:2,spd:1}, spells:[["heal",2],["smite",3]]},
  Ranger:  {hp:26, mp:0,  atk:8, def:4, spd:8, g:{hp:5,mp:0,atk:2,def:1,spd:2}, spells:[]},
  Rogue:   {hp:24, mp:0,  atk:7, def:3, spd:9, g:{hp:4,mp:0,atk:2,def:1,spd:2}, spells:[], crit:.25},
  Cleric:  {hp:22, mp:14, atk:5, def:4, spd:5, g:{hp:4,mp:4,atk:1,def:1,spd:1}, spells:[["heal",1],["prayer",5],["revive",6]]},
  Sorcerer:{hp:18, mp:16, atk:4, def:2, spd:6, g:{hp:3,mp:5,atk:1,def:0,spd:1}, spells:[["fire",1],["wave",4]]},
};

export const SPELLS: Record<string, SpellDef> = {
  heal:  {n:"Heal",       mp:4,  kind:"ally",    d:m=>20+2*m.lvl, txt:"mends"},
  prayer:{n:"Prayer",     mp:10, kind:"allies",  d:m=>14+m.lvl,   txt:"mends"},
  revive:{n:"Revive",     mp:12, kind:"fallen",  d:()=>0,         txt:"raises"},
  fire:  {n:"Firebolt",   mp:3,  kind:"enemy",   d:m=>13+3*m.lvl, txt:"scorches"},
  wave:  {n:"Flame Wave", mp:9,  kind:"enemies", d:m=>10+2*m.lvl, txt:"engulfs"},
  smite: {n:"Smite",      mp:5,  kind:"enemy",   d:m=>15+2*m.lvl, txt:"smites", holy:true},
};

export const ROSTER: RosterEntry[] = [
  {name:"Sir Aldric",      cls:"Knight",   blurb:"Once captain of the harbor watch. Still wears the badge."},
  {name:"Dame Isolde",     cls:"Paladin",  blurb:"Swore an oath to the Tide. The Tide has not answered lately."},
  {name:"Mira Thorn",      cls:"Ranger",   blurb:"Hunted the cliffs before the birds went quiet."},
  {name:"Finn Vole",       cls:"Rogue",    blurb:"Claims he has already been down the Stair. Twice."},
  {name:"Brother Odo",     cls:"Cleric",   blurb:"Left the temple with its last relic and no permission."},
  {name:"Zephyra",         cls:"Sorcerer", blurb:"Came to the isle to study the Ember. Now she means to end it."},
  {name:"Grimbold Ashhand",cls:"Knight",   blurb:"A smith who forged his own eulogy, then a sword to outlive it."},
  {name:"Sella of the Vale",cls:"Cleric",  blurb:"Sings to the wounded. The wounded, so far, recover."},
];

export const ENEMIES: Record<string, EnemyDef> = {
  rat: {n:"Cave Rat",     hp:12, atk:6,  def:0, spd:9, xp:8,  g:5,  hue:"#8a7a52"},
  sli: {n:"Green Slime",  hp:16, atk:5,  def:3, spd:3, xp:10, g:7,  hue:"#7fae6a"},
  gob: {n:"Goblin",       hp:18, atk:8,  def:2, spd:6, xp:14, g:12, hue:"#a3913c"},
  ske: {n:"Skeleton",     hp:24, atk:9,  def:3, spd:5, xp:20, g:14, hue:"#b8b0a0", undead:true},
  orc: {n:"Orc Raider",   hp:36, atk:13, def:4, spd:6, xp:36, g:26, hue:"#a86a3c"},
  wra: {n:"Cave Wraith",  hp:30, atk:11, def:2, spd:8, xp:42, g:20, hue:"#7fa8bd", undead:true, pierce:true},
  cul: {n:"Ember Cultist",hp:32, atk:9,  def:3, spd:6, xp:45, g:30, hue:"#c8502f", caster:true},
  gol: {n:"Stone Golem",  hp:55, atk:14, def:8, spd:2, xp:60, g:40, hue:"#8a8a8a"},
  boss:{n:"Pyrelord Vhal",hp:240,atk:17, def:6, spd:7, xp:600,g:500,hue:"#e09a3c", boss:true},
};

export const GROUPS: Record<number, string[][]> = {
  1:[["rat","rat"],["rat","rat","rat"],["sli","sli"],["gob"],["gob","rat"],["gob","gob"],["ske"],["ske","rat","rat"],["sli","gob"]],
  2:[["orc"],["orc","gob","gob"],["wra"],["cul","ske"],["orc","orc"],["gol"],["cul","wra"],["ske","ske","ske"],["gol","cul"]],
};

export const MAPS: Record<number, string[]> = {
  1:["###############",
     "#E....#...#..C#",
     "#.###.#.#.#.#.#",
     "#.#...#.#...#.#",
     "#.#.###.#####.#",
     "#.#..F..#...#.#",
     "#.#####.#.#.#.#",
     "#...#...#.#...#",
     "###.#.###.###.#",
     "#C..#.....#..S#",
     "###############"],
  2:["###############",
     "#U..#.....#..C#",
     "#.#.#.###.#.#.#",
     "#.#.#.#.#.#.#.#",
     "#.#...#.#...#.#",
     "#.###.#.#####.#",
     "#.#C#.#.....#.#",
     "#.#.#.#####.#.#",
     "#.#.#..F..#.#.#",
     "#.#.#####.#.#.#",
     "#.#.....#.#.#.#",
     "#.#####.#.#.#.#",
     "#...C#....#.B.#",
     "###############"],
};

export const LEVEL_NAMES: Record<number, string> = {1:"The Ember Caves · Depth I", 2:"The Ember Deep · Depth II"};

export const CHESTS: Record<string, ChestLoot> = {
  "1:13,1":{gold:60, potions:1, note:"a smuggler's cache"},
  "1:1,9": {gold:45, potions:1, note:"a rotted strongbox"},
  "2:13,1":{gold:150,potions:2, note:"a cultist's tithe chest"},
  "2:3,6": {gold:40, charm:true, note:"a warded reliquary"},
  "2:4,12":{gold:120,potions:1, note:"an orcish war-chest"},
};

export const WBONUS=[0,3,7,13], WCOST=[60,160,380], WNAME=["Worn steel","Forged steel","Runed steel","Emberforged"];
export const ABONUS=[0,2,5,9],  ACOST=[50,140,320], ANAME=["Padded cloth","Chainmail","Half-plate","Warded plate"];
export const ENC_RATE: Record<number, number> = {1:.13, 2:.15};
export const ENC_GRACE = 3;
export const SAVE_KEY = "ember-isle-save-v1";
export const DIRV: ReadonlyArray<readonly [number, number]> = [[0,-1],[1,0],[0,1],[-1,0]];
export const DIRN = ["North","East","South","West"];
