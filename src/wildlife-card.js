/*
 * wildlife-card
 * Frigate wildlife activity for Home Assistant: per-species tiles, an activity
 * grid (by species / time of day / camera) and a sightings browser with clips.
 *
 * Data comes straight from the Frigate integration (websocket
 * `frigate/events/get`), so no helper sensors or packages are needed.
 * Media uses the integration's notification proxy, falling back to signed paths.
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
 *   refresh: 300                  # seconds between background refreshes
 *   indoor_cameras: [Attic, Crawlspace]
 *   coyote:
 *     enabled: true
 *     cameras: [Driveway, Front]  # where a lone night-time dog counts
 *     start: '23:00'
 *     end: '05:00'
 *     person_window: 120          # seconds either side to look for a person
 *   species:                      # replaces the built-in list when given
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

  const ICON = {
    tune: 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z',
    left: 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z',
    right: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
    close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    image: 'M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z',
    open: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const hhmm = (s, d) => { const m = /^(\d{1,2}):?(\d{2})?/.exec(String(s ?? '')); return m ? +m[1] + (+(m[2] || 0)) / 60 : d; };

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
    .c { height:var(--ch,16px); border-radius:3px; background:rgba(var(--wl-ink),.05); }
    .c[data-v] { background:rgba(var(--wl-rgb),var(--a)); }
    .c.wk { margin-left:2px; }
    .c.sel { outline:2px solid var(--primary-text-color); outline-offset:1px; }
    .c:hover { outline:2px solid rgba(var(--wl-ink),.55); outline-offset:1px; }
    .rows { display:grid; gap:2px; }
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
    .empty { padding:10px 16px 16px; font-size:13px; color:var(--secondary-text-color); }
    .err { margin:4px 12px 12px; padding:10px 12px; border-radius:14px; font-size:13px; background:rgba(var(--rgb-error-color,219,68,55),.12); color:var(--primary-text-color); }
  `;

  class WildlifeCard extends HTMLElement {
    static getStubConfig() { return {}; }

    setConfig(config) {
      const c = config || {};
      const coy = c.coyote || {};
      this._cfg = {
        title: c.title ?? 'Wildlife',
        icon: c.icon || 'mdi:binoculars',
        instance: c.instance_id || 'frigate',
        refresh: Math.max(60, +c.refresh || 300),
        indoor: (c.indoor_cameras || ['Attic', 'Crawlspace']).map((s) => s.toLowerCase()),
        species: (Array.isArray(c.species) && c.species.length ? c.species : DEFAULT_SPECIES).map((s) => ({
          id: s.id, name: s.name || pretty(s.id), one: s.one || (s.name || pretty(s.id)).replace(/e?s$/, ''),
          labels: s.labels || [s.id], glyph: s.glyph || '🐾',
        })),
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
      };
      this._events = new Map();
      this._people = new Map();
      this._loaded = false; this._error = null;
      if (this._root) { this._build(); this._fetch(true); }
    }

    set hass(h) {
      const first = !this._hass;
      this._hass = h;
      if (first && this._root) this._fetch(true);
    }

    connectedCallback() {
      if (!this._root) { this._root = this.attachShadow({ mode: 'open' }); this._build(); }
      if (this._hass && !this._loaded) this._fetch(true);
      this._ro = this._ro || new ResizeObserver((r) => this.toggleAttribute('wide', r[0].contentRect.width >= 640));
      this._ro.observe(this);
      this._timer = setInterval(() => { if (!document.hidden) this._fetch(false); }, this._cfg.refresh * 1000);
    }
    disconnectedCallback() { clearInterval(this._timer); this._ro?.disconnect(); }
    getCardSize() { return 9; }
    getGridOptions() { return { columns: 12, min_columns: 6 }; }

    _load() { try { return JSON.parse(localStorage.getItem('wildlife-card') || '{}'); } catch (e) { return {}; } }
    _save() { try { localStorage.setItem('wildlife-card', JSON.stringify({ days: this._ui.days, view: this._ui.view, min: this._ui.min })); } catch (e) { /* private mode */ } }

    /* ---------- time helpers (HA time zone, not the browser's) ---------- */
    _fmt() {
      const tz = this._hass?.config?.time_zone;
      if (!this._f || this._f.tz !== tz) {
        const o = tz ? { timeZone: tz } : {};
        const loc = this._hass?.locale?.language || undefined;
        this._f = {
          tz,
          parts: new Intl.DateTimeFormat('en-CA', { ...o, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }),
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

    async _fetch(full) {
      if (!this._hass || this._busy) return;
      this._busy = true;
      try {
        const now = Math.floor(Date.now() / 1000);
        const horizon = now - (this._ui.days + 1) * 86400;
        let after = horizon;
        if (!full && this._loaded && this._newest && this._span >= this._ui.days) after = Math.max(horizon, Math.floor(this._newest) - 7200);
        const labels = [...new Set(this._cfg.species.flatMap((s) => s.labels))];
        const jobs = [this._ws({ labels, after, limit: 10000 })];
        const coy = this._cfg.coyote;
        if (coy.enabled) jobs.push(this._ws({ labels: ['dog'], cameras: coy.cameras, after, limit: 3000 }).catch(() => []));
        const [wild, dogs = []] = await Promise.all(jobs);
        if (full || after === horizon) this._events.clear();
        const byLabel = new Map();
        for (const s of this._cfg.species) for (const l of s.labels) if (!byLabel.has(l)) byLabel.set(l, s.id);
        for (const e of wild) this._put(e, byLabel.get(e.label));
        await this._coyotes(dogs);
        for (const [id, e] of this._events) if (e.start < horizon) this._events.delete(id);
        this._newest = Math.max(0, ...[...this._events.values()].map((e) => e.start));
        this._span = this._ui.days; this._loaded = true; this._error = null;
      } catch (err) {
        this._error = err?.message || err?.code || String(err);
      }
      this._busy = false;
      this._render();
    }

    _put(e, species, extra) {
      if (!species || e.false_positive) return;
      const sub = Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label;
      const lt = this._local(e.start_time);
      this._events.set(e.id, {
        id: e.id, sp: species, label: e.label, sub: sub || '', cam: e.camera, zones: e.zones || [],
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

    _media(id, file) { return this._hass.hassUrl(`/api/frigate/${this._cfg.instance}/notifications/${id}/${file}`); }
    _thumb(e) { return this._media(e.id, 'thumbnail.jpg'); }

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

    /* ---------- derived ---------- */
    _visible() {
      const min = this._ui.min / 100; const first = this._days()[0]?.key;
      return [...this._events.values()].filter((e) => e.score >= min && e.day >= first).sort((a, b) => b.start - a.start);
    }
    _hidden() {
      const min = this._ui.min / 100; const first = this._days()[0]?.key; let n = 0;
      for (const e of this._events.values()) if (e.day >= first && e.score < min) n++;
      return n;
    }
    _rowKey(e) { return this._ui.view === 'species' ? e.sp : this._ui.view === 'camera' ? e.cam : String(Math.floor(e.hour / 2)); }
    _filtered(all) {
      const { sp, cell } = this._ui;
      return all.filter((e) => (!sp || e.sp === sp) && (!cell || ((cell.day == null || e.day === cell.day) && (cell.row == null || this._rowKey(e) === cell.row))));
    }
    _spec(id) { return this._cfg.species.find((s) => s.id === id) || { id, name: pretty(id), one: pretty(id), glyph: '🐾' }; }
    _name(e) {
      if (e.inferred) return e.pack > 1 ? `Likely coyotes ×${e.pack}` : 'Likely coyote';
      const base = e.sp === 'other' || !this._spec(e.sp).one ? pretty(e.label) : this._spec(e.sp).one;
      return e.sub ? `${base} · ${pretty(e.sub)}` : base;
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
      const up = []; const down = []; const notes = [];
      for (const s of this._cfg.species) {
        const l = all.filter((e) => e.sp === s.id); if (!l.length) continue;
        const rec = l.filter((e) => now - e.start < D3).length; const base = (l.length - rec) / per3;
        if (rec >= 3 && rec >= 1.8 * Math.max(base, 0.5)) { up.push(s); notes.push(`${s.name} ${rec} in 3 days (usual ${fmtN(base)})`); }
        else if (base >= 3 && rec <= 0.5 * base) { down.push(s); notes.push(`${s.name} down, ${rec} in 3 days (usual ${fmtN(base)})`); }
      }
      const rod = all.filter((e) => e.sp === 'rodent'); const cat = all.filter((e) => e.sp === 'cat');
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
      const rec = all.filter((e) => now - e.start < D3).length;
      const s = notes.length ? notes.join(' · ') : (all.length ? `${rec} sightings in 3 days, in line with the last ${days}` : 'No wildlife recorded in this period');
      if (pack) return { rgb: R, icon: 'mdi:alert-circle', p: `Likely coyote pack · ${pretty(pack.cam)} · ${this._when(pack.start)}`, s };
      if (inside) return { rgb: R, icon: 'mdi:alert-circle', p: `Rodent inside · ${pretty(inside.cam)} · ${this._when(inside.start)}`, s };
      const warn = coy || up.some((x) => x.id === 'rodent' || x.id === 'coyote');
      const names = (a) => { const n = a.map((x) => x.name); return list([n[0], ...n.slice(1).map(low)]); };
      let p = 'Wildlife activity steady';
      if (up.length && down.length) p = `${names(up)} up, ${low(names(down))} down`;
      else if (up.length) p = `${names(up)} more active than usual`;
      else if (down.length) p = `${names(down)} quieter than usual`;
      return { rgb: warn ? A : G, icon: this._cfg.icon, p, s };
    }

    /* ---------- rendering ---------- */
    _build() {
      this._root.innerHTML = `<style>${CSS}</style><ha-card>
        <div class="head"></div><div class="tunewrap"></div><div class="hlwrap"></div>
        <div class="tiles"></div><div class="chart"></div><div class="browser"></div></ha-card>`;
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
        if (ev.target.tagName === 'VIDEO' && !ev.target._hls) this._attachMedia(ev.target);
      }, true);
      this._root.addEventListener('pointermove', (ev) => this._tip(ev));
      this._root.addEventListener('pointerleave', () => this._tip(null));
      this._render();
    }

    _render(keepTune) {
      if (!this._root) return;
      const u = this._ui;
      const all = this._loaded ? this._visible() : [];
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
      const hid = this._$('.hid'); if (hid) { const n = this._hidden(); hid.textContent = n ? `Hiding ${n} lower-confidence sighting${n === 1 ? '' : 's'} from every view.` : 'Nothing is hidden at this setting.'; }
      if (this._error) {
        this._$('.hlwrap').innerHTML = `<div class="err">Could not read Frigate events (${esc(this._error)}). Check that the Frigate integration is loaded and that <b>instance_id</b> matches its MQTT client id.</div>`;
        return;
      }
      if (!this._loaded) { this._$('.hlwrap').innerHTML = '<div class="empty">Loading sightings…</div>'; return; }
      const h = this._headline(all);
      this._$('.hlwrap').innerHTML = `<div class="panel hl" style="--hl:${h.rgb}"><div class="shape"><ha-icon icon="${h.icon}"></ha-icon></div>
        <div><div class="p">${esc(h.p)}</div><div class="s">${esc(h.s)}</div></div></div>`;
      this._tiles(all); this._chart(all); this._browser(all);
    }

    _tiles(all) {
      const html = this._cfg.species.map((s) => {
        const list = all.filter((e) => e.sp === s.id);
        const best = list.slice(0, 8).sort((a, b) => b.score - a.score)[0];
        const pack = s.id === 'coyote' && list.some((e) => (e.pack || 1) > 1);
        return `<button class="tile${list.length ? '' : ' none'}" data-act="sp" data-v="${esc(s.id)}" aria-pressed="${this._ui.sp === s.id}" title="${esc(s.name)}">
          <div class="pic"><span>${s.glyph}</span>${best ? `<img loading="lazy" alt="" data-id="${esc(best.id)}" src="${esc(this._thumb(best))}">` : ''}
          ${list.length ? `<span class="n">${list.length}</span>` : ''}${pack ? '<span class="flag">pack</span>' : ''}</div>
          <b>${esc(s.name)}</b><i>${list.length ? this._ago(list[0].start) : `none in ${this._ui.days}d`}</i></button>`;
      }).join('');
      this._$('.tiles').innerHTML = html;
    }

    _chart(all) {
      const u = this._ui; const days = this._days(); const f = this._fmt();
      const src = u.view === 'species' ? all : all.filter((e) => !u.sp || e.sp === u.sp);
      let rows;
      if (u.view === 'species') rows = this._cfg.species.map((s) => ({ key: s.id, label: `${s.glyph} ${s.name}`, on: u.sp === s.id }));
      else if (u.view === 'hour') rows = Array.from({ length: 12 }, (_, i) => ({ key: String(i), label: `${(i * 2) % 12 || 12}${i < 6 ? 'a' : 'p'}–${((i + 1) * 2) % 12 || 12}${i + 1 < 6 || i === 11 ? 'a' : 'p'}` }));
      else {
        const m = {}; for (const e of src) m[e.cam] = (m[e.cam] || 0) + 1;
        rows = Object.keys(m).sort((a, b) => m[b] - m[a]).map((k) => ({ key: k, label: pretty(k) }));
      }
      const count = {};
      for (const e of src) { const k = `${this._rowKey(e)}|${e.day}`; count[k] = (count[k] || 0) + 1; }
      const shared = u.view === 'species' ? null : Math.max(3, ...Object.values(count));
      const body = rows.map((r) => {
        let tot = 0; let max = 3;
        for (const d of days) { const v = count[`${r.key}|${d.key}`] || 0; tot += v; if (v > max) max = v; }
        const scale = shared || max;
        const cells = days.map((d) => {
          const v = count[`${r.key}|${d.key}`] || 0;
          const wk = f.wd.format(new Date(d.ts * 1000)) === 'Mon' ? ' wk' : '';
          const sel = u.cell && u.cell.row === r.key && u.cell.day === d.key ? ' sel' : '';
          const a = v ? (0.3 + 0.7 * Math.sqrt(Math.min(1, v / scale))).toFixed(2) : 0;
          return `<button class="c${wk}${sel}" data-act="cell" data-row="${esc(r.key)}" data-day="${d.key}" data-n="${v}" data-lab="${esc(r.label)}"${v ? ` data-v style="--a:${a}"` : ''} aria-label="${esc(r.label)}, ${esc(f.day.format(new Date(d.ts * 1000)))}: ${v}"></button>`;
        }).join('');
        return `<div class="row"><button class="lab${r.on ? ' on' : ''}" data-act="row" data-row="${esc(r.key)}">${esc(r.label)}</button><div class="cells">${cells}</div><div class="tot">${tot || ''}</div></div>`;
      }).join('');
      const n = days.length; const step = n <= 7 ? 1 : n <= 14 ? 3 : 7; let ticks = '';
      for (let i = n - 1 - step; i >= 0; i -= step) ticks += `<span style="left:${((i + 0.5) / n) * 100}%">${esc(f.md.format(new Date(days[i].ts * 1000)))}</span>`;
      ticks += '<span class="end" style="left:100%">Today</span>';
      const sp = u.sp ? this._spec(u.sp).name : 'All wildlife';
      const title = u.view === 'species' ? 'Sightings per day' : u.view === 'hour' ? `${sp} · time of day` : `${sp} · by camera`;
      const seg = [['species', 'Species'], ['hour', 'Time'], ['camera', 'Location']].map(([v, l]) => `<button data-act="view" data-v="${v}" aria-pressed="${u.view === v}">${l}</button>`).join('');
      this._$('.chart').innerHTML = `<div class="sub"><h3>${esc(title)}</h3><span class="seg" role="group">${seg}</span></div>
        <div class="grid" style="--lab:${u.view === 'camera' ? '104px' : u.view === 'hour' ? '54px' : '92px'};--ch:${u.view === 'hour' ? '13px' : '18px'}">
          ${rows.length ? `<div class="rows">${body}</div><div class="axis"><i></i><div>${ticks}</div><i></i></div>` : '<div class="empty" style="padding-left:0">Nothing to chart for this selection.</div>'}
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
      const shots = list.slice(0, u.limit).map((e, i) => `<button class="shot" data-act="open" data-i="${i}" aria-current="${u.cur === e.id}">
        <div class="pic"><span>${this._spec(e.sp).glyph}</span><img loading="lazy" alt="" data-id="${esc(e.id)}" src="${esc(this._thumb(e))}">
        <span class="sc">${Math.round(e.score * 100)}%</span>${u.sp ? '' : `<span class="gl">${this._spec(e.sp).glyph}</span>`}</div>
        <b>${esc(this._when(e.start))}</b><i>${esc(e.inferred ? `${pretty(e.cam)} · likely coyote` : pretty(e.cam))}</i></button>`).join('');
      const more = list.length > u.limit ? `<button class="more" data-act="more">+${list.length - u.limit} more</button>` : '';
      this._$('.browser').innerHTML = `<div class="sub"><h3>${list.length} sighting${list.length === 1 ? '' : 's'}${chips.length ? '' : ` · last ${u.days} days`}</h3></div>${chipHtml}
        <div class="stagewrap"></div>
        ${list.length ? `<div class="film">${shots}${more}</div>` : '<div class="empty">No sightings match. Try a longer range or a lower confidence filter.</div>'}`;
      this._stage();
    }

    _stage() {
      const wrap = this._$('.stagewrap'); if (!wrap) return;
      wrap.querySelector('video')?._hls?.destroy();
      const list = this._list || []; const i = list.findIndex((e) => e.id === this._ui.cur);
      if (i < 0) { wrap.innerHTML = ''; return; }
      const e = list[i];
      const still = e.snap ? this._media(e.id, 'snapshot.jpg') : this._thumb(e);
      const media = this._ui.clip && e.clip
        ? `<video class="media" controls playsinline muted preload="metadata" poster="${esc(still)}" data-hls="${esc(this._media(e.id, 'index.m3u8'))}" data-mp4="${esc(this._media(e.id, 'clip.mp4'))}"></video>`
        : `<img class="media" alt="${esc(this._name(e))}" data-id="${esc(e.id)}" data-kind="${e.snap ? 'snapshot' : 'thumbnail'}" src="${esc(still)}">`;
      const dur = e.end ? Math.max(1, Math.round(e.end - e.start)) : null;
      const meta = [pretty(e.cam), `${Math.round(e.score * 100)}%${e.inferred ? ' as dog' : ''}`, dur ? (dur >= 90 ? `${Math.round(dur / 60)} min` : `${dur}s`) : 'in progress', ...e.zones.slice(0, 2).map(pretty)];
      wrap.innerHTML = `<div class="stage">${media}
        <button class="nav l" data-act="step" data-v="-1" aria-label="Newer" ${i === 0 ? 'disabled' : ''}>${svg('left')}</button>
        <button class="nav r" data-act="step" data-v="1" aria-label="Older" ${i >= list.length - 1 ? 'disabled' : ''}>${svg('right')}</button>
        <button class="x" data-act="close" aria-label="Close">${svg('close')}</button>
        <span class="pos">${i + 1} / ${list.length}</span>
        <div class="cap"><div class="t"><div class="p">${esc(this._name(e))}</div><div class="s">${esc([this._when(e.start), ...meta].join(' · '))}</div></div>
          ${e.clip ? (this._ui.clip ? `<button class="pill" data-act="still">${svg('image')}Photo</button>` : `<button class="pill" data-act="clip">${svg('play')}Video</button>`) : ''}
          <a class="pill ghost" target="_blank" rel="noopener" href="${esc(e.clip ? this._media(e.id, 'clip.mp4') : still)}" title="Open in a new tab" aria-label="Open in a new tab">${svg('open')}</a>
        </div></div>`;
      const video = wrap.querySelector('video');
      if (video) this._attachMedia(video);
      this._root.querySelectorAll('.shot').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === i)));
      this._root.querySelector('.shot[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    /* Play order: hls.js, then the browser's own HLS, then the file. Home
       Assistant's media browser uses hls.js and plays recordings that Apple's
       native player rejects outright — same file, same connection — so the
       library goes first wherever it works, and each step falls to the next. */
    async _attachMedia(v) {
      const play = () => v.play().catch(() => {});
      if (v.dataset.hls && !v.dataset.noLib) {
        const Hls = await this._hlsLib();
        if (Hls && Hls.isSupported() && v.isConnected) {
          const hls = new Hls({ enableWorker: false });
          v._hls = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            hls.destroy(); v._hls = null; v.dataset.noLib = '1'; this._attachMedia(v);
          });
          hls.on(Hls.Events.MANIFEST_PARSED, play);
          hls.loadSource(v.dataset.hls);
          hls.attachMedia(v);
          return;
        }
      }
      if (v.dataset.hls && !v.dataset.noNative && v.canPlayType('application/vnd.apple.mpegurl')) {
        v.dataset.noNative = '1';
        v.src = v.dataset.hls; v.load(); play();
        return;
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
        case 'close': u.cur = null; stageOnly = true; break;
        case 'clip': u.clip = true; stageOnly = true; break;
        case 'still': u.clip = false; stageOnly = true; break;
        default: return;
      }
      this._save();
      if (stageOnly) { this._stage(); return; }
      if (refetch) { this._render(); this._fetch(true); return; }
      this._render();
    }
  }

  if (!customElements.get('wildlife-card')) customElements.define('wildlife-card', WildlifeCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'wildlife-card')) {
    window.customCards.push({ type: 'wildlife-card', name: 'Wildlife Card', description: 'Frigate wildlife activity, trends and sightings browser.', preview: false });
  }
  console.info(`%c WILDLIFE-CARD %c v${VERSION} `, 'color:#fff;background:#03a9f4;font-weight:700', 'color:#03a9f4;background:#fff');
})();
