export const $ = (id: string): HTMLElement => document.getElementById(id)!;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const rnd = Math.random;
export const ri = (n: number) => Math.floor(rnd() * n);
export const reduceMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
