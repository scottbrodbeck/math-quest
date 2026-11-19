(function () {
  "use strict";

  // ---------- Config ----------
  const ROUND_SECONDS = 60;
  const LEVEL_UP_EVERY = 5;          // correct answers (at a level) to level up
  const LEVEL_DOWN_AFTER = 3;        // misses (wrong or skip, at a level) to drop a level
  const BASE_POINTS = 10;
  const SPEED_BONUS_MAX = 10;        // bonus for answering quickly
  const SPEED_WINDOW = 5;            // seconds over which speed bonus decays
  const SPEED_DEMON_SEC = 2;

  // Default starting level per kid (Nov 2026: Evelyn mid-3rd grade, JD mid-2nd). Grown-ups can
  // override these in ⚙️ Grown-ups. The adaptive system moves each kid up or down from here.
  const STARTING_LEVEL = { Evelyn: 2, JD: 1 };
  const KIDS = ["Evelyn", "JD"];
  const HIDDEN_PLAYERS = ["test"];   // test accounts: never shown as a player button
  const ALL_OPS = ["add", "sub", "mul", "div"];
  const OP_LABEL = { add: "+", sub: "−", mul: "×", div: "÷" };
  const MAX_START_LEVEL = 5;
  const LEVEL_INFO = {
    1: "Add & subtract within 20",
    2: "Within 20, plus ×2, ×5, ×10",
    3: "Two-digit ± one-digit (no regrouping), plus easy ×",
    4: "Two-digit ± two-digit (no regrouping), plus ×2–×5 and ×10",
    5: "Two-digit with regrouping, all times tables, and ÷",
  };
  const TRICKY_WINDOW = 15;   // look at the last N rounds when finding tricky facts
  const TRICKY_MAX = 12;      // most tricky facts to show / drill at once
  const SERIES_COLORS = ["#2a78d6", "#eb6834"];   // chart colors for KIDS[0], KIDS[1] (validated categorical slots 1–2)

  const BADGES = [
    { id: "first",  ico: "🌟", name: "First Round" },
    { id: "fire",   ico: "🔥", name: "On Fire" },
    { id: "speed",  ico: "⚡", name: "Speed Demon" },
    { id: "lvl3",   ico: "🚀", name: "Level Up" },
    { id: "master", ico: "🧠", name: "Math Master" },
    { id: "high",   ico: "🏆", name: "High Roller" },
    { id: "century",ico: "💯", name: "Century" },
  ];

  // ---------- Spelling ----------
  // The word bank lives in spelling-words.js (window.SPELLING_UNITS), organized by spelling rule.
  const SPELL_BADGES = [
    { id: "sp-first",   ico: "📝", name: "First Words" },
    { id: "sp-streak",  ico: "🐝", name: "Busy Bee" },
    { id: "sp-rules",   ico: "🧙", name: "Rule Wizard" },
    { id: "sp-master",  ico: "📖", name: "Word Master" },
    { id: "sp-century", ico: "🔤", name: "Word Collector" },
    { id: "sp-perfect", ico: "🌈", name: "Perfect Round" },
  ];
  const ALL_BADGES = BADGES.concat(SPELL_BADGES);
  // Which rule units each spelling level mixes in (adaptive like math: 5 right → up, 3 misses → down).
  // Levels 1–3 follow UFLI Foundations' early lessons (short vowels → FLSZ → -all/-oll/-ull → digraphs).
  const SPELL_LEVELS = {
    1: ["cvc", "flsz"],
    2: ["flsz", "glued", "heart1"],
    3: ["glued", "heart1", "ck", "digraph"],
    4: ["digraph", "magic-e", "vowel-team"],
    5: ["magic-e", "vowel-team", "r-control", "tch-dge", "heart"],
    6: ["r-control", "heart", "soft-cg", "double", "endings"],
    7: ["soft-cg", "double", "endings", "y-to-i", "tion", "suffix"],
    8: ["y-to-i", "tion", "suffix", "schwa", "homophone"],
  };
  const SPELL_MAX_LEVEL = 8;
  const SPELL_LEVEL_INFO = {
    1: "Short vowels and double f / l / s / z (puff, bell, miss, buzz)",
    2: "Double f / l / s / z, -all / -oll / -ull, first heart words (go, no, so)",
    3: "-all / -oll / -ull, heart words, -ck, and sh / ch / th / wh",
    4: "sh / ch / th / wh, magic e, and vowel teams",
    5: "Magic e, vowel teams, bossy r, -tch / -dge, heart words",
    6: "Bossy r, heart words, soft c & g, double consonants, -ing / -ed",
    7: "Soft c & g, doubles, endings, y → i, -tion, suffixes",
    8: "y → i, -tion, suffixes, quiet vowels (schwa), homophones",
  };
  const SPELL_START = { Evelyn: 6, JD: 2 };   // default spelling starting levels (grown-ups can change)
  // Two beginner levels were added below the original six (Nov 2026). Spelling levels saved before
  // then (settings without ss:2, games without ls:2) are on the old scale: add 2 when reading them.
  const SPELL_SCALE = 2, SPELL_SHIFT = 2;
  function gameLevel(h) {
    const lv = h.level || 1;
    return (h.track === "spell" || h.track === "chunk") && h.ls !== SPELL_SCALE ? Math.min(SPELL_MAX_LEVEL, lv + SPELL_SHIFT) : lv;
  }
  const TRACK_NAME = { math: "Math", spell: "Spell It", chunk: "Fix the Chunk" };
  // Points per right answer: base + a speed bonus that fades over `window` seconds, times the combo.
  const TRACK_SCORING = {
    math:  { base: 10, speedMax: 10, window: 5 },
    chunk: { base: 10, speedMax: 10, window: 6 },
    spell: { base: 20, speedMax: 15, window: 14 },
  };
  const SPELL_UNITS = (window.SPELLING_UNITS || []).map(u => ({
    id: u.id, emoji: u.emoji, name: u.name, rule: u.rule, homophone: !!u.homophone,
    words: u.words.map(line => {
      const p = line.split("|");
      return { word: p[0], chunk: p[1], alts: p[2].split(","), sentence: p[3], tip: p[4] || "", unit: u.id };
    }),
  }));
  const UNIT_BY_ID = {}, WORD_INDEX = {};
  SPELL_UNITS.forEach(u => { UNIT_BY_ID[u.id] = u; u.words.forEach(w => { if (!WORD_INDEX[w.word]) WORD_INDEX[w.word] = w; }); });

  // ---------- Cloud sync (Firebase Realtime Database — OPTIONAL) ----------
  // To sync scores across devices, follow FIREBASE-SETUP.md: paste your database URL into
  // CLOUD.url and pick a CLOUD.family word. Use the SAME url + family on every device.
  // Leave the placeholder as-is to run local-only (no sync).
  const CLOUD = {
    url:    "https://kid-math-project-default-rtdb.firebaseio.com",
    family: "our-family",
  };
  function cloudEnabled() { return !!CLOUD.url && CLOUD.url.indexOf("PASTE_") === -1; }
  function cloudPath(p) {
    return CLOUD.url.replace(/\/+$/, "") + "/mathquest/" + encodeURIComponent(CLOUD.family) + "/" + p + ".json";
  }
  // GET (default) or PUT (opts.method) a node; returns parsed JSON (null if empty). Times out at 5s.
  async function cloudFetch(p, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(cloudPath(p), Object.assign({ signal: ctrl.signal }, opts || {}));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Storage ----------
  const SKEY = "mathQuest.v1";
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(SKEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {}
  }
  let store = loadStore();
  if (!store.players) store.players = {};      // name -> {badges:[], history:[ {..., len} ]}
  if (!store.recent) store.recent = [];         // array of names, most recent first
  if (typeof store.muted !== "boolean") store.muted = false;
  if (typeof store.lastLen !== "number") store.lastLen = 60;
  if (!store.settings || typeof store.settings !== "object") store.settings = {};   // name -> {startLevel, ops, spellLevel, ts}
  if (store.subject !== "spell") store.subject = "math";        // which subject the tabs show
  if (store.spellMode !== "chunk") store.spellMode = "spell";   // Spell It or Fix the Chunk
  if (!store.spellSeen || typeof store.spellSeen !== "object") store.spellSeen = {};   // name -> {word: last-asked ts} (this device)

  // A kid's settings: grown-up overrides if set, otherwise the defaults above.
  function settingsFor(name) {
    const s = store.settings[name];
    const ops = s && typeof s.ops === "string" ? s.ops.split(",").filter(o => ALL_OPS.indexOf(o) >= 0) : [];
    return {
      startLevel: s && typeof s.startLevel === "number" ? Math.min(MAX_START_LEVEL, Math.max(1, s.startLevel)) : (STARTING_LEVEL[name] || 1),
      ops: ops.length ? ops : ALL_OPS.slice(),
      spellLevel: s && typeof s.spellLevel === "number"
        ? Math.min(SPELL_MAX_LEVEL, Math.max(1, s.spellLevel + (s.ss === SPELL_SCALE ? 0 : SPELL_SHIFT)))
        : (SPELL_START[name] || 1),
    };
  }
  // Records, stats and tricky lists are kept per track: "math", "spell" (Spell It), "chunk" (Fix the Chunk).
  function currentTrack() { return store.subject === "spell" ? store.spellMode : "math"; }
  function isSpellTrack(track) { return track === "spell" || track === "chunk"; }
  function startingLevelFor(name) { return settingsFor(name).startLevel; }

  // Game length (seconds). Each length keeps its own scores/history; badges are shared.
  const LENGTHS = [60, 120, 180];
  let selectedLen = store.lastLen || 60;
  function lenLabel(len) { return (len / 60) + "-min"; }

  // Derive games / scoreSum / best / topLevel from the history (the source of truth). This makes
  // cross-device merges idempotent — union the history, then recompute.
  function recompute(pd) {
    let sum = 0, best = pd.best || 0, top = pd.topLevel || 1;
    pd.history.forEach(h => {
      const sc = h.score || 0, lv = h.level || 1;
      sum += sc;
      if (sc > best) best = sc;
      if (lv > top) top = lv;
    });
    pd.games = pd.history.length;
    pd.scoreSum = sum;
    pd.best = best;
    pd.topLevel = top;
    return pd;
  }
  function normalize(pd) {
    if (typeof pd.best !== "number") pd.best = 0;
    if (typeof pd.topLevel !== "number") pd.topLevel = 1;
    if (!Array.isArray(pd.badges)) pd.badges = [];
    if (!Array.isArray(pd.history)) pd.history = [];
    if (!pd.cleared || typeof pd.cleared !== "object") pd.cleared = {};   // fact -> when it was cleared in a drill
    // Give every game a stable id. Legacy entries (no id) get a deterministic id from their
    // timestamp so the same game dedupes identically on every device.
    pd.history.forEach(h => {
      if (!h.id) h.id = (h.ts != null ? "ts-" + h.ts : "x-" + Math.floor(Math.random() * 1e9));
      if (typeof h.len !== "number") h.len = 60;   // legacy games were all 1-minute
    });
    recompute(pd);
    return pd;
  }

  // Per-length stats derived from the flat history (each game tagged with .len; default 60).
  function lengthStats(pd, len, track) {
    const tr = track || "math";
    const items = (pd.history || []).filter(h => (h.len || 60) === len && (h.track || "math") === tr);
    const sorted = items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    let sum = 0, best = 0, top = 1;
    items.forEach(h => {
      sum += h.score || 0;
      if ((h.score || 0) > best) best = h.score;
      if (gameLevel(h) > top) top = gameLevel(h);
    });
    return {
      games: items.length, best: best, topLevel: top, history: sorted,
      last: sorted.length ? sorted[0].score : 0,
      average: items.length ? Math.round(sum / items.length) : 0,
    };
  }
  function playerData(name) {
    if (!store.players[name]) store.players[name] = { best: 0, topLevel: 1, badges: [], games: 0, scoreSum: 0, history: [] };
    return normalize(store.players[name]);
  }
  function rememberPlayer(name) {
    store.recent = [name].concat(store.recent.filter(n => n !== name)).slice(0, 6);
  }

  // ---------- Cloud sync helpers ----------
  function setSync(state) {
    const el = $("syncStatus");
    if (!el) return;
    const map = {
      local:   "💾 Local only",
      syncing: "☁️ Syncing…",
      synced:  "☁️ Synced",
      offline: "⚠️ Offline – saved here",
    };
    el.textContent = map[state] || map.local;
    el.className = "sync-status " + (state === "local" ? "" : state);
  }

  // Conflict-free merge: union of immutable games (by id) and badges, then recompute derived stats.
  function mergePlayer(a, b) {
    const byId = {};
    (a.history || []).concat(b.history || []).forEach(h => { if (h && h.id) byId[h.id] = h; });
    const history = Object.keys(byId).map(k => byId[k])
      .sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, 500);
    const badges = [];
    (a.badges || []).concat(b.badges || []).forEach(id => { if (badges.indexOf(id) === -1) badges.push(id); });
    const cleared = {};   // fact -> latest time it was cleared (max wins, so merges stay conflict-free)
    [a.cleared || {}, b.cleared || {}].forEach(c => Object.keys(c).forEach(k => { cleared[k] = Math.max(cleared[k] || 0, +c[k] || 0); }));
    const merged = {
      best: Math.max(a.best || 0, b.best || 0),
      topLevel: Math.max(a.topLevel || 1, b.topLevel || 1),
      badges: badges, history: history, cleared: cleared,
    };
    return recompute(merged);
  }

  // Convert a Firebase node { history:{id:{...}}, badges:{id:true} } into a local player record.
  function cloudNodeToPlayer(node) {
    const pd = { best: 0, topLevel: 1, badges: [], history: [] };
    if (node) {
      if (node.history) Object.keys(node.history).forEach(id => {
        const h = node.history[id];
        if (h && typeof h === "object") { h.id = id; pd.history.push(h); }
      });
      if (node.badges) pd.badges = Object.keys(node.badges);
      if (node.cleared && typeof node.cleared === "object") pd.cleared = Object.assign({}, node.cleared);
    }
    return normalize(pd);
  }

  function cloudPushGame(name, entry) {
    const body = { score: entry.score, level: entry.level, solved: entry.solved, ts: entry.ts, len: entry.len || 60 };
    if (entry.missed) body.missed = entry.missed;   // facts / words missed that round (feeds the tricky lists)
    if (entry.track && entry.track !== "math") body.track = entry.track;
    if (entry.ls) body.ls = entry.ls;
    return cloudFetch("players/" + encodeURIComponent(name) + "/history/" + encodeURIComponent(entry.id),
      { method: "PUT", body: JSON.stringify(body) });
  }

  // Settings and cleared facts live at paths that need the updated Firebase rules (FIREBASE-SETUP.md).
  // Until those rules are published those writes are refused; everything still works on this device.
  let extrasSyncOK = null;   // null = not tried yet, "ok", "denied" (rules not updated) or "offline"
  function trackExtras(promises) {
    if (!promises.length) return;
    Promise.all(promises.map(p => p.then(() => "ok", e => /HTTP 40[13]/.test(String(e && e.message)) ? "denied" : "offline")))
      .then(r => {
        extrasSyncOK = r.indexOf("denied") >= 0 ? "denied" : r.indexOf("offline") >= 0 ? "offline" : "ok";
        refreshSettingsNote();
      });
  }
  function cloudPushCleared(name, fact, ts) {
    return cloudFetch("players/" + encodeURIComponent(name) + "/cleared/" + encodeURIComponent(fact),
      { method: "PUT", body: String(ts) });
  }
  function cloudPushSettings(name, s) {
    const body = { startLevel: s.startLevel, ops: s.ops, ts: s.ts };
    if (typeof s.spellLevel === "number") body.spellLevel = s.spellLevel;
    if (s.ss) body.ss = s.ss;
    return cloudFetch("settings/" + encodeURIComponent(name), { method: "PUT", body: JSON.stringify(body) });
  }
  function cloudPushBadge(name, badgeId) {
    return cloudFetch("players/" + encodeURIComponent(name) + "/badges/" + encodeURIComponent(badgeId),
      { method: "PUT", body: "true" });
  }

  // Pull everything, merge with local, save, then push anything the cloud is missing.
  async function cloudSyncAll() {
    if (!cloudEnabled()) { setSync("local"); return; }
    setSync("syncing");
    try {
      const [all, cloudSettings] = await Promise.all([cloudFetch("players"), cloudFetch("settings").catch(() => null)]);
      const names = {};
      if (all) Object.keys(all).forEach(n => { names[n] = true; });
      Object.keys(store.players).forEach(n => { names[n] = true; });

      const pushes = [], extras = [];
      Object.keys(names).forEach(name => {
        const cloudNode = all && all[name] ? all[name] : null;
        const cloudPd = cloudNodeToPlayer(cloudNode);
        const localPd = normalize(store.players[name] || {});
        const merged = mergePlayer(localPd, cloudPd);
        store.players[name] = merged;

        const cloudHist = (cloudNode && cloudNode.history) ? cloudNode.history : {};
        merged.history.forEach(h => { if (!cloudHist[h.id]) pushes.push(cloudPushGame(name, h)); });
        const cloudBadges = (cloudNode && cloudNode.badges) ? cloudNode.badges : {};
        merged.badges.forEach(b => { if (!cloudBadges[b]) pushes.push(cloudPushBadge(name, b)); });
        const cloudCleared = (cloudNode && cloudNode.cleared) ? cloudNode.cleared : {};
        Object.keys(merged.cleared).forEach(f => {
          if (!((+cloudCleared[f] || 0) >= merged.cleared[f])) extras.push(cloudPushCleared(name, f, merged.cleared[f]));
        });
      });

      // Settings: newest (by ts) wins per kid; push any local ones the cloud doesn't have yet.
      const cs = (cloudSettings && typeof cloudSettings === "object") ? cloudSettings : {};
      const mergedSettings = {};
      Object.keys(cs).forEach(n => { const c = cs[n]; if (c && typeof c.startLevel === "number" && typeof c.ops === "string") mergedSettings[n] = c; });
      Object.keys(store.settings).forEach(n => {
        const l = store.settings[n], c = mergedSettings[n];
        if (!c || (l.ts || 0) > (c.ts || 0)) { mergedSettings[n] = l; extras.push(cloudPushSettings(n, l)); }
      });
      store.settings = mergedSettings;

      saveStore(store);
      refreshVisible();
      trackExtras(extras);
      await Promise.all(pushes);
      setSync("synced");
    } catch (e) {
      setSync("offline");
    }
  }

  // ---------- Elements ----------
  const $ = id => document.getElementById(id);
  const screens = {
    home: $("homeScreen"), game: $("gameScreen"), results: $("resultsScreen"),
    practice: $("practiceScreen"), records: $("recordsScreen"), settings: $("settingsScreen"),
  };
  function show(which) {
    Object.values(screens).forEach(s => s.classList.remove("active"));
    screens[which].classList.add("active");
    const inRound = which === "game" || which === "results";
    $("tabs").style.display = inRound ? "none" : "";
    $("subjectSwitch").style.display = (which === "home" || which === "practice" || which === "records") ? "" : "none";
    Array.prototype.forEach.call(document.querySelectorAll("#tabs .tab"), t =>
      t.classList.toggle("active", t.getAttribute("data-tab") === which));
    $("footerSettings").style.display = which === "game" ? "none" : "";
    window.scrollTo(0, 0);
  }

  // ---------- Sound (Web Audio, no files) ----------
  let audioCtx = null;
  function tone(freq, dur, type, when, gainVal) {
    if (store.muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime + (when || 0);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gainVal || 0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  const sfx = {
    correct: () => { tone(660, 0.12, "triangle", 0); tone(990, 0.14, "triangle", 0.1); },
    wrong:   () => { tone(180, 0.25, "sawtooth", 0, 0.15); },
    levelup: () => { [523,659,784,1047].forEach((f,i) => tone(f, 0.16, "triangle", i*0.09)); },
    leveldown: () => { [440,330,262].forEach((f,i) => tone(f, 0.14, "sine", i*0.08)); },
    newbest: () => { [659,784,988,1319].forEach((f,i) => tone(f, 0.2, "triangle", i*0.12)); },
  };

  // ---------- Problem generation ----------
  function rint(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Returns {text, answer} scaled by level, using only the operations switched on for this kid.
  // Difficulty tiers (adaptive: 5 correct at a level → up one, 3 misses → down one).
  //  L1   add & subtract within 20
  //  L2   + easy multiplication (×2, ×5, ×10)
  //  L3   two-digit ± one-digit, no regrouping (34 + 5, 47 − 6)    + easy ×
  //  L4   two-digit ± two-digit, no regrouping (32 + 25, 58 − 23)  + ×2, ×3, ×4, ×5, ×10
  //  L5+  two-digit with regrouping (47 + 28, 52 − 27)             + full tables 2–10 + ÷
  // Each tier also names the generator each operation uses there, so if a grown-up leaves only
  // operations the tier wouldn't normally mix in (e.g. only ÷ at level 1), it still gets a
  // level-appropriate version.
  function tierFor(level) {
    if (level <= 1) return { mix: ["add", "sub"],               add: "add20", sub: "sub20", mul: "mulEasy", div: "divEasy" };
    if (level <= 2) return { mix: ["add", "sub", "mul"],        add: "add20", sub: "sub20", mul: "mulEasy", div: "divEasy" };
    if (level <= 3) return { mix: ["add", "sub", "mul"],        add: "add21", sub: "sub21", mul: "mulEasy", div: "divEasy" };
    if (level <= 4) return { mix: ["add", "sub", "mul"],        add: "add22", sub: "sub22", mul: "mulMid",  div: "divEasy" };
    return              { mix: ["add", "sub", "mul", "div"], add: "addR",  sub: "subR",  mul: "mul",     div: "div" };
  }
  function makeProblem(level, enabledOps) {
    const tier = tierFor(level);
    const enabled = enabledOps && enabledOps.length ? enabledOps : ALL_OPS;
    let cats = tier.mix.filter(c => enabled.indexOf(c) >= 0);
    if (!cats.length) cats = enabled;
    const op = tier[pick(cats)];
    let a, b, sym;
    switch (op) {
      case "add20": a = rint(1, 19); b = rint(1, 20 - a); sym = "+"; break;
      case "sub20": a = rint(2, 20); b = rint(0, a); sym = "−"; break;
      case "add21": { const oa = rint(0, 8); a = rint(1, 8) * 10 + oa; b = rint(1, 9 - oa); sym = "+"; break; }
      case "sub21": { const oa = rint(1, 9); a = rint(1, 9) * 10 + oa; b = rint(1, oa); sym = "−"; break; }
      case "add22": {
        const ta = rint(1, 8), tb = rint(1, 9 - ta), oa = rint(0, 9), ob = rint(0, 9 - oa);
        a = ta * 10 + oa; b = tb * 10 + ob; sym = "+"; break;
      }
      case "sub22": {
        const ta = rint(2, 9), tb = rint(1, ta - 1), oa = rint(0, 9), ob = rint(0, oa);
        a = ta * 10 + oa; b = tb * 10 + ob; sym = "−"; break;
      }
      case "addR": a = rint(11, 89); b = rint(2, 99 - a); sym = "+"; break;
      case "subR": a = rint(20, 99); b = rint(2, a - 1); sym = "−"; break;
      case "mulEasy": a = pick([2, 5, 10]); b = rint(1, 10); sym = "×"; break;
      case "mulMid":  a = pick([2, 3, 4, 5, 10]); b = rint(1, 10); sym = "×"; break;
      case "divEasy": b = pick([2, 5, 10]); a = b * rint(1, 10); sym = "÷"; break;
      case "div":     b = rint(2, 10); a = b * rint(2, 10); sym = "÷"; break;
      default:        a = rint(2, 10); b = rint(2, 10); sym = "×";
    }
    const answer = sym === "+" ? a + b : sym === "−" ? a - b : sym === "÷" ? a / b : a * b;
    return { text: a + " " + sym + " " + b, answer: answer };
  }

  // A simple, kid-friendly hint that uses the actual numbers, for the end-of-round review.
  function hintFor(text, answer) {
    const m = text.match(/^(\d+)\s*([+−×÷x*\-])\s*(\d+)$/);
    if (!m) return "";
    const a = +m[1], op = m[2], b = +m[3];
    const tens = n => Math.floor(n / 10) * 10, ones = n => n % 10;

    if (op === "+") {
      const big = Math.max(a, b), small = Math.min(a, b);
      if (small >= 10) {                           // two-digit + two-digit: tens, then ones
        const t = tens(a) + tens(b), o = ones(a) + ones(b);
        return "Add the tens, then the ones: " + tens(a) + " + " + tens(b) + " = " + t + ", " +
               ones(a) + " + " + ones(b) + " = " + o + " → " + t + " + " + o + " = " + answer + ".";
      }
      if (big >= 10) {                             // two-digit + one-digit
        if (ones(big) + small < 10) {
          return "Just add the ones: " + ones(big) + " + " + small + " = " + (ones(big) + small) + ", so " + big + " + " + small + " = " + answer + ".";
        }
        const need = 10 - ones(big);
        return "Get to the next ten: " + big + " + " + need + " = " + (big + need) + ", then " + (small - need) + " more = " + answer + ".";
      }
      if (big + small > 10) {                      // single digits that cross 10
        const need = 10 - big;
        return "Make 10 first: " + big + " + " + need + " = 10, then " + (small - need) + " more = " + answer + ".";
      }
      return "Start at the bigger number " + big + " and count up " + small + " → " + answer + ".";
    }

    if (op === "−" || op === "-") {
      if (a >= 10 && b >= 10) {                    // two-digit − two-digit
        if (ones(a) >= ones(b)) {
          return "Subtract the tens, then the ones: " + tens(a) + " − " + tens(b) + " = " + (tens(a) - tens(b)) + ", " +
                 ones(a) + " − " + ones(b) + " = " + (ones(a) - ones(b)) + " → " + answer + ".";
        }
        const nextTen = tens(b) + 10;              // regrouping: count up through the next ten
        if (a === nextTen) return "Count up from " + b + " to " + a + " — that's " + answer + ".";
        return "Count up from " + b + ": to " + nextTen + " is " + (nextTen - b) + ", then to " + a + " is " + (a - nextTen) +
               ". " + (nextTen - b) + " + " + (a - nextTen) + " = " + answer + ".";
      }
      if (a >= 10) {                               // two-digit − one-digit
        if (ones(a) >= b) {
          return "Just subtract the ones: " + ones(a) + " − " + b + " = " + (ones(a) - b) + ", so " + a + " − " + b + " = " + answer + ".";
        }
        if (ones(a) > 0) {
          return "Take away " + ones(a) + " to get " + tens(a) + ", then " + (b - ones(a)) + " more: " +
                 tens(a) + " − " + (b - ones(a)) + " = " + answer + ".";
        }
      }
      return "Count up from " + b + " to " + a + " — that's " + answer + " more.";
    }

    if (op === "÷") {
      if (b === 1)  return "Anything ÷ 1 stays the same: " + a + " ÷ 1 = " + answer + ".";
      if (b === 10) return "÷10 is easy — take the 0 off " + a + " → " + answer + ".";
      if (b === 2)  return "÷2 means half: half of " + a + " is " + answer + " (" + answer + " + " + answer + " = " + a + ").";
      if (b === 5)  return "Count by 5s up to " + a + ": that's " + answer + " fives, so " + a + " ÷ 5 = " + answer + ".";
      return "Think multiplication: " + b + " × ? = " + a + ". Since " + b + " × " + answer + " = " + a + ", " + a + " ÷ " + b + " = " + answer + ".";
    }

    // multiplication
    const other = n => (a === n ? b : a);
    if (a === 1 || b === 1)   return "Anything × 1 stays the same: " + a + " × " + b + " = " + answer + ".";
    if (a === 10 || b === 10) return "×10 is easy — put a 0 after " + other(10) + " → " + answer + ".";
    if (a === 5 || b === 5)   return "Count by 5s (5, 10, 15…). " + a + " × " + b + " = " + answer + " — ×5 always ends in 0 or 5.";
    if (a === 2 || b === 2)   return "×2 means double it: " + other(2) + " + " + other(2) + " = " + answer + ".";
    if (a === 4 || b === 4)   return "×4 is double, then double again: " + other(4) + " → " + (other(4) * 2) + " → " + answer + ".";
    if (a === 9 || b === 9)   return "×9 trick: " + other(9) + " × 10 = " + (other(9) * 10) + ", then take away one " + other(9) + " → " + answer + ".";
    if (a === 3 || b === 3)   return "×3 is double plus one more: " + other(3) + " + " + other(3) + " = " + (other(3) * 2) + ", + " + other(3) + " = " + answer + ".";
    return a + " × " + b + " means " + b + " groups of " + a + " (count by " + a + "s) = " + answer + ".";
  }

  // The answer to a fact written like "7 × 8" (used for stored tricky facts).
  function answerFor(text) {
    const m = String(text).match(/^(\d+) ([+−×÷]) (\d+)$/);
    if (!m) return null;
    const a = +m[1], b = +m[3];
    return m[2] === "+" ? a + b : m[2] === "−" ? a - b : m[2] === "×" ? a * b : (b ? a / b : null);
  }

  // A kid's tricky items for a subject: math facts or spelling words missed in their last
  // TRICKY_WINDOW rounds of that subject, most-missed first. An item drops off once it's answered
  // right first try in a drill (until it's missed again), or once it ages out of the window.
  function trickyItems(pd, subject) {
    const spell = subject === "spell";
    const games = (pd.history || []).filter(h => isSpellTrack(h.track || "math") === spell)
      .sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, TRICKY_WINDOW);
    const stats = {};
    games.forEach(h => {
      if (!h.missed) return;
      String(h.missed).split("|").forEach(t => {
        const ans = spell ? (WORD_INDEX[t] ? t : null) : answerFor(t);
        if (ans == null) return;
        const st = stats[t] || (stats[t] = { text: t, answer: ans, count: 0, last: 0 });
        st.count++;
        st.last = Math.max(st.last, h.ts || 0);
      });
    });
    const cleared = pd.cleared || {};
    return Object.keys(stats).map(k => stats[k])
      .filter(st => !((+cleared[st.text] || 0) >= st.last))
      .sort((a, b) => b.count - a.count || b.last - a.last)
      .slice(0, TRICKY_MAX);
  }

  // ---------- Spelling questions ----------
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function esc(str) { return String(str).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  // One spelling question. Spell It: type the whole word. Fix the Chunk: pick the tricky part.
  function spellQ(w, track) {
    const q = { word: w.word, w: w, unit: UNIT_BY_ID[w.unit], text: w.word, answer: w.word };
    if (track === "chunk") { q.options = shuffle([w.chunk].concat(w.alts.slice(0, 2))); q.answer = w.chunk; }
    return q;
  }
  // Word picking. Goals: every rule at the level gets equal turns (not weighted by how many words
  // it has), the same rule never comes twice in a row, and each kid sees the words they've seen
  // least recently, so rounds don't keep serving the same handful of words.
  function seenMap(name) { return (name && store.spellSeen[name]) || {}; }
  function markSeen(name, word) {
    if (!name) return;
    (store.spellSeen[name] = store.spellSeen[name] || {})[word] = Date.now();
    saveStore(store);
  }
  // Random pick from the least-recently-seen third of the candidates (never-seen words first).
  function pickFresh(words, seen) {
    const sorted = shuffle(words.slice()).sort((a, b) => (seen[a.word] || 0) - (seen[b.word] || 0));
    return pick(sorted.slice(0, Math.max(1, Math.min(sorted.length, Math.ceil(sorted.length / 3)))));
  }
  function makeSpellQuestion(level, track, used, name, st) {
    const lv = Math.min(SPELL_MAX_LEVEL, Math.max(1, level));
    const ids = (SPELL_LEVELS[lv] || SPELL_LEVELS[1]).filter(id => UNIT_BY_ID[id]);
    const seen = seenMap(name);
    st = st || {};
    const freshIn = id => UNIT_BY_ID[id].words.filter(w => !used[w.word]);
    // A shuffled "bag" of this level's rules: each rule gets one turn before any gets a second.
    if (st.bagLevel !== lv || !st.bag || !st.bag.length) {
      st.bag = shuffle(ids.slice()); st.bagLevel = lv;
      if (st.bag.length > 1 && st.bag[0] === st.lastUnit) st.bag.push(st.bag.shift());
    }
    let unitId = null;
    while (st.bag.length && !unitId) {
      const id = st.bag.shift();
      if (freshIn(id).length && (id !== st.lastUnit || ids.length === 1)) unitId = id;
    }
    if (!unitId) {   // bag ran dry of usable rules: any rule with unused words, else anything
      const open = ids.filter(id => freshIn(id).length && id !== st.lastUnit);
      unitId = open.length ? pick(open) : pick(ids.filter(id => freshIn(id).length).concat(ids));
    }
    const pool = freshIn(unitId);
    const w = pickFresh(pool.length ? pool : UNIT_BY_ID[unitId].words, seen);
    st.lastUnit = unitId;
    return spellQ(w, track);
  }
  function ruleTip(w) { return w.tip || (UNIT_BY_ID[w.unit] ? UNIT_BY_ID[w.unit].rule : ""); }
  // The word with its tricky chunk highlighted, e.g. fic<b>tion</b>.
  function markChunk(w) {
    const i = w.word.indexOf(w.chunk);
    return esc(w.word.slice(0, i)) + '<b class="chunk">' + esc(w.chunk) + "</b>" + esc(w.word.slice(i + w.chunk.length));
  }
  // The word with a gap where the chunk goes (or the gap filled in).
  function gappedWord(w, fill, cls) {
    const i = w.word.indexOf(w.chunk);
    const mid = fill == null ? '<span class="gap">?</span>' : '<span class="gap filled ' + (cls || "") + '">' + esc(fill) + "</span>";
    return esc(w.word.slice(0, i)) + mid + esc(w.word.slice(i + w.chunk.length));
  }
  function blankSentence(w) { return w.sentence.replace(new RegExp("\\b" + w.word + "\\b", "gi"), "_____"); }

  // ---------- Read-aloud ----------
  // Pre-recorded clips (audio/, made by tools/make-audio.mjs) when they exist; otherwise the
  // device's built-in voice. Speech ignores the sound-effects mute: spelling can't work if kids
  // can't hear the word.
  const CLIPS = window.SPELLING_AUDIO && Array.isArray(window.SPELLING_AUDIO.words) ? window.SPELLING_AUDIO : null;
  const CLIP_WORDS = {};
  if (CLIPS) CLIPS.words.forEach(w => { CLIP_WORDS[w] = 1; });
  const canSpeak = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  function canListen() { return canSpeak || !!CLIPS; }

  // --- built-in voice (fallback) ---
  let voice = null;
  function pickVoice() {
    if (!canSpeak) return null;
    const vs = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    // Downloaded high-quality voices sound far better than the defaults, so try those first.
    const good = vs.find(v => /premium|enhanced|natural|neural/i.test(v.name) && /en[-_]US/i.test(v.lang)) ||
                 vs.find(v => /premium|enhanced|natural|neural/i.test(v.name));
    if (good) return good;
    const preferred = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Karen", "Moira", "Daniel"];
    for (let i = 0; i < preferred.length; i++) {
      const v = vs.find(x => x.name.indexOf(preferred[i]) === 0);
      if (v) return v;
    }
    return vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  }
  if (canSpeak) { voice = pickVoice(); speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); }; }
  // Queue several utterances (e.g. the word slowly, then the sentence at normal speed).
  function speakParts(parts) {
    if (!canSpeak) return;
    try {
      speechSynthesis.cancel();
      if (!voice) voice = pickVoice();
      parts.forEach(p => {
        const u = new SpeechSynthesisUtterance(p.text);
        if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
        u.rate = p.rate || 0.95;
        speechSynthesis.speak(u);
      });
    } catch (e) {}
  }

  // --- pre-recorded clips (Web Audio: exact pauses, no tap needed for each word) ---
  let voiceCtx = null, voiceSources = [], voiceToken = 0;
  const clipCache = {};
  function voiceContext() {
    if (!voiceCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      // iPad/iPhone: play the words even when the silent switch is on (Safari 17+).
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
      try { voiceCtx = new AC(); } catch (e) { return null; }
    }
    return voiceCtx;
  }
  // Browsers only let audio start after a tap or key press, so wake the audio up on each one.
  function unlockVoice() {
    const ctx = CLIPS && voiceContext();
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  }
  ["click", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, unlockVoice, true));
  // Trim the silence around each clip, so the pauses are exactly the ones we ask for.
  function trimClip(buf) {
    const d = buf.getChannelData(0), th = 0.01;
    let a = 0, b = d.length - 1;
    while (a < b && Math.abs(d[a]) < th) a++;
    while (b > a && Math.abs(d[b]) < th) b--;
    const start = Math.max(0, a / buf.sampleRate - 0.03), end = Math.min(buf.duration, b / buf.sampleRate + 0.08);
    return { buf: buf, start: start, dur: Math.max(0.05, end - start) };
  }
  function loadClip(name) {
    if (!clipCache[name]) {
      clipCache[name] = fetch("audio/" + name + "." + (CLIPS.ext || "mp3") + "?v=" + CLIPS.v)
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
        .then(data => new Promise((res, rej) => voiceContext().decodeAudioData(data, res, rej)))
        .then(trimClip)
        .catch(e => { delete clipCache[name]; throw e; });
    }
    return clipCache[name];
  }
  function stopVoice() {
    voiceToken++;
    voiceSources.forEach(src => { try { src.stop(); } catch (e) {} });
    voiceSources = [];
    if (canSpeak) { try { speechSynthesis.cancel(); } catch (e) {} }
  }
  // parts: clip names ("w/bird", "s/bird", "l/b") and pauses in seconds, played in order.
  // If anything can't load, it's said with the built-in voice instead.
  function playClips(parts, fallback) {
    stopVoice();
    const token = voiceToken, ctx = voiceContext();
    if (!ctx) { fallback(); return; }
    Promise.all(parts.filter(p => typeof p === "string").map(loadClip)).then(clips => {
      if (token !== voiceToken) return;
      return (ctx.state === "running" ? Promise.resolve() : ctx.resume()).then(() => {
        if (token !== voiceToken) return;
        let t = ctx.currentTime + 0.05, i = 0;
        parts.forEach(p => {
          if (typeof p === "number") { t += p; return; }
          const c = clips[i++], src = ctx.createBufferSource();
          src.buffer = c.buf;
          src.connect(ctx.destination);
          src.start(t, c.start, c.dur);
          voiceSources.push(src);
          t += c.dur;
        });
      });
    }).catch(() => { if (token === voiceToken) fallback(); });
  }
  function preloadLetters() {
    if (CLIPS && CLIPS.letters) "abcdefghijklmnopqrstuvwxyz".split("").forEach(c => loadClip("l/" + c).catch(() => {}));
  }

  // --- what the game says ---
  // Spelling-test style: the word on its own, a pause, then the word in a sentence.
  function sayWord(w, withSentence) {
    const fallback = () => speakParts([{ text: w.word, rate: 0.7 }].concat(withSentence ? [{ text: w.sentence, rate: 0.8 }] : []));
    if (!CLIP_WORDS[w.word]) { fallback(); return; }
    playClips(withSentence ? ["w/" + w.word, 0.9, "s/" + w.word] : ["w/" + w.word], fallback);
  }
  function saySentence(w) {
    const fallback = () => speakParts([{ text: w.sentence, rate: 0.8 }]);
    if (!CLIP_WORDS[w.word]) { fallback(); return; }
    playClips(["s/" + w.word], fallback);
  }
  // After a miss: "lunch … L, U, N, C, H."
  function spellItOut(w) {
    const fallback = () => speakParts([{ text: w.word, rate: 0.75 }, { text: w.word.toUpperCase().split("").join(". ") + ".", rate: 0.7 }]);
    if (!CLIP_WORDS[w.word] || !CLIPS.letters) { fallback(); return; }
    const parts = ["w/" + w.word, 0.7];
    w.word.split("").forEach((c, i) => { if (i) parts.push(0.3); parts.push("l/" + c); });
    playClips(parts, fallback);
  }
  // How long to leave a missed word on screen: enough for "word … L, E, T, T, E, R" to finish.
  function spellPause(w) { return Math.max(4000, 2600 + w.word.length * 800); }
  function replayQuestion() {
    if (!g || !g.current || g.track === "math") return;
    const q = g.current;
    if (g.track === "chunk" && q.unit && q.unit.homophone) saySentence(q.w);
    else sayWord(q.w, g.track === "spell");
  }

  // ---------- Game screen: which input to show + how the question looks ----------
  function buildKeyboard() {
    const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
    $("keyboard").innerHTML = rows.map(r => '<div class="kb-row">' + r.split("").map(c => '<button data-k="' + c + '">' + c + "</button>").join("") + "</div>").join("") +
      '<div class="kb-row kb-actions"><button class="key-clear" data-k="clear" aria-label="Delete letter">⌫</button><button class="key-enter" data-k="enter">✓ Check</button></div>';
  }
  function setInputMode(track) {
    $("pad").style.display = track === "math" ? "" : "none";
    $("keyboard").style.display = track === "spell" ? "" : "none";
    $("chunkOpts").style.display = track === "chunk" ? "" : "none";
    $("answerBox").style.display = track === "chunk" ? "none" : "";
    $("listenBtn").style.display = track === "math" ? "none" : "";
    $("listenBtn").disabled = !canListen();
    $("listenBtn").textContent = canListen() ? "🔊 Hear it again" : "🔇 This device can't read words aloud";
    $("problemCard").classList.toggle("spelling", track !== "math");
    $("skipBtn").textContent = track === "math" ? "🤔 Skip this one" : "🤔 Skip this word";
  }
  function renderQuestion() {
    const q = g.current, qEl = $("question"), sEl = $("qSentence");
    sEl.style.display = "none";
    if (g.track === "math") {
      qEl.className = "question"; qEl.textContent = q.text;
    } else if (g.track === "spell") {
      qEl.className = "question q-listen"; qEl.textContent = "🔊 Listen & spell";
      sEl.textContent = blankSentence(q.w); sEl.style.display = "";
      sayWord(q.w, true);
    } else {
      if (q.unit && q.unit.homophone) {
        qEl.className = "question q-listen"; qEl.textContent = "Which word fits?";
        sEl.textContent = blankSentence(q.w); sEl.style.display = "";
        saySentence(q.w);
      } else {
        qEl.className = "question"; qEl.innerHTML = gappedWord(q.w);
        sayWord(q.w, false);
      }
      const box = $("chunkOpts");
      box.innerHTML = "";
      box.style.gridTemplateColumns = "repeat(" + q.options.length + ", 1fr)";
      q.options.forEach((o, i) => {
        const b = document.createElement("button");
        b.className = "chunk-opt"; b.setAttribute("data-i", i); b.textContent = o;
        box.appendChild(b);
      });
    }
    renderInput();
  }
  // After a spelling answer, show the right spelling in place.
  function revealSpelling(ok) {
    const q = g.current;
    if (g.track === "chunk") {
      Array.prototype.forEach.call($("chunkOpts").children, b => {
        const o = q.options[Number(b.getAttribute("data-i"))];
        b.classList.toggle("right", o === q.answer);
        b.classList.toggle("wrong", !ok && o === g.input);
      });
      if (q.unit && q.unit.homophone) $("qSentence").textContent = q.w.sentence;
      else $("question").innerHTML = gappedWord(q.w, q.answer, ok ? "ok" : "fix");
    } else if (g.track === "spell") {
      $("qSentence").textContent = q.w.sentence;
    }
  }
  function showSpellFeedback(q, cls) {
    const f = $("feedback");
    f.innerHTML = '<span class="sp-word">' + markChunk(q.w) + "</span> " + esc(ruleTip(q.w));
    f.className = "feedback spell " + cls;
  }
  function chooseChunk(i) {
    if (!g || g.locked || g.track !== "chunk" || !g.current || !g.current.options) return;
    const opt = g.current.options[i];
    if (opt == null) return;
    g.input = opt;
    submit();
  }

  // ---------- Game state ----------
  let g = null;
  let tickHandle = null;
  let lastPlay = null;   // { mode: "game" | "drill", name } — what "Play Again" repeats

  function startGame() {
    const name = currentName();
    if (!name) { $("nameInput").focus(); return; }
    rememberPlayer(name);
    saveStore(store);

    // Resume audio context on user gesture
    if (!store.muted) { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch(e){} }

    const set = settingsFor(name);
    const track = currentTrack();
    const startLevel = track === "math" ? set.startLevel : set.spellLevel;
    lastPlay = { mode: "game", name: name, track: track };
    g = {
      mode: "game",
      track: track,
      used: {},                  // spelling words already asked this round (avoid repeats)
      pickState: {},             // spelling: rule rotation for this round
      ops: set.ops,
      name: name,
      score: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      startLevel: startLevel,
      level: startLevel,
      maxLevel: startLevel,      // highest level reached this round (for badges + records)
      upCount: 0,                // correct answers since the last level change
      downCount: 0,              // misses since the last level change
      roundSeconds: selectedLen,
      timeLeft: selectedLen,
      current: null,
      input: "",
      askedAt: 0,
      locked: false,
      gotSpeedDemon: false,
      wrong: 0,
      skips: 0,
      misses: [],                // problems gotten wrong or skipped (for end-of-round review)
      startMs: nowMs(),
    };
    setHudMode("game");
    setInputMode(track);
    if (track !== "math") preloadLetters();
    show("game");
    updateHud();
    nextProblem();
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(tick, 250);
  }

  // The game screen doubles as the tricky-facts drill screen; this swaps what the HUD shows.
  function setHudMode(mode) {
    const drill = mode === "drill";
    $("hudLevelBox").style.display = drill ? "none" : "";
    $("hudTimeLbl").textContent = drill ? "Left" : "Seconds";
    $("hudTime").textContent = drill ? "" : selectedLen;
    $("hudTimeBox").classList.remove("warn");
    $("timerFill").style.width = drill ? "0%" : "100%";
    $("endDrillBtn").style.display = drill ? "" : "none";
    $("quitBtn").style.display = drill ? "none" : "";
    resetQuitBtn();
    $("comboFlash").textContent = "";
  }

  // Quit a round in progress: nothing is saved. Two taps, so a stray tap doesn't end the game.
  let quitTimer = null;
  function resetQuitBtn() {
    clearTimeout(quitTimer); quitTimer = null;
    $("quitBtn").textContent = "✖ Quit game";
    $("quitBtn").classList.remove("confirm");
  }
  function quitGame() {
    if (!g || g.ended || g.mode !== "game") return;
    if (!quitTimer) {
      $("quitBtn").textContent = "Tap again to quit (this round won't be saved)";
      $("quitBtn").classList.add("confirm");
      quitTimer = setTimeout(resetQuitBtn, 3500);
      return;
    }
    resetQuitBtn();
    g.ended = true; g.locked = true;
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    stopVoice();
    const name = g.name;
    refreshHome();
    preselectPlayer(name);
    show("home");
  }

  // An untimed drill. Misses come back (with a hint) until answered.
  //   kind "tricky": a kid's tricky facts (math) or tricky words (spelling, played as Spell It)
  //   kind "rule":   up to 10 words from one spelling rule, as Spell It or Fix the Chunk
  function drillQueue(name, d) {
    if (d.kind === "rule") {
      const unit = UNIT_BY_ID[d.unit];
      if (!unit) return [];
      const seen = seenMap(name);   // the 10 words this kid has seen least recently, in random order
      const least = shuffle(unit.words.slice()).sort((a, b) => (seen[a.word] || 0) - (seen[b.word] || 0)).slice(0, 10);
      return shuffle(least).map(w => spellQ(w, d.track));
    }
    const pd = store.players[name] ? normalize(store.players[name]) : null;
    const items = pd ? trickyItems(pd, d.subject) : [];
    return shuffle(items.map(it => d.subject === "spell" ? spellQ(WORD_INDEX[it.text], "spell") : { text: it.text, answer: it.answer }));
  }
  function startDrill(name, d) {
    const queue = drillQueue(name, d);
    if (!queue.length) return;
    if (!store.muted) { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch(e){} }
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    const track = d.kind === "rule" ? d.track : (d.subject === "spell" ? "spell" : "math");
    lastPlay = { mode: "drill", name: name, drill: d };
    g = {
      mode: "drill", drill: d, track: track, name: name, score: 0, correct: 0, streak: 0, bestStreak: 0,
      level: 0, startLevel: 0, maxLevel: 0, upCount: 0, downCount: 0,
      roundSeconds: 0, timeLeft: Infinity, current: null, input: "", askedAt: 0, locked: false,
      gotSpeedDemon: false, wrong: 0, skips: 0, misses: [],
      queue: queue, total: queue.length, missedInDrill: {}, firstTry: [],
    };
    setHudMode("drill");
    setInputMode(track);
    if (track !== "math") preloadLetters();
    show("game");
    updateHud();
    nextProblem();
  }

  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  function tick() {
    if (g.pausedAt) return;   // clock stops while a missed word's rule is on screen
    g.timeLeft = Math.max(0, g.roundSeconds - (nowMs() - g.startMs) / 1000);
    const secs = Math.ceil(g.timeLeft);
    $("hudTime").textContent = secs;
    $("timerFill").style.width = (g.timeLeft / g.roundSeconds * 100) + "%";
    $("hudTimeBox").classList.toggle("warn", secs <= 10);
    if (g.timeLeft <= 0) endGame();
  }

  function nextProblem() {
    if (!g || g.ended) return;
    if (g.pausedAt) { g.startMs += nowMs() - g.pausedAt; g.pausedAt = 0; }
    if (g.mode === "drill") {
      if (!g.queue.length) { endDrill(); return; }
      g.current = g.queue[0];
    } else if (g.track === "math") {
      g.current = makeProblem(g.level, g.ops);
    } else {
      g.current = makeSpellQuestion(g.level, g.track, g.used, g.name, g.pickState);
      g.used[g.current.word] = 1;
    }
    if (g.track !== "math" && g.current.word) markSeen(g.name, g.current.word);
    g.input = "";
    g.askedAt = nowMs();
    g.locked = false;
    $("feedback").textContent = "";
    $("feedback").className = "feedback";
    renderQuestion();
  }

  function renderInput() {
    const box = $("answerBox");
    if (g.track === "spell") {
      // the newest letter pops in, so typing feels lively
      box.innerHTML = g.input === "" ? '<span class="placeholder">type the word</span>'
        : esc(g.input.slice(0, -1)) + '<span class="pop">' + esc(g.input.slice(-1)) + "</span>";
    } else {
      box.textContent = g.input === "" ? "?" : g.input;
    }
  }

  function updateHud() {
    $("hudScore").textContent = g.score;
    $("hudStreak").textContent = g.streak;
    $("hudLevel").textContent = g.level;
    if (g.mode === "drill") {
      $("hudTime").textContent = g.queue.length;
      $("timerFill").style.width = (g.total ? 100 * (g.total - g.queue.length) / g.total : 0) + "%";
    }
  }

  // ---------- Input handling ----------
  function pressKey(k) {
    if (!g || g.locked) return;
    if (k === "clear") { g.input = g.input.slice(0, -1); renderInput(); return; }
    if (k === "enter") { submit(); return; }
    if (g.track === "math" && /^[0-9]$/.test(k)) {
      if (g.input.length < 4) { g.input += k; renderInput(); }
    } else if (g.track === "spell" && /^[a-z]$/.test(k)) {
      if (g.input.length < 16) { g.input += k; renderInput(); }
    }
  }

  function submit() {
    if (!g || g.locked || g.input === "") return;
    const elapsed = (nowMs() - g.askedAt) / 1000;
    const card = $("problemCard");
    const q = g.current;
    const right = g.track === "math" ? parseInt(g.input, 10) === q.answer
                : g.track === "spell" ? g.input.toLowerCase() === q.word.toLowerCase()
                : g.input === q.answer;

    if (right) {
      g.locked = true;
      g.correct++;
      g.streak++;
      g.bestStreak = Math.max(g.bestStreak, g.streak);

      const sc = TRACK_SCORING[g.track] || TRACK_SCORING.math;
      const combo = comboMultiplier(g.streak);
      const speedBonus = Math.round(Math.max(0, sc.speedMax * (1 - elapsed / sc.window)));
      const gained = Math.round((sc.base + speedBonus) * combo);
      g.score += gained;
      if (g.track === "math" && elapsed <= SPEED_DEMON_SEC) g.gotSpeedDemon = true;
      if (g.track !== "math") revealSpelling(true);

      sfx.correct();
      card.classList.remove("wrong");
      void card.offsetWidth;
      card.classList.add("correct");
      $("feedback").textContent = "+" + gained + (combo > 1 ? "  (×" + combo + " combo!)" : "");
      $("feedback").className = "feedback good";
      showCombo(g.streak, combo);
      celebrateCorrect(gained);

      if (g.mode === "drill") {
        // Right on the first try clears the fact; either way it leaves the queue.
        if (!g.missedInDrill[g.current.text]) g.firstTry.push(g.current.text);
        g.queue.shift();
      }

      // Level up after enough correct answers at this level (not during drills).
      if (g.mode !== "drill") g.upCount++;
      const atTop = g.track !== "math" && g.level >= SPELL_MAX_LEVEL;
      if (g.mode !== "drill" && g.upCount >= LEVEL_UP_EVERY && !atTop) {
        g.level++; g.upCount = 0; g.downCount = 0;
        g.maxLevel = Math.max(g.maxLevel, g.level);
        levelUp();
      }

      updateHud();
      const me = g;
      setTimeout(() => { card.classList.remove("correct"); if (g === me && g.timeLeft > 0) nextProblem(); }, g.track === "math" ? 420 : 900);
    } else {
      g.locked = true;
      g.streak = 0;
      g.wrong++;
      // what they actually wrote (for Fix the Chunk: the word with their chunk in it)
      const typed = g.track === "chunk"
        ? q.w.word.slice(0, q.w.word.indexOf(q.w.chunk)) + g.input + q.w.word.slice(q.w.word.indexOf(q.w.chunk) + q.w.chunk.length)
        : g.input;
      g.misses.push({ text: q.text, answer: q.answer, typed: typed, kind: "wrong" });
      sfx.wrong();
      card.classList.remove("correct");
      void card.offsetWidth;
      card.classList.add("wrong");
      const drill = g.mode === "drill", spelling = g.track !== "math";
      if (spelling) {
        if (g.mode === "game") g.pausedAt = nowMs();
        revealSpelling(false);
        showSpellFeedback(q, "bad");
        spellItOut(q.w);
      } else {
        $("feedback").textContent = drill ? hintFor(q.text, q.answer) : "The answer was " + q.answer;
        $("feedback").className = "feedback bad";
      }
      if (drill) requeueInDrill();
      registerMiss();
      updateHud();
      // Show the answer (spelling: with its rule; math drills: a hint) briefly, then move on.
      const me = g;
      setTimeout(() => { card.classList.remove("wrong"); if (g === me && g.timeLeft > 0) nextProblem(); },
        spelling ? spellPause(g.current.w) : drill ? 3200 : 1400);
    }
  }

  // A miss is a wrong answer OR a skip. Too many at a level drops the difficulty.
  function requeueInDrill() {
    g.missedInDrill[g.current.text] = true;
    g.queue.push(g.queue.shift());   // try it again after the others
  }

  function registerMiss() {
    if (g.mode === "drill") return;   // drills don't change levels
    g.downCount++;
    if (g.downCount >= LEVEL_DOWN_AFTER && g.level > 1) {
      g.level--; g.upCount = 0; g.downCount = 0;
      levelDown();
    }
  }

  function skipQuestion() {
    if (!g || g.locked) return;
    g.locked = true;
    g.streak = 0;
    g.skips++;
    g.misses.push({ text: g.current.text, answer: g.current.answer, kind: "skip" });
    sfx.leveldown();
    const card = $("problemCard");
    card.classList.remove("correct", "wrong");
    const drill = g.mode === "drill", spelling = g.track !== "math";
    if (spelling) {
      g.input = "";
      if (g.mode === "game") g.pausedAt = nowMs();
      revealSpelling(false);
      showSpellFeedback(g.current, "skip");
      spellItOut(g.current.w);
    } else {
      $("feedback").textContent = drill ? hintFor(g.current.text, g.current.answer) : "Skipped — the answer was " + g.current.answer;
      $("feedback").className = "feedback skip";
    }
    if (drill) requeueInDrill();
    registerMiss();
    updateHud();
    const me = g;
    setTimeout(() => { if (g === me && g.timeLeft > 0) nextProblem(); },
      spelling ? spellPause(g.current.w) : drill ? 3200 : 1400);
  }

  function comboMultiplier(streak) {
    if (streak >= 15) return 3;
    if (streak >= 10) return 2.5;
    if (streak >= 7) return 2;
    if (streak >= 4) return 1.5;
    return 1;
  }

  function showCombo(streak, combo) {
    const el = $("comboFlash");
    if (combo > 1) {
      el.textContent = "🔥 " + streak + " streak  ×" + combo + "!";
    } else if (streak > 1) {
      el.textContent = "🔥 " + streak + " in a row!";
    } else {
      el.textContent = "";
    }
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  // On a spelling level-up, name the rule that just got mixed in.
  function newRuleNote(level) {
    if (!g || g.track === "math" || level > SPELL_MAX_LEVEL || !SPELL_LEVELS[level - 1]) return "";
    const fresh = SPELL_LEVELS[level].filter(id => SPELL_LEVELS[level - 1].indexOf(id) < 0).map(id => UNIT_BY_ID[id]).filter(Boolean);
    return fresh.length ? "  New: " + fresh[0].emoji + " " + fresh[0].name : "";
  }

  function levelUp() {
    sfx.levelup();
    const el = $("comboFlash");
    el.textContent = "🚀 LEVEL " + g.level + "!" + newRuleNote(g.level);
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    confettiBurst(28);
  }

  function levelDown() {
    sfx.leveldown();
    const el = $("comboFlash");
    el.textContent = "↘️ Easier ones — Level " + g.level;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  // Small, quick celebration on a correct answer: a floating "+points" and a few sparkles
  // near the answer box. (Big confetti stays reserved for level-ups and new bests.)
  function celebrateCorrect(gained) {
    const box = $("answerBox").offsetParent ? $("answerBox") : $("question");   // answer box is hidden in Fix the Chunk
    if (!box || !box.getBoundingClientRect) return;
    const r = box.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    const fp = document.createElement("div");
    fp.className = "float-points";
    fp.textContent = "+" + gained;
    fp.style.left = cx + "px"; fp.style.top = cy + "px";
    document.body.appendChild(fp);
    setTimeout(() => fp.remove(), 800);

    const marks = ["✨", "⭐", "💫"];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      s.textContent = pick(marks);
      const ang = (Math.PI * 2 * i) / 5 + Math.random();
      const dist = 30 + Math.random() * 28;
      s.style.left = cx + "px"; s.style.top = cy + "px";
      s.style.setProperty("--dx", (Math.cos(ang) * dist) + "px");
      s.style.setProperty("--dy", (Math.sin(ang) * dist - 18) + "px");
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }

  // ---------- End of round ----------
  function endGame() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    if (!g) return;
    g.ended = true;

    const pd = playerData(g.name);
    const lenNow = g.roundSeconds || 60;
    const track = g.track || "math", spelling = track !== "math";
    // "Best" is per track + length: compare against the best for THIS track and length only.
    const isNewBest = g.correct >= 1 && g.score > lengthStats(pd, lenNow, track).best;

    // Award badges
    const newly = [];
    function award(id) {
      if (!pd.badges.includes(id)) { pd.badges.push(id); newly.push(id); }
    }
    if (spelling) {
      award("sp-first");
      if (g.bestStreak >= 10) award("sp-streak");
      if (g.maxLevel >= 7) award("sp-rules");
      if (g.maxLevel >= SPELL_MAX_LEVEL) award("sp-master");
      if (g.correct >= 25) award("sp-century");
      if (g.correct >= 8 && !g.wrong && !g.skips) award("sp-perfect");
    } else {
      award("first");
      if (g.bestStreak >= 10) award("fire");
      if (g.gotSpeedDemon) award("speed");
      if (g.maxLevel >= 3) award("lvl3");
      if (g.maxLevel >= 5) award("master");
      if (g.score >= 500) award("high");
      if (g.correct >= 25) award("century");
    }

    // Record the round in history — only count real rounds (solved at least one problem).
    let recordedEntry = null;
    if (g.correct >= 1) {
      recordedEntry = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), score: g.score, level: g.maxLevel, solved: g.correct, ts: Date.now(), len: lenNow };
      const missedTexts = [];
      g.misses.forEach(mi => { if (missedTexts.indexOf(mi.text) < 0) missedTexts.push(mi.text); });
      if (missedTexts.length) recordedEntry.missed = missedTexts.slice(0, 12).join("|");
      if (spelling) { recordedEntry.track = track; recordedEntry.ls = SPELL_SCALE; }
      pd.history.unshift(recordedEntry);
      pd.history = pd.history.slice(0, 500);
      recompute(pd);
    }

    saveStore(store);

    // Push to the cloud (fire-and-forget; the game is already saved locally and will re-push on the
    // next successful sync if this fails).
    if (cloudEnabled()) {
      setSync("syncing");
      const ops = [];
      if (recordedEntry) ops.push(cloudPushGame(g.name, recordedEntry));
      newly.forEach(id => ops.push(cloudPushBadge(g.name, id)));
      Promise.all(ops).then(() => setSync("synced")).catch(() => setSync("offline"));
    }

    // Render results
    setResultsMode("game");
    $("resultsName").textContent = g.name + " · " + lenLabel(lenNow) + " " + (spelling ? TRACK_NAME[track] : "game");
    $("finalSolvedLbl").textContent = spelling ? "Words right" : "Solved";
    $("finalScore").textContent = g.score;
    $("finalSolved").textContent = g.correct;
    $("finalStreak").textContent = g.bestStreak;
    $("finalLevel").textContent = g.maxLevel;

    // solved / skipped / wrong breakdown
    const parts = [g.correct + (spelling ? " words right" : " solved")];
    if (g.skips) parts.push(g.skips + " skipped");
    if (g.wrong) parts.push(g.wrong + " wrong");
    $("finalBreakdown").textContent = parts.join("  ·  ");

    // per-length records (includes the round just recorded above)
    const st = lengthStats(pd, lenNow, track);
    $("finalRecordsHead").textContent = "Your " + lenLabel(lenNow) + (spelling ? " " + TRACK_NAME[track] : "") + " records";
    $("finalBest").textContent = st.best;
    $("finalAvg").textContent = st.average;
    $("finalGames").textContent = st.games;
    const recentEl = $("finalRecent");
    recentEl.innerHTML = "";
    st.history.slice(0, 6).forEach((h, i) => {
      const chip = document.createElement("div");
      chip.className = "rs" + (i === 0 ? " newest" : "");
      chip.textContent = h.score;
      recentEl.appendChild(chip);
    });

    // Review missed problems (wrong or skipped) with a simple hint for each.
    const seen = {};
    renderReview(g.misses.filter(mi => { if (seen[mi.text]) return false; seen[mi.text] = 1; return true; }).slice(0, 6), "📝 Let's review", spelling);

    $("newBest").textContent = "🎉 NEW " + lenLabel(lenNow).toUpperCase() + " BEST! 🎉";
    $("newBest").style.display = isNewBest ? "block" : "none";

    const earnedWrap = $("earnedWrap");
    const earnedRow = $("earnedRow");
    earnedRow.innerHTML = "";
    if (newly.length) {
      earnedWrap.style.display = "block";
      newly.forEach(id => {
        const b = ALL_BADGES.find(x => x.id === id);
        const div = document.createElement("div");
        div.className = "badge just-earned";
        div.innerHTML = '<div class="ico">' + b.ico + '</div><div class="name">' + b.name + '</div>';
        earnedRow.appendChild(div);
      });
    } else {
      earnedWrap.style.display = "none";
    }

    show("results");
    if (isNewBest) { sfx.newbest(); confettiBurst(80); }
    else if (newly.length) { confettiBurst(40); }
  }

  function renderReview(items, title, spelling) {
    const list = $("reviewList");
    list.innerHTML = "";
    $("reviewTitle").textContent = title;
    $("reviewWrap").style.display = items.length ? "block" : "none";
    items.forEach(mi => {
      const div = document.createElement("div");
      div.className = "review-item";
      const w = spelling ? WORD_INDEX[mi.text] : null;
      if (w) {   // spelling: the word (tap to hear), its tricky chunk, the rule, and what they wrote
        div.classList.add("speakable");
        div.setAttribute("data-word", w.word);
        div.innerHTML =
          '<div class="rev-q">🔊 ' + markChunk(w) + "</div>" +
          '<div class="rev-hint">' + esc(ruleTip(w)) +
          (mi.typed && mi.typed !== w.word ? ' <span class="rev-typed">You wrote “' + esc(mi.typed) + "”</span>" : "") + "</div>";
      } else {
        div.innerHTML =
          '<div class="rev-q">' + mi.text + ' = ' + mi.answer + '</div>' +
          '<div class="rev-hint">' + hintFor(mi.text, mi.answer) + '</div>';
      }
      list.appendChild(div);
    });
  }

  // The results screen shows a full scorecard after a round, and a lighter summary after a drill.
  function setResultsMode(mode) {
    const drill = mode === "drill";
    $("resultsTitle").textContent = drill ? "🎯 Tricky facts done!" : "⏰ Time's Up!";
    $("finalScoreLbl").textContent = drill ? "cleared on the first try" : "points";
    $("resultsStats").style.display = drill ? "none" : "";
    $("resultsRecords").style.display = drill ? "none" : "";
    $("playAgainBtn").textContent = "▶ Play Again";
    $("homeBtn").textContent = drill ? "📚 Practice" : "🏠 Home";
    if (drill) { $("newBest").style.display = "none"; $("earnedWrap").style.display = "none"; }
  }

  function endDrill() {
    g.ended = true;
    const pd = playerData(g.name);
    const now = Date.now();
    g.firstTry.forEach(t => { pd.cleared[t] = now; });
    saveStore(store);
    if (cloudEnabled() && g.firstTry.length) trackExtras(g.firstTry.map(t => cloudPushCleared(g.name, t, now)));

    const keepPracticing = Object.keys(g.missedInDrill);
    g.queue.forEach(q => { if (keepPracticing.indexOf(q.text) < 0) keepPracticing.push(q.text); });   // unfinished if stopped early

    setResultsMode("drill");
    const spelling = g.track !== "math", d = g.drill || { kind: "tricky", subject: "math" }, noun = spelling ? "word" : "fact";
    if (d.kind === "rule") {
      const unit = UNIT_BY_ID[d.unit];
      $("resultsTitle").textContent = "📖 Rule practice done!";
      $("resultsName").textContent = g.name + " · " + (unit ? unit.emoji + " " + unit.name : "") + " · " + TRACK_NAME[g.track];
    } else {
      $("resultsTitle").textContent = spelling ? "🎯 Tricky words done!" : "🎯 Tricky facts done!";
      $("resultsName").textContent = g.name + " · " + g.total + " tricky " + noun + (g.total === 1 ? "" : "s");
    }
    $("finalScore").textContent = g.firstTry.length + " / " + g.total;
    const lastTyped = {};
    g.misses.forEach(m => { if (m.typed) lastTyped[m.text] = m.typed; });
    renderReview(keepPracticing.map(t => ({ text: t, answer: spelling ? t : answerFor(t), typed: lastTyped[t] })), "📝 Keep practicing these", spelling);
    $("playAgainBtn").textContent = d.kind === "rule" ? "📖 Practice again"
      : trickyItems(pd, d.subject).length ? "🎯 Drill again" : "▶ Play a round";
    show("results");
    confettiBurst(g.firstTry.length === g.total ? 70 : 25);
    if (g.firstTry.length === g.total) sfx.newbest();
  }

  // ---------- Home screen rendering ----------
  let selectedName = null;
  function currentName() { return selectedName ? selectedName.trim() : ""; }

  function clearPicks() {
    Array.prototype.forEach.call(document.querySelectorAll("#picker .pick"), b => b.classList.remove("selected"));
  }

  function markLen() {
    Array.prototype.forEach.call(document.querySelectorAll("#lenPicker .lpick"), b => {
      b.classList.toggle("selected", Number(b.getAttribute("data-len")) === selectedLen);
    });
  }
  function selectLength(len) {
    selectedLen = len;
    store.lastLen = len;
    saveStore(store);
    markLen();
    refreshHomeStats();
  }

  function selectPlayer(name, btn) {
    selectedName = name;
    clearPicks();
    if (btn) btn.classList.add("selected");
    refreshHomeStats();
  }

  function refreshHome() {
    // Reset the picker each time we land on home so the next kid chooses fresh.
    selectedName = null;
    clearPicks();
    const inp = $("nameInput");
    inp.style.display = "none";
    inp.value = "";
    refreshHomeStats();
  }

  function refreshHomeStats() {
    const name = currentName();
    const pd = name && store.players[name]
      ? normalize(store.players[name])
      : { badges: [], history: [] };
    const track = currentTrack(), spelling = track !== "math";
    const shelfBadges = spelling ? SPELL_BADGES : BADGES;
    const st = lengthStats(pd, selectedLen, track);   // scores/history for this track + length
    $("homeBest").textContent = st.best;
    $("homeLevel").textContent = st.topLevel;
    $("homeBadges").textContent = shelfBadges.filter(b => (pd.badges || []).indexOf(b.id) >= 0).length;   // shared across lengths
    $("homeGames").textContent = st.games;
    $("homeLast").textContent = st.last;
    $("homeAvg").textContent = st.average;
    const label = lenLabel(selectedLen) + (spelling ? " " + TRACK_NAME[track] : "");
    $("recordsHead").textContent = name ? ("Your " + label + " records") : ("Pick a player · " + label);
    $("spellModeWrap").style.display = spelling ? "" : "none";
    Array.prototype.forEach.call(document.querySelectorAll("#spellModePicker .pick"), b =>
      b.classList.toggle("selected", b.getAttribute("data-mode") === store.spellMode));
    markLen();

    const startBtn = $("startBtn");
    if (name) { startBtn.disabled = false; startBtn.textContent = "▶ Start, " + name + "!"; }
    else { startBtn.disabled = true; startBtn.textContent = "▶ Pick a player"; }

    // badge shelf reflects current player's earned badges
    const shelf = $("badgeShelf");
    shelf.innerHTML = "";
    shelfBadges.forEach(b => {
      const earned = pd.badges.includes(b.id);
      const div = document.createElement("div");
      div.className = "badge" + (earned ? "" : " locked");
      div.innerHTML = '<div class="ico">' + (earned ? b.ico : "🔒") + '</div><div class="name">' + b.name + '</div>';
      shelf.appendChild(div);
    });

    // recent games list for the selected player + length
    const list = $("historyList");
    list.innerHTML = "";
    if (!st.history.length) {
      const empty = document.createElement("div");
      empty.className = "hist-empty";
      empty.textContent = name ? ("No " + label + " games yet — play a round!") : "Pick a player to see their games.";
      list.appendChild(empty);
    } else {
      st.history.forEach(h => {
        const when = new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const row = document.createElement("div");
        row.className = "hist-row";
        row.innerHTML =
          '<span class="h-score">' + h.score + '</span>' +
          '<span class="h-meta">Lv ' + gameLevel(h) + ' · ' + h.solved + (spelling ? " words" : " solved") + '</span>' +
          '<span class="h-date">' + when + '</span>';
        list.appendChild(row);
      });
    }
  }

  // ---------- Tabs ----------
  function openTab(tab) {
    if (tab === "practice") openPractice();
    else if (tab === "records") { renderRecords(); show("records"); }
    else { refreshHomeStats(); show("home"); }
  }
  // Re-render whatever is on screen (e.g. after a cloud sync brings in new data).
  function refreshVisible() {
    refreshHomeStats();
    if (screens.practice.classList.contains("active")) renderTricky();
    if (screens.records.classList.contains("active")) renderRecords();
    if (screens.settings.classList.contains("active") && gateUnlocked) renderSettings();
  }
  function preselectPlayer(name) {
    const btn = Array.prototype.find.call(document.querySelectorAll("#picker .pick"), b => b.getAttribute("data-name") === name);
    if (btn) { $("nameInput").style.display = "none"; selectPlayer(name, btn); }
  }

  // ---------- Tricky facts (Practice tab) ----------
  let trickyKid = null;
  function trickyNames() {
    const others = Object.keys(store.players).filter(n => KIDS.indexOf(n) < 0 && HIDDEN_PLAYERS.indexOf(n.toLowerCase()) < 0 && (store.players[n].history || []).length);
    return KIDS.concat(others).slice(0, 4);
  }
  function renderTricky() {
    const names = trickyNames();
    if (names.indexOf(trickyKid) < 0) trickyKid = names.indexOf(selectedName) >= 0 ? selectedName : names[0];
    const kids = $("trickyKids");
    kids.innerHTML = "";
    kids.style.gridTemplateColumns = "repeat(" + names.length + ", 1fr)";
    names.forEach(n => {
      const b = document.createElement("button");
      b.className = "pick" + (n === trickyKid ? " selected" : "");
      b.setAttribute("data-name", n);
      b.textContent = n;
      kids.appendChild(b);
    });
    const spell = store.subject === "spell", noun = spell ? "word" : "fact";
    $("trickyTitle").textContent = spell ? "🎯 Tricky words" : "🎯 Tricky facts";
    $("trickySub").textContent = spell ? "Words missed in recent spelling rounds. Tap one to hear it, then drill them until they stick!"
                                       : "Facts missed in recent rounds. Drill them until they stick!";
    const pd = store.players[trickyKid] ? normalize(store.players[trickyKid]) : { history: [], cleared: {} };
    const items = trickyItems(pd, store.subject);
    const list = $("trickyList");
    list.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "tricky-empty";
      empty.textContent = "No tricky " + noun + "s right now — nice work! Anything " + trickyKid + " misses in a round will show up here.";
      list.appendChild(empty);
      $("drillBtn").style.display = "none";
      return;
    }
    items.forEach(f => {
      const chip = document.createElement("div");
      chip.className = "tricky-chip" + (spell ? " speakable" : "");
      if (spell) { chip.setAttribute("data-word", f.text); chip.innerHTML = markChunk(WORD_INDEX[f.text]); }
      else chip.textContent = f.text;
      chip.title = "Missed " + f.count + (f.count === 1 ? " time" : " times") + " recently";
      list.appendChild(chip);
    });
    $("drillBtn").style.display = "";
    $("drillBtn").textContent = "▶ Drill " + (items.length === 1 ? "this " + noun : "these " + items.length + " " + noun + "s");
  }

  // ---------- Spelling rules (Practice tab) ----------
  let practiceUnit = null;
  function renderRules() {
    if (!SPELL_UNITS.length) return;
    if (!UNIT_BY_ID[practiceUnit]) {   // start on the newest rule at this kid's spelling level
      const lvl = settingsFor(trickyKid || KIDS[0]).spellLevel;
      practiceUnit = (SPELL_LEVELS[lvl] || SPELL_LEVELS[1]).slice(-1)[0];
    }
    const picker = $("rulePicker");
    picker.innerHTML = "";
    SPELL_UNITS.forEach(u => {
      const b = document.createElement("button");
      b.className = "rule-chip" + (u.id === practiceUnit ? " selected" : "");
      b.setAttribute("data-unit", u.id);
      b.textContent = u.emoji + " " + u.name;
      picker.appendChild(b);
    });
    const u = UNIT_BY_ID[practiceUnit];
    $("ruleCard").innerHTML =
      '<div class="rule-name">' + u.emoji + " " + esc(u.name) + "</div>" +
      '<div class="rule-text">' + esc(u.rule) + "</div>" +
      '<div class="rule-words">' + u.words.map(w => '<button class="rule-word speakable" data-word="' + esc(w.word) + '">' + markChunk(w) + "</button>").join("") + "</div>" +
      '<div class="rule-hint">' + (canListen() ? "Tap a word to hear it in a sentence." : "") + "</div>";
  }
  function openPractice() {
    if (!$("numPicker").children.length) buildNumPicker();
    renderPractice();
    renderTricky();
    renderRules();
    show("practice");
  }

  // ---------- Subject (Math / Spelling) ----------
  function setSubject(subj) {
    store.subject = subj === "spell" ? "spell" : "math";
    saveStore(store);
    applySubject();
  }
  function applySubject() {
    const spell = store.subject === "spell";
    Array.prototype.forEach.call(document.querySelectorAll("#subjectSwitch .subj"), b =>
      b.classList.toggle("active", b.getAttribute("data-subject") === store.subject));
    $("mathTables").style.display = spell ? "none" : "";
    $("spellRules").style.display = spell ? "" : "none";
    $("recordsModeWrap").style.display = spell ? "" : "none";
    if (screens.practice.classList.contains("active")) { renderTricky(); renderRules(); }
    if (screens.records.classList.contains("active")) renderRecords();
    refreshHomeStats();
  }
  function setSpellMode(mode) {
    store.spellMode = mode === "chunk" ? "chunk" : "spell";
    saveStore(store);
    refreshHomeStats();
    if (screens.records.classList.contains("active")) renderRecords();
  }

  // ---------- Records tab: family board + progress chart ----------
  let chartLen = null;
  function gamesWord(n) { return n + (n === 1 ? " game" : " games"); }
  function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }

  function renderRecords() {
    if (!chartLen) chartLen = selectedLen;
    const track = currentTrack();
    Array.prototype.forEach.call(document.querySelectorAll("#recordsModePicker .pick"), b =>
      b.classList.toggle("selected", b.getAttribute("data-mode") === store.spellMode));
    $("boardSub").textContent = "Best score for each game length" + (track === "math" ? " (math)." : " (" + TRACK_NAME[track] + ").");
    let html = "<thead><tr><th></th>" + KIDS.map(k => "<th>" + k + "</th>").join("") + "</tr></thead><tbody>";
    LENGTHS.forEach(len => {
      const stats = KIDS.map(k => store.players[k] ? lengthStats(normalize(store.players[k]), len, track) : { best: 0, games: 0, average: 0 });
      const top = Math.max.apply(null, stats.map(s => s.best));
      html += "<tr><th>" + lenLabel(len) + "</th>" + stats.map(s => {
        if (!s.games) return '<td class="none">—</td>';
        const crown = s.best === top && top > 0 ? ' <span class="crown" title="Family best">👑</span>' : "";
        return '<td><div class="b-best">' + s.best + crown + '</div><div class="b-sub">avg ' + s.average + " · " + gamesWord(s.games) + "</div></td>";
      }).join("") + "</tr>";
    });
    $("familyBoard").innerHTML = html + "</tbody>";
    Array.prototype.forEach.call(document.querySelectorAll("#chartLenPicker .pick"), b =>
      b.classList.toggle("selected", Number(b.getAttribute("data-len")) === chartLen));
    renderChart();
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  // Each kid's games at this length, oldest → newest, numbered 1..N (last 30 shown).
  // Color follows the kid (fixed slot), never their rank.
  function chartSeries(len, track) {
    return KIDS.map((k, i) => {
      const pd = store.players[k] ? normalize(store.players[k]) : null;
      const games = pd ? lengthStats(pd, len, track).history.slice().reverse() : [];
      const pts = games.map((h, j) => ({ n: j + 1, score: h.score || 0, ts: h.ts, level: gameLevel(h) })).slice(-30);
      return { name: k, color: SERIES_COLORS[i], pts: pts };
    });
  }

  function renderChart() {
    const wrap = $("chartWrap"), table = $("chartTable");
    const track = currentTrack();
    const series = chartSeries(chartLen, track).filter(s => s.pts.length);
    const all = [].concat.apply([], series.map(s => s.pts));
    if (!all.length) {
      wrap.innerHTML = '<div class="tricky-empty">No ' + lenLabel(chartLen) + (track === "math" ? "" : " " + TRACK_NAME[track]) + " games yet. Play one to start the chart!</div>";
      table.innerHTML = "";
      return;
    }
    const W = 520, H = 250, L = 40, R = 70, T = 14, B = 36;
    const xs = all.map(p => p.n), xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    const topScore = Math.max.apply(null, all.map(p => p.score));
    const step = niceStep(topScore / 4);
    const yMax = Math.max(step * 4, step * Math.ceil(topScore / step));
    const x = n => xMax === xMin ? L + (W - L - R) / 2 : L + (n - xMin) / (xMax - xMin) * (W - L - R);
    const y = v => T + (1 - v / yMax) * (H - T - B);

    let svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Scores per game for ' + lenLabel(chartLen) + ' rounds">';
    for (let v = 0; v <= yMax + 0.001; v += step) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
             '<text class="axis" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + "</text>";
    }
    const ticks = [], every = Math.max(1, Math.ceil((xMax - xMin) / 5));
    for (let n = xMin; n <= xMax; n += every) ticks.push(n);
    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
    ticks.forEach(n => { svg += '<text class="axis" x="' + x(n).toFixed(1) + '" y="' + (H - B + 18) + '" text-anchor="middle">' + n + "</text>"; });
    svg += '<text class="axis" x="' + (W - R) + '" y="' + (H - 3) + '" text-anchor="end">game #</text>';

    const labels = [];
    series.forEach(s => {
      if (s.pts.length > 1) {
        const d = s.pts.map((p, i) => (i ? "L" : "M") + x(p.n).toFixed(1) + " " + y(p.score).toFixed(1)).join(" ");
        svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      }
      s.pts.forEach(p => {
        svg += '<circle cx="' + x(p.n).toFixed(1) + '" cy="' + y(p.score).toFixed(1) + '" r="4" fill="' + s.color + '" stroke="#fff" stroke-width="2"/>';
      });
      const lp = s.pts[s.pts.length - 1];
      labels.push({ name: s.name, x: x(lp.n) + 9, y: y(lp.score) + 4 });
    });
    if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 14) {   // keep the two end labels apart
      const mid = (labels[0].y + labels[1].y) / 2, upper = labels[0].y <= labels[1].y ? 0 : 1;
      labels[upper].y = mid - 7; labels[1 - upper].y = mid + 7;
    }
    labels.forEach(lb => { svg += '<text class="dlabel" x="' + lb.x.toFixed(1) + '" y="' + lb.y.toFixed(1) + '">' + lb.name + "</text>"; });
    svg += '<line class="xhair" id="xhair" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/></svg>';

    wrap.innerHTML =
      '<div class="legend">' + series.map(s => '<span class="lg"><i style="background:' + s.color + '"></i>' + s.name + "</span>").join("") + "</div>" +
      '<div class="chart-box">' + svg + '<div class="chart-tip" id="chartTip"></div></div>';

    // Hover/tap: snap to the nearest game # and show every kid's score at that game.
    const byN = {};
    series.forEach(s => s.pts.forEach(p => { (byN[p.n] = byN[p.n] || []).push({ s: s, p: p }); }));
    const ns = Object.keys(byN).map(Number).sort((a, b) => a - b);
    const svgEl = wrap.querySelector("svg"), tip = $("chartTip"), xhair = $("xhair");
    function hover(ev) {
      const r = svgEl.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * W / r.width;
      let near = ns[0];
      ns.forEach(n => { if (Math.abs(x(n) - sx) < Math.abs(x(near) - sx)) near = n; });
      xhair.setAttribute("x1", x(near)); xhair.setAttribute("x2", x(near)); xhair.style.display = "";
      tip.innerHTML = '<div class="tt-h">Game #' + near + "</div>" + byN[near].map(o =>
        '<div class="tt-r"><i style="background:' + o.s.color + '"></i>' + o.s.name + " <b>" + o.p.score + "</b> <span>" +
        fmtDate(o.p.ts) + " · level " + o.p.level + "</span></div>").join("");
      tip.style.display = "block";
      const px = x(near) * r.width / W, tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, px - tw / 2), r.width - tw) + "px";
    }
    svgEl.addEventListener("pointermove", hover);
    svgEl.addEventListener("pointerdown", hover);
    svgEl.addEventListener("pointerleave", ev => {
      if (ev.pointerType === "mouse") { tip.style.display = "none"; xhair.style.display = "none"; }
    });

    // Same data as a table (accessible, and handy for exact numbers).
    let t = '<table class="mini"><thead><tr><th>Game #</th>' + series.map(s => "<th>" + s.name + "</th>").join("") + "</tr></thead><tbody>";
    ns.slice().reverse().forEach(n => {
      t += "<tr><td>" + n + "</td>" + series.map(s => {
        const o = byN[n].filter(v => v.s === s)[0];
        return "<td>" + (o ? o.p.score + " <span>" + fmtDate(o.p.ts) + "</span>" : "—") + "</td>";
      }).join("") + "</tr>";
    });
    table.innerHTML = t + "</tbody></table>";
  }

  // ---------- Grown-ups settings ----------
  let gateUnlocked = false, gateAnswer = 0;
  function openSettings() {
    if (!gateUnlocked) {
      const a = rint(12, 19), b = rint(6, 9);
      gateAnswer = a * b;
      $("gateQ").textContent = a + " × " + b + " = ?";
      $("gateInput").value = "";
      $("gateErr").textContent = "";
      $("gate").style.display = "";
      $("settingsPanel").style.display = "none";
    } else {
      renderSettings();
    }
    show("settings");
    if (!gateUnlocked) setTimeout(() => $("gateInput").focus(), 50);
  }
  function tryGate() {
    if (Number($("gateInput").value) === gateAnswer) {
      gateUnlocked = true;
      $("gate").style.display = "none";
      renderSettings();
    } else {
      $("gateErr").textContent = "Not quite — try again.";
      $("gateInput").value = "";
    }
  }
  function renderSettings() {
    $("settingsPanel").style.display = "";
    const wrap = $("settingsKids");
    wrap.innerHTML = "";
    KIDS.forEach(kid => {
      const s = settingsFor(kid);
      const div = document.createElement("div");
      div.className = "set-kid";
      div.innerHTML =
        '<div class="set-name">' + kid + "</div>" +
        '<div class="set-row"><span class="set-lbl">🔢 Math starting level</span><div class="stepper">' +
          '<button data-act="dec" data-kid="' + kid + '"' + (s.startLevel <= 1 ? " disabled" : "") + ' aria-label="Lower math starting level for ' + kid + '">−</button>' +
          '<span class="lvl">' + s.startLevel + "</span>" +
          '<button data-act="inc" data-kid="' + kid + '"' + (s.startLevel >= MAX_START_LEVEL ? " disabled" : "") + ' aria-label="Higher math starting level for ' + kid + '">+</button>' +
        "</div></div>" +
        '<div class="set-desc">Level ' + s.startLevel + ": " + LEVEL_INFO[s.startLevel] + "</div>" +
        '<div class="set-row"><span class="set-lbl">Operations</span><div class="op-toggles">' +
          ALL_OPS.map(op => {
            const on = s.ops.indexOf(op) >= 0;
            return '<button class="optog' + (on ? " on" : "") + '" data-act="op" data-op="' + op + '" data-kid="' + kid + '" aria-pressed="' + on + '">' + OP_LABEL[op] + "</button>";
          }).join("") +
        "</div></div>" +
        '<div class="set-row set-gap"><span class="set-lbl">🔤 Spelling starting level</span><div class="stepper">' +
          '<button data-act="sdec" data-kid="' + kid + '"' + (s.spellLevel <= 1 ? " disabled" : "") + ' aria-label="Lower spelling starting level for ' + kid + '">−</button>' +
          '<span class="lvl">' + s.spellLevel + "</span>" +
          '<button data-act="sinc" data-kid="' + kid + '"' + (s.spellLevel >= SPELL_MAX_LEVEL ? " disabled" : "") + ' aria-label="Higher spelling starting level for ' + kid + '">+</button>' +
        "</div></div>" +
        '<div class="set-desc">Level ' + s.spellLevel + ": " + SPELL_LEVEL_INFO[s.spellLevel] + "</div>";
      wrap.appendChild(div);
    });
    refreshSettingsNote();
  }
  function changeSetting(kid, act, op) {
    const s = settingsFor(kid);
    let level = s.startLevel, ops = s.ops.slice(), spellLevel = s.spellLevel;
    if (act === "inc") level = Math.min(MAX_START_LEVEL, level + 1);
    else if (act === "dec") level = Math.max(1, level - 1);
    else if (act === "sinc") spellLevel = Math.min(SPELL_MAX_LEVEL, spellLevel + 1);
    else if (act === "sdec") spellLevel = Math.max(1, spellLevel - 1);
    else if (act === "op") {
      const i = ops.indexOf(op);
      if (i >= 0) {
        if (ops.length === 1) { $("settingsNote").textContent = "Keep at least one operation switched on."; return; }
        ops.splice(i, 1);
      } else ops.push(op);
      ops = ALL_OPS.filter(o => ops.indexOf(o) >= 0);   // stable order
    } else return;
    const rec = { startLevel: level, ops: ops.join(","), spellLevel: spellLevel, ss: SPELL_SCALE, ts: Date.now() };
    store.settings[kid] = rec;
    saveStore(store);
    if (cloudEnabled()) trackExtras([cloudPushSettings(kid, rec)]);
    renderSettings();
  }
  function refreshSettingsNote() {
    const el = $("settingsNote");
    if (!el) return;
    if (!cloudEnabled()) el.textContent = "💾 Settings are saved on this device.";
    else if (extrasSyncOK === "denied") el.textContent = "💾 Saved on this device. To sync settings and tricky-fact progress to your other devices, publish the updated Firebase rules (FIREBASE-SETUP.md, Step 3).";
    else if (extrasSyncOK === "offline") el.textContent = "💾 Saved on this device — it'll sync the next time you're online.";
    else if (extrasSyncOK === "ok") el.textContent = "☁️ Settings sync to all your devices.";
    else el.textContent = "";
  }

  // ---------- Confetti ----------
  const COLORS = ["#f59e0b","#ef4444","#34d399","#60a5fa","#a78bfa","#f472b6","#fde047"];
  function confettiBurst(count) {
    const root = $("confetti");
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = rint(0, 100) + "vw";
      p.style.background = pick(COLORS);
      p.style.animationDuration = (1.2 + Math.random() * 1.3) + "s";
      p.style.animationDelay = (Math.random() * 0.3) + "s";
      if (Math.random() < 0.5) p.style.borderRadius = "50%";
      p.style.width = p.style.height = rint(8, 14) + "px";
      root.appendChild(p);
      setTimeout(() => p.remove(), 3000);
    }
  }

  // ---------- Mute ----------
  function refreshMute() { $("muteBtn").textContent = store.muted ? "🔇" : "🔊"; }

  // ---------- Practice tables ----------
  let practiceOp = "mul", practiceNum = 2, practiceHide = false;

  function practiceFacts(op, n) {
    const facts = [];
    if (op === "add") { for (let k = 1; k <= 12; k++) facts.push({ text: n + " + " + k, answer: n + k }); }
    else if (op === "sub") { for (let k = 0; k <= n; k++) facts.push({ text: n + " − " + k, answer: n - k }); }
    else if (op === "div") { for (let k = 1; k <= 12; k++) facts.push({ text: (n * k) + " ÷ " + n, answer: k }); }
    else { for (let k = 1; k <= 12; k++) facts.push({ text: n + " × " + k, answer: n * k }); }
    return facts;
  }

  function buildNumPicker() {
    const wrap = $("numPicker");
    wrap.innerHTML = "";
    for (let i = 1; i <= 12; i++) {
      const b = document.createElement("button");
      b.className = "npick";
      b.setAttribute("data-num", i);
      b.textContent = i;
      wrap.appendChild(b);
    }
  }

  function renderPractice() {
    Array.prototype.forEach.call(document.querySelectorAll("#opPicker .op"), b =>
      b.classList.toggle("selected", b.getAttribute("data-op") === practiceOp));
    Array.prototype.forEach.call(document.querySelectorAll("#numPicker .npick"), b =>
      b.classList.toggle("selected", Number(b.getAttribute("data-num")) === practiceNum));
    $("toggleAnsBtn").textContent = practiceHide ? "👁️ Show answers" : "🙈 Hide answers (quiz me)";

    const wrap = $("practiceCards");
    wrap.innerHTML = "";
    practiceFacts(practiceOp, practiceNum).forEach(f => {
      const card = document.createElement("div");
      card.className = "fact" + (practiceHide ? " hidden" : "");
      card.setAttribute("data-ans", f.answer);
      card.innerHTML = f.text + ' <span class="fa">= ' + (practiceHide ? "?" : f.answer) + '</span>';
      wrap.appendChild(card);
    });
  }

  // ---------- Wire up events ----------
  $("startBtn").addEventListener("click", startGame);
  $("playAgainBtn").addEventListener("click", () => {
    if (lastPlay && lastPlay.mode === "drill") {
      const d = lastPlay.drill;
      if (d.kind === "rule") { startDrill(lastPlay.name, d); return; }
      const pd = store.players[lastPlay.name];
      if (pd && trickyItems(normalize(pd), d.subject).length) { startDrill(lastPlay.name, d); return; }
      refreshHome(); preselectPlayer(lastPlay.name); show("home"); return;
    }
    startGame();
  });
  $("homeBtn").addEventListener("click", () => {
    if (lastPlay && lastPlay.mode === "drill") { openPractice(); return; }
    refreshHome(); show("home");
  });
  $("picker").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const inp = $("nameInput");
    if (btn.id === "otherBtn") {
      clearPicks();
      btn.classList.add("selected");
      inp.style.display = "block";
      inp.value = "";
      selectedName = "";
      refreshHomeStats();
      inp.focus();
    } else {
      inp.style.display = "none";
      selectPlayer(btn.getAttribute("data-name"), btn);
    }
  });

  $("nameInput").addEventListener("input", () => {
    selectedName = $("nameInput").value.trim();
    refreshHomeStats();
  });
  $("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });

  $("lenPicker").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (btn) selectLength(Number(btn.getAttribute("data-len")));
  });

  $("pad").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (btn) pressKey(btn.getAttribute("data-k"));
  });
  $("skipBtn").addEventListener("click", skipQuestion);
  $("quitBtn").addEventListener("click", quitGame);

  document.addEventListener("keydown", e => {
    if (!screens.game.classList.contains("active") || !g || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (g.track === "math" && k >= "0" && k <= "9") { pressKey(k); e.preventDefault(); }
    else if (g.track === "spell" && /^[a-zA-Z]$/.test(k)) { pressKey(k.toLowerCase()); e.preventDefault(); }
    else if (g.track === "chunk" && /^[1-3]$/.test(k)) { chooseChunk(Number(k) - 1); e.preventDefault(); }
    else if (k === "Backspace") { pressKey("clear"); e.preventDefault(); }
    else if (k === "Enter") { pressKey("enter"); e.preventDefault(); }
    else if (k === " " && g.track !== "math") { replayQuestion(); e.preventDefault(); }
    else if ((k === "s" || k === "S") && g.track !== "spell") { skipQuestion(); e.preventDefault(); }
  });

  $("muteBtn").addEventListener("click", () => {
    store.muted = !store.muted;
    saveStore(store);
    refreshMute();
    if (!store.muted) sfx.correct();
  });

  // Tabs, tricky facts, records, grown-ups settings
  $("tabs").addEventListener("click", e => {
    const t = e.target.closest(".tab"); if (t) openTab(t.getAttribute("data-tab"));
  });
  $("trickyKids").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    trickyKid = b.getAttribute("data-name"); renderTricky();
  });
  $("drillBtn").addEventListener("click", () => startDrill(trickyKid, { kind: "tricky", subject: store.subject }));
  $("endDrillBtn").addEventListener("click", () => { if (g && g.mode === "drill" && !g.ended) endDrill(); });
  $("chartLenPicker").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    chartLen = Number(b.getAttribute("data-len")); renderRecords();
  });
  $("footerSettings").addEventListener("click", openSettings);
  $("gateBtn").addEventListener("click", tryGate);
  $("gateInput").addEventListener("keydown", e => { if (e.key === "Enter") tryGate(); });
  $("settingsKids").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    changeSetting(b.getAttribute("data-kid"), b.getAttribute("data-act"), b.getAttribute("data-op"));
  });
  $("settingsDone").addEventListener("click", () => openTab("home"));

  // Subject switch, spelling modes, spelling input, read-aloud
  $("subjectSwitch").addEventListener("click", e => {
    const b = e.target.closest(".subj"); if (b) setSubject(b.getAttribute("data-subject"));
  });
  $("spellModePicker").addEventListener("click", e => {
    const b = e.target.closest(".pick"); if (b) setSpellMode(b.getAttribute("data-mode"));
  });
  $("recordsModePicker").addEventListener("click", e => {
    const b = e.target.closest(".pick"); if (b) setSpellMode(b.getAttribute("data-mode"));
  });
  $("keyboard").addEventListener("click", e => {
    const b = e.target.closest("button"); if (b) pressKey(b.getAttribute("data-k"));
  });
  $("chunkOpts").addEventListener("click", e => {
    const b = e.target.closest(".chunk-opt"); if (b) chooseChunk(Number(b.getAttribute("data-i")));
  });
  $("listenBtn").addEventListener("click", replayQuestion);
  $("rulePicker").addEventListener("click", e => {
    const b = e.target.closest(".rule-chip"); if (!b) return;
    practiceUnit = b.getAttribute("data-unit"); renderRules();
  });
  $("ruleChunkBtn").addEventListener("click", () => startDrill(trickyKid, { kind: "rule", unit: practiceUnit, track: "chunk" }));
  $("ruleSpellBtn").addEventListener("click", () => startDrill(trickyKid, { kind: "rule", unit: practiceUnit, track: "spell" }));
  // Tap any word chip / review word to hear it in its sentence
  document.addEventListener("click", e => {
    const el = e.target.closest(".speakable");
    const w = el && WORD_INDEX[el.getAttribute("data-word")];
    if (w) sayWord(w, true);
  });
  $("opPicker").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    practiceOp = b.getAttribute("data-op"); renderPractice();
  });
  $("numPicker").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    practiceNum = Number(b.getAttribute("data-num")); renderPractice();
  });
  $("toggleAnsBtn").addEventListener("click", () => { practiceHide = !practiceHide; renderPractice(); });
  $("practiceCards").addEventListener("click", e => {
    const card = e.target.closest(".fact");
    if (!card || !practiceHide) return;   // tap-to-reveal only matters in quiz mode
    card.querySelector(".fa").textContent = "= " + card.getAttribute("data-ans");
    card.classList.remove("hidden");
  });

  // ---------- Init ----------
  buildKeyboard();
  refreshMute();
  refreshHome();
  applySubject();
  setSync(cloudEnabled() ? "syncing" : "local");
  if (cloudEnabled()) cloudSyncAll();
})();
