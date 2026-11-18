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
  check(!(await page.$('wildlife-card [data-act="src"]')), "no Seen / Heard switch until a BirdNET-Go is configured");
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

/* 13 — discovery goes by what Frigate saw, not what it heard */
{
  const tiles = async (cfg) => {
    const page = await open("&audio=1&config=" + encodeURIComponent(JSON.stringify(cfg)));
    await page.waitForSelector("wildlife-card .tile");
    const names = await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim().toLowerCase()));
    await page.close();
    return names;
  };
  const auto = await tiles({ species: "auto" });
  check(auto.length > 2 && !auto.some((n) => /speech|fire alarm/.test(n)), `sounds are left out of automatic discovery (${auto.slice(0, 5).join(", ")}…)`);
  const dropped = await tiles({ species: "auto", ignore_labels: ["bird"] });
  check(!dropped.includes("bird") && auto.includes("bird"), "and ignore_labels removes one that was there");
  const asked = await tiles({ species: [{ id: "voices", name: "Voices", labels: ["speech"] }] });
  check(asked.join() === "voices", "while a label written into a species list is taken at its word");
}

/* 14 — the editor's switch for discovery */
{
  const page = await open("&audio=1");
  const out = await page.evaluate(async () => {
    const make = async (config) => {
      const ed = customElements.get("wildlife-card").getConfigElement();
      document.body.appendChild(ed);
      ed.setConfig(config); ed.hass = window.hass;
      await new Promise((r) => setTimeout(r, 300));
      return ed;
    };
    const names = (ed) => JSON.stringify(ed.querySelector("ha-form").schema).match(/"name":"(auto|auto_over|ignore_labels)"/g) || [];
    const fire = (ed, value) => new Promise((res) => {
      ed.addEventListener("config-changed", (ev) => res(ev.detail.config), { once: true });
      ed.querySelector("ha-form").dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    });
    const plain = await make({ type: "custom:wildlife-card", title: "Yard" });
    const base = plain.querySelector("ha-form").data;
    const on = await fire(plain, { ...base, auto: true });
    const autoEd = await make({ type: "custom:wildlife-card", species: "auto", ignore_labels: ["dog"], aliases: { a: "B" } });
    const autoData = autoEd.querySelector("ha-form").data;
    const off = await fire(autoEd, { ...autoData, auto: false, ignore_labels: [] });
    const opts = JSON.stringify(autoEd.querySelector("ha-form").schema);
    const custom = await make({ type: "custom:wildlife-card", species: [{ id: "x", name: "X", labels: ["bird"] }] });
    const kept = await fire(custom, { ...custom.querySelector("ha-form").data, title: "New" });
    const over = await fire(custom, { ...custom.querySelector("ha-form").data, auto_over: true });
    const overEd = await make(over);
    const back = await fire(overEd, { ...overEd.querySelector("ha-form").data, auto_over: false, ignore_labels: [] });
    return { plain: names(plain), on, autoNames: names(autoEd), off, hasSpeech: /speech/i.test(opts), hasBird: /"bird"/.test(opts), customNames: names(custom), kept,
      over, overNames: names(overEd), overOn: overEd.querySelector("ha-form").data.auto_over, back };
  });
  check(out.plain.length === 1, "the editor offers the discovery switch on an ordinary card");
  check(out.on.species === "auto" && !("auto" in out.on), "turning it on writes species: auto and nothing else");
  check(out.autoNames.length === 2 && out.hasBird && !out.hasSpeech, "with it on, labels to leave out are offered from what Frigate saw, sounds excluded");
  check(!("species" in out.off) && !("ignore_labels" in out.off) && out.off.aliases?.a === "B", "turning it off removes the key and leaves the YAML-only options alone");
  check(out.customNames.join() === '"name":"auto_over"' && Array.isArray(out.kept.species) && out.kept.title === "New" && !("discover" in out.kept) && !("auto_over" in out.kept),
    "a species list written in YAML is offered the switch too, and an unrelated edit leaves it alone");
  check(out.over.discover === true && out.over.species?.[0]?.id === "x" && !("auto_over" in out.over), "turning it on over a list sets discover and keeps the list");
  check(out.overOn === true && out.overNames.length === 2, "the switch then shows on, with the labels to leave out");
  check(!("discover" in out.back) && out.back.species?.[0]?.id === "x", "and turning it off puts the list back in force, untouched");
  const tiles = async (cfg) => {
    const p = await open("&config=" + encodeURIComponent(JSON.stringify(cfg)));
    await p.waitForSelector("wildlife-card .tile");
    const names = await p.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim().toLowerCase()));
    await p.close();
    return names;
  };
  const withDogs = await tiles({ species: "auto" });
  const noDogs = await tiles({ species: "auto", ignore_labels: ["dog"] });
  check(withDogs.includes("coyote") && withDogs.includes("dog"), `under discovery a lone night-time dog becomes a coyote and the rest stay dogs (${withDogs.join(", ")})`);
  check(noDogs.includes("coyote") && !noDogs.includes("dog"), `leaving dogs out does not switch the coyote inference off (${noDogs.join(", ")})`);
  const listed = [{ id: "bird", name: "Feathered", labels: ["bird"] }];
  const under = await tiles({ species: listed });
  const overTiles = await tiles({ species: listed, discover: true });
  check(under.join() === "feathered" && overTiles.length > 2 && !overTiles.includes("feathered") && overTiles.includes("rabbit"),
    `discover overrides a written list on the card itself (${overTiles.slice(0, 4).join(", ")}…)`);
  await page.close();
}

