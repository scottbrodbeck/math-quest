(function () {
  "use strict";

  // ---------- Config ----------
  const ROUND_SECONDS = 60;
  const LEVEL_UP_EVERY = 5;          // correct answers per level
  const BASE_POINTS = 10;
  const SPEED_BONUS_MAX = 10;        // bonus for answering quickly
  const SPEED_WINDOW = 5;            // seconds over which speed bonus decays
  const SPEED_DEMON_SEC = 2;

  // Per-kid starting level (by grade). Everyone else starts at 1.
  const STARTING_LEVEL = { Evelyn: 3, JD: 1 };
  function startingLevelFor(name) { return STARTING_LEVEL[name] || 1; }

  const BADGES = [
    { id: "first",  ico: "🌟", name: "First Round" },
    { id: "fire",   ico: "🔥", name: "On Fire" },
    { id: "speed",  ico: "⚡", name: "Speed Demon" },
    { id: "lvl3",   ico: "🚀", name: "Level Up" },
    { id: "master", ico: "🧠", name: "Math Master" },
    { id: "high",   ico: "🏆", name: "High Roller" },
    { id: "century",ico: "💯", name: "Century" },
  ];

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
  if (!store.players) store.players = {};      // name -> {best, topLevel, badges:[]}
  if (!store.recent) store.recent = [];         // array of names, most recent first
  if (typeof store.muted !== "boolean") store.muted = false;

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
    // Give every game a stable id. Legacy entries (no id) get a deterministic id from their
    // timestamp so the same game dedupes identically on every device.
    pd.history.forEach(h => {
      if (!h.id) h.id = (h.ts != null ? "ts-" + h.ts : "x-" + Math.floor(Math.random() * 1e9));
    });
    recompute(pd);
    return pd;
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
    const merged = {
      best: Math.max(a.best || 0, b.best || 0),
      topLevel: Math.max(a.topLevel || 1, b.topLevel || 1),
      badges: badges, history: history,
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
    }
    return normalize(pd);
  }

  function cloudPushGame(name, entry) {
    return cloudFetch("players/" + encodeURIComponent(name) + "/history/" + encodeURIComponent(entry.id),
      { method: "PUT", body: JSON.stringify({ score: entry.score, level: entry.level, solved: entry.solved, ts: entry.ts }) });
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
      const all = await cloudFetch("players");
      const names = {};
      if (all) Object.keys(all).forEach(n => { names[n] = true; });
      Object.keys(store.players).forEach(n => { names[n] = true; });

      const pushes = [];
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
      });

      saveStore(store);
      refreshHomeStats();
      await Promise.all(pushes);
      setSync("synced");
    } catch (e) {
      setSync("offline");
    }
  }

  // ---------- Elements ----------
  const $ = id => document.getElementById(id);
  const screens = { home: $("homeScreen"), game: $("gameScreen"), results: $("resultsScreen") };
  function show(which) {
    Object.values(screens).forEach(s => s.classList.remove("active"));
    screens[which].classList.add("active");
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
    newbest: () => { [659,784,988,1319].forEach((f,i) => tone(f, 0.2, "triangle", i*0.12)); },
  };

  // ---------- Problem generation ----------
  function rint(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Returns {text, answer} scaled by level.
  function makeProblem(level) {
    let ops;
    if (level <= 2) ops = ["add", "sub"];
    else if (level <= 4) ops = ["add", "sub", "mulEasy"];
    else ops = ["add", "sub", "mul"];

    const op = pick(ops);
    let a, b, text, answer;

    if (op === "add") {
      const cap = level <= 2 ? 20 : 100;
      a = rint(1, cap); b = rint(1, Math.max(1, cap - a));
      text = a + " + " + b; answer = a + b;
    } else if (op === "sub") {
      const cap = level <= 2 ? 20 : 100;
      a = rint(1, cap); b = rint(0, a);           // keep answer >= 0
      text = a + " − " + b; answer = a - b;
    } else if (op === "mulEasy") {
      a = pick([2, 5, 10]); b = rint(1, 10);
      text = a + " × " + b; answer = a * b;
    } else { // mul
      a = rint(2, 10); b = rint(2, 10);
      text = a + " × " + b; answer = a * b;
    }
    return { text: text, answer: answer };
  }

  // ---------- Game state ----------
  let g = null;
  let tickHandle = null;

  function startGame() {
    const name = currentName();
    if (!name) { $("nameInput").focus(); return; }
    rememberPlayer(name);
    saveStore(store);

    // Resume audio context on user gesture
    if (!store.muted) { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch(e){} }

    const startLevel = startingLevelFor(name);
    g = {
      name: name,
      score: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      startLevel: startLevel,
      level: startLevel,
      timeLeft: ROUND_SECONDS,
      current: null,
      input: "",
      askedAt: 0,
      locked: false,
      gotSpeedDemon: false,
      startMs: nowMs(),
    };
    show("game");
    updateHud();
    nextProblem();
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(tick, 250);
  }

  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  function tick() {
    g.timeLeft = Math.max(0, ROUND_SECONDS - (nowMs() - g.startMs) / 1000);
    const secs = Math.ceil(g.timeLeft);
    $("hudTime").textContent = secs;
    $("timerFill").style.width = (g.timeLeft / ROUND_SECONDS * 100) + "%";
    $("hudTimeBox").classList.toggle("warn", secs <= 10);
    if (g.timeLeft <= 0) endGame();
  }

  function nextProblem() {
    g.current = makeProblem(g.level);
    g.input = "";
    g.askedAt = nowMs();
    g.locked = false;
    $("question").textContent = g.current.text;
    renderInput();
    $("feedback").textContent = "";
    $("feedback").className = "feedback";
  }

  function renderInput() {
    $("answerBox").textContent = g.input === "" ? "?" : g.input;
  }

  function updateHud() {
    $("hudScore").textContent = g.score;
    $("hudStreak").textContent = g.streak;
    $("hudLevel").textContent = g.level;
  }

  // ---------- Input handling ----------
  function pressKey(k) {
    if (!g || g.locked) return;
    if (k === "clear") { g.input = g.input.slice(0, -1); renderInput(); return; }
    if (k === "enter") { submit(); return; }
    if (/^[0-9]$/.test(k)) {
      if (g.input.length < 4) { g.input += k; renderInput(); }
    }
  }

  function submit() {
    if (g.input === "") return;
    const val = parseInt(g.input, 10);
    const elapsed = (nowMs() - g.askedAt) / 1000;
    const card = $("problemCard");

    if (val === g.current.answer) {
      g.locked = true;
      g.correct++;
      g.streak++;
      g.bestStreak = Math.max(g.bestStreak, g.streak);

      const combo = comboMultiplier(g.streak);
      const speedBonus = Math.round(Math.max(0, SPEED_BONUS_MAX * (1 - elapsed / SPEED_WINDOW)));
      const gained = Math.round((BASE_POINTS + speedBonus) * combo);
      g.score += gained;
      if (elapsed <= SPEED_DEMON_SEC) g.gotSpeedDemon = true;

      sfx.correct();
      card.classList.remove("wrong");
      void card.offsetWidth;
      card.classList.add("correct");
      $("feedback").textContent = "+" + gained + (combo > 1 ? "  (×" + combo + " combo!)" : "");
      $("feedback").className = "feedback good";
      showCombo(g.streak, combo);

      // Level up? (counts upward from this player's starting level)
      const newLevel = g.startLevel + Math.floor(g.correct / LEVEL_UP_EVERY);
      if (newLevel > g.level) { g.level = newLevel; levelUp(); }

      updateHud();
      setTimeout(() => { card.classList.remove("correct"); if (g.timeLeft > 0) nextProblem(); }, 420);
    } else {
      g.locked = true;
      g.streak = 0;
      sfx.wrong();
      card.classList.remove("correct");
      void card.offsetWidth;
      card.classList.add("wrong");
      $("feedback").textContent = "The answer was " + g.current.answer;
      $("feedback").className = "feedback bad";
      updateHud();
      // Show the correct answer briefly, then move on to the next question.
      setTimeout(() => { card.classList.remove("wrong"); if (g.timeLeft > 0) nextProblem(); }, 1400);
    }
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

  function levelUp() {
    sfx.levelup();
    const el = $("comboFlash");
    el.textContent = "🚀 LEVEL " + g.level + "!";
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    confettiBurst(28);
  }

  // ---------- End of round ----------
  function endGame() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    if (!g) return;

    const pd = playerData(g.name);
    const isNewBest = g.score > pd.best;
    if (isNewBest) pd.best = g.score;
    if (g.level > pd.topLevel) pd.topLevel = g.level;

    // Award badges
    const newly = [];
    function award(id) {
      if (!pd.badges.includes(id)) { pd.badges.push(id); newly.push(id); }
    }
    award("first");
    if (g.bestStreak >= 10) award("fire");
    if (g.gotSpeedDemon) award("speed");
    if (g.level >= 3) award("lvl3");
    if (g.level >= 5) award("master");
    if (g.score >= 500) award("high");
    if (g.correct >= 25) award("century");

    // Record the round in history — only count real rounds (solved at least one problem).
    let recordedEntry = null;
    if (g.correct >= 1) {
      recordedEntry = { id: Date.now() + "-" + Math.floor(Math.random() * 1e6), score: g.score, level: g.level, solved: g.correct, ts: Date.now() };
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
    $("resultsName").textContent = g.name + ", great job!";
    $("finalScore").textContent = g.score;
    $("finalSolved").textContent = g.correct;
    $("finalStreak").textContent = g.bestStreak;
    $("finalLevel").textContent = g.level;

    $("newBest").style.display = isNewBest ? "block" : "none";

    const earnedWrap = $("earnedWrap");
    const earnedRow = $("earnedRow");
    earnedRow.innerHTML = "";
    if (newly.length) {
      earnedWrap.style.display = "block";
      newly.forEach(id => {
        const b = BADGES.find(x => x.id === id);
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

  // ---------- Home screen rendering ----------
  let selectedName = null;
  function currentName() { return selectedName ? selectedName.trim() : ""; }

  function clearPicks() {
    Array.prototype.forEach.call(document.querySelectorAll(".pick"), b => b.classList.remove("selected"));
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
      : { best: 0, topLevel: 1, badges: [], games: 0, scoreSum: 0, history: [] };
    $("homeBest").textContent = pd.best;
    $("homeLevel").textContent = pd.topLevel;
    $("homeBadges").textContent = pd.badges.length;
    $("homeGames").textContent = pd.games;
    $("homeLast").textContent = pd.history.length ? pd.history[0].score : 0;
    $("homeAvg").textContent = pd.games ? Math.round(pd.scoreSum / pd.games) : 0;

    const startBtn = $("startBtn");
    if (name) { startBtn.disabled = false; startBtn.textContent = "▶ Start, " + name + "!"; }
    else { startBtn.disabled = true; startBtn.textContent = "▶ Pick a player"; }

    // badge shelf reflects current player's earned badges
    const shelf = $("badgeShelf");
    shelf.innerHTML = "";
    BADGES.forEach(b => {
      const earned = pd.badges.includes(b.id);
      const div = document.createElement("div");
      div.className = "badge" + (earned ? "" : " locked");
      div.innerHTML = '<div class="ico">' + (earned ? b.ico : "🔒") + '</div><div class="name">' + b.name + '</div>';
      shelf.appendChild(div);
    });

    // recent games list for the selected player
    const list = $("historyList");
    list.innerHTML = "";
    if (!pd.history.length) {
      const empty = document.createElement("div");
      empty.className = "hist-empty";
      empty.textContent = name ? "No games yet — play a round!" : "Pick a player to see their games.";
      list.appendChild(empty);
    } else {
      pd.history.forEach(h => {
        const when = new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const row = document.createElement("div");
        row.className = "hist-row";
        row.innerHTML =
          '<span class="h-score">' + h.score + '</span>' +
          '<span class="h-meta">Lv ' + h.level + ' · ' + h.solved + ' solved</span>' +
          '<span class="h-date">' + when + '</span>';
        list.appendChild(row);
      });
    }
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

  // ---------- Wire up events ----------
  $("startBtn").addEventListener("click", startGame);
  $("playAgainBtn").addEventListener("click", startGame);
  $("homeBtn").addEventListener("click", () => { refreshHome(); show("home"); });
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

  $("pad").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (btn) pressKey(btn.getAttribute("data-k"));
  });

  document.addEventListener("keydown", e => {
    if (!screens.game.classList.contains("active")) return;
    if (e.key >= "0" && e.key <= "9") { pressKey(e.key); e.preventDefault(); }
    else if (e.key === "Backspace") { pressKey("clear"); e.preventDefault(); }
    else if (e.key === "Enter") { pressKey("enter"); e.preventDefault(); }
  });

  $("muteBtn").addEventListener("click", () => {
    store.muted = !store.muted;
    saveStore(store);
    refreshMute();
    if (!store.muted) sfx.correct();
  });

  // ---------- Init ----------
  refreshMute();
  refreshHome();
  setSync(cloudEnabled() ? "syncing" : "local");
  if (cloudEnabled()) cloudSyncAll();
})();
