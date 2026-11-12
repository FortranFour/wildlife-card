// Build: one self-contained card module. No chunks — HACS serves a single file.
import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
fs.rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/wildlife-card.js"],
  outfile: "dist/wildlife-card.js",
  bundle: true, format: "esm", minify: true, target: "es2020",
  legalComments: "eof",
  banner: { js: `/*! wildlife-card v${pkg.version} | MIT | https://github.com/FortranFour/wildlife-card */` },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
});
const s = fs.statSync("dist/wildlife-card.js");
console.log(`wildlife-card.js${" ".padEnd(38)}${(s.size / 1024).toFixed(1)} KB`);
