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

async function open(query = "", width = 430, userAgent) {
  const page = await browser.newPage({
    ...(userAgent ? { userAgent } : {}),
    viewport: { width: width + 32, height: 1000 }, deviceScaleFactor: 2,
    // Pinned so the generated night-time events and the screenshots are the
    // same on any machine, whatever the runner's time zone.
    timezoneId: "America/Los_Angeles", locale: "en-US",
  });
  const errors = [];
  // Some checks load something on purpose that cannot play; page.ignore() keeps
  // that one message out of the error check without blinding it to the rest.
  const ignore = [];
  const keep = (t) => !ignore.some((re) => re.test(t));
  page.on("pageerror", (e) => { if (keep(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && keep(m.text())) errors.push(m.text()); });
  await page.goto(`${base}?w=${width}${query}`);
  await page.waitForFunction("window.ready === true");
  await page.waitForSelector("wildlife-card .tile");
  page.errors = errors;
  page.$$c = (sel) => page.$$(`wildlife-card ${sel}`);
  page.click$ = async (sel) => { await page.click(`wildlife-card ${sel}`); await page.waitForTimeout(250); };
  page.text$ = (sel) => page.textContent(`wildlife-card ${sel}`);
  page.ignore = (re) => ignore.push(re);
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
  /* 3b — hls.js is tried first, and a clip nothing can play says so.
     The harness points clips at about:blank, which no player will accept. */
  page.ignore(/ERR_UNKNOWN_URL_SCHEME|about:blank|Failed to load/);
  await page.click$('[data-act="clip"]');
  await page.waitForSelector("wildlife-card .fail", { timeout: 15000 }).catch(() => {});
  check(await page.$eval("wildlife-card", (c) => !!c._hlsMod), "hls.js is loaded to play the clip");
  check(!!(await page.$("wildlife-card .fail a")), "a clip no player accepts explains itself and offers the file");
  await page.click$('[data-act="still"]');

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

/* 4b — with native HLS claimed as well, every step of the chain is walked:
   hls.js, then the browser's own HLS, then the file, then the notice. */
{
  const page = await open("&hls=1");
  page.ignore(/ERR_UNKNOWN_URL_SCHEME|about:blank|Failed to load/);
  await page.click$(".shot");
  await page.click$('[data-act="clip"]');
  await page.waitForSelector("wildlife-card .fail", { timeout: 15000 }).catch(() => {});
  const tried = await page.$eval("wildlife-card", (c) => {
    const v = c.shadowRoot.querySelector("video");
    return v ? { lib: v.dataset.noLib, native: v.dataset.noNative, mp4: v.dataset.mp4 } : "gone";
  }).catch(() => "gone");
  check(tried === "gone", `every source is tried before giving up (${JSON.stringify(tried)})`);
  check(!!(await page.$("wildlife-card .fail")), "the notice is the last resort, not the first");
  await page.close();
}

/* 4c — day/night shading: present, lighter by day, and dated per column */
{
  const page = await open("", 820);
  await page.click$('[data-act="days"][data-v="30"]');
  await page.click$('[data-act="view"][data-v="hour"]');
  check(!!(await page.$("wildlife-card .grid.sky")), "the time rows carry day/night shading");
  const lum = (rgb) => rgb.split(",").reduce((a, b) => a + +b, 0) / 3;
  const rowSky = (i) => page.$eval(`wildlife-card .rows .row:nth-child(${i + 1})`,
    (r) => r.style.getPropertyValue("--sky"));
  const [midnight, midday] = [await rowSky(0), await rowSky(6)];
  check(lum(midday) > lum(midnight), `midday is lighter than midnight (${midday} vs ${midnight})`);
  // 4pm-6pm in Seattle crosses sunset somewhere inside a 30-day window.
  const drift = await page.$$eval("wildlife-card .rows .row:nth-child(9) .c",
    (cs) => [cs[0].style.getPropertyValue("--sky"), cs[cs.length - 1].style.getPropertyValue("--sky")]);
  check(drift[0] !== drift[1], `each column uses its own date (${drift[0]} → ${drift[1]})`);
  check(/^\d+a? ?.{0,3} ?\d/.test((await page.text$(".rows .lab")).trim()), "time labels keep their from-to shape");
  await page.close();
}

/* 4d — without a latitude there is nothing to compute, and it simply goes away */
{
  const page = await open("&nosun=1");
  await page.click$('[data-act="view"][data-v="hour"]');
  check(!(await page.$("wildlife-card .grid.sky")), "shading is skipped when the location is unknown");
  check((await page.$$c(".row")).length === 12, "the time rows still render without it");
  await page.close();
}

/* 4e — the visual editor: defaults shown, camera names found, and every key
   the form does not manage carried through a change untouched */
{
  const page = await open();
  const r = await page.evaluate(async () => {
    const editor = customElements.get("wildlife-card").getConfigElement();
    document.body.appendChild(editor);
    editor.setConfig({
      type: "custom:wildlife-card", card_reference_id: "wildlife", days: 30,
      species: [{ id: "rodent", name: "Rodents", labels: ["rodent"], glyph: "R" }],
    });
    editor.hass = window.hass;
    await new Promise((done) => setTimeout(done, 400));
    const form = editor.querySelector("ha-form");
    const cams = form.schema.find((f) => f.name === "indoor_cameras").selector.select.options;
    let changed = null;
    editor.addEventListener("config-changed", (ev) => { changed = ev.detail.config; });
    form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: {
      ...form.data, title: "Critters", days: "7",
      coyote: { ...form.data.coyote, start: "22:30:00" },
    } } }));
    return { shown: form.data, cams: cams.map((c) => c.value), changed };
  });
  check(r.shown.title === "Wildlife" && r.shown.days === "30",
    `the form opens on the real settings (${r.shown.title}, ${r.shown.days}d)`);
  check(r.cams.includes("Driveway"), `camera names come from Frigate (${r.cams.slice(0, 3).join(", ")}…)`);
  check(r.changed.species?.length === 1 && r.changed.card_reference_id === "wildlife"
    && r.changed.type === "custom:wildlife-card"
    && !("clip_lead_in" in r.changed) && !("clip_lead_out" in r.changed), "species and other keys survive an edit");
  check(r.changed.days === 7 && r.changed.title === "Critters", "edits are written back in the card's own types");
  check(r.changed.coyote.start === "22:30", `times are trimmed to hours and minutes (${r.changed.coyote.start})`);
  check(page.errors.length === 0, `the editor runs without errors (${page.errors.slice(0, 2).join("; ")})`);
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
  const widths = await page.$$eval("wildlife-card .rows .row:first-child .c",
    (cs) => [...new Set(cs.map((c) => Math.round(c.getBoundingClientRect().width * 10)))]);
  check(widths.length === 1, `every column is the same width (${widths.map((w) => w / 10).join(", ")}px)`);
  check(await page.$eval("wildlife-card", (e) => e.hasAttribute("wide")), "wide layout switches on past 640px");
  await shot(page, "overview-wide.png");
  check(page.errors.length === 0, `wide layout renders without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 8 — where the two links outside the card go */
{
  // Apple's player refuses Frigate's range-less MP4, so the open button hands
  // the browser a picture, which every browser can show, on every platform.
  const page = await open();
  await page.click$(".shot");
  await page.waitForSelector('wildlife-card .cap a[aria-label="Open the picture in a new tab"]');
  const href = await page.$eval('wildlife-card .cap a[aria-label="Open the picture in a new tab"]', (a) => a.getAttribute("href"));
  check(/snapshot\.jpg|thumbnail\.jpg/.test(href), `the open button offers the picture, not the clip (${href.slice(0, 48)}…)`);
  check(!/\.mp4|m3u8/.test(href), "the open button never hands out a clip");
  // Nothing of the frontend's own credentials travels to a new tab.
  check(/authSig=/.test(href), "and it is signed, so it survives leaving the frontend");
  check(!(await page.$('wildlife-card [data-act="frigate"]')), "no Frigate button until one is configured");
  await page.close();
}

/* 9 — the Frigate link, through ingress and through a plain address.
   It has to be a real anchor with its address already in place: the iOS
   Companion app never arrives at a tab that script opened and then navigated
   after an await, which is how the first version of this lost the sighting. */
{
  const SEL = 'a[aria-label="Open this sighting in Frigate"]';
  const href = async (query) => {
    const page = await open(query);
    await page.click$(".shot");
    await page.waitForSelector(`wildlife-card ${SEL}`);
    const out = await page.evaluate((s) => [
      window.card.shadowRoot.querySelector(s).getAttribute("href"),
      window.card.shadowRoot.querySelector(s).getAttribute("target"),
      window.card._ui.cur,
    ], SEL);
    await page.close();
    return out;
  };

  const [ingress, target, id] = await href("&config=" + encodeURIComponent('{"frigate_addon":"ccab4aaf_frigate-fa"}'));
  check(ingress === `/api/hassio_ingress/TOKEN-OF-THE-MOMENT/explore?event_id=${id}`,
    `an add-on resolves its ingress address before the tap (${ingress})`);
  check(target === "_blank", "and it is an ordinary link the app can open");

  const [direct, , id2] = await href("&config=" + encodeURIComponent('{"frigate_url":"http://192.168.1.10:5000/"}'));
  check(direct === `http://192.168.1.10:5000/explore?event_id=${id2}`,
    `a plain address loses its trailing slash rather than doubling it (${direct})`);

  // Inside the Companion app neither a new tab nor the same view reaches
  // ingress, so an add-on's button goes to Home Assistant's own panel for it.
  {
    const APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Home Assistant/2026.10 (io.robbie.HomeAssistant; build:2026.1; iOS 18.0)";
    let page = await open("&config=" + encodeURIComponent('{"frigate_addon":"ccab4aaf_frigate-fa"}'), 430, APP);
    await page.click$(".shot");
    await page.waitForSelector('wildlife-card [data-act="frigate"]');
    check(!(await page.$(`wildlife-card ${SEL}`)), "in the Companion app an add-on gets no ingress link");
    await page.evaluate(() => { window.moved = 0; window.addEventListener("location-changed", () => window.moved++); });
    await page.click$('[data-act="frigate"]');
    const [path, moved] = await page.evaluate(() => [location.pathname, window.moved]);
    check(path === "/hassio/ingress/ccab4aaf_frigate-fa" && moved === 1, `its button navigates Home Assistant to the add-on's panel (${path})`);
    await page.close();
    page = await open("&config=" + encodeURIComponent('{"frigate_url":"http://192.168.1.10:5000"}'), 430, APP);
    await page.click$(".shot");
    await page.waitForSelector(`wildlife-card ${SEL}`);
    check(true, "while a plain address still gets its link there");
    await page.close();
  }

  // An add-on that is not there should say so rather than offer a dead link.
  const page = await open("&config=" + encodeURIComponent('{"frigate_addon":"not_installed"}'));
  await page.click$(".shot");
  await page.waitForSelector("wildlife-card .stage .err");
  check((await page.text$(".stage .err")).includes("could not be reached"), "a Frigate that cannot be reached explains itself");
  check(!(await page.$(`wildlife-card ${SEL}`)), "and offers no link at all rather than a broken one");
  await page.close();

  // Ingress is for administrators. Another user, or a visitor to a read-only
  // public view, gets no button and no complaint under every sighting.
  {
    const page = await open("&guest&config=" + encodeURIComponent('{"frigate_addon":"ccab4aaf_frigate-fa"}'));
    await page.click$(".shot");
    await page.waitForSelector('wildlife-card a[aria-label="Open the picture in a new tab"]');
    check(!(await page.$("wildlife-card .stage .err")), "a viewer who may not open Frigate is told nothing about it");
    check(!(await page.$(`wildlife-card ${SEL}`)), "and gets no Frigate button");
    await page.close();
  }
}