/* 15 — what is heard: BirdNET-Go's detections behind a Seen / Heard switch */
{
  const BN = encodeURIComponent(JSON.stringify({ birdnet_url: "http://birdnet.local:8080/" }));
  const page = await open(`&heard=1&config=${BN}`);
  await page.waitForFunction("window.card._hLoaded === true");
  check((await page.$$c('[data-act="src"]')).length === 2, "a configured BirdNET-Go adds the Seen / Heard switch");
  check(!(await page.$("wildlife-card .shot .hd")), "and pairs nothing until asked to");
  check((await page.$$c(".tile")).length === 8 && (await page.$$c(".row")).length === 8, "and the card still opens on what was seen");
  check((await page.text$(".hl .s")).includes("Coyote heard"), `a coyote that was heard reaches the seen headline (${(await page.text$(".hl .s")).slice(0, 60)}…)`);

  await page.click$('[data-act="src"][data-v="heard"]');
  const calls = await page.evaluate(() => window.bnCalls);
  const expected = await page.evaluate(() => {
    const first = window.card._days()[0].key;
    return window.heardRows.filter((r) => r.date >= first && !/^(Engine|Human vocal|Dog)$/.test(r.commonName) && r.verified !== "false_positive").length;
  });
  const got = await page.evaluate(() => window.card._heard.size);
  check(calls.length >= 2 && /offset=1000/.test(calls[1].url), `a busy fortnight is read a page at a time (${calls.length} requests)`);
  check(calls[0].url.startsWith("http://birdnet.local:8080/api/v2/detections?start_date="), `from the address given, without its trailing slash (${calls[0].url.slice(0, 60)}…)`);
  check(calls[0].credentials === "", "a plain address is sent no cookies");
  check(got === expected && got > 1000, `every detection in range is kept, bar the ignored and the rejected (${got} of ${expected})`);

  const names = await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim()));
  check(names.length === 8 && names[0] === "Dark-eyed Junco", `the tiles are the eight commonest voices (${names.slice(0, 3).join(", ")}…)`);
  check(!names.some((n) => /Engine|Human|Dog/.test(n)), "engines, voices and dogs are not wildlife");
  check((await page.$$c(".row")).length === 12, "the grid lists twelve species to begin with");
  await page.click$('[data-act="allrows"]');
  const rows = (await page.$$c(".row")).length;
  check(rows > 12 && !(await page.$('wildlife-card [data-act="allrows"]')), `and the rest on request (${rows})`);
  const head = await page.text$(".hl .p");
  check(/Coyote heard/.test(head), `the heard headline leads with the coyote (${head})`);
  check(/species, \d+ detections in 3 days/.test(await page.text$(".hl .s")), "and counts species and detections beneath it");
  await shot(page, "heard-light.png");

  /* a species picked from the grid, though it has no tile of its own */
  await page.click$('.row .lab[data-row="barred_owl"]');
  check((await page.text$(".chips .chip")).includes("Barred Owl"), "a species without a tile can still be chosen from the grid");
  check((await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim()))).includes("Barred Owl"), "and is given one while it is chosen");
  await page.click$('[data-act="view"][data-v="hour"]');
  check((await page.$$c(".row")).length === 12 && !!(await page.$("wildlife-card .grid.sky")), "time of day works for calls, shading and all");
  const night = await page.$$eval("wildlife-card .rows .row", (rs) => rs.map((r) => +r.querySelector(".tot").textContent || 0));
  check(night[11] + night[0] + night[1] > 0 && night.slice(3, 10).every((n) => n === 0), `the owl keeps to the dark hours (${night.join(" ")})`);

  /* the stage: a spectrogram, the recording, and a way out to BirdNET-Go */
  await page.click$(".shot");
  check(!!(await page.$("wildlife-card .stage img.spec")), "a detection opens on its spectrogram");
  check(!!(await page.$("wildlife-card .stage audio.player[controls]")), "with the recording under it");
  check((await page.text$(".stage .p")).includes("Barred Owl") && (await page.text$(".stage .p")).includes("Strix varia"), "named in both languages");
  const out = await page.evaluate(() => {
    const c = window.card; const e = c._list.find((x) => x.id === c._ui.cur);
    return {
      link: c.shadowRoot.querySelector('.cap a[aria-label="Open this detection in BirdNET-Go"]')?.getAttribute("href"),
      id: e.hid, sp: c._bnReal("species", e), spec: c._bnReal("spectrogram", e), audio: c._bnReal("audio", e),
    };
  });
  check(out.link === `http://birdnet.local:8080/ui/detections/${out.id}`, `the link goes to that detection (${out.link})`);
  check(out.sp === "http://birdnet.local:8080/api/v2/media/species-image?name=Strix%20varia"
    && out.spec === `http://birdnet.local:8080/api/v2/spectrogram/${out.id}?size=md`
    && out.audio === `http://birdnet.local:8080/api/v2/audio/${out.id}`, "pictures and recording are asked of BirdNET-Go's own API");
  await page.click$('[data-act="step"][data-v="1"]');
  check((await page.text$(".stage .pos")).startsWith("2 /"), "previous and next step through what was heard");
  await shot(page, "heard-stage.png");

  /* an old detection whose recording has been cleared away */
  await page.click$('[data-act="days"][data-v="30"]');
  await page.waitForFunction("window.card._hSpan === 30 && !window.card._hBusy");
  check(await page.$eval("wildlife-card", (c) => c._ui.src === "heard"), "changing the range stays on what was heard");
  const old = await page.evaluate(() => {
    const c = window.card; const i = c._list.findIndex((e) => !e.clip);
    c._ui.cur = c._list[i].id; c._stage();
    return c.shadowRoot.querySelector(".stage .note")?.textContent || "";
  });
  check(/no longer keeps/.test(old) && !(await page.$("wildlife-card .stage audio")), "a detection whose recording is gone says so and offers no player");

  /* the confidence filter and the way back */
  await page.click$('[data-act="close"]');
  await page.click$(".chips .chip");
  await page.click$('[data-act="tune"]');
  const before = await page.$eval("wildlife-card", (c) => c._all.length);
  await page.$eval("wildlife-card input[name=hmin]", (i) => { i.value = 95; i.dispatchEvent(new Event("input", { bubbles: true, composed: true })); });
  await page.waitForTimeout(250);
  check((await page.$eval("wildlife-card", (c) => c._all.length)) < before && /detection/.test(await page.text$(".hid")), "the confidence filter applies to detections, and says detections");
  await page.click$('[data-act="src"][data-v="seen"]');
  check((await page.$$c(".tile")).length === 8 && /sighting/.test(await page.text$(".browser .sub h3")), "Seen puts the cameras back");
  check(page.errors.length === 0, `the heard side runs without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 16 — heard, wide and dark; labels left out; nothing heard at night without a coyote */
{
  const cfg = encodeURIComponent(JSON.stringify({ birdnet_url: "http://birdnet.local:8080", heard_ignore: ["Dark-eyed Junco", "pseudacris regilla"] }));
  const page = await open(`&heard=1&quiet=1&dark=1&config=${cfg}`, 820);
  await page.waitForFunction("window.card._hLoaded === true");
  check(!(await page.text$(".hl .s")).includes("Coyote heard"), "no coyote heard, no mention of one");
  await page.click$('[data-act="src"][data-v="heard"]');
  const names = await page.$$eval("wildlife-card .tile b", (els) => els.map((e) => e.textContent.trim()));
  check(!names.includes("Dark-eyed Junco") && names[0] === "Black-capped Chickadee", `heard_ignore leaves a species out by its common name (${names[0]} leads)`);
  check(await page.$eval("wildlife-card", (c) => ![...c._heard.values()].some((e) => e.spName === "Pacific Chorus Frog")), "or by its scientific one");
  const head = await page.text$(".hl .p");
  check(/Varied Thrush heard for the first time in 14 days/.test(head), `a newcomer makes the headline (${head})`);
  check(await page.$eval("wildlife-card", (c) => c._bnReal("spectrogram", { hid: 7 }).endsWith("?size=lg")), "a wide card asks for the larger spectrogram");
  await page.click$('[data-act="view"][data-v="camera"]');
  const labs = await page.$$eval("wildlife-card .row .lab", (els) => els.map((e) => e.textContent.trim()));
  check(labs.join() === "Backyard,Front" && /by microphone/.test(await page.text$(".chart .sub h3")), `the location view is by microphone (${labs.join(", ")})`);
  await shot(page, "heard-wide-dark.png");
  check(page.errors.length === 0, `wide and dark, heard renders without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();
}

