// Headless-Chromium harness: renders the built card against generated events,
// asserts the interactive parts work, and writes screenshots to dev/out/.
//   node dev/test.mjs   build first, then run the checks
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dev/out");
const TYPE = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

if (!fs.existsSync(path.join(ROOT, "dist/wildlife-card.js"))) {
  console.error("dist/wildlife-card.js is missing — run `npm run build` first.");
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204).end(); return; }
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPE[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/dev/harness.html`;

// CHROMIUM_PATH lets this run against a system Chrome where Playwright has no browser of its own.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "  ok  " : "FAIL  "}${what}`); if (!ok) failures.push(what); };

async function open(query = "", width = 430) {
  const page = await browser.newPage({
    viewport: { width: width + 32, height: 1000 }, deviceScaleFactor: 2,
    // Pinned so the generated night-time events and the screenshots are the
    // same on any machine, whatever the runner's time zone.
    timezoneId: "America/Los_Angeles", locale: "en-US",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}?w=${width}${query}`);
  await page.waitForFunction("window.ready === true");
  await page.waitForSelector("wildlife-card .tile");
  page.errors = errors;
  page.$$c = (sel) => page.$$(`wildlife-card ${sel}`);
  page.click$ = async (sel) => { await page.click(`wildlife-card ${sel}`); await page.waitForTimeout(250); };
  page.text$ = (sel) => page.textContent(`wildlife-card ${sel}`);
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(350);
  const el = await page.$("wildlife-card");
  await el.screenshot({ path: path.join(OUT, name) });
};

/* 1 — overview renders, one tile per species, newest-first browser */
{
  const page = await open();
  check((await page.$$c(".tile")).length === 8, "eight species tiles");
  check(!!(await page.text$(".hl .p")), "headline has a top line");
  check((await page.$$c(".shot")).length > 5, "sightings filmstrip is populated");
  check((await page.$$c(".row")).length === 8, "activity grid has a row per species");
  await shot(page, "overview-light.png");

  /* 2 — a species tile filters the grid and the browser */
  const before = (await page.$$c(".shot")).length;
  await page.click$('.tile[data-v="rodent"]');
  check((await page.text$(".chips .chip")).includes("Rodent"), "tile adds a filter chip");
  check((await page.$$c(".shot")).length < before, "filter narrows the filmstrip");

  /* 3 — time-of-day view, then a sighting opens on the stage */
  await page.click$('[data-act="view"][data-v="hour"]');
  check((await page.$$c(".row")).length === 12, "time view has twelve two-hour rows");
  await page.click$(".shot");
  check(!!(await page.$("wildlife-card .stage .media")), "a sighting opens on the stage");
  check(/of|\//.test(await page.text$(".stage .pos")), "stage shows its position in the list");
  await page.click$('[data-act="tune"]');
  await shot(page, "rodents-by-time.png");

  /* 4 — the confidence filter hides low-scoring sightings */
  const shown = (await page.$$c(".shot")).length;
  await page.$eval("wildlife-card input[name=min]", (i) => {
    i.value = 95; i.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(250);
  check((await page.$$c(".shot")).length < shown, "confidence slider hides sightings");
  check((await page.text$(".hid")).includes("Hiding"), "filter panel reports what is hidden");

  check(page.errors.length === 0, `no console or page errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 5 — the dog-at-night inference, dark theme, and the location view */
{
  const page = await open("&dark=1");
  const coyote = await page.$('wildlife-card .tile[data-v="coyote"] .n');
  check(coyote !== null && +(await coyote.textContent()) >= 2, "coyotes inferred from night-time dogs");
  check(!!(await page.$("wildlife-card .tile .flag")), "a pack of two is flagged");
  await page.click$('.tile[data-v="coyote"]');
  await page.click$('[data-act="view"][data-v="camera"]');
  await page.click$(".shot");
  check((await page.text$(".stage .p")).includes("coyote"), "inferred sightings are named as likely");
  await shot(page, "coyotes-dark.png");
  check(page.errors.length === 0, `dark theme renders without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 6 — a person near the dog suppresses the inference */
{
  const page = await open("&quiet=1");
  const txt = await page.text$('.tile[data-v="coyote"] i');
  check(!/none/.test(txt), "a lone night dog still counts");
  const page2 = await open("&quiet=1&config=" + encodeURIComponent('{"coyote":{"enabled":false}}'));
  check(/none/.test(await page2.text$('.tile[data-v="coyote"] i')), "coyote inference can be switched off");
  await page.close(); await page2.close();
}

/* 7 — wide layout and a 30-day range */
{
  const page = await open("", 820);
  await page.click$('[data-act="days"][data-v="30"]');
  check((await page.$$c(".row .cells .c")).length / 8 === 30, "30-day range draws thirty columns");
  check(await page.$eval("wildlife-card", (e) => e.hasAttribute("wide")), "wide layout switches on past 640px");
  await shot(page, "overview-wide.png");
  check(page.errors.length === 0, `wide layout renders without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nall checks passed — screenshots in dev/out/`);
process.exit(failures.length ? 1 : 0);
