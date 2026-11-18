/*
 * wildlife-card
 * Frigate wildlife activity for Home Assistant: per-species tiles, an activity
 * grid (by species / time of day / camera) and a sightings browser with clips.
 *
 * Data comes straight from the Frigate integration (websocket
 * `frigate/events/get`), so no helper sensors or packages are needed.
 * Media uses the integration's notification proxy, falling back to signed paths.
 *
 * Optionally the card also shows what is heard: bird and other animal calls
 * identified by BirdNET-Go, read from its own API, with the spectrogram and
 * the recording for each one.
 *
 *   type: custom:wildlife-card
 *
 * Every option below is optional; the values shown are the defaults.
 *
 *   title: Wildlife
 *   icon: mdi:binoculars          # headline icon when nothing is alarming
 *   instance_id: frigate          # Frigate mqtt client_id
 *   days: 14                      # initial range: 7, 14 or 30
 *   min_score: 70                 # initial confidence filter, percent
 *   sun_shading: true             # day/night shading behind the time-of-day rows
 *   refresh: 300                  # seconds between background refreshes
 *   indoor_cameras: [Attic, Crawlspace]
 *   clip_lead_in: 0               # extra seconds before a sighting when playing a clip
 *   clip_lead_out: 0              # extra seconds after a sighting when playing a clip
 *   birdnet_addon: ''             # BirdNET-Go add-on slug: adds what the microphones hear
 *   birdnet_url: ''               # or its address, for a BirdNET-Go that is not an add-on
 *   heard_ignore: []              # heard labels to leave out, besides engines, voices and the like
 *   correlate: false              # pair sightings with calls of the same animal, place and time
 *   correlate_window: 120         # seconds either side of a sighting that still count as the same time
 *   coyote:
 *     enabled: true
 *     cameras: [Driveway, Front]  # where a lone night-time dog counts
 *     start: '23:00'
 *     end: '05:00'
 *     person_window: 120          # seconds either side to look for a person
 *   species:                      # omit for the built-in list, set 'auto' for dynamic discovery, or list custom groups
 *   discover: false               # true: discover species even though a list is written out, and keep the list
 *     - { id: rodent, name: Rodents, labels: [rodent], glyph: 🐀 }
 */