/* 17 — BirdNET-Go as an add-on: through ingress, on a session, for those allowed in */
{
  const ADDON = encodeURIComponent(JSON.stringify({ birdnet_addon: "db21ed7f_birdnet-go" }));
  const page = await open(`&heard=1&config=${ADDON}`);
  await page.waitForFunction("window.card._hLoaded === true");
  const calls = await page.evaluate(() => window.bnCalls);
  check(calls[0].url.startsWith("/api/hassio_ingress/BIRDNET-TOKEN/api/v2/detections?"), `an add-on is read through its ingress address (${calls[0].url.slice(0, 52)}…)`);
  check(calls[0].credentials === "same-origin" && (await page.evaluate(() => window.sessions)) >= 1, "on an ingress session, with the cookie sent");
  await page.click$('[data-act="src"][data-v="heard"]');
  await page.click$(".shot");
  const link = await page.$eval('wildlife-card .cap a[aria-label="Open this detection in BirdNET-Go"]', (a) => a.getAttribute("href"));
  check(/^\/api\/hassio_ingress\/BIRDNET-TOKEN\/ui\/detections\/\d+$/.test(link), `and its page opens through ingress too (${link})`);
  /* a session left to age is renewed before a recording is opened */
  const renewed = await page.evaluate(async () => {
    const c = window.card; const was = window.sessions;
    c._bn.at = Date.now() - 400000; c._stage();
    const waiting = c.shadowRoot.querySelector(".stage .note")?.textContent || "";
    await new Promise((r) => setTimeout(r, 300));
    return { waiting, more: window.sessions > was, back: !!c.shadowRoot.querySelector(".stage img.spec") };
  });
  check(/Opening/.test(renewed.waiting) && renewed.more && renewed.back, "a stale session is renewed before a recording is opened");
  await page.close();

  /* someone who may not open the add-on gets the card as it was, and no complaint */
  const guest = await open(`&heard=1&guest&config=${ADDON}`);
  await guest.waitForFunction("window.card._hDenied === true");
  check(!(await guest.$('wildlife-card [data-act="src"]')) && !(await guest.$("wildlife-card .err")), "a viewer who may not open BirdNET-Go gets no switch and no error");
  check((await guest.$$c(".tile")).length === 8, "and the cameras' side is untouched");
  await guest.close();

  /* inside the Companion app the page link is left out; everything else stays */
  const APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Home Assistant/2026.10 (io.robbie.HomeAssistant; build:2026.1; iOS 18.0)";
  const app = await open(`&heard=1&config=${ADDON}`, 430, APP);
  await app.waitForFunction("window.card._hLoaded === true");
  await app.click$('[data-act="src"][data-v="heard"]');
  await app.click$(".shot");
  check(!!(await app.$("wildlife-card .stage audio.player")) && !(await app.$('wildlife-card .cap a[aria-label="Open this detection in BirdNET-Go"]')),
    "in the Companion app the recording plays in the card and no ingress link is offered");
  await app.close();
}

