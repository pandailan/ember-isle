import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";

const page = readFileSync("src/page.html", "utf8");
rmSync("dist", {recursive: true, force: true});
mkdirSync("dist/chunks", {recursive: true});

/* 1) The streaming build (GitHub Pages): ESM chunks loaded on demand.
      The core app paints immediately; the three.js world chunk streams in
      behind the title screen; PeerJS only travels when co-op is touched. */
const split = await esbuild.build({
  entryPoints: {main: "src/main.ts"},
  bundle: true,
  minify: true,
  format: "esm",
  splitting: true,
  target: "es2020",
  outdir: "dist/chunks",
  chunkNames: "[name]-[hash]",
  metafile: true,
  charset: "utf8",
});

/* Preload the world chunk (needed within seconds) but NOT the peerjs chunk
   (may never be needed). */
const outputs = Object.entries(split.metafile.outputs);
const preloads = outputs
  .filter(([path, meta]) =>
    path.endsWith(".js") &&
    (path.endsWith("/main.js") ||
      Object.keys(meta.inputs).some(i => i.includes("node_modules/three/"))))
  .map(([path]) => `<link rel="modulepreload" href="./${path.replace(/^dist\//, "")}">`)
  .join("\n");

const webHtml = page.replace(
  "<!--BUNDLE-->",
  () => `${preloads}\n<script type="module" src="./chunks/main.js"></script>`,
);
writeFileSync("dist/index.html", webHtml);

/* 2) The classic single self-contained file — offline copies & the artifact.
      Dynamic imports are inlined here, so it stays one file. */
const single = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  charset: "utf8",
});
// replacer function: a literal replacement string would mangle `$`-sequences in the JS
const js = single.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");
writeFileSync("dist/single.html", page.replace("<!--BUNDLE-->", () => `<script>\n${js}</script>`));

/* 3) Service worker: network-first for the shell, cache-first for hashed
      chunks — repeat visits are instant and the game runs offline. */
writeFileSync("dist/sw.js", `const CACHE = "ember-isle-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  const isShell = e.request.mode === "navigate" || url.pathname.endsWith(".html");
  if (isShell) {
    e.respondWith(fetch(e.request).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r;
    }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r;
    })));
  }
});
`);

const kb = p => (statSync(p).size / 1024).toFixed(1) + " KiB";
console.log("dist/index.html (streaming shell):", kb("dist/index.html"));
for (const [path] of outputs.filter(([p]) => p.endsWith(".js"))) {
  console.log(" ", path.replace(/^dist\//, ""), kb(path));
}
console.log("dist/single.html (self-contained):", kb("dist/single.html"));
