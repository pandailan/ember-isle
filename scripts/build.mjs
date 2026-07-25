import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const result = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  charset: "utf8",
});

// Escape any sequence that would terminate the inline script tag early.
const js = result.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");

// replacer function: a literal replacement string would mangle `$`-sequences in the JS
const html = readFileSync("src/page.html", "utf8").replace(
  "<!--BUNDLE-->",
  () => `<script>\n${js}</script>`,
);
if (html.includes("<!--BUNDLE-->")) throw new Error("bundle placeholder not replaced");

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(1)} KiB)`);