/* 18 — a BirdNET-Go that fails says so on its own side and leaves the other alone */
{
  const BN = encodeURIComponent(JSON.stringify({ birdnet_url: "http://birdnet.local:8080" }));
  const page = await open(`&heard=1&bnfail=503&config=${BN}`);
  await page.waitForFunction("!!window.card._hError");
  check(!(await page.$("wildlife-card .err")) && (await page.$$c(".tile")).length === 8, "a failing BirdNET-Go does not disturb what was seen");
  await page.click$('[data-act="src"][data-v="heard"]');
  check(/Could not read BirdNET-Go \(BirdNET-Go answered 503\)/.test(await page.text$(".err")), "and explains itself on the heard side");
  check((await page.$$c(".tile")).length === 0 && (await page.$$c('[data-act="src"]')).length === 2, "with the switch still there to go back");
  await page.close();

  const priv = await open(`&heard=1&bnfail=401&config=${BN}`);
  await priv.waitForFunction("!!window.card._hError");
  await priv.click$('[data-act="src"][data-v="heard"]');
  check(/private mode/.test(await priv.text$(".err")), "a BirdNET-Go in private mode is named as such");
  await priv.close();

  const nospec = await open(`&heard=1&nospec=1&config=${BN}`);
  nospec.ignore(/ERR_UNKNOWN_URL_SCHEME|about:blank|Failed to load/);
  await nospec.waitForFunction("window.card._hLoaded === true");
  await nospec.click$('[data-act="src"][data-v="heard"]');
  await nospec.click$(".shot");
  await nospec.waitForSelector("wildlife-card .stage .fail", { timeout: 5000 }).catch(() => {});
  check(/No spectrogram/.test(await nospec.text$(".stage .fail").catch(() => "")) && !!(await nospec.$("wildlife-card .stage audio.player")), "a spectrogram that cannot be drawn says so, and the recording still plays");
  await nospec.close();
}