(() => {
  const VERSION = __VERSION__;

  const DEFAULT_SPECIES = [
    { id: 'rodent', name: 'Rodents', one: 'Rodent', labels: ['rodent'], glyph: '🐀' },
    { id: 'cat', name: 'Cats', one: 'Cat', labels: ['cat'], glyph: '🐈' },
    { id: 'rabbit', name: 'Rabbits', one: 'Rabbit', labels: ['rabbit'], glyph: '🐇' },
    { id: 'bird', name: 'Birds', one: 'Bird', labels: ['bird'], glyph: '🐦' },
    { id: 'raccoon', name: 'Raccoons', one: 'Raccoon', labels: ['raccoon'], glyph: '🦝' },
    { id: 'coyote', name: 'Coyotes', one: 'Coyote', labels: ['coyote'], glyph: '🐺' },
    { id: 'squirrel', name: 'Squirrels', one: 'Squirrel', labels: ['squirrel'], glyph: '🐿️' },
    { id: 'other', name: 'Others', one: 'Other', labels: ['fox', 'skunk', 'possum', 'snake'], glyph: '🐾' },
  ];

  // Non-wildlife detector classes excluded when species: auto discovers labels.
  const NON_WILDLIFE = new Set([
    'person', 'human', 'face', 'car', 'vehicle', 'bicycle', 'motorcycle',
    'bus', 'train', 'truck', 'boat', 'blank', 'none', 'on_demand',
  ]);
  const EMPTY_SUB = new Set(['blank', 'none', 'unknown', 'animal', 'wildlife']);
  /* BirdNET's label list has a few classes that are not animals at all, and
     one, the dog, that would drown out everything else in a neighbourhood. */
  const NON_WILDLIFE_SOUNDS = [
    'human vocal', 'human non-vocal', 'human whistle', 'engine', 'environmental',
    'fireworks', 'gun', 'noise', 'power tools', 'siren', 'dog',
  ];
  const HEARD_PAGE = 1000;     // the most BirdNET-Go returns per request
  const HEARD_PAGES = 20;      // newest first, so a busy month loses its oldest days, not its latest
  const HEARD_TILES = 8;
  const HEARD_ROWS = 12;

  const GLYPH_RULES = [
    [/coyote|wolf|wolves/, '🐺'],
    [/squirrel|chipmunk|marmot|groundhog|woodchuck|gopher/, '🐿️'],
    [/\bfox\b/, '🦊'],
    [/raccoon|coati|ringtail/, '🦝'],
    [/\bskunk\b/, '🦨'],
    [/badger|wolverine/, '🦡'],
    [/otter/, '🦦'],
    [/beaver/, '🦫'],
    [/rabbit|hare|cottontail/, '🐇'],
    [/rodent|\brat\b|\bmice\b|\bmouse\b|vole|woodrat|deermouse|shrew/, '🐀'],
    [/hedgehog|porcupine/, '🦔'],
    [/\bcat\b|lynx|bobcat|cougar|puma|feline/, '🐈'],
    [/\bdog\b|canine|canid|puppy/, '🐕'],
    [/deer|stag|elk|moose|antelope/, '🦌'],
    [/\bbear\b/, '🐻'],
    [/\bpig\b|boar|\bhog\b|peccary/, '🐗'],
    [/cattle|\bcow\b|\bbull\b|bison|buffalo/, '🐄'],
    [/horse|pony|donkey|mule/, '🐎'],
    [/goat/, '🐐'],
    [/sheep|bighorn/, '🐑'],
    [/\bowl\b/, '🦉'],
    [/eagle|hawk|falcon|osprey|vulture/, '🦅'],
    [/duck|mallard|teal|goose|geese|swan|waterfowl/, '🦆'],
    [/turkey/, '🦃'],
    [/chicken|rooster|pheasant|quail|grouse|gamebird/, '🐓'],
    [/heron|egret|crane|stork|pelican/, '🦩'],
    [/dove|pigeon/, '🕊️'],
    [/parrot|macaw|parakeet/, '🦜'],
    [/bird|junco|sparrow|cardinal|finch|wren|thrush|robin|mockingbird|woodpecker|chickadee|\btit\b|nuthatch|warbler|towhee|swallow|oriole|tanager|hummingbird|kingfisher|crow|raven|\bjay\b|magpie|blackbird|grackle|starling|songbird/, '🐦'],
    [/snake|viper|python|rattlesnake/, '🐍'],
    [/lizard|gecko|iguana|\bskink\b|chameleon|reptile/, '🦎'],
    [/turtle|tortoise/, '🐢'],
    [/frog|toad|salamander|newt|amphibian/, '🐸'],
    [/\bbat\b/, '🦇'],
  ];

  const SMALL_WORDS = new Set(['of', 'and', 'or', 'the', 'in', 'on', 'at', 'to', 'a', 'an']);
  const subOf = (e) => (Array.isArray(e?.sub_label) ? e.sub_label[0] : e?.sub_label);
  const normKey = (s) => String(s || '').trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/\bgrey\b/g, 'gray');
  const slugId = (s) => normKey(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'animal';
  const normMap = (obj) => {
    const out = {};
    if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) out[normKey(k)] = String(v);
    return out;
  };
  const titleCase = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).map((w, i) => {
    const lw = w.toLowerCase();
    return i > 0 && SMALL_WORDS.has(lw) ? lw : lw.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
  }).join(' ');
  const formatLabel = (raw, aliases = {}) => {
    let s = String(raw || '').trim();
    if (!s) return 'Animal';
    const rawKey = normKey(s);
    if (aliases[rawKey]) return titleCase(aliases[rawKey]);
    if (s.includes(';')) {
      const parts = s.split(';').map((p) => p.trim());
      s = (parts.length >= 6 && parts[parts.length - 1]) || parts.slice(1, 6).filter(Boolean).join(' ') || s;
    }
    const paren = /^(.+?)\s*\([A-Z][a-z]+(?:\s+[a-z]+){0,2}\)$/.exec(s);
    if (paren) s = paren[1];
    s = normKey(s);
    if (aliases[s]) return titleCase(aliases[s]);
    const tax = /^(.+?)\s+(family|order|class|kingdom|species|genus)$/.exec(s);
    if (tax && aliases[tax[1]]) {
      const base = aliases[tax[1]];
      return titleCase(tax[2] === 'family' ? `${base} family` : base);
    }
    return titleCase(s);
  };
  const glyphFor = (name, raw = '', glyphs = {}) => {
    const custom = glyphs[normKey(name)] || glyphs[normKey(raw)];
    if (custom) return custom;
    const hay = `${name} ${raw}`.toLowerCase();
    for (const [re, g] of GLYPH_RULES) if (re.test(hay)) return g;
    return '🐾';
  };
  /* Whether a sighting and a call can be the same animal. A camera usually
     knows only "bird" where the microphone names the species, so the test is
     on the kind of animal unless the sighting carries a species of its own,
     in which case the two have to agree. 2 is the same species, 1 the same
     kind, 0 neither. */
  const BIRD_GLYPHS = new Set(['🐦', '🦉', '🦅', '🦆', '🦃', '🐓', '🦩', '🕊️', '🦜']);
  const kindOf = (name, raw, heard) => {
    const g = glyphFor(name, raw);
    return BIRD_GLYPHS.has(g) ? '🐦' : g === '🐾' ? (heard ? '🐦' : '') : g;
  };
  const sameKind = (e, h) => {
    const hn = slugId(h.spName); const hs = h.sci ? slugId(h.sci) : '';
    const within = (a, b) => `_${b}_`.includes(`_${a}_`);
    const sub = e.sub && !e.inferred && !EMPTY_SUB.has(normKey(e.sub)) ? slugId(e.sub) : '';
    if (sub) {
      if (sub === hn || sub === hs || within(sub, hn) || within(hn, sub)) return 2;
      if (kindOf(e.sub, '', false)) return 0;          // a species of its own, and a different one
    }
    const lab = slugId(e.label);
    if (!e.inferred && (lab === hn || lab === hs)) return 2;
    const seen = e.inferred || e.sp === 'coyote' ? '🐺' : kindOf(e.label, '', false);
    return seen && seen === kindOf(h.spName, h.sci, true) ? 1 : 0;
  };
  const span = (sec) => (sec < 90 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`);
  const isDogLike = (label, sub) => {
    const l = normKey(label); const s = normKey(sub);
    return l === 'dog' || s === 'dog' || s === 'domestic dog' || s === 'canis familiaris' || s === 'canis lupus familiaris';
  };

  const ICON = {
    tune: 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z',
    left: 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z',
    right: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
    close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    image: 'M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z',
    open: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
    find: 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const hhmm = (s, d) => { const m = /^(\d{1,2}):?(\d{2})?/.exec(String(s ?? '')); return m ? +m[1] + (+(m[2] || 0)) / 60 : d; };

  /* Low-precision solar position (USNO): the sun's altitude in degrees, for a
     UTC instant at a given latitude and longitude. Good to a couple of minutes
     either side of sunrise, which is far finer than a two-hour row needs. */
  const RAD = Math.PI / 180;
  const altitude = (ms, lat, lon) => {
    const d = ms / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * RAD;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ha = (((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon - ra) * RAD;
    return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
  };

  /* Two palettes: over a dark surface a warm daylight tint turns olive, so the
     dark theme gets a paler, less saturated day and a cooler dusk. */
  const SKY = {
    light: { night: [38, 62, 130], dawn: [226, 132, 170], day: [250, 206, 112], dusk: [242, 146, 62] },
    dark: { night: [60, 96, 190], dawn: [236, 150, 190], day: [214, 226, 255], dusk: [250, 178, 120] },
  };

  const CSS = `
    :host { display:block; --wl-rgb: var(--rgb-primary-color, 3,169,244); --wl-ink: var(--rgb-primary-text-color, 33,33,33); }
    ha-card { overflow:hidden; border-radius:18px; border:1px solid rgba(var(--wl-ink),.10); }
    button { font:inherit; color:inherit; background:none; border:0; padding:0; margin:0; cursor:pointer; -webkit-tap-highlight-color:transparent; }
    svg { width:20px; height:20px; fill:currentColor; display:block; }
    .head { display:flex; align-items:center; gap:8px; padding:14px 12px 8px 16px; }
    .title { flex:1; font-size:20px; font-weight:500; line-height:28px; color:var(--primary-text-color); }
    .seg { display:inline-flex; padding:2px; border-radius:999px; background:rgba(var(--wl-rgb),.08); border:1px solid rgba(var(--wl-ink),.09); }
    .seg button { padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; line-height:16px; color:var(--secondary-text-color); white-space:nowrap; }
    .seg button[aria-pressed="true"] { background:var(--primary-color); color:var(--text-primary-color,#fff); }
    .iconbtn { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; color:var(--secondary-text-color); position:relative; }
    .iconbtn:hover, .iconbtn[aria-expanded="true"] { background:rgba(var(--wl-rgb),.12); color:var(--primary-color); }
    .iconbtn .dot { position:absolute; top:5px; right:5px; width:7px; height:7px; border-radius:50%; background:var(--primary-color); }
    .panel { margin:12px 12px 10px; border-radius:14px; border:1px solid rgba(var(--wl-ink),.09); background:rgba(var(--wl-rgb),.06); }
    .tune { padding:10px 14px 12px; margin-bottom:0; }
    .tune label { display:flex; justify-content:space-between; font-size:13px; font-weight:600; color:var(--primary-text-color); }
    .tune small { display:block; font-size:12px; color:var(--secondary-text-color); margin-top:2px; }
    .tune input { width:100%; margin:8px 0 0; accent-color:var(--primary-color); }
    .hl { display:flex; gap:12px; align-items:center; padding:10px 12px; }
    .hl .shape { flex:none; width:36px; height:36px; display:grid; place-items:center; color:rgb(var(--hl)); --mdc-icon-size:22px; }
    .hl .p { font-size:14px; font-weight:500; line-height:20px; color:var(--primary-text-color); }
    .hl .s { font-size:12px; line-height:16px; color:var(--secondary-text-color); }
    .tiles { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; padding:2px 12px 10px; }
    :host([wide]) .tiles { grid-template-columns:repeat(8,minmax(0,1fr)); }
    :host([wide]) .stage .media { aspect-ratio:auto; max-height:520px; }
    .tile { text-align:left; border-radius:14px; padding:4px 4px 6px; border:1px solid transparent; min-width:0; }
    .tile[aria-pressed="true"] { background:rgba(var(--wl-rgb),.10); border-color:rgba(var(--wl-rgb),.55); }
    .tile .pic { position:relative; aspect-ratio:1; border-radius:11px; overflow:hidden; background:rgba(var(--wl-ink),.06); display:grid; place-items:center; font-size:26px; }
    .tile img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .tile.none { opacity:.55; }
    .tile .n { position:absolute; right:4px; bottom:4px; padding:0 6px; border-radius:999px; font-size:11px; font-weight:700; line-height:16px; background:rgba(0,0,0,.62); color:#fff; }
    .tile .flag { position:absolute; left:4px; top:4px; padding:0 5px; border-radius:999px; font-size:10px; font-weight:700; line-height:15px; background:rgba(var(--rgb-warning-color,255,166,0),.95); color:#000; }
    .tile b { display:block; margin:5px 2px 0; font-size:12px; font-weight:600; line-height:15px; color:var(--primary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tile i { display:block; margin:0 2px; font-style:normal; font-size:11px; line-height:14px; color:var(--secondary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sub { display:flex; align-items:center; gap:8px; padding:6px 12px 6px 16px; }
    .sub h3 { flex:1; margin:0; font-size:13px; font-weight:600; letter-spacing:.02em; color:var(--secondary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .grid { padding:0 12px 4px 16px; position:relative; }
    .row { display:grid; grid-template-columns:var(--lab) minmax(0,1fr) 30px; align-items:center; gap:6px; }
    .row .lab { font-size:12px; line-height:16px; color:var(--primary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; padding:1px 0; }
    .row .lab.on { color:var(--primary-color); font-weight:700; }
    .row .tot { font-size:11px; text-align:right; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
    .cells { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); gap:2px; }
    .c { position:relative; height:var(--ch,16px); border-radius:3px; background:rgba(var(--wl-ink),.05); }
    .c[data-v] { background:rgba(var(--wl-rgb),var(--a)); }
    .c.wk::before { content:''; position:absolute; top:0; bottom:0; left:-2px; width:1px; background:rgba(var(--wl-ink),.2); }
    .c.sel { outline:2px solid var(--primary-text-color); outline-offset:1px; }
    .c:hover { outline:2px solid rgba(var(--wl-ink),.55); outline-offset:1px; }
    .rows { display:grid; gap:2px; }
    .grid.hours .lab { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:3px; }
    .grid.hours .lab em { font-style:normal; opacity:.5; }
    .grid.hours .lab span:first-child { text-align:right; }
    .grid.hours .lab span:last-child { text-align:left; }
    .grid.sky .row .lab { background:rgba(var(--sky),.22); margin:-1px 0; padding:1px 4px 1px 6px; border-radius:3px; }
    .grid.sky .c { background:rgba(var(--sky),.16); }
    .grid.sky .c[data-v] { background:linear-gradient(rgba(var(--wl-rgb),var(--a)),rgba(var(--wl-rgb),var(--a))),rgba(var(--sky),.16); }
    .axis { display:grid; grid-template-columns:var(--lab) minmax(0,1fr) 30px; gap:6px; margin-top:4px; }
    .axis div { position:relative; height:14px; font-size:10px; color:var(--secondary-text-color); }
    .axis span { position:absolute; top:0; transform:translateX(-50%); white-space:nowrap; }
    .axis span.end { transform:translateX(-100%); }
    .key { display:flex; align-items:center; gap:6px; justify-content:flex-end; padding:2px 12px 8px; font-size:10px; color:var(--secondary-text-color); }
    .key u { width:12px; height:10px; border-radius:3px; background:rgba(var(--wl-rgb),var(--a)); }
    .tip { position:absolute; z-index:5; pointer-events:none; padding:5px 9px; border-radius:10px; font-size:12px; line-height:16px; white-space:nowrap; background:var(--card-background-color,#fff); color:var(--primary-text-color); border:1px solid rgba(var(--wl-ink),.16); box-shadow:0 4px 14px rgba(0,0,0,.22); transform:translate(-50%,-100%); }
    .tip b { font-weight:700; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 12px 6px 16px; }
    .chip { display:inline-flex; align-items:center; gap:2px; padding:2px 4px 2px 10px; border-radius:999px; font-size:12px; font-weight:600; background:rgba(var(--wl-rgb),.14); color:var(--primary-text-color); }
    .chip svg { width:15px; height:15px; opacity:.7; }
    .stage { margin:2px 12px 8px; border-radius:14px; overflow:hidden; border:1px solid rgba(var(--wl-ink),.09); background:#000; position:relative; }
    .stage .media { display:block; width:100%; aspect-ratio:16/9; object-fit:contain; background:#000; }
    .stage .nav { position:absolute; top:calc(50% - 40px); width:36px; height:36px; border-radius:50%; display:grid; place-items:center; background:rgba(0,0,0,.5); color:#fff; }
    .stage .nav.l { left:8px; } .stage .nav.r { right:8px; }
    .stage .nav:disabled { opacity:.25; cursor:default; }
    .stage .x { position:absolute; top:8px; right:8px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; background:rgba(0,0,0,.5); color:#fff; }
    .stage .pos { position:absolute; top:10px; left:10px; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(0,0,0,.5); color:#fff; }
    .fail { display:grid; gap:8px; place-items:center; padding:26px 18px; text-align:center; background:rgba(var(--wl-ink),.04); }
    .fail p { margin:0; font-size:13px; line-height:18px; color:var(--primary-text-color); }
    .fail small { font-size:12px; color:var(--secondary-text-color); }
    .cap { display:flex; align-items:center; gap:8px; padding:8px 10px 8px 12px; background:var(--card-background-color,#fff); }
    .cap .t { flex:1; min-width:0; }
    .cap .p { font-size:14px; font-weight:600; line-height:19px; color:var(--primary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cap .s { font-size:12px; line-height:16px; color:var(--secondary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pill { display:inline-flex; align-items:center; gap:4px; padding:5px 12px 5px 8px; border-radius:999px; font-size:12px; font-weight:700; background:var(--primary-color); color:var(--text-primary-color,#fff); }
    .pill.ghost { background:rgba(var(--wl-rgb),.12); color:var(--primary-color); padding:5px; }
    .pill svg { width:16px; height:16px; }
    .film { display:flex; gap:6px; overflow-x:auto; padding:0 12px 14px; scroll-snap-type:x proximity; scrollbar-width:thin; }
    .shot { flex:none; width:104px; scroll-snap-align:start; text-align:left; }
    .shot .pic { position:relative; aspect-ratio:1; border-radius:11px; overflow:hidden; background:rgba(var(--wl-ink),.06); display:grid; place-items:center; font-size:24px; border:2px solid transparent; }
    .shot[aria-current="true"] .pic { border-color:var(--primary-color); }
    .shot img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .shot .sc { position:absolute; left:4px; bottom:4px; padding:0 5px; border-radius:999px; font-size:10px; font-weight:700; line-height:15px; background:rgba(0,0,0,.62); color:#fff; }
    .shot .gl { position:absolute; right:4px; top:3px; font-size:14px; filter:drop-shadow(0 0 2px rgba(0,0,0,.8)); }
    .shot b { display:block; margin-top:3px; font-size:11px; font-weight:600; line-height:14px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .shot i { display:block; font-style:normal; font-size:11px; line-height:14px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .more { flex:none; align-self:center; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600; background:rgba(var(--wl-rgb),.12); color:var(--primary-color); }
    .srcrow { padding-top:2px; }
    .shot .hd { position:absolute; left:4px; top:3px; min-width:16px; padding:0 3px; border-radius:999px; font-size:11px; line-height:16px; text-align:center; background:var(--primary-color); color:var(--text-primary-color,#fff); }
    .stage .also { border-top:1px solid var(--divider-color,rgba(127,127,127,.3)); }
    .shotwrap { position:relative; background:#000; }
    .shotwrap .nav { top:calc(50% - 18px); }
    .stage .media.spec { aspect-ratio:2/1; object-fit:fill; }
    .stage .player { display:block; width:100%; height:40px; background:var(--card-background-color,#fff); }
    .stage .note { padding:8px 12px; font-size:12px; line-height:16px; color:var(--secondary-text-color); background:var(--card-background-color,#fff); }
    .allrows { margin:6px 0 0; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; background:rgba(var(--wl-rgb),.12); color:var(--primary-color); }
    .empty { padding:10px 16px 16px; font-size:13px; color:var(--secondary-text-color); }
    .err { margin:4px 12px 12px; padding:10px 12px; border-radius:14px; font-size:13px; background:rgba(var(--rgb-error-color,219,68,55),.12); color:var(--primary-text-color); }
  `;

  class WildlifeCard extends HTMLElement {
    static getStubConfig() { return {}; }

    static getConfigElement() { return document.createElement('wildlife-card-editor'); }

    setConfig(config) {
      const c = config || {};
      const coy = c.coyote || {};
      /* discover: true asks for discovery over a species list that stays
         written in the YAML, so the list is there again when it is turned off. */
      const auto = c.species === 'auto' || c.discover === true;
      const custom = !auto && Array.isArray(c.species) && c.species.length > 0;
      const list = auto ? null : (custom ? c.species : DEFAULT_SPECIES);
      this._cfg = {
        title: c.title ?? 'Wildlife',
        icon: c.icon || 'mdi:binoculars',
        instance: c.instance_id || 'frigate',
        refresh: Math.max(60, +c.refresh || 300),
        sun: c.sun_shading !== false,
        indoor: (c.indoor_cameras || ['Attic', 'Crawlspace']).map((s) => s.toLowerCase()),
        ignore: new Set([...NON_WILDLIFE, ...(Array.isArray(c.ignore_labels) ? c.ignore_labels.map(normKey) : [])]),
        aliases: normMap(c.aliases),
        glyphs: normMap(c.glyphs),
        customSpecies: custom,
        clipLeadIn: c.clip_lead_in != null && c.clip_lead_in !== '' && Number.isFinite(+c.clip_lead_in) ? Math.max(0, +c.clip_lead_in) : 0,
        clipLeadOut: c.clip_lead_out != null && c.clip_lead_out !== '' && Number.isFinite(+c.clip_lead_out) ? Math.max(0, +c.clip_lead_out) : 0,
        frigate: { url: String(c.frigate_url || '').replace(/\/+$/, ''), addon: String(c.frigate_addon || '').trim() },
        birdnet: { url: String(c.birdnet_url || '').replace(/\/+$/, ''), addon: String(c.birdnet_addon || '').trim() },
        correlate: !!c.correlate,
        window: Math.min(3600, Math.max(5, Number.isFinite(+c.correlate_window) && +c.correlate_window > 0 ? +c.correlate_window : 120)),
        heardIgnore: new Set([...NON_WILDLIFE_SOUNDS, ...(Array.isArray(c.heard_ignore) ? c.heard_ignore : [])].map(normKey)),
        species: list ? list.map((s) => ({
          id: s.id, name: s.name || pretty(s.id), one: s.one || (s.name || pretty(s.id)).replace(/e?s$/, ''),
          labels: s.labels || [s.id], glyph: s.glyph || '🐾',
        })) : null,
        coyote: {
          enabled: coy.enabled !== false,
          cameras: coy.cameras || ['Driveway', 'Front'],
          start: hhmm(coy.start, 23), end: hhmm(coy.end, 5),
          win: +coy.person_window || 120,
        },
      };
      const saved = this._load();
      this._ui = {
        days: [7, 14, 30].includes(saved.days) ? saved.days : ([7, 14, 30].includes(+c.days) ? +c.days : 14),
        view: ['species', 'hour', 'camera'].includes(saved.view) ? saved.view : 'species',
        min: Number.isFinite(saved.min) ? saved.min : Math.min(99, Math.max(50, +c.min_score || 70)),
        sp: null, cell: null, tune: false, cur: null, clip: false, limit: 60,
        src: (saved.src === 'heard' || (saved.src === 'both' && c.correlate)) && (c.birdnet_url || c.birdnet_addon) ? saved.src : 'seen', allRows: false,
      };
      this._events = new Map();
      this._dynMeta = new Map();
      this._audio = new Set();
      this._people = new Map();
      this._loaded = false; this._error = null;
      this._heard = new Map();
      this._heardMeta = new Map();
      this._hLoaded = false; this._hError = null; this._hDenied = false; this._hCut = false;
      this._hNewest = 0; this._hSpan = 0; this._bn = null; this._pairCache = null;
      if (this._root) { this._build(); this._refresh(true); }
    }

    set hass(h) {
      const first = !this._hass;
      this._hass = h;
      if (first && this._root) this._refresh(true);
    }

    connectedCallback() {
      if (!this._root) { this._root = this.attachShadow({ mode: 'open' }); this._build(); }
      if (this._hass && !this._loaded) this._refresh(true);
      this._ro = this._ro || new ResizeObserver((r) => this.toggleAttribute('wide', r[0].contentRect.width >= 640));
      this._ro.observe(this);
      /* A refresh redraws the stage, which would cut off a recording or a clip
         part-way through, so one that is playing is left to finish. */
      this._timer = setInterval(() => { if (!document.hidden && !this._playing()) this._refresh(false); }, this._cfg.refresh * 1000);
    }
    disconnectedCallback() { clearInterval(this._timer); this._ro?.disconnect(); }
    getCardSize() { return 9; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }

    _load() { try { return JSON.parse(localStorage.getItem('wildlife-card') || '{}'); } catch (e) { return {}; } }
    _save() { try { localStorage.setItem('wildlife-card', JSON.stringify({ days: this._ui.days, view: this._ui.view, min: this._ui.min, src: this._ui.src })); } catch (e) { /* private mode */ } }

    _refresh(full) { this._fetch(full); if (this._bnOn()) this._fetchHeard(full); }
    _playing() { return [...(this._root?.querySelectorAll('video,audio') || [])].some((m) => !m.paused && !m.ended); }
    _isHeard() { return this._ui.src === 'heard' && this._heardAvail(); }
    _isBoth() { return this._ui.src === 'both' && this._cfg.correlate && this._heardAvail(); }

    /* ---------- seen and heard together ----------
       A sighting is paired with the calls of the same kind of animal, picked
       up by the microphone that carries its camera's name, from a little
       before it began to a little after it ended. The pairing is worked out
       once per load; which call stands for the pair is settled at view time,
       since the confidence filter may rule the best one out. */
    _pairs() {
      if (this._pairCache) return this._pairCache;
      const w = this._cfg.window; const by = new Map();
      for (const h of this._heard.values()) { const k = normKey(h.cam); if (!by.has(k)) by.set(k, []); by.get(k).push(h); }
      for (const l of by.values()) l.sort((a, b) => a.start - b.start);
      const seen = new Map(); const heard = new Map();
      for (const e of this._events.values()) {
        const l = by.get(normKey(e.cam)); if (!l) continue;
        const from = e.start - w; const to = (e.end || e.start) + w;
        let lo = 0; let hi = l.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (l[mid].start < from) lo = mid + 1; else hi = mid; }
        const c = [];
        for (let i = lo; i < l.length && l[i].start <= to; i++) { const rank = sameKind(e, l[i]); if (rank) c.push({ h: l[i], rank }); }
        if (!c.length) continue;
        c.sort((a, b) => b.rank - a.rank || b.h.score - a.h.score);
        seen.set(e.id, c.map((x) => x.h));
        for (const x of c) if (!heard.has(x.h.id)) heard.set(x.h.id, e);
      }
      this._pairCache = { seen, heard };
      return this._pairCache;
    }
    _match(e) {
      if (!this._cfg.correlate || !this._heardAvail() || e.heard) return null;
      const min = this._ui.min / 100;
      return this._pairs().seen.get(e.id)?.find((h) => h.score >= min) || null;
    }
    _matchSeen(h) {
      if (!this._cfg.correlate) return null;
      const e = this._pairs().heard.get(h.id);
      return e && e.score >= this._ui.min / 100 ? e : null;
    }
    _timing(e, h) {
      if (h.start < e.start) return `${span(e.start - h.start)} before`;
      if (e.end && h.start > e.end) return `${span(h.start - e.end)} after`;
      return 'while in view';
    }

    /* ---------- time helpers (HA time zone, not the browser's) ---------- */
    _fmt() {
      const tz = this._hass?.config?.time_zone;
      if (!this._f || this._f.tz !== tz) {
        const o = tz ? { timeZone: tz } : {};
        const loc = this._hass?.locale?.language || undefined;
        this._f = {
          tz,
          parts: new Intl.DateTimeFormat('en-CA', { ...o, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
          time: new Intl.DateTimeFormat(loc, { ...o, hour: 'numeric', minute: '2-digit' }),
          day: new Intl.DateTimeFormat(loc, { ...o, weekday: 'short', month: 'short', day: 'numeric' }),
          md: new Intl.DateTimeFormat(loc, { ...o, month: 'short', day: 'numeric' }),
          wd: new Intl.DateTimeFormat('en-US', { ...o, weekday: 'short' }),
        };
      }
      return this._f;
    }
    _local(ts) {
      const p = {};
      for (const x of this._fmt().parts.formatToParts(new Date(ts * 1000))) p[x.type] = x.value;
      return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
    }
    _days() {
      const out = []; const seen = new Set(); const now = Date.now() / 1000;
      for (let i = 0; out.length < this._ui.days && i < this._ui.days * 2 + 4; i++) {
        const ts = now - i * 43200; const d = this._local(ts).day;
        if (!seen.has(d)) { seen.add(d); out.unshift({ key: d, ts }); }
      }
      return out;
    }
    _ago(ts) {
      const s = Date.now() / 1000 - ts;
      if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
      if (s < 86400) return `${Math.round(s / 3600)}h ago`;
      return `${Math.round(s / 86400)}d ago`;
    }
    _when(ts) {
      const f = this._fmt(); const d = this._local(ts).day; const today = this._local(Date.now() / 1000).day;
      const yest = this._local(Date.now() / 1000 - 86400).day;
      const t = f.time.format(new Date(ts * 1000));
      return d === today ? `Today ${t}` : d === yest ? `Yesterday ${t}` : `${f.day.format(new Date(ts * 1000))}, ${t}`;
    }

    /* ---------- data ---------- */
    async _ws(msg) {
      const r = await this._hass.callWS({ type: 'frigate/events/get', instance_id: this._cfg.instance, ...msg });
      return typeof r === 'string' ? JSON.parse(r) : (r || []);
    }

    async _wsSummary() {
      const r = await this._hass.callWS({ type: 'frigate/events/summary', instance_id: this._cfg.instance });
      return typeof r === 'string' ? JSON.parse(r) : (r || []);
    }

    _isIgnoredEvent(label, sub) {
      const l = normKey(label); const s = normKey(sub);
      if (this._cfg.ignore.has(l)) return true;
      if (s && !EMPTY_SUB.has(s) && this._cfg.ignore.has(s)) return true;
      if (l === 'unknown' && (!s || EMPTY_SUB.has(s))) return true;
      return false;
    }

    async _fetch(full) {
      if (!this._hass || this._busy) return;
      this._busy = true;
      try {
        const now = Math.floor(Date.now() / 1000);
        const horizon = now - (this._ui.days + 1) * 86400;
        let after = horizon;
        if (!full && this._loaded && this._newest && this._span >= this._ui.days) after = Math.max(horizon, Math.floor(this._newest) - 7200);
        const coy = this._cfg.coyote;
        const summaryP = (!this._cfg.species || this._cfg.customSpecies) ? this._wsSummary().catch(() => null) : Promise.resolve(null);
        let wild; let dogs = []; let byLabel;
        if (this._cfg.species) {
          byLabel = new Map();
          for (const s of this._cfg.species) for (const l of s.labels) if (!byLabel.has(normKey(l))) byLabel.set(normKey(l), s.id);
          const wanted = new Set(this._cfg.species.flatMap((s) => s.labels));
          const dogsP = coy.enabled ? this._ws({ labels: ['dog'], cameras: coy.cameras, after, limit: 3000 }).catch(() => []) : Promise.resolve([]);
          const summary = await summaryP;
          if (Array.isArray(summary)) {
            for (const x of summary) {
              const sub = subOf(x);
              if (x.label && sub && (byLabel.has(normKey(sub)) || (coy.enabled && isDogLike(x.label, sub)))) wanted.add(x.label);
            }
          }
          [wild, dogs] = await Promise.all([this._ws({ labels: [...wanted], after, limit: 10000 }), dogsP]);
        } else {
          const summary = await summaryP;
          /* Dogs left out of discovery are left out of the request too, and the
             coyote inference would then have nothing to go on, so they are
             asked for on their own. */
          const dogsLeftOut = Array.isArray(summary) && summary.some((x) => isDogLike(x.label, subOf(x)) && this._isIgnoredEvent(x.label, subOf(x)));
          if (Array.isArray(summary)) {
            const labels = [...new Set(summary.filter((x) => x.label && !this._audio.has(normKey(x.label)) && !this._isIgnoredEvent(x.label, subOf(x))).map((x) => x.label))];
            wild = labels.length ? await this._ws({ labels, after, limit: 10000 }) : [];
          } else {
            wild = await this._ws({ after, limit: 10000 });
          }
          if (coy.enabled && (wild.length >= 10000 || dogsLeftOut) && coy.cameras?.length) {
            dogs = await this._ws({ labels: ['dog'], cameras: coy.cameras, after, limit: 3000 }).catch(() => []);
          }
        }
        if (coy.enabled) {
          const coyCams = new Set(coy.cameras || []);
          const seen = new Set(dogs.map((d) => d.id));
          for (const e of wild) {
            if (!e.false_positive && !seen.has(e.id) && coyCams.has(e.camera) && isDogLike(e.label, subOf(e))) {
              dogs.push(e); seen.add(e.id);
            }
          }
        }
        if (full || after === horizon) { this._events.clear(); this._dynMeta.clear(); }
        for (const e of wild) {
          if (byLabel) {
            const sub = subOf(e);
            this._put(e, (sub && byLabel.get(normKey(sub))) || byLabel.get(normKey(e.label)));
          } else {
            this._put(e);
          }
        }
        await this._coyotes(dogs);
        for (const [id, e] of this._events) if (e.start < horizon) this._events.delete(id);
        this._newest = Math.max(0, ...[...this._events.values()].map((e) => e.start));
        this._span = this._ui.days; this._loaded = true; this._error = null; this._pairCache = null;
      } catch (err) {
        this._error = err?.message || err?.code || String(err);
      }
      this._busy = false;
      this._render();
    }

    _put(e, species, extra) {
      /* Frigate files what it hears beside what it sees. Speech and smoke
         alarms are not wildlife, and no list of names could keep up with the
         audio labels a detector may report, so discovery goes by the event's
         own type. A label written into an explicit species list is still
         taken at its word. */
      if (!this._cfg.species && !species && e.data?.type === 'audio') { this._audio.add(normKey(e.label)); return; }
      if (e.false_positive) return;
      const sub = subOf(e);
      let sp = species;
      let spName = '';
      if (!this._cfg.species && !sp) {
        if (this._isIgnoredEvent(e.label, sub)) return;
        const subClean = sub && !EMPTY_SUB.has(normKey(sub)) ? sub : '';
        const raw = subClean || e.label;
        spName = formatLabel(raw, this._cfg.aliases);
        sp = slugId(spName);
        if (!this._dynMeta.has(sp)) this._dynMeta.set(sp, { id: sp, name: spName, one: spName, glyph: glyphFor(spName, raw, this._cfg.glyphs) });
      } else if (sp === 'coyote' && !this._cfg.species && !this._dynMeta.has('coyote')) {
        this._dynMeta.set('coyote', { id: 'coyote', name: 'Coyote', one: 'Coyote', glyph: '🐺' });
        spName = 'Coyote';
      }
      if (!sp) return;
      const lt = this._local(e.start_time);
      this._events.set(e.id, {
        id: e.id, sp, spName, label: e.label, sub: sub || '', cam: e.camera, zones: e.zones || [],
        start: e.start_time, end: e.end_time || null,
        score: e.data?.top_score ?? e.top_score ?? e.data?.score ?? 0,
        clip: !!e.has_clip, snap: !!e.has_snapshot, day: lt.day, hour: lt.hour, ...extra,
      });
    }

    /* A dog on the configured cameras, late at night, with no person nearby in
       time, is filed as a likely coyote; overlapping tracks make it a pack. */
    async _coyotes(dogs) {
      const c = this._cfg.coyote;
      const night = (h) => (c.start > c.end ? h >= c.start || h < c.end : h >= c.start && h < c.end);
      const cand = dogs.filter((d) => !d.false_positive)
        .filter((d) => { const dt = new Date(d.start_time * 1000); const p = this._local(d.start_time); return night(p.hour + dt.getMinutes() / 60); })
        .sort((a, b) => a.start_time - b.start_time);
      const groups = [];
      for (const d of cand) {
        const g = groups[groups.length - 1];
        if (g && d.start_time - g.end < 600) { g.items.push(d); g.end = Math.max(g.end, d.end_time || d.start_time); }
        else groups.push({ items: [d], start: d.start_time, end: d.end_time || d.start_time });
      }
      await Promise.all(groups.map(async (g) => {
        const key = `${Math.floor(g.start)}:${Math.floor(g.end)}`;
        if (!this._people.has(key)) {
          let people = null;
          try {
            people = await this._ws({ labels: ['person'], cameras: c.cameras, after: Math.floor(g.start - c.win - 600), before: Math.ceil(g.end + c.win), limit: 25 });
          } catch (e) { /* treat as unknown: do not infer */ }
          this._people.set(key, people && people.filter((p) => !p.false_positive).map((p) => [p.start_time, p.end_time || p.start_time + 30]));
        }
        const people = this._people.get(key);
        if (!people) return;
        for (const d of g.items) {
          const s = d.start_time; const e = d.end_time || s;
          if (people.some(([ps, pe]) => ps <= e + c.win && pe >= s - c.win)) continue;
          const pack = g.items.filter((o) => o.start_time <= e + 5 && (o.end_time || o.start_time) >= s - 5).length;
          this._put(d, 'coyote', { inferred: true, pack });
        }
      }));
    }

    /* ---------- what is heard: BirdNET-Go ----------
       BirdNET-Go keeps its own database of detections, with a recording and a
       spectrogram for each, and serves them from an API of its own. As an
       add-on that API sits behind ingress, on Home Assistant's own origin, so
       it is read with the same session cookie the add-on's panel uses and
       nothing is asked of the browser across origins. */
    _bnOn() { return !!(this._cfg.birdnet.url || this._cfg.birdnet.addon); }
    _heardAvail() { return this._bnOn() && !this._hDenied; }
    _bnNow() { return this._cfg.birdnet.url || this._bn?.base || ''; }
    _bnFresh() { return !!this._cfg.birdnet.url || (!!this._bn && Date.now() - this._bn.at < 300000); }

    /* An ingress session lapses when it is not renewed, so one older than a
       few minutes is replaced before it is relied on. */
    async _bnBase(force) {
      const b = this._cfg.birdnet;
      if (b.url) return b.url;
      if (!force && this._bnFresh()) return this._bn.base;
      if (!this._bnWait) {
        this._bnWait = (async () => {
          try {
            const info = await this._hass.callWS({ type: 'supervisor/ingress/info', slug: b.addon });
            const entry = /^(\/api\/hassio_ingress\/[^/]+)/.exec(info?.ingress_url || '');
            if (!entry) throw new Error(`the ${b.addon} add-on is not serving a page`);
            const sess = await this._hass.callWS({ type: 'supervisor/ingress/session', slug: b.addon });
            if (sess?.session) document.cookie = `ingress_session=${sess.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
            this._bn = { base: this._hass.hassUrl(entry[1]), at: Date.now() };
            return this._bn.base;
          } finally { this._bnWait = null; }
        })();
      }
      return this._bnWait;
    }

    async _bnJson(path, again = true) {
      const direct = !!this._cfg.birdnet.url;
      const base = await this._bnBase();
      let res;
      try {
        res = await fetch(`${base}${path}`, direct ? {} : { credentials: 'same-origin' });
      } catch (err) {
        if (direct && location.protocol === 'https:' && /^http:/i.test(base)) {
          throw new Error('this page is served over https and may not read an http address; use birdnet_addon, or put BirdNET-Go behind https');
        }
        throw new Error(`no answer from ${direct ? base : 'the add-on'}`);
      }
      if (res.status === 401 && again && !direct) { await this._bnBase(true); return this._bnJson(path, false); }
      if (res.status === 401) throw new Error('BirdNET-Go asked for a login; its private mode keeps the card out');
      if (!res.ok) throw new Error(`BirdNET-Go answered ${res.status}`);
      return res.json();
    }

    async _fetchHeard(full) {
      if (!this._hass || this._hBusy || this._hDenied) return;
      this._hBusy = true;
      try {
        const days = this._days();
        const first = days[0].key;
        const last = this._local(Date.now() / 1000 + 86400).day;   // through tomorrow, in case the two clocks disagree
        const topUp = !full && this._hLoaded && this._hNewest && this._hSpan >= this._ui.days;
        const from = topUp ? [first, this._local(this._hNewest - 7200).day].sort()[1] : first;
        const rows = []; let cut = false;
        for (let page = 0, offset = 0; ; page++) {
          if (page >= HEARD_PAGES) { cut = true; break; }
          const r = await this._bnJson(`/api/v2/detections?start_date=${from}&end_date=${last}&numResults=${HEARD_PAGE}&offset=${offset}`);
          const data = Array.isArray(r?.data) ? r.data : [];
          rows.push(...data);
          offset += data.length;
          if (data.length < HEARD_PAGE || offset >= (+r.total || 0)) break;
        }
        if (!topUp) { this._heard.clear(); this._heardMeta.clear(); this._hCut = cut; }
        for (const d of rows) this._putHeard(d);
        for (const [id, e] of this._heard) if (e.day < first) this._heard.delete(id);
        this._hNewest = Math.max(0, ...[...this._heard.values()].map((e) => e.start));
        this._hSpan = this._ui.days; this._hLoaded = true; this._hError = null; this._pairCache = null;
      } catch (err) {
        /* Ingress answers those allowed to open the add-on. For anyone else
           there is nothing to hear, which is not a fault: the switch is
           simply left out, as the Frigate button is. */
        if (err?.code === 'unauthorized') { this._hDenied = true; this._ui.src = 'seen'; }
        else this._hError = err?.message || err?.code || String(err);
      }
      this._hBusy = false;
      this._render();
    }

    _putHeard(d) {
      const name = String(d.commonName || d.scientificName || '').trim();
      const start = Date.parse(d.timestamp || `${d.date}T${d.time}`) / 1000;
      if (!name || !Number.isFinite(start) || d.id == null) return;
      if (d.verified === 'false_positive') return;
      const ig = this._cfg.heardIgnore;
      if (ig.has(normKey(name)) || (d.scientificName && ig.has(normKey(d.scientificName)))) return;
      const sp = slugId(name);
      if (!this._heardMeta.has(sp)) {
        /* Nearly everything BirdNET names is a bird, so a name no rule knows
           gets a bird rather than a pawprint. */
        const g = glyphFor(name, d.scientificName || '', this._cfg.glyphs);
        this._heardMeta.set(sp, { id: sp, name, one: name, sci: d.scientificName || '', glyph: g === '🐾' ? '🐦' : g });
      }
      const lt = this._local(start);
      this._heard.set(`h${d.id}`, {
        id: `h${d.id}`, hid: d.id, heard: true, sp, spName: name, sci: d.scientificName || '', label: name, sub: '',
        cam: d.source?.displayName || d.source?.id || 'Microphone', zones: [],
        start, end: null, score: +d.confidence || 0, clip: !!d.clipName, snap: false,
        fresh: !!d.isNewSpecies, day: lt.day, hour: lt.hour,
      });
    }

    /* Overridden by the test harness, which has no BirdNET-Go to ask. */
    _bnMedia(kind, e) {
      const base = this._bnNow();
      if (!base) return '';
      if (kind === 'species') return e.sci ? `${base}/api/v2/media/species-image?name=${encodeURIComponent(e.sci)}` : '';
      if (kind === 'spectrogram') return `${base}/api/v2/spectrogram/${e.hid}?size=${this.hasAttribute('wide') ? 'lg' : 'md'}`;
      if (kind === 'audio') return `${base}/api/v2/audio/${e.hid}`;
      return `${base}/ui/detections/${e.hid}`;
    }

    /* A coyote that is heard matters whichever side of the card is showing. */
    _heardCoyote() {
      if (!this._heardAvail()) return null;
      const now = Date.now() / 1000; const min = this._ui.min / 100; let hit = null;
      for (const e of this._heard.values()) {
        if (now - e.start < 172800 && e.score >= min && /coyote/i.test(e.spName) && (!hit || e.start > hit.start)) hit = e;
      }
      return hit;
    }

    _media(id, file) { return this._hass.hassUrl(`/api/frigate/${this._cfg.instance}/notifications/${id}/${file}`); }
    _thumb(e) { return this._media(e.id, 'thumbnail.jpg'); }
    _clipPaths(e) {
      const { clipLeadIn: before, clipLeadOut: after, instance } = this._cfg;
      if ((before <= 0 && after <= 0) || !e.cam || !e.start) return null;
      const start = Math.max(0, Math.floor(e.start - before));
      const end = Math.ceil((e.end || Date.now() / 1000) + after);
      const cam = encodeURIComponent(e.cam);
      return {
        hls: `/api/frigate/${instance}/vod/${cam}/start/${start}/end/${end}/index.m3u8`,
        mp4: `/api/frigate/${instance}/recording/${cam}/start/${start}/end/${end}`,
      };
    }
    async _signPath(path) {
      const r = await this._hass.callWS({ type: 'auth/sign_path', path, expires: 3600 });
      return r?.path ? this._hass.hassUrl(r.path) : '';
    }

    /* If the unauthenticated notification proxy is switched off, retry once
       through an HA signed path. */
    async _imgFallback(img) {
      if (img.dataset.retry) { img.remove(); return; }
      img.dataset.retry = '1';
      const kind = img.dataset.kind === 'snapshot' ? 'snapshot' : 'thumbnail';
      try {
        const r = await this._hass.callWS({ type: 'auth/sign_path', path: `/api/frigate/${this._cfg.instance}/${kind}/${img.dataset.id}`, expires: 3600 });
        img.src = this._hass.hassUrl(r.path);
      } catch (e) { img.remove(); }
    }

    _frigateOn() { return !!(this._cfg.frigate.url || this._cfg.frigate.addon); }

    /* Where Frigate serves its Explore view, resolved before the sighting is
       drawn rather than when its button is tapped. A plain link is the only
       thing the iOS Companion app opens reliably — a tab opened in script and
       navigated after an await never arrives — and a link needs its address up
       front. Behind ingress that address carries a token the Supervisor
       reissues whenever the add-on restarts, so it is re-read once it ages,
       and a session is minted exactly as Home Assistant's own add-on panel
       does. Returns null while the first lookup is still in flight. */
    _frigateBase() {
      const f = this._cfg.frigate;
      if (f.url) return f.url;
      const have = this._fb;
      if (have && Date.now() - have.at < 600000) return have.base;
      if (!this._fbWait) {
        this._fbWait = (async () => {
          let base = '', err = '';
          try {
            const info = await this._hass.callWS({ type: 'supervisor/ingress/info', slug: f.addon });
            const entry = /^(\/api\/hassio_ingress\/[^/]+)/.exec(info?.ingress_url || '');
            if (!entry) throw new Error(`the ${f.addon} add-on is not serving a page`);
            const s = await this._hass.callWS({ type: 'supervisor/ingress/session', slug: f.addon });
            if (s?.session) document.cookie = `ingress_session=${s.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
            base = this._hass.hassUrl(entry[1]);
          } catch (e) {
            /* Ingress belongs to the Supervisor, which answers administrators
               only. Anyone else (another member of the household, a visitor
               to a read-only public view) has no Frigate page to open. That
               is not a fault to report under every sighting: the button is
               simply left out. */
            err = e?.code === 'unauthorized' ? '' : `Frigate could not be reached: ${e?.message || e}.`;
          }
          this._fb = { base, err, at: Date.now() };
          this._fbWait = null;
          if (this._ui.cur) this._stage();
        })();
      }
      return have ? have.base : null;
    }

    /* The picture opens in a separate browser context, where none of Home
       Assistant's credentials travel: the frontend holds its token in script,
       not in a cookie, so a bare proxy URL arrives unauthenticated and can be
       refused. The link therefore carries a signed path, which satisfies the
       proxy whether or not it demands authentication, and settles the
       notification proxy's expiry option at the same time. */
    _signed(e) {
      const key = `${e.id}:${e.snap ? 'snapshot' : 'thumbnail'}`;
      if (this._sig?.key === key && Date.now() - this._sig.at < 1800000) return this._sig.url;
      if (this._sigWait !== key) {
        this._sigWait = key;
        (async () => {
          let url = '';
          try {
            const r = await this._hass.callWS({
              type: 'auth/sign_path',
              path: `/api/frigate/${this._cfg.instance}/notifications/${e.id}/${e.snap ? 'snapshot.jpg' : 'thumbnail.jpg'}`,
              expires: 3600,
            });
            url = this._hass.hassUrl(r.path);
          } catch (err) { /* the picture is on the stage either way */ }
          this._sig = { key, url, at: Date.now() };
          if (this._sigWait === key) this._sigWait = null;
          if (this._ui.cur === e.id) this._stage();
        })();
      }
      return '';
    }

    /* Ingress accepts nothing but a session cookie, and the Companion apps
       give a new-tab link to the system browser, which keeps its own cookies,
       so it arrives with no session. Sending the app's own view to the ingress
       address fares no better: the app answers by reloading the frontend.
       What does work there is Home Assistant's own add-on panel, so inside
       the apps the button goes to that, at the cost of landing on Frigate's
       front page rather than on the sighting. */
    _frigateHere() {
      if (this._cfg.frigate.url || !this._cfg.frigate.addon) return false;
      return /Home Assistant\//.test(navigator.userAgent) || !!window.externalApp || !!window.webkit?.messageHandlers?.externalBus;
    }

    _frigatePanel() {
      const slug = this._cfg.frigate.addon;
      const path = this._hass?.panels?.[slug] ? `/${slug}` : `/hassio/ingress/${slug}`;
      history.pushState(null, '', path);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false }, bubbles: true, composed: true }));
    }

    _frigateLink(id) {
      const base = this._frigateOn() ? this._frigateBase() : '';
      return base ? `${base}/explore?event_id=${encodeURIComponent(id)}` : '';
    }

    /* ---------- derived ---------- */
    _store() { return this._isHeard() ? this._heard : this._events; }
    _fixed() { return !this._isHeard() && !!this._cfg.species; }   // a species list written out, rather than discovered
    _word(n) { return this._isBoth() ? (n === 1 ? 'match' : 'matches') : `${this._isHeard() ? 'detection' : 'sighting'}${n === 1 ? '' : 's'}`; }
    _visible() {
      const min = this._ui.min / 100; const first = this._days()[0]?.key;
      const list = [...this._store().values()].filter((e) => e.score >= min && e.day >= first).sort((a, b) => b.start - a.start);
      return this._isBoth() ? list.filter((e) => this._match(e)) : list;
    }
    _hidden() {
      const min = this._ui.min / 100; const first = this._days()[0]?.key; let n = 0;
      for (const e of this._store().values()) if (e.day >= first && e.score < min) n++;
      return n;
    }
    /* Faint day/night shading behind the time rows, worked out from the sun's
       altitude at this house's latitude, so every column uses its own date and
       the nights visibly draw in across a 30-day view. Each two-hour cell is
       sampled every half hour and the colours blended, so a cell straddling
       sunrise comes out part night, part dawn. Dawn and dusk are identical as
       far as the sun is concerned, so they are told apart by whether it is on
       its way up. */
    _skyFor(day) {
      const { latitude: lat, longitude: lon } = this._hass?.config || {};
      if (!this._cfg.sun || typeof lat !== 'number' || typeof lon !== 'number') return null;
      const sky = SKY[this._darkTheme() ? 'dark' : 'light'];
      const key = `${lat},${lon},${this._darkTheme()}`;
      if (this._skyKey !== key) { this._skyKey = key; this._skyMemo = new Map(); }
      const seen = this._skyMemo.get(day.key);
      if (seen) return seen;

      const [Y, M, D] = day.key.split('-').map(Number);
      const offset = this._offsetMs(day.ts);
      const utcAt = (h) => Date.UTC(Y, M - 1, D) + h * 3600000 - offset;
      const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
      const colour = (h) => {
        const alt = altitude(utcAt(h), lat, lon);
        const twilight = altitude(utcAt(h + 0.25), lat, lon) > alt ? sky.dawn : sky.dusk;
        if (alt >= 6) return sky.day;
        if (alt >= -3) return mix(twilight, sky.day, (alt + 3) / 9);
        if (alt >= -12) return mix(sky.night, twilight, (alt + 12) / 9);
        return sky.night;
      };
      const rows = Array.from({ length: 12 }, (_, i) => {
        const blend = [0.25, 0.75, 1.25, 1.75].map((o) => colour(i * 2 + o))
          .reduce((acc, c) => acc.map((v, k) => v + c[k] / 4), [0, 0, 0]);
        return blend.map(Math.round).join(',');
      });
      this._skyMemo.set(day.key, rows);
      return rows;
    }

    /* Light text means a dark theme, whatever the operating system is set to. */
    _darkTheme() {
      const ink = getComputedStyle(this).getPropertyValue('--rgb-primary-text-color').trim() || '33,33,33';
      const parts = ink.split(',').map(Number);
      return parts.length === 3 && (parts[0] + parts[1] + parts[2]) / 3 > 128;
    }

    /* How far this time zone was from UTC on the day containing ts. */
    _offsetMs(ts) {
      const p = {};
      for (const x of this._fmt().parts.formatToParts(new Date(ts * 1000))) p[x.type] = x.value;
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ts * 1000;
    }

    _rowKey(e) { return this._ui.view === 'species' ? e.sp : this._ui.view === 'camera' ? e.cam : String(Math.floor(e.hour / 2)); }
    _filtered(all) {
      const { sp, cell } = this._ui;
      return all.filter((e) => (!sp || e.sp === sp) && (!cell || ((cell.day == null || e.day === cell.day) && (cell.row == null || this._rowKey(e) === cell.row))));
    }
    _species(all) {
      if (this._fixed()) return this._cfg.species;
      const stats = new Map();
      for (const e of all) {
        let st = stats.get(e.sp);
        if (!st) {
          const meta = this._spec(e.sp);
          st = { ...meta, count: 0, latest: 0 };
          stats.set(e.sp, st);
        }
        st.count++;
        if (e.start > st.latest) st.latest = e.start;
      }
      return [...stats.values()].sort((a, b) => {
        if ((a.id === 'animal') !== (b.id === 'animal')) return a.id === 'animal' ? 1 : -1;
        return b.count - a.count || b.latest - a.latest || a.name.localeCompare(b.name);
      });
    }
    _spec(id) {
      if (this._isHeard()) return this._heardMeta.get(id) || { id, name: pretty(id), one: pretty(id), sci: '', glyph: '🐦' };
      if (this._cfg.species) return this._cfg.species.find((s) => s.id === id) || { id, name: pretty(id), one: pretty(id), glyph: '🐾' };
      const name = formatLabel(id, this._cfg.aliases);
      return this._dynMeta.get(id) || { id, name, one: name, glyph: glyphFor(name, id, this._cfg.glyphs) };
    }
    _name(e) {
      if (e.heard) return e.spName;
      if (e.inferred) return e.pack > 1 ? `Likely coyotes ×${e.pack}` : 'Likely coyote';
      const spec = this._spec(e.sp);
      if (this._cfg.species) {
        const base = e.sp === 'other' || !spec.one ? pretty(e.label) : spec.one;
        return e.sub && !EMPTY_SUB.has(normKey(e.sub)) && normKey(e.sub) !== normKey(base) ? `${base} · ${pretty(e.sub)}` : base;
      }
      const subPretty = e.sub ? formatLabel(e.sub, this._cfg.aliases) : '';
      const base = spec.one || formatLabel(e.label, this._cfg.aliases);
      return subPretty && !EMPTY_SUB.has(normKey(e.sub)) && normKey(subPretty) !== normKey(base) ? `${base} · ${subPretty}` : base;
    }

    /* Headline: alerts first, otherwise which animals are running above or
       below their own usual rate (last 3 days against the rest of the range),
       plus the cat-rodent relationship and where/when rodents concentrate. */
    _headline(all) {
      const now = Date.now() / 1000; const G = '76,175,80'; const A = '255,193,7'; const R = '244,67,54';
      const D3 = 259200; const days = this._ui.days; const per3 = Math.max(1, (days - 3) / 3);
      const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
      const list = (a) => (a.length < 2 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]}, ${a[1]} and ${a.length - 2} more`);
      const fmtN = (x) => (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));
      const isRodent = (e) => e.sp === 'rodent' || /\b(rodent|rat|rats|mouse|mice|vole|gopher|woodrat|deermouse|muridae|cricetidae)\b/i.test(`${e.spName || ''} ${e.sub || ''} ${e.label || ''}`);
      const isCat = (e) => e.sp === 'cat' || e.sp === 'domestic_cat';
      const up = []; const down = []; const notes = [];
      for (const s of this._species(all)) {
        const l = all.filter((e) => e.sp === s.id); if (!l.length) continue;
        const rec = l.filter((e) => now - e.start < D3).length; const base = (l.length - rec) / per3;
        if (rec >= 3 && rec >= 1.8 * Math.max(base, 0.5)) { up.push(s); notes.push(`${s.name} ${rec} in 3 days (usual ${fmtN(base)})`); }
        else if (base >= 3 && rec <= 0.5 * base) { down.push(s); notes.push(`${s.name} down, ${rec} in 3 days (usual ${fmtN(base)})`); }
      }
      const rod = all.filter(isRodent); const cat = all.filter(isCat);
      if (rod.length >= 4 && cat.length >= 4) {
        const keys = this._days().map((d) => d.key); const cnt = (l) => keys.map((k) => l.filter((e) => e.day === k).length);
        const x = cnt(rod); const y = cnt(cat); const n = keys.length; const mx = x.reduce((a, v) => a + v, 0) / n; const my = y.reduce((a, v) => a + v, 0) / n;
        let sxy = 0; let sxx = 0; let syy = 0;
        for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
        const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
        if (r >= 0.45) notes.push(`Cats track rodents day to day (r ${r.toFixed(2)})`);
        else if (r <= -0.45) notes.push(`Cats and rodents on opposite days (r ${r.toFixed(2)})`);
        else notes.push(`No cat–rodent link (r ${r.toFixed(2)})`);
      }
      if (rod.length >= 3) {
        const mode = (f) => { const m = {}; for (const e of rod) m[f(e)] = (m[f(e)] || 0) + 1; const k = Object.keys(m).sort((p, q) => m[q] - m[p])[0]; return [k, m[k]]; };
        const [cam, cn] = mode((e) => e.cam); const [blk, bn] = mode((e) => Math.floor(e.hour / 2));
        const h = (i) => `${(i * 2) % 12 || 12}${i % 12 < 6 ? 'a' : 'p'}`;
        const bits = []; if (cn / rod.length >= 0.4) bits.push(pretty(cam)); if (bn / rod.length >= 0.3) bits.push(`${h(+blk)}–${h(+blk + 1)}`);
        if (bits.length) notes.push(`Rodents mostly ${bits.join(', ')}`);
      }
      const pack = all.find((e) => e.sp === 'coyote' && (e.pack || 1) > 1 && now - e.start < 172800);
      const inside = rod.find((e) => this._cfg.indoor.includes(String(e.cam).toLowerCase()) && now - e.start < D3);
      const coy = all.find((e) => e.sp === 'coyote' && now - e.start < 172800);
      if (coy && !pack) notes.unshift(`Likely coyote ${this._when(coy.start)}, ${pretty(coy.cam)}`);
      const howl = this._heardCoyote();
      if (howl) notes.unshift(`Coyote heard ${this._when(howl.start)}`);
      const rec = all.filter((e) => now - e.start < D3).length;
      const s = notes.length ? notes.join(' · ') : (all.length ? `${rec} sightings in 3 days, in line with the last ${days}` : 'No wildlife recorded in this period');
      if (pack) return { rgb: R, icon: 'mdi:alert-circle', p: `Likely coyote pack · ${pretty(pack.cam)} · ${this._when(pack.start)}`, s };
      if (inside) return { rgb: R, icon: 'mdi:alert-circle', p: `${this._cfg.species ? 'Rodent' : this._name(inside)} inside · ${pretty(inside.cam)} · ${this._when(inside.start)}`, s };
      const warn = coy || howl || up.some((x) => x.id === 'coyote' || isRodent({ sp: x.id, spName: x.name }));
      const names = (a) => { const n = a.map((x) => x.name); return this._cfg.species ? list([n[0], ...n.slice(1).map(low)]) : list(n); };
      let p = 'Wildlife activity steady';
      if (up.length && down.length) p = `${names(up)} up, ${this._cfg.species ? low(names(down)) : names(down)} down`;
      else if (up.length) p = `${names(up)} more active than usual`;
      else if (down.length) p = `${names(down)} quieter than usual`;
      return { rgb: warn ? A : G, icon: this._cfg.icon, p, s };
    }

    /* The same question asked of what is heard: which callers are above or
       below their own usual rate, what has turned up that was not here before,
       and when the place is loudest. A microphone hears far more than a camera
       sees, so "up" asks for a few more detections before it says anything,
       and none of it is said until there is a week of listening behind it. */
    _headlineHeard(all) {
      const now = Date.now() / 1000; const G = '76,175,80'; const A = '255,193,7';
      const D3 = 259200; const days = this._ui.days; const per3 = Math.max(1, (days - 3) / 3);
      const list = (a) => (a.length < 2 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]}, ${a[1]} and ${a.length - 2} more`);
      const fmtN = (x) => (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));
      const h = (i) => `${(i * 2) % 12 || 12}${i % 12 < 6 ? 'a' : 'p'}`;
      if (!all.length) return { rgb: G, icon: this._cfg.icon, p: 'Nothing heard in this period', s: this._hCut ? '' : 'BirdNET-Go has no detections at this confidence.' };
      const species = this._species(all);
      const oldest = Math.min(...[...this._heard.values()].map((e) => e.start));
      const settled = now - oldest >= 6 * 86400;
      const up = []; const down = []; const fresh = []; const notes = [];
      if (settled) {
        for (const s of species) {
          const l = all.filter((e) => e.sp === s.id);
          const rec = l.filter((e) => now - e.start < D3).length; const base = (l.length - rec) / per3;
          if (rec && rec === l.length) fresh.push(s);
          else if (rec >= 5 && rec >= 1.8 * Math.max(base, 0.5)) { up.push(s); notes.push(`${s.name} ${rec} in 3 days (usual ${fmtN(base)})`); }
          else if (base >= 5 && rec <= 0.5 * base) { down.push(s); notes.push(`${s.name} down, ${rec} in 3 days (usual ${fmtN(base)})`); }
        }
      }
      const blocks = {}; for (const e of all) blocks[Math.floor(e.hour / 2)] = (blocks[Math.floor(e.hour / 2)] || 0) + 1;
      const peak = Object.keys(blocks).sort((a, b) => blocks[b] - blocks[a])[0];
      if (all.length >= 10 && blocks[peak] / all.length >= 0.2) notes.push(`Busiest ${h(+peak)}–${h(+peak + 1)}`);
      const night = {}; for (const e of all) if (e.hour >= 22 || e.hour < 4) night[e.spName] = (night[e.spName] || 0) + 1;
      const owls = Object.keys(night).sort((a, b) => night[b] - night[a]).slice(0, 2);
      if (owls.length) notes.push(`After dark: ${owls.map((n) => `${n} ×${night[n]}`).join(', ')}`);
      const rec = all.filter((e) => now - e.start < D3);
      const lead = `${new Set(rec.map((e) => e.sp)).size} species, ${rec.length} detections in 3 days`;
      const s = [settled ? lead : `${lead} · listening since ${this._fmt().md.format(new Date(oldest * 1000))}`, ...notes.slice(0, 4)].join(' · ');
      const names = (a) => list(a.map((x) => x.name));
      const howl = this._heardCoyote();
      if (howl) return { rgb: A, icon: this._cfg.icon, p: `Coyote heard · ${pretty(howl.cam)} · ${this._when(howl.start)}`, s };
      let p = settled ? 'The usual voices, at the usual rate' : `${species.length} species heard so far`;
      if (fresh.length) p = `${names(fresh)} heard for the first time in ${days} days`;
      else if (up.length && down.length) p = `${names(up)} up, ${names(down)} down`;
      else if (up.length) p = `${names(up)} calling more than usual`;
      else if (down.length) p = `${names(down)} quieter than usual`;
      return { rgb: G, icon: this._cfg.icon, p, s };
    }

    _headlineBoth(all) {
      const G = '76,175,80'; const w = span(this._cfg.window);
      if (!all.length) {
        return { rgb: G, icon: this._cfg.icon, p: 'Nothing seen and heard together in this period',
          s: `A match is a call of the same kind of animal within ${w} of a sighting, from a microphone that has its camera's name.` };
      }
      const n = {}; const cams = new Set();
      for (const e of all) { const h = this._match(e); n[h.spName] = (n[h.spName] || 0) + 1; cams.add(e.cam); }
      const top = Object.keys(n).sort((a, b) => n[b] - n[a]);
      const s = [top.slice(0, 3).map((k) => `${k} ×${n[k]}`).join(', ') + (top.length > 3 ? ` and ${top.length - 3} more` : ''),
        `${cams.size} location${cams.size === 1 ? '' : 's'}`, `calls within ${w} of the sighting`].join(' · ');
      return { rgb: G, icon: this._cfg.icon, p: `${all.length} ${all.length === 1 ? 'sighting was' : 'sightings were'} also heard`, s };
    }

    /* ---------- rendering ---------- */
    _build() {
      this._root.innerHTML = `<style>${CSS}</style><ha-card>
        <div class="head"></div><div class="tunewrap"></div><div class="hlwrap"></div>
        <div class="srcwrap"></div><div class="tiles"></div><div class="chart"></div><div class="browser"></div></ha-card>`;
      this._$ = (s) => this._root.querySelector(s);
      this._root.addEventListener('click', (ev) => this._click(ev));
      this._root.addEventListener('input', (ev) => {
        if (ev.target.name !== 'min') return;
        this._ui.min = +ev.target.value; this._ui.cur = null; this._save();
        this._$('.tune output').textContent = `${this._ui.min}%`;
        this._render(true);
      });
      this._root.addEventListener('error', (ev) => {
        if (ev.target.tagName === 'IMG' && ev.target.dataset.id) this._imgFallback(ev.target);
        if (ev.target.dataset?.heard != null) this._heardFallback(ev.target);
        if (ev.target.tagName === 'VIDEO' && !ev.target._hls) this._attachMedia(ev.target);
      }, true);
      this._root.addEventListener('pointermove', (ev) => this._tip(ev));
      this._root.addEventListener('pointerleave', () => this._tip(null));
      this._render();
    }

    _render(keepTune) {
      if (!this._root) return;
      const u = this._ui;
      if (this._frigateOn() && !this._frigateHere()) this._frigateBase();   // warm, so the link is ready before a sighting is opened
      const loaded = this._isHeard() ? this._hLoaded : this._isBoth() ? this._loaded && this._hLoaded : this._loaded;
      const all = loaded ? this._visible() : [];
      this._all = all;
      const seg = (name, cur, opts) => `<span class="seg" role="group">${opts.map(([v, l]) => `<button data-act="${name}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</span>`;
      this._$('.head').innerHTML = `<div class="title">${esc(this._cfg.title)}</div>
        ${seg('days', u.days, [[7, '7d'], [14, '14d'], [30, '30d']])}
        <button class="iconbtn" data-act="tune" aria-expanded="${u.tune}" title="Filters" aria-label="Filters">${svg('tune')}${u.min > 70 ? '<span class="dot"></span>' : ''}</button>`;
      if (!keepTune) {
        this._$('.tunewrap').innerHTML = u.tune ? `<div class="panel tune">
          <label><span>Minimum confidence</span><output>${u.min}%</output></label>
          <input type="range" name="min" min="50" max="99" step="1" value="${u.min}" aria-label="Minimum confidence">
          <small class="hid"></small></div>` : '';
      }
      const hid = this._$('.hid'); if (hid) { const n = this._hidden(); hid.textContent = n ? `Hiding ${n} lower-confidence ${this._word(n)} from every view.` : 'Nothing is hidden at this setting.'; }
      const heard = this._isHeard();
      const blank = () => { for (const k of ['.tiles', '.chart', '.browser']) this._$(k).innerHTML = ''; };
      /* The switch stays put whatever the state of either side, so a failure
         on one never strands the viewer on it. */
      const both = this._isBoth();
      this._$('.srcwrap').innerHTML = this._heardAvail() ? `<div class="sub srcrow"><h3>${heard ? 'Heard by the microphones' : both ? 'Seen and heard together' : 'Seen by the cameras'}</h3>
        ${seg('src', heard ? 'heard' : both ? 'both' : 'seen', [['seen', 'Seen'], ['heard', 'Heard'], ...(this._cfg.correlate ? [['both', 'Both']] : [])])}</div>` : '';
      const hErr = (heard || both) && this._hError;
      const err = hErr || (!heard && this._error);
      if (err) {
        this._$('.hlwrap').innerHTML = hErr
          ? `<div class="err">Could not read BirdNET-Go (${esc(err)}). Check that it is running and that <b>${this._cfg.birdnet.url ? 'birdnet_url' : 'birdnet_addon'}</b> is right.</div>`
          : `<div class="err">Could not read Frigate events (${esc(err)}). Check that the Frigate integration is loaded and that <b>instance_id</b> matches its MQTT client id.</div>`;
        /* What was read before the failure is still worth showing under it. */
        if (loaded) { this._tiles(all); this._chart(all); this._browser(all); } else blank();
        return;
      }
      if (!loaded) { this._$('.hlwrap').innerHTML = `<div class="empty">Loading ${heard || (both && this._loaded) ? 'what was heard' : 'sightings'}…</div>`; blank(); return; }
      const h = heard ? this._headlineHeard(all) : both ? this._headlineBoth(all) : this._headline(all);
      this._$('.hlwrap').innerHTML = `<div class="panel hl" style="--hl:${h.rgb}"><div class="shape"><ha-icon icon="${h.icon}"></ha-icon></div>
        <div><div class="p">${esc(h.p)}</div><div class="s">${esc(h.s)}</div></div></div>`;
      this._tiles(all); this._chart(all); this._browser(all);
    }

    _tiles(all) {
      const heard = this._isHeard();
      let species = this._species(all);
      if (heard && species.length > HEARD_TILES) {
        /* A garden can hold forty voices; the tiles take the commonest, and
           the grid below lists the rest. A selected one always keeps a tile. */
        const top = species.slice(0, HEARD_TILES);
        const sel = this._ui.sp && !top.some((s) => s.id === this._ui.sp) && species.find((s) => s.id === this._ui.sp);
        if (sel) top[top.length - 1] = sel;
        species = top;
      }
      const html = species.map((s) => {
        const list = all.filter((e) => e.sp === s.id);
        const best = heard ? list[0] : list.slice(0, 8).sort((a, b) => b.score - a.score)[0];
        const pack = s.id === 'coyote' && list.some((e) => (e.pack || 1) > 1);
        const fresh = heard && list.some((e) => e.fresh);
        const src = best && (heard ? this._bnMedia('species', best) : this._thumb(best));
        return `<button class="tile${list.length ? '' : ' none'}" data-act="sp" data-v="${esc(s.id)}" aria-pressed="${this._ui.sp === s.id}" title="${esc(s.sci ? `${s.name} (${s.sci})` : s.name)}">
          <div class="pic"><span>${s.glyph}</span>${src ? `<img loading="lazy" alt="" ${heard ? 'data-heard' : `data-id="${esc(best.id)}"`} src="${esc(src)}">` : ''}
          ${list.length ? `<span class="n">${list.length}</span>` : ''}${pack ? '<span class="flag">pack</span>' : ''}${fresh ? '<span class="flag">new</span>' : ''}</div>
          <b>${esc(s.name)}</b><i>${list.length ? this._ago(list[0].start) : `none in ${this._ui.days}d`}</i></button>`;
      }).join('');
      this._$('.tiles').innerHTML = html;
    }

    _chart(all) {
      const u = this._ui; const days = this._days(); const f = this._fmt();
      const src = u.view === 'species' ? all : all.filter((e) => !u.sp || e.sp === u.sp);
      let rows;
      const heard = this._isHeard(); let unlisted = 0;
      if (u.view === 'species') {
        let species = this._species(all);
        if (heard && !u.allRows && species.length > HEARD_ROWS) {
          unlisted = species.length - HEARD_ROWS;
          const top = species.slice(0, HEARD_ROWS);
          const sel = u.sp && !top.some((s) => s.id === u.sp) && species.find((s) => s.id === u.sp);
          if (sel) top[top.length - 1] = sel;
          species = top;
        }
        rows = species.map((s) => ({ key: s.id, label: `${s.glyph} ${s.name}`, on: u.sp === s.id }));
      }
      else if (u.view === 'hour') {
        rows = Array.from({ length: 12 }, (_, i) => {
          const from = `${(i * 2) % 12 || 12}${i < 6 ? 'a' : 'p'}`;
          const to = `${((i + 1) * 2) % 12 || 12}${i + 1 < 6 || i === 11 ? 'a' : 'p'}`;
          return { key: String(i), label: `${from}–${to}`, html: `<span>${from}</span><em>–</em><span>${to}</span>` };
        });
      }
      else {
        const m = {}; for (const e of src) m[e.cam] = (m[e.cam] || 0) + 1;
        rows = Object.keys(m).sort((a, b) => m[b] - m[a]).map((k) => ({ key: k, label: pretty(k) }));
      }
      // One palette per day; the strip beside the labels follows the latest.
      const sky = u.view === 'hour' ? days.map((d) => this._skyFor(d)) : [];
      const today = sky.length ? sky[sky.length - 1] : null;
      const count = {};
      for (const e of src) { const k = `${this._rowKey(e)}|${e.day}`; count[k] = (count[k] || 0) + 1; }
      const shared = u.view === 'species' ? null : Math.max(3, ...Object.values(count));
      const body = rows.map((r) => {
        let tot = 0; let max = 3;
        for (const d of days) { const v = count[`${r.key}|${d.key}`] || 0; tot += v; if (v > max) max = v; }
        const scale = shared || max;
        const cells = days.map((d, di) => {
          const v = count[`${r.key}|${d.key}`] || 0;
          const wk = f.wd.format(new Date(d.ts * 1000)) === 'Mon' ? ' wk' : '';
          const sel = u.cell && u.cell.row === r.key && u.cell.day === d.key ? ' sel' : '';
          const a = v ? (0.3 + 0.7 * Math.sqrt(Math.min(1, v / scale))).toFixed(2) : 0;
          const style = [v ? `--a:${a}` : '', sky[di] ? `--sky:${sky[di][+r.key]}` : ''].filter(Boolean).join(';');
          return `<button class="c${wk}${sel}" data-act="cell" data-row="${esc(r.key)}" data-day="${d.key}" data-n="${v}" data-lab="${esc(r.label)}"${v ? ' data-v' : ''}${style ? ` style="${style}"` : ''} aria-label="${esc(r.label)}, ${esc(f.day.format(new Date(d.ts * 1000)))}: ${v}"></button>`;
        }).join('');
        return `<div class="row"${today ? ` style="--sky:${today[+r.key]}"` : ''}><button class="lab${r.on ? ' on' : ''}" data-act="row" data-row="${esc(r.key)}">${r.html || esc(r.label)}</button><div class="cells">${cells}</div><div class="tot">${tot || ''}</div></div>`;
      }).join('');
      const n = days.length; const step = n <= 7 ? 1 : n <= 14 ? 3 : 7; let ticks = '';
      for (let i = n - 1 - step; i >= 0; i -= step) ticks += `<span style="left:${((i + 0.5) / n) * 100}%">${esc(f.md.format(new Date(days[i].ts * 1000)))}</span>`;
      ticks += '<span class="end" style="left:100%">Today</span>';
      const sp = u.sp ? this._spec(u.sp).name : heard ? 'Everything heard' : 'All wildlife';
      const title = u.view === 'species' ? (heard ? 'Detections per day' : this._isBoth() ? 'Seen and heard per day' : 'Sightings per day') : u.view === 'hour' ? `${sp} · time of day` : `${sp} · by ${heard ? 'microphone' : 'camera'}`;
      const rest = unlisted ? `<button class="allrows" data-act="allrows">Show ${unlisted} more species</button>` : '';
      const seg = [['species', 'Species'], ['hour', 'Time'], ['camera', 'Location']].map(([v, l]) => `<button data-act="view" data-v="${v}" aria-pressed="${u.view === v}">${l}</button>`).join('');
      this._$('.chart').innerHTML = `<div class="sub"><h3>${esc(title)}</h3><span class="seg" role="group">${seg}</span></div>
        <div class="grid${today ? ' sky' : ''}${u.view === 'hour' ? ' hours' : ''}" style="--lab:${u.view === 'camera' ? '104px' : u.view === 'hour' ? '66px' : this._fixed() ? '92px' : 'clamp(96px, 28%, 144px)'};--ch:${u.view === 'hour' ? '13px' : '18px'}">
          ${rows.length ? `<div class="rows">${body}</div><div class="axis"><i></i><div>${ticks}</div><i></i></div>${rest}` : '<div class="empty" style="padding-left:0">Nothing to chart for this selection.</div>'}
          <div class="tip" hidden></div></div>
        <div class="key"><span>fewer</span><u style="--a:.3"></u><u style="--a:.55"></u><u style="--a:.75"></u><u style="--a:1"></u><span>more${u.view === 'species' ? ' · each row on its own scale' : ''}</span></div>`;
    }

    _browser(all) {
      const u = this._ui; const f = this._fmt();
      const list = this._filtered(all); this._list = list;
      const chips = [];
      if (u.sp) chips.push(['sp', this._spec(u.sp).name]);
      if (u.cell) {
        const bits = [];
        if (u.cell.row != null && u.view !== 'species') bits.push(u.view === 'camera' ? pretty(u.cell.row) : `${(u.cell.row * 2) % 12 || 12}${u.cell.row < 6 ? 'am' : 'pm'} block`);
        if (u.cell.day) bits.push(f.day.format(new Date(`${u.cell.day}T12:00:00`)));
        if (bits.length) chips.push(['cellx', bits.join(' · ')]);
      }
      const chipHtml = chips.length ? `<div class="chips">${chips.map(([a, l]) => `<button class="chip" data-act="${a}" data-v="${esc(u.sp || '')}">${esc(l)}${svg('close')}</button>`).join('')}</div>` : '';
      const heard = this._isHeard();
      const shots = list.slice(0, u.limit).map((e, i) => {
        const g = this._spec(e.sp).glyph;
        const src = heard ? this._bnMedia('species', e) : this._thumb(e);
        const m = heard ? null : this._match(e);
        const under = heard ? (u.sp ? pretty(e.cam) : e.spName) : this._isBoth() ? `${m.spName} · ${pretty(e.cam)}` : (e.inferred ? `${pretty(e.cam)} · likely coyote` : pretty(e.cam));
        return `<button class="shot" data-act="open" data-i="${i}" aria-current="${u.cur === e.id}">
        <div class="pic"><span>${g}</span>${src ? `<img loading="lazy" alt="" ${heard ? 'data-heard' : `data-id="${esc(e.id)}"`} src="${esc(src)}">` : ''}
        <span class="sc">${Math.round(e.score * 100)}%</span>${u.sp ? '' : `<span class="gl">${g}</span>`}${m ? `<span class="hd" title="Also heard: ${esc(m.spName)}">♪</span>` : ''}</div>
        <b>${esc(this._when(e.start))}</b><i>${esc(under)}</i></button>`;
      }).join('');
      const more = list.length > u.limit ? `<button class="more" data-act="more">+${list.length - u.limit} more</button>` : '';
      const cut = heard && this._hCut ? ` · newest ${HEARD_PAGE * HEARD_PAGES} read` : '';
      this._$('.browser').innerHTML = `<div class="sub"><h3>${list.length} ${this._word(list.length)}${chips.length ? '' : ` · last ${u.days} days`}${cut}</h3></div>${chipHtml}
        <div class="stagewrap"></div>
        ${list.length ? `<div class="film">${shots}${more}</div>` : `<div class="empty">No ${this._word(2)} match. Try a longer range or a lower confidence filter.</div>`}`;
      this._stage();
    }

    _stage() {
      const wrap = this._$('.stagewrap'); if (!wrap) return;
      wrap.querySelector('video')?._hls?.destroy();
      const list = this._list || []; const i = list.findIndex((e) => e.id === this._ui.cur);
      if (i < 0) { wrap.innerHTML = ''; return; }
      const e = list[i];
      if (e.heard) { this._stageHeard(wrap, list, i); return; }
      const still = e.snap ? this._media(e.id, 'snapshot.jpg') : this._thumb(e);
      const frig = this._frigateHere() ? '' : this._frigateLink(e.id);
      const away = this._signed(e);
      const pad = this._ui.clip && e.clip ? this._clipPaths(e) : null;
      const media = this._ui.clip && e.clip
        ? `<video class="media" controls playsinline muted preload="metadata" poster="${esc(still)}"${pad ? ` data-vod-hls="${esc(pad.hls)}" data-vod-mp4="${esc(pad.mp4)}"` : ''} data-hls="${esc(this._media(e.id, 'index.m3u8'))}" data-mp4="${esc(this._media(e.id, 'clip.mp4'))}"></video>`
        : `<img class="media" alt="${esc(this._name(e))}" data-id="${esc(e.id)}" data-kind="${e.snap ? 'snapshot' : 'thumbnail'}" src="${esc(still)}">`;
      /* The call that goes with this sighting, when there is one. Its recording
         comes through the same ingress session as the rest of what is heard. */
      const m = this._match(e); let also = '';
      if (m) {
        const fresh = this._bnFresh();
        if (!fresh && this._restaged !== e.id) {
          this._restaged = e.id;
          this._bnBase(true).then(() => { if (this._ui.cur === e.id) this._stage(); }).catch(() => {});
        }
        also = `<div class="also">${fresh && m.clip ? `<audio class="player" controls preload="none" data-heard src="${esc(this._bnMedia('audio', m))}"></audio>` : ''}
          <div class="note">Heard ${esc(this._timing(e, m))}: <b>${esc(m.spName)}</b> · ${Math.round(m.score * 100)}% · ${esc(pretty(m.cam))} microphone${m.clip ? '' : ' · recording no longer kept'}</div></div>`;
      }
      const dur = e.end ? Math.max(1, Math.round(e.end - e.start)) : null;
      const meta = [pretty(e.cam), `${Math.round(e.score * 100)}%${e.inferred ? ' as dog' : ''}`, dur ? (dur >= 90 ? `${Math.round(dur / 60)} min` : `${dur}s`) : 'in progress', ...e.zones.slice(0, 2).map(pretty)];
      wrap.innerHTML = `<div class="stage">${media}
        <button class="nav l" data-act="step" data-v="-1" aria-label="Newer" ${i === 0 ? 'disabled' : ''}>${svg('left')}</button>
        <button class="nav r" data-act="step" data-v="1" aria-label="Older" ${i >= list.length - 1 ? 'disabled' : ''}>${svg('right')}</button>
        <button class="x" data-act="close" aria-label="Close">${svg('close')}</button>
        <span class="pos">${i + 1} / ${list.length}</span>${also}
        <div class="cap"><div class="t"><div class="p">${esc(this._name(e))}</div><div class="s">${esc([this._when(e.start), ...meta].join(' · '))}</div></div>
          ${e.clip ? (this._ui.clip ? `<button class="pill" data-act="still">${svg('image')}Photo</button>` : `<button class="pill" data-act="clip">${svg('play')}Video</button>`) : ''}
          ${this._frigateHere()
            ? `<button class="pill ghost" data-act="frigate" title="Open Frigate" aria-label="Open Frigate">${svg('find')}</button>`
            : frig ? `<a class="pill ghost" target="_blank" rel="noopener" href="${esc(frig)}" title="Open this sighting in Frigate" aria-label="Open this sighting in Frigate">${svg('find')}</a>` : ''}
          ${away ? `<a class="pill ghost" target="_blank" rel="noopener" href="${esc(away)}" title="Open the picture in a new tab" aria-label="Open the picture in a new tab">${svg('open')}</a>` : ''}
        </div>${this._fb?.err ? `<div class="err">${esc(this._fb.err)}</div>` : ''}</div>`;
      const video = wrap.querySelector('video');
      if (video) this._attachMedia(video);
      this._root.querySelectorAll('.shot').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === i)));
      this._root.querySelector('.shot[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    /* A detection that was heard has no picture of the animal, only of the
       sound: its spectrogram, with the recording under it. Both come through
       ingress on a session that lapses, so a stale one is renewed first. */
    _stageHeard(wrap, list, i) {
      const e = list[i];
      if (!this._bnFresh()) {
        wrap.innerHTML = '<div class="stage"><div class="note">Opening the recording…</div></div>';
        this._bnBase(true).then(() => { if (this._ui.cur === e.id) this._stage(); })
          .catch(() => { wrap.innerHTML = '<div class="stage"><div class="note">BirdNET-Go could not be reached for this recording.</div></div>'; });
        return;
      }
      const sci = e.sci && normKey(e.sci) !== normKey(e.spName) ? e.sci : '';
      const seenToo = this._matchSeen(e);
      const meta = [this._when(e.start), pretty(e.cam), `${Math.round(e.score * 100)}%`, ...(e.fresh ? ['new here'] : []), ...(seenToo ? ['seen on camera too'] : [])];
      /* Inside the Companion apps a new tab leaves with no ingress session,
         as it does for Frigate, so the link is only offered where it works. */
      const away = this._cfg.birdnet.addon && !this._cfg.birdnet.url && (/Home Assistant\//.test(navigator.userAgent) || !!window.externalApp || !!window.webkit?.messageHandlers?.externalBus)
        ? '' : this._bnMedia('page', e);
      wrap.innerHTML = `<div class="stage heard"><div class="shotwrap">
          <img class="media spec" alt="Spectrogram of ${esc(e.spName)}" data-heard src="${esc(this._bnMedia('spectrogram', e))}">
          <button class="nav l" data-act="step" data-v="-1" aria-label="Newer" ${i === 0 ? 'disabled' : ''}>${svg('left')}</button>
          <button class="nav r" data-act="step" data-v="1" aria-label="Older" ${i >= list.length - 1 ? 'disabled' : ''}>${svg('right')}</button>
          <button class="x" data-act="close" aria-label="Close">${svg('close')}</button>
          <span class="pos">${i + 1} / ${list.length}</span></div>
        ${e.clip ? `<audio class="player" controls preload="none" data-heard src="${esc(this._bnMedia('audio', e))}"></audio>` : '<div class="note">BirdNET-Go no longer keeps this recording.</div>'}
        <div class="cap"><div class="t"><div class="p">${esc(e.spName)}${sci ? ` <i style="font-weight:400;opacity:.7">${esc(sci)}</i>` : ''}</div><div class="s">${esc(meta.join(' · '))}</div></div>
          ${away ? `<a class="pill ghost" target="_blank" rel="noopener" href="${esc(away)}" title="Open this detection in BirdNET-Go" aria-label="Open this detection in BirdNET-Go">${svg('open')}</a>` : ''}
        </div></div>`;
      this._root.querySelectorAll('.shot').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === i)));
      this._root.querySelector('.shot[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    /* A species with no picture keeps its glyph; a spectrogram that cannot be
       drawn, or a recording that will not play, says so in its place. */
    _heardFallback(el) {
      if (el.tagName === 'AUDIO') { el.insertAdjacentHTML('afterend', '<div class="note">This recording could not be played here.</div>'); el.remove(); return; }
      if (el.classList.contains('spec')) { el.insertAdjacentHTML('afterend', '<div class="fail"><p>No spectrogram for this detection.</p><small>BirdNET-Go draws one only while it still has the recording.</small></div>'); }
      el.remove();
    }

    /* Play order: padded VOD via hls.js (with signed segment auth), event HLS
       via hls.js, browser native HLS, padded recording MP4, then event MP4.
       Home Assistant's Frigate integration serves padded clips via /vod and
       /recording; falling back to /notifications ensures old or unpadded events
       still play even when continuous/motion retention has expired. */
    async _attachHls(v, url, failFlag, sig) {
      const Hls = await this._hlsLib();
      if (!Hls || !Hls.isSupported() || !v.isConnected) return false;
      const hls = new Hls({
        enableWorker: false,
        ...(sig ? {
          xhrSetup(xhr, reqUrl) {
            if (!reqUrl.includes('authSig=')) {
              xhr.open('GET', `${reqUrl}${reqUrl.includes('?') ? '&' : '?'}authSig=${encodeURIComponent(sig)}`, true);
            }
          },
        } : {}),
      });
      v._hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        hls.destroy(); v._hls = null; v.dataset[failFlag] = '1'; this._attachMedia(v);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.loadSource(url);
      hls.attachMedia(v);
      return true;
    }

    async _attachMedia(v) {
      const play = () => v.play().catch(() => {});
      if (v.dataset.vodHls && !v.dataset.noVodLib) {
        try {
          const signed = await this._signPath(v.dataset.vodHls);
          if (!v.isConnected) return;
          const sig = signed ? new URL(signed, location.href).searchParams.get('authSig') : '';
          if (signed && await this._attachHls(v, signed, 'noVodLib', sig)) return;
        } catch (err) { /* fall through to event HLS */ }
        v.dataset.noVodLib = '1';
      }
      if (v.dataset.hls && !v.dataset.noLib) {
        if (await this._attachHls(v, v.dataset.hls, 'noLib')) return;
      }
      if (v.dataset.hls && !v.dataset.noNative && v.canPlayType('application/vnd.apple.mpegurl')) {
        v.dataset.noNative = '1';
        v.src = v.dataset.hls; v.load(); play();
        return;
      }
      if (v.dataset.vodMp4 && !v.dataset.noVodMp4) {
        v.dataset.noVodMp4 = '1';
        try {
          const signed = await this._signPath(v.dataset.vodMp4);
          if (!v.isConnected) return;
          if (signed) { v.src = signed; v.load(); play(); return; }
        } catch (err) { /* fall through to event MP4 */ }
      }
      if (v.dataset.mp4) {
        const url = v.dataset.mp4; delete v.dataset.mp4;
        v.src = url; v.load(); play();
        return;
      }
      this._clipNotice(v);
    }

    /* Bundled, but only fetched the first time a clip is opened. */
    async _hlsLib() {
      if (this._hlsMod === undefined) {
        try { this._hlsMod = (await import('hls.js/dist/hls.light.mjs')).default; } catch (err) { this._hlsMod = null; }
      }
      return this._hlsMod;
    }

    _clipNotice(v) {
      const why = {
        1: ['Loading the clip was interrupted.', 'It may just need another try.'],
        2: ['The clip could not be fetched.', 'A network or proxy problem rather than the recording itself.'],
        3: ['This browser could not decode the clip.', 'The recording plays elsewhere but not here — usually its video or audio codec.'],
        4: ['This browser would not play the clip.', 'Either the recording\u2019s format or the way the server sent it was refused here. Opening the file usually says more.'],
      }[v.error?.code] || ['The clip did not play.', ''];
      const url = v.getAttribute('src');   // the file by now, HLS having been tried first
      v.insertAdjacentHTML('afterend', `<div class="fail"><p>${esc(why[0])}</p><small>${esc(why[1])}</small>
        <a class="pill" target="_blank" rel="noopener" href="${esc(url)}">${svg('open')}Open the file</a></div>`);
      v.remove();
    }

    _tip(ev) {
      const tip = this._$('.tip'); if (!tip) return;
      const c = ev?.target?.closest?.('.c');
      if (!c || ev.pointerType === 'touch') { tip.hidden = true; return; }
      const g = this._$('.grid').getBoundingClientRect(); const r = c.getBoundingClientRect();
      tip.innerHTML = `<b>${esc(c.dataset.n)}</b> · ${esc(c.dataset.lab)} · ${esc(this._fmt().day.format(new Date(`${c.dataset.day}T12:00:00`)))}`;
      tip.hidden = false;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(g.width - half - 4, Math.max(half + 4, r.left - g.left + r.width / 2))}px`;
      tip.style.top = `${r.top - g.top - 6}px`;
    }

    _click(ev) {
      const b = ev.target.closest('[data-act]'); if (!b || !this._root.contains(b)) return;
      const u = this._ui; const v = b.dataset.v; let refetch = false; let stageOnly = false;
      switch (b.dataset.act) {
        case 'days': u.days = +v; u.cell = null; u.cur = null; refetch = true; break;
        case 'tune': u.tune = !u.tune; break;
        case 'src': if (u.src === v) return; u.src = v; u.sp = null; u.cell = null; u.cur = null; u.limit = 60; u.allRows = false; break;
        case 'allrows': u.allRows = true; break;
        case 'view': u.view = v; u.cell = null; u.cur = null; break;
        case 'sp': u.sp = u.sp === v ? null : v; if (u.view === 'species') u.cell = null; u.cur = null; u.limit = 60; break;
        case 'row':
          if (u.view === 'species') { u.sp = u.sp === b.dataset.row ? null : b.dataset.row; u.cell = null; } else { u.cell = u.cell && u.cell.row === b.dataset.row && !u.cell.day ? null : { row: b.dataset.row, day: null }; }
          u.cur = null; break;
        case 'cell': {
          const same = u.cell && u.cell.row === b.dataset.row && u.cell.day === b.dataset.day;
          u.cell = same ? null : { row: b.dataset.row, day: b.dataset.day };
          if (u.view === 'species') u.sp = same ? u.sp : b.dataset.row;
          u.cur = null; u.limit = 60; break;
        }
        case 'cellx': u.cell = null; u.cur = null; break;
        case 'more': u.limit += 120; break;
        case 'open': { const e = this._list[+b.dataset.i]; u.cur = u.cur === e.id ? null : e.id; u.clip = false; stageOnly = true; break; }
        case 'step': { const i = this._list.findIndex((e) => e.id === u.cur) + +v; if (this._list[i]) { u.cur = this._list[i].id; u.clip = false; } stageOnly = true; break; }
        case 'frigate': this._frigatePanel(); return;
        case 'close': u.cur = null; stageOnly = true; break;
        case 'clip': u.clip = true; stageOnly = true; break;
        case 'still': u.clip = false; stageOnly = true; break;
        default: return;
      }
      this._save();
      if (stageOnly) { this._stage(); return; }
      if (refetch) { this._render(); this._refresh(true); return; }
      this._render();
    }
  }


  /* ------------------------------------------------------------------ editor
     A visual editor built on Home Assistant's own ha-form, so it looks and
     behaves like the built-in cards' editors. Species groups stay in YAML:
     they are a list of lists, and a form makes them harder to read, not
     easier. Any key the form does not know about — species, the card type, a
     wrapper's own keys — is carried through untouched on every change. */

  const FIELDS = {
    title: ['Title', 'Shown at the top of the card.'],
    icon: ['Headline icon', 'Used while nothing needs attention; an alert swaps in its own.'],
    days: ['Opening range', 'Which range the card starts on. You can still switch it on the card.'],
    refresh: ['Refresh every', 'How often sightings are re-read in the background.'],
    min_score: ['Opening confidence', 'Sightings below this are hidden until you move the slider on the card.'],
    sun_shading: ['Day/night shading', 'Shade the time-of-day rows for daylight, darkness, dawn and dusk.'],
    indoor_cameras: ['Indoor cameras', 'A rodent on these is an alert rather than a sighting.'],
    auto: ['Discover species automatically', 'Build the tiles from whatever animals Frigate reports, sub-labels included, instead of the built-in groups. People, vehicles and sounds are left out.'],
    auto_over: ['Discover species automatically', 'Build the tiles from whatever animals Frigate reports, sub-labels included, in place of the species list written in YAML. The list is kept and comes back when this is turned off.'],
    ignore_labels: ['Labels to leave out', 'Anything else discovery should skip, e.g. dog.'],
    instance_id: ['Frigate instance', 'Its MQTT client id. Only matters with more than one Frigate.'],
    frigate_addon: ['Frigate add-on', 'Its slug, for a Frigate running as an add-on. Adds a button that opens the sighting in Frigate.'],
    frigate_url: ['Frigate address', 'For a Frigate that is not an add-on, e.g. http://192.168.1.10:5000. Used in preference to the slug.'],
    clip_lead_in: ['Clip lead-in', 'Extra seconds before a sighting when playing a clip (uses Frigate recordings).'],
    clip_lead_out: ['Clip lead-out', 'Extra seconds after a sighting when playing a clip (uses Frigate recordings).'],
    birdnet_addon: ['BirdNET-Go add-on', 'Its slug, for a BirdNET-Go running as an add-on. Adds a Seen / Heard switch with the calls it has identified.'],
    birdnet_url: ['BirdNET-Go address', 'For a BirdNET-Go that is not an add-on, e.g. http://192.168.1.10:8080. Used in preference to the slug.'],
    heard_ignore: ['Heard labels to leave out', 'Besides engines, voices, sirens and dogs, which are always left out.'],
    correlate: ['Seen and heard together', 'Pair a sighting with a call of the same kind of animal, from the microphone named as its camera, at the same time. Adds Both to the switch.'],
    correlate_window: ['Same-time window', 'Seconds before or after a sighting that a call may fall. 120 unless set.'],
    coyote: ['Coyotes', ''],
    enabled: ['Infer coyotes from night-time dogs', 'Frigate cannot detect a coyote, so a dog alone at night stands in for one.'],
    cameras: ['Cameras to watch', 'Where a night-time dog counts as a likely coyote.'],
    start: ['Night starts', ''],
    end: ['Night ends', ''],
    person_window: ['Person within', 'A person seen this close in time means the dog was a dog.'],
  };

  const DEFAULTS = {
    title: 'Wildlife', icon: 'mdi:binoculars', instance_id: 'frigate', days: 14,
    min_score: 70, refresh: 300, sun_shading: true, indoor_cameras: ['Attic', 'Crawlspace'],
    coyote: { enabled: true, cameras: ['Driveway', 'Front'], start: '23:00', end: '05:00', person_window: 120 },
  };

  const schema = (cameras, labels = [], species, birdnet = false, auto = species === 'auto') => {
    const pick = { select: { multiple: true, custom_value: true, mode: 'dropdown', options: cameras } };
    /* A species list written out in YAML is the user's own work, so the
       switch never throws one away: over a list it sets discover, which the
       card obeys while the list stays where it is. */
    const discovery = [
      { name: Array.isArray(species) ? 'auto_over' : 'auto', selector: { boolean: {} } },
      ...(auto ? [{ name: 'ignore_labels', selector: { select: { multiple: true, custom_value: true, mode: 'dropdown', options: labels } } }] : []),
    ];
    return [
      { name: 'title', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
      { type: 'grid', name: '', schema: [
        { name: 'days', selector: { select: { mode: 'dropdown', options: [
          { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }] } } },
        { name: 'refresh', selector: { number: { min: 60, max: 3600, step: 30, mode: 'box', unit_of_measurement: 'seconds' } } },
      ] },
      { name: 'min_score', selector: { number: { min: 50, max: 99, step: 1, mode: 'slider', unit_of_measurement: '%' } } },
      { name: 'sun_shading', selector: { boolean: {} } },
      ...discovery,
      { name: 'indoor_cameras', selector: pick },
      { name: 'instance_id', selector: { text: {} } },
      { type: 'grid', name: '', schema: [
        { name: 'frigate_addon', selector: { text: {} } },
        { name: 'frigate_url', selector: { text: {} } },
      ] },
      { type: 'grid', name: '', schema: [
        { name: 'clip_lead_in', selector: { number: { min: 0, max: 60, step: 1, mode: 'box', unit_of_measurement: 'seconds' } } },
        { name: 'clip_lead_out', selector: { number: { min: 0, max: 60, step: 1, mode: 'box', unit_of_measurement: 'seconds' } } },
      ] },
      { type: 'grid', name: '', schema: [
        { name: 'birdnet_addon', selector: { text: {} } },
        { name: 'birdnet_url', selector: { text: {} } },
      ] },
      ...(birdnet ? [
        { name: 'heard_ignore', selector: { select: { multiple: true, custom_value: true, mode: 'dropdown', options: [] } } },
        { type: 'grid', name: '', schema: [
          { name: 'correlate', selector: { boolean: {} } },
          { name: 'correlate_window', selector: { number: { min: 5, max: 3600, step: 5, mode: 'box', unit_of_measurement: 'seconds' } } },
        ] },
      ] : []),
      { type: 'expandable', name: 'coyote', title: FIELDS.coyote[0], icon: 'mdi:paw', schema: [
        { name: 'enabled', selector: { boolean: {} } },
        { name: 'cameras', selector: pick },
        { type: 'grid', name: '', schema: [
          { name: 'start', selector: { time: {} } },
          { name: 'end', selector: { time: {} } },
        ] },
        { name: 'person_window', selector: { number: { min: 0, max: 900, step: 10, mode: 'box', unit_of_measurement: 'seconds' } } },
      ] },
    ];
  };

  const clock = (v) => (v ? String(v).split(':').slice(0, 2).map((n) => n.padStart(2, '0')).join(':') : v);

  class WildlifeCardEditor extends HTMLElement {
    setConfig(config) { this._config = config || {}; this._render(); }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) this._findCameras();
      this._render();
    }

    /* The camera names Frigate itself uses, read from recent events so they
       match exactly — guessing them from entity ids gets the case wrong. */
    async _findCameras() {
      try {
        const res = await this._hass.callWS({
          type: 'frigate/events/get',
          instance_id: this._config?.instance_id || 'frigate',
          after: Math.floor(Date.now() / 1000) - 7 * 86400,
          limit: 500,
        });
        const events = typeof res === 'string' ? JSON.parse(res) : res || [];
        const names = [...new Set(events.map((e) => e.camera).filter(Boolean))].sort();
        if (names.length) this._cameras = names.map((c) => ({ value: c, label: pretty(c) }));
        /* What discovery would show, offered as things to leave out. */
        const seen = new Set();
        for (const e of events) {
          if (e.data?.type === 'audio' || NON_WILDLIFE.has(normKey(e.label))) continue;
          seen.add(e.label);
          const sub = subOf(e);
          if (sub && !EMPTY_SUB.has(normKey(sub))) seen.add(sub);
        }
        this._labels = [...seen].sort().map((l) => ({ value: l, label: formatLabel(l) }));
        this._render();
      } catch (err) { /* the names can still be typed */ }
    }

    _data() {
      const c = this._config || {};
      return {
        ...DEFAULTS, ...c,
        days: String(c.days ?? DEFAULTS.days),
        coyote: { ...DEFAULTS.coyote, ...(c.coyote || {}) },
        auto: c.species === 'auto' || c.discover === true,
        auto_over: c.species === 'auto' || c.discover === true,
        ignore_labels: Array.isArray(c.ignore_labels) ? c.ignore_labels : [],
        heard_ignore: Array.isArray(c.heard_ignore) ? c.heard_ignore : [],
        correlate: !!c.correlate,
      };
    }

    _changed(ev) {
      ev.stopPropagation();
      const v = ev.detail.value;
      const config = {
        ...this._config, ...v,
        days: +v.days,
        coyote: { ...v.coyote, start: clock(v.coyote?.start), end: clock(v.coyote?.end) },
      };
      /* Without a list of the user's own, the switch writes species: auto and
         turning it off removes the key, which restores the built-in groups.
         Over a written list it sets discover and leaves the list alone. */
      if (Array.isArray(this._config?.species)) {
        if (v.auto_over) config.discover = true; else delete config.discover;
      } else {
        if (v.auto) config.species = 'auto'; else delete config.species;
        delete config.discover;
      }
      delete config.auto_over;
      delete config.auto;
      if (!Array.isArray(config.ignore_labels) || !config.ignore_labels.length) delete config.ignore_labels;
      if (!Array.isArray(config.heard_ignore) || !config.heard_ignore.length) delete config.heard_ignore;
      if (!config.correlate) delete config.correlate;
      if (!(+config.correlate_window > 0)) delete config.correlate_window;
      /* An emptied field should leave no key behind. */
      for (const k of ['frigate_addon', 'frigate_url', 'birdnet_addon', 'birdnet_url', 'clip_lead_in', 'clip_lead_out']) {
        if (config[k] === '' || config[k] == null) delete config[k];
      }
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    }

    _render() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        const note = document.createElement('ha-alert');
        note.setAttribute('alert-type', 'info');
        note.textContent = 'Custom species groups, display-name aliases and tile glyphs are edited in YAML. Anything set there is kept when you switch, and a species list is kept while discovery is on.';
        note.style.display = 'block';
        note.style.marginBottom = '12px';
        this.appendChild(note);
        this._form = document.createElement('ha-form');
        this._form.addEventListener('value-changed', (ev) => this._changed(ev));
        this.appendChild(this._form);
      }
      this._form.hass = this._hass;
      this._form.schema = schema(this._cameras || [], this._labels || [], this._config.species, !!(this._config.birdnet_addon || this._config.birdnet_url),
        this._config.species === 'auto' || this._config.discover === true);
      this._form.data = this._data();
      this._form.computeLabel = (s) => FIELDS[s.name]?.[0] || pretty(s.name);
      this._form.computeHelper = (s) => FIELDS[s.name]?.[1] || '';
    }
  }

  if (!customElements.get('wildlife-card')) customElements.define('wildlife-card', WildlifeCard);
  if (!customElements.get('wildlife-card-editor')) customElements.define('wildlife-card-editor', WildlifeCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'wildlife-card')) {
    window.customCards.push({ type: 'wildlife-card', name: 'Wildlife Card', description: 'Frigate wildlife activity, trends and sightings browser, with BirdNET-Go calls.', preview: false });
  }
  console.info(`%c WILDLIFE-CARD %c v${VERSION} `, 'color:#fff;background:#03a9f4;font-weight:700', 'color:#03a9f4;background:#fff');
})();
