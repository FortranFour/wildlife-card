// Build: one self-contained card module. No chunks — HACS serves a single file.
import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
fs.rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/wildlife-card.js"],
  outdir: "dist", splitting: true,
  bundle: true, format: "esm", minify: true, target: "es2020",
  entryNames: "[name]", chunkNames: "wildlife-[name]-[hash]",
  legalComments: "eof",
  banner: { js: `/*! wildlife-card v${pkg.version} | MIT | https://github.com/FortranFour/wildlife-card */` },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
});
for (const f of fs.readdirSync("dist")) {
  console.log(`${f.padEnd(44)}${(fs.statSync(`dist/${f}`).size / 1024).toFixed(1)} KB`);
}