/* 19 — the editor's BirdNET-Go fields */
{
  const page = await open();
  const out = await page.evaluate(async () => {
    const make = async (config) => {
      const ed = customElements.get("wildlife-card").getConfigElement();
      document.body.appendChild(ed);
      ed.setConfig(config); ed.hass = window.hass;
      await new Promise((r) => setTimeout(r, 300));
      return ed;
    };
    const has = (ed, name) => JSON.stringify(ed.querySelector("ha-form").schema).includes(`"name":"${name}"`);
    const fire = (ed, value) => new Promise((res) => {
      ed.addEventListener("config-changed", (ev) => res(ev.detail.config), { once: true });
      ed.querySelector("ha-form").dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    });
    const plain = await make({ type: "custom:wildlife-card" });
    const set = await fire(plain, { ...plain.querySelector("ha-form").data, birdnet_addon: "db21ed7f_birdnet-go" });
    const withBn = await make({ type: "custom:wildlife-card", birdnet_addon: "db21ed7f_birdnet-go", heard_ignore: ["American Crow"] });
    const cleared = await fire(withBn, { ...withBn.querySelector("ha-form").data, birdnet_addon: "", heard_ignore: [] });
    return { offered: has(plain, "birdnet_addon") && has(plain, "birdnet_url"), early: has(plain, "heard_ignore"), later: has(withBn, "heard_ignore"), set, cleared };
  });
  check(out.offered && !out.early && out.later, "the editor offers the BirdNET-Go fields, and the labels to leave out once one is set");
  check(out.set.birdnet_addon === "db21ed7f_birdnet-go" && !("heard_ignore" in out.set) && !("birdnet_url" in out.set), "setting the slug writes that key and no empty ones");
  check(!("birdnet_addon" in out.cleared) && !("heard_ignore" in out.cleared), "and emptying the fields leaves no keys behind");
  await page.close();
}