/* 10 — explicit species matches sub_label (including DEFAULT_SPECIES & custom sub-label lists) */
{
  const cfg = encodeURIComponent(JSON.stringify({
    species: [
      { id: "squirrel", name: "Squirrels", one: "Squirrel", labels: ["eastern fox squirrel", "squirrel"], glyph: "🐿️" },
      { id: "coyote", name: "Coyotes", one: "Coyote", labels: ["coyote"], glyph: "🐺" },
    ],
  }));
  const page = await open(`&mode=speciesnet&config=${cfg}`);
  const sq = await page.$('wildlife-card .tile[data-v="squirrel"] .n');
  const coy = await page.$('wildlife-card .tile[data-v="coyote"] .n');
  check(sq && +(await sq.textContent()) > 0, "explicit species list matches events by sub_label via summary preflight");
  check(coy && +(await coy.textContent()) === 2, "explicit mode infers coyotes from SpeciesNet domestic dog sub_label");
  await page.close();
}

/* 11 — species: auto discovers labels/sub_labels, strips taxonomy, applies aliases & glyphs */
{
  const cfg = encodeURIComponent(JSON.stringify({
    species: "auto",
    aliases: {
      "sciuridae family": "Squirrel Family",
      "dasypus species": "Armadillo",
      "urocyon cinereoargenteus": "Gray Fox",
    },
    glyphs: { armadillo: "🛡️" },
    ignore_labels: ["striped skunk"],
  }));
  const page = await open(`&mode=speciesnet&config=${cfg}`);
  const names = await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim()));
  check(!names.includes("Person") && !names.includes("Car"), "person and car detector classes are excluded");
  check(!names.includes("Striped Skunk"), "ignore_labels excludes specified sub_labels");
  check(names.filter((n) => n === "Eastern Fox Squirrel").length === 1,
    `case variants merge into pretty label (${names.join(", ")})`);
  const sqGlyph = await page.textContent('wildlife-card .tile[data-v="eastern_fox_squirrel"] .pic span');
  const foxGlyph = await page.textContent('wildlife-card .tile[data-v="gray_fox"] .pic span');
  const armGlyph = await page.textContent('wildlife-card .tile[data-v="armadillo"] .pic span');
  check(sqGlyph === "🐿️" && foxGlyph === "🦊", `Eastern Fox Squirrel gets squirrel glyph (${sqGlyph}) while Gray Fox gets fox (${foxGlyph})`);
  check(armGlyph === "🛡️", `custom YAML glyph override applied (${armGlyph})`);
  check(names.filter((n) => n === "Gray Fox").length === 1, "grey/gray fox variants & alias merge into Gray Fox");
  check(names.includes("Squirrel Family"), "YAML alias maps taxonomic family rollup (Squirrel Family)");
  check(names.includes("Armadillo"), "YAML alias maps taxonomic genus rollup (Armadillo)");
  check(names.includes("Eastern Gray Squirrel"), "semicolon-delimited taxonomy string extracts common name");
  check(names.includes("Nine-Banded Armadillo"), "trailing Latin parenthetical is stripped cleanly");
  check(names.includes("Coyote"), "Coyote inferred from SpeciesNet domestic dog at night");
  check(names[names.length - 1] === "Animal", "generic Animal bucket sorts to the end");
  const coy = await page.$('wildlife-card .tile[data-v="coyote"] .n');
  check(coy && +(await coy.textContent()) === 2, "person-adjacent night dog does not count as coyote");
  await page.click$('.tile[data-v="gray_fox"]');
  await page.click$(".shot");
  const cap = await page.text$(".stage .p");
  check(!/Gray Fox\s*·\s*Gray Fox/i.test(cap), `stage caption does not duplicate species name (${cap})`);
  await shot(page, "speciesnet-auto.png");
  check(page.errors.length === 0, `species: auto renders without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 12 — summary RPC failure falls back gracefully to unfiltered events */
{
  const cfg = encodeURIComponent(JSON.stringify({ species: "auto" }));
  const page = await open(`&mode=speciesnet&nosummary=1&config=${cfg}`);
  const names = await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim()));
  check(names.includes("Eastern Fox Squirrel") && names.includes("Gray Fox"),
    `fallback without summary discovers SpeciesNet sublabels (${names.slice(0, 4).join(", ")})`);
  check(page.errors.length === 0, `summary fallback runs without console errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 10 — clip lead-in and lead-out VOD/recording paths and default off */
{
  const defPage = await open();
  await defPage.click$(".shot");
  const defOut = await defPage.evaluate(() => {
    const e = window.card._list.find((x) => x.id === window.card._ui.cur);
    return window.card._clipPaths(e);
  });
  check(defOut === null, "default 0s lead-in and lead-out preserve unpadded event clips");
  await defPage.close();

  const customCfg = encodeURIComponent(JSON.stringify({ clip_lead_in: 8, clip_lead_out: 3 }));
  const page = await open(`&config=${customCfg}`);
  page.ignore(/ERR_UNKNOWN_URL_SCHEME|about:blank|Failed to load/);
  await page.evaluate(() => {
    window._signedPaths = [];
    const orig = window.hass.callWS.bind(window.hass);
    window.hass.callWS = async (msg) => {
      if (msg.type === "auth/sign_path") window._signedPaths.push(msg.path);
      return orig(msg);
    };
  });
  await page.click$(".shot");
  await page.click$('[data-act="clip"]');
  await page.waitForSelector("wildlife-card .fail", { timeout: 15000 }).catch(() => {});
  const out = await page.evaluate(() => {
    const e = window.card._list.find((x) => x.id === window.card._ui.cur);
    return {
      e: { cam: e.cam, start: e.start, end: e.end },
      paths: window.card._clipPaths(e),
      signed: window._signedPaths,
    };
  });
  const expStart = Math.floor(out.e.start - 8);
  const expEnd = Math.ceil(out.e.end + 3);
  check(out.paths?.hls === `/api/frigate/frigate/vod/${encodeURIComponent(out.e.cam)}/start/${expStart}/end/${expEnd}/index.m3u8`,
    `custom lead-in/out builds padded VOD playlist (${out.paths?.hls})`);
  check(out.paths?.mp4 === `/api/frigate/frigate/recording/${encodeURIComponent(out.e.cam)}/start/${expStart}/end/${expEnd}`,
    `custom lead-in/out builds padded recording MP4 (${out.paths?.mp4})`);
  check(out.signed.includes(out.paths.hls) && out.signed.includes(out.paths.mp4),
    "both padded VOD playlist and recording MP4 are signed via auth/sign_path");
  await page.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nall checks passed — screenshots in dev/out/`);
process.exit(failures.length ? 1 : 0);
