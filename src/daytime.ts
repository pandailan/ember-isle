/* The world clock: minutes into the day, advanced by walking and fighting.
   Both the HUD and the 3D sky read from it; co-op guests inherit it in sync. */

import type { Weather } from "./types";

export const hourOf = (clock: number): number => ((clock % 1440) + 1440) % 1440 / 60;

export function phaseName(clock: number): string {
  const h = hourOf(clock);
  if (h < 5) return "Dead of Night";
  if (h < 7) return "First Light";
  if (h < 11) return "Morning";
  if (h < 15) return "High Sun";
  if (h < 18) return "Golden Hour";
  if (h < 20) return "Dusk";
  return "Night";
}

export const WEATHER_NAMES: Record<Weather, string> = {
  clear: "", mist: "Sea Mist", rain: "Rain", storm: "Storm",
};

export const WEATHER_MSGS: Record<Weather, string> = {
  clear: "The clouds part; the sky opens wide over the isle.",
  mist: "A sea mist rolls in off the water, soft and blind.",
  rain: "Rain begins — cold, thin, patient on the stones.",
  storm: "Thunder mutters out at sea. A storm breaks over the isle.",
};

export const PHASE_MSGS: Record<string, string> = {
  "First Light": "First light silvers the rooftops in the east.",
  "Morning": "Morning comes, and gulls with it.",
  "Golden Hour": "The light goes long and golden.",
  "Dusk": "Dusk settles over the isle.",
  "Night": "Night falls. Lamps gutter alight.",
};