/* 20 — seen and heard together: the same animal, the same place, the same time */
{
  const cfg = (extra = {}) => encodeURIComponent(JSON.stringify({ birdnet_url: "http://birdnet.local:8080", correlate: true, ...extra }));
  const page = await open(`&heard=pairs&config=${cfg()}`);
  await page.waitForFunction("window.card._hLoaded === true && window.card._loaded === true");
  check((await page.$$c('[data-act="src"]')).length === 3, "correlate adds Both to the switch");
  const pairs = await page.evaluate(() => {
    const c = window.card; const out = {};
    for (const [k, id] of Object.entries(window.plan)) { const m = c._match(c._events.get(id)); out[k] = m ? m.spName : null; }
    return out;
  });
  check(pairs.plain === "American Robin", `a bird on camera pairs with the surest bird call there (${pairs.plain})`);
  check(pairs.junco === "Dark-eyed Junco", `a sighting that names its species prefers that species over a surer call (${pairs.junco})`);
  check(pairs.other === null, "and pairs with no other species");
  check(pairs.porch === "American Crow", "a call shortly before the sighting counts, and a camera's underscores match the microphone's spaces");
  check(pairs.away === null, "a call from another microphone does not");
  check(pairs.late === null, "nor one that comes too long after");
  check(pairs.cat === null, "a cat is not paired with birdsong");
  check(pairs.coyote === "Coyote", "a likely coyote on camera pairs with a coyote that was heard");
  check(pairs.squirrel === "Douglas Squirrel", "a squirrel pairs with a squirrel, whatever the microphone calls it");

  await page.click$('.tile[data-v="squirrel"]');
  check((await page.$$c(".shot .hd")).length === 1, "a paired sighting is marked on the Seen side");
  await page.evaluate(() => { const c = window.card; c._ui.cur = window.plan.squirrel; c._stage(); });
  check(/Heard while in view: Douglas Squirrel/.test(await page.text$(".stage .also .note")), "and opens with its call under the picture there too");
  await page.click$('[data-act="close"]');
  await page.click$(".chips .chip");
  await page.click$('[data-act="src"][data-v="both"]');
  const list = await page.evaluate(() => window.card._all.map((e) => e.id));
  const want = await page.evaluate(() => ["plain", "junco", "porch", "coyote", "squirrel"].map((k) => window.plan[k]));
  check(list.length === 5 && want.every((id) => list.includes(id)), `Both lists the paired sightings and nothing else (${list.length})`);
  check(/5 sightings were also heard/.test(await page.text$(".hl .p")) && /within 2 min/.test(await page.text$(".hl .s")), `the headline counts them (${await page.text$(".hl .p")})`);
  check(/5 matches/.test(await page.text$(".browser .sub h3")) && /Seen and heard per day/.test(await page.text$(".chart .sub h3")), "the browser and grid speak of matches");
  const under = await page.$$eval("wildlife-card .shot i", (els) => els.map((e) => e.textContent.trim()));
  check(under.some((t) => t.startsWith("Dark-eyed Junco · Front")), `each shot names what was heard and where (${under[0]})`);
  await page.evaluate(() => { const c = window.card; c._ui.cur = window.plan.porch; c._stage(); });
  const also = await page.text$(".stage .also .note");
  check(/Heard 40 s before: American Crow · 88% · Garage porch microphone/.test(also), `the stage says what was heard and when (${also})`);
  check(!!(await page.$("wildlife-card .stage .also audio.player")) && !!(await page.$("wildlife-card .stage img.media")), "with the recording under the picture");
  await shot(page, "both-stage.png");

  /* the confidence filter can rule the better call out, and the pair with it */
  await page.click$('[data-act="close"]');
  await page.click$('[data-act="tune"]');
  await page.$eval("wildlife-card input[name=hmin]", (i) => { i.value = 87; i.dispatchEvent(new Event("input", { bubbles: true, composed: true })); });
  await page.waitForTimeout(250);
  const strict = await page.evaluate(() => {
    const c = window.card; const m = (k) => { const e = c._events.get(window.plan[k]); const h = c._match(e); return h ? h.spName : null; };
    return { junco: m("junco"), squirrel: m("squirrel") };
  });
  check(strict.junco === null && strict.squirrel === null, "a call under the confidence filter no longer makes a pair");

  /* the heard side knows it was seen */
  await page.$eval("wildlife-card input[name=hmin]", (i) => { i.value = 70; i.dispatchEvent(new Event("input", { bubbles: true, composed: true })); });
  await page.waitForTimeout(250);
  await page.click$('[data-act="src"][data-v="heard"]');
  await page.evaluate(() => { const c = window.card; c._ui.cur = c._list.find((e) => e.spName === "Coyote").id; c._stage(); });
  check(/seen on camera too/.test(await page.text$(".stage .cap .s")), "a call that was also seen says so on the Heard side");
  check(page.errors.length === 0, `pairing runs without errors (${page.errors.slice(0, 2).join("; ")})`);
  await page.close();

  /* a narrower window, and nothing to pair */
  const tight = await open(`&heard=pairs&config=${cfg({ correlate_window: 20 })}`);
  await tight.waitForFunction("window.card._hLoaded === true && window.card._loaded === true");
  check(await tight.evaluate(() => { const c = window.card; return c._match(c._events.get(window.plan.porch)) === null && !!c._match(c._events.get(window.plan.plain)); }),
    "correlate_window narrows what counts as the same time");
  await tight.close();
  const none = await open(`&heard=pairs&config=${cfg({ heard_ignore: ["American Robin", "Song Sparrow", "Dark-eyed Junco", "American Crow", "Coyote", "Douglas Squirrel"] })}`);
  await none.waitForFunction("window.card._hLoaded === true && window.card._loaded === true");
  await none.click$('[data-act="src"][data-v="both"]');
  check(/Nothing seen and heard together/.test(await none.text$(".hl .p")) && /No matches match|No matches/.test(await none.text$(".browser .empty")), "with nothing paired, Both says so plainly");
  await none.close();

  /* the editor */
  const ed = await open();
  const out = await ed.evaluate(async () => {
    const e = customElements.get("wildlife-card").getConfigElement();
    document.body.appendChild(e);
    e.setConfig({ type: "custom:wildlife-card", birdnet_addon: "db21ed7f_birdnet-go" }); e.hass = window.hass;
    await new Promise((r) => setTimeout(r, 300));
    const form = e.querySelector("ha-form");
    const fire = (value) => new Promise((res) => {
      e.addEventListener("config-changed", (ev) => res(ev.detail.config), { once: true });
      form.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    });
    const offered = JSON.stringify(form.schema).includes('"name":"correlate"');
    const on = await fire({ ...form.data, correlate: true, correlate_window: 60 });
    const off = await fire({ ...form.data, correlate: false });
    return { offered, on, off };
  });
  check(out.offered && out.on.correlate === true && out.on.correlate_window === 60, "the editor offers the pairing and its window");
  check(!("correlate" in out.off) && !("correlate_window" in out.off), "and leaves no keys behind when it is off");
  await ed.close();
}

/* 21 — the playhead on the spectrogram, repeat, a threshold for calls, and the strip in Both */
{
  const BN = (extra = {}) => encodeURIComponent(JSON.stringify({ birdnet_url: "http://birdnet.local:8080", ...extra }));
  const page = await open(`&heard=1&config=${BN()}`);
  await page.waitForFunction("window.card._hLoaded === true");
  await page.click$('[data-act="src"][data-v="heard"]');
  await page.click$(".shot");
  const box = () => page.evaluate(() => { const el = window.card.shadowRoot.querySelector(".stage .shotwrap img.spec"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const head = () => page.evaluate(() => { const h = window.card.shadowRoot.querySelector(".stage .playhead"); const a = window.card.shadowRoot.querySelector(".stage audio"); return { left: parseFloat(h.style.left) || 0, on: h.style.opacity === "1", paused: a.paused, ended: a.ended, loop: a.loop, t: a.currentTime, d: a.duration }; });
  check((await head()).on === false, "the playhead is out of sight until something plays");
  let b = await box();
  await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.3);
  await page.waitForFunction(() => window.card.shadowRoot.querySelector(".stage audio").ended, null, { timeout: 5000 });
  let h = await head();
  check(h.on && h.left > 99, `a click on the spectrogram plays from there, and the line runs to the end with the sound (${h.left.toFixed(0)}%)`);

  /* repeat: set once, kept on the element, and remembered for the next one */
  check((await page.$$c('.stage [data-act="loop"][aria-pressed="false"]')).length === 1, "the stage offers repeat, off to begin with");
  await page.click$('.stage [data-act="loop"]');
  h = await head();
  check(h.loop === true && (await page.$$c('.stage [data-act="loop"][aria-pressed="true"]')).length === 1, "turning it on sets the player to loop");
  b = await box();
  await page.mouse.click(b.x + b.w * 0.25, b.y + b.h * 0.3);
  await page.waitForTimeout(900);
  h = await head();
  check(!h.paused && !h.ended && h.left >= 0 && h.left <= 100, "and the recording goes round rather than stopping");

  /* a background refresh leaves what is playing alone */
  const kept = await page.evaluate(async () => {
    const c = window.card; const a = c.shadowRoot.querySelector(".stage audio"); a._mark = 1;
    c._refresh(false);
    await new Promise((r) => setTimeout(r, 600));
    const now = c.shadowRoot.querySelector(".stage audio");
    return { same: now && now._mark === 1, playing: now && !now.paused, tiles: c.shadowRoot.querySelectorAll(".tile").length };
  });
  check(kept.same && kept.playing && kept.tiles === 8, "a background refresh redraws the card around a recording that is playing");
  await page.click$('[data-act="step"][data-v="1"]');
  check((await head()).loop === true, "repeat carries to the next recording");
  await page.click$('[data-act="src"][data-v="seen"]');
  await page.click$(".shot");
  check(await page.evaluate(() => {
    const r = window.card.shadowRoot; r.querySelector('.stage [data-act="clip"]').click();   // the harness has no clip to serve, so look before it gives up
    const v = r.querySelector(".stage video");
    return v?.loop === true && v.muted === false && !!r.querySelector('.stage [data-act="loop"][aria-pressed="true"]');
  }), "and to a sighting's video, which starts with its sound on");
  check(await page.evaluate(async () => {
    const c = window.card; c._ui.clip = true; c._stage();
    const v = c.shadowRoot.querySelector(".stage video"); v.muted = true;
    await new Promise((r) => setTimeout(r, 150));
    const kept = c._ui.vmuted === true;
    c._stage();
    const again = c.shadowRoot.querySelector(".stage video").muted === true;
    const w = c.shadowRoot.querySelector(".stage video"); w._auto = true; w.muted = false; w.muted = true;   // a browser's doing, not the viewer's
    return kept && again;
  }), "a viewer who mutes a video finds the next one muted too");
  await page.close();

  /* a threshold of its own for what is heard */
  const strict = await open(`&heard=1&config=${BN({ heard_min_score: 90 })}`);
  await strict.waitForFunction("window.card._hLoaded === true");
  const seenN = await strict.$eval("wildlife-card", (c) => c._all.length);
  await strict.click$('[data-act="src"][data-v="heard"]');
  const stats = await strict.evaluate(() => { const c = window.card; return { low: c._all.filter((e) => e.score < 0.9).length, n: c._all.length, all: c._heard.size }; });
  check(stats.low === 0 && stats.n > 0 && stats.n < stats.all, `heard_min_score filters calls on its own (${stats.n} of ${stats.all})`);
  await strict.click$('[data-act="tune"]');
  check(!!(await strict.$("wildlife-card input[name=hmin]")) && !(await strict.$("wildlife-card input[name=min]")) && (await strict.text$('.tune output[data-for="hmin"]')) === "90%", "the slider on the Heard side is the calls' own");
  await strict.click$('[data-act="src"][data-v="seen"]');
  check((await strict.$eval("wildlife-card", (c) => c._all.length)) === seenN && !!(await strict.$("wildlife-card input[name=min]")) && (await strict.text$('.tune output[data-for="min"]')) === "70%", "and sightings keep theirs");
  await strict.close();

  /* Both: the sound drawn under the picture, beside the species it names */
  const both = await open(`&heard=pairs&config=${BN({ correlate: true })}`);
  await both.waitForFunction("window.card._hLoaded === true && window.card._loaded === true");
  await both.click$('[data-act="src"][data-v="both"]');
  await both.click$('[data-act="tune"]');
  check((await both.$$c(".tune input[type=range]")).length === 2, "Both offers a slider for each side");
  await both.click$('[data-act="tune"]');
  await both.evaluate(() => { const c = window.card; c._ui.cur = window.plan.junco; c._stage(); });
  const strip = await both.evaluate(() => {
    const r = window.card.shadowRoot; const sg = r.querySelector(".stage .strip .sg"); const ref = r.querySelector(".stage .strip img.ref");
    return { sg: !!sg?.querySelector("img.stripimg"), head: !!sg?.querySelector(".playhead"), ref: ref?.getAttribute("title"), pic: !!r.querySelector(".stage .shotwrap > img.media"), loop: !!r.querySelector('.stage [data-act="loop"]') };
  });
  check(strip.sg && strip.head && strip.pic, "a paired sighting shows the call's spectrogram under the camera picture");
  check(strip.ref === "Dark-eyed Junco" && strip.loop, "with BirdNET-Go's picture of the species it named, and repeat");
  const geo = await both.evaluate(() => {
    const r = window.card.shadowRoot; const m = r.querySelector(".stage .shotwrap > .media").getBoundingClientRect();
    const mid = (el) => { const q = el.getBoundingClientRect(); return q.top + q.height / 2; };
    const navs = [...r.querySelectorAll(".stage .nav")];
    /* where a video's own play button sits: bottom left of the picture */
    const hit = r.elementFromPoint(m.left + 30, m.bottom - 24);
    return { centred: navs.every((n) => Math.abs(mid(n) - (m.top + m.height / 2)) < 4), hit: hit?.className || hit?.tagName,
      dead: navs.filter((n) => n.disabled).every((n) => getComputedStyle(n).pointerEvents === "none") };
  });
  check(geo.centred && /media/.test(geo.hit) && geo.dead, `the arrows sit on the picture's middle, clear of a video's own controls, however much is stacked under it (${geo.hit})`);
  const r = await both.evaluate(() => { const el = window.card.shadowRoot.querySelector(".stage .strip .sg"); el.scrollIntoView({ block: "center" }); const q = el.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  await both.mouse.click(r.x + r.w * 0.5, r.y + r.h * 0.5);
  await both.waitForFunction(() => window.card.shadowRoot.querySelector(".stage audio").ended, null, { timeout: 5000 });
  check(await both.evaluate(() => { const h = window.card.shadowRoot.querySelector(".stage .playhead"); return h.style.opacity === "1" && parseFloat(h.style.left) > 99; }), "and the strip plays from a click, with its own playhead");
  check(both.errors.length === 0, `the players run without errors (${both.errors.slice(0, 2).join("; ")})`);
  check(await both.evaluate(() => { const r = window.card.shadowRoot; r.querySelector('.stage [data-act="clip"]').click(); return !!r.querySelector(".stage video") && !!r.querySelector(".stage .strip .sg img.stripimg"); }), "the strip stays while the video plays");
  await both.click$('[data-act="still"]');
  await shot(both, "both-strip.png");
  await both.close();

  /* the editor: written only when it differs from the sightings' threshold */
  const ed = await open();
  const out = await ed.evaluate(async () => {
    const e = customElements.get("wildlife-card").getConfigElement();
    document.body.appendChild(e);
    e.setConfig({ type: "custom:wildlife-card", birdnet_addon: "db21ed7f_birdnet-go", min_score: 70 }); e.hass = window.hass;
    await new Promise((r) => setTimeout(r, 300));
    const form = e.querySelector("ha-form");
    const fire = (value) => new Promise((res) => {
      e.addEventListener("config-changed", (ev) => res(ev.detail.config), { once: true });
      form.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    });
    return { offered: JSON.stringify(form.schema).includes('"name":"heard_min_score"'), start: form.data.heard_min_score, same: await fire({ ...form.data, title: "T" }), set: await fire({ ...form.data, heard_min_score: 85 }) };
  });
  check(out.offered && out.start === 70 && !("heard_min_score" in out.same) && out.set.heard_min_score === 85, "the editor offers the calls' threshold and writes it only when it is set apart");
  await ed.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nall checks passed — screenshots in dev/out/`);
process.exit(failures.length ? 1 : 0);
