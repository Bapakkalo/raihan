/* ring.js — puts the boxing game on the page: the fight card, the canvas,
   sound and effects for what the simulation reports, the HUD, the touch pad,
   keyboard control and the full-screen "live" mode. */
(() => {
  "use strict";

  const RW = window.RW || {};
  const root = document.querySelector("[data-ring]");
  if (!root || !RW.ringSim || !RW.ringScene || !RW.ringBoxer || !RW.ringData) return;

  const DATA = RW.ringData;
  const SCENE = RW.ringScene;
  const BOXER = RW.ringBoxer;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => (RW.reducedMotion ? RW.reducedMotion() : false);
  const coarse = window.matchMedia("(pointer: coarse)");

  const stage = $("[data-ring-stage]");
  const canvas = $("[data-ring-canvas]");
  const ctx = canvas.getContext("2d");
  const el = {
    hud: $("[data-ring-hud]"),
    pad: $("[data-ring-pad]"),
    tools: $("[data-ring-tools]"),
    call: $("[data-ring-call]"),
    bubble: $("[data-ring-bubble]"),
    hint: $("[data-ring-hint]"),
    count: $("[data-ring-count]"),
    countN: $("[data-count-n]"),
    mash: $("[data-count-mash]"),
    mashBar: $("[data-count-bar]"),
    foes: $("[data-foes]"),
    blurb: $("[data-ring-blurb]"),
    start: $("[data-ring-start]"),
    pHp: $('[data-hud="p-hp"]'),
    pLag: $('[data-hud="p-lag"]'),
    pSta: $('[data-hud="p-sta"]'),
    pSpirit: $('[data-hud="p-spirit"]'),
    meter: $('[data-hud="meter"]'),
    oHp: $('[data-hud="o-hp"]'),
    oLag: $('[data-hud="o-lag"]'),
    oName: $('[data-hud="o-name"]'),
    oKd: $('[data-hud="o-kd"]'),
    round: $('[data-hud="round"]'),
    clock: $('[data-hud="clock"]'),
    special: $('[data-act="special"]'),
  };
  const screens = {
    select: $('[data-ring-screen="select"]'),
    corner: $('[data-ring-screen="corner"]'),
    result: $('[data-ring-screen="result"]'),
    pause: $('[data-ring-screen="pause"]'),
  };

  /* ---------- saved progress (this browser only) ---------- */
  const KEY = "rw-ring";
  let save = {};
  try { save = JSON.parse((RW.storage && RW.storage.get(KEY)) || "{}") || {}; } catch { save = {}; }
  save.rec = save.rec || {};
  const persist = () => { if (RW.storage) RW.storage.set(KEY, JSON.stringify(save)); };

  const playerLook = { ...DATA.PLAYER_LOOK, skinLit: BOXER.lit(DATA.PLAYER_LOOK.skin, 0.3), ink: "#1a110c" };

  /* ---------- state ---------- */
  let selected = DATA.FIGHTERS.some((f) => f.id === save.sel) ? save.sel : "joko";
  let game = null;
  let live = false;
  let paused = false;
  let visible = false;
  let touchMode = false;
  let screen = "select";
  let raf = 0;
  let last = 0;
  let slowT = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let P = null;
  let backdrop = null;
  let vignette = null;
  let sizeKey = "";
  let flashes = [];
  let parts = [];
  let white = 0;
  let attractT = 0;
  let crowdT = 0;
  let hintT = 0;
  let bubbleT = 0;
  let resultT = -1;
  let pendingResult = null;
  let lastClock = "";
  const lag = { p: 1, o: 1 };
  const shown = new Set();

  /* ---------- the fight card ---------- */
  function recText(id) {
    const r = save.rec[id];
    if (!r || !r.tries) return "";
    return r.wins ? `Menang ×${r.wins}` : "Belum menang";
  }

  function renderFoes() {
    el.foes.textContent = "";
    DATA.FIGHTERS.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "foe";
      b.setAttribute("role", "radio");
      b.dataset.foe = f.id;
      const on = f.id === selected;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      const name = document.createElement("span");
      name.className = "foe__name";
      name.textContent = f.name;
      const lvl = document.createElement("span");
      lvl.className = "foe__lvl";
      lvl.setAttribute("aria-hidden", "true");
      for (let k = 1; k <= 3; k++) {
        const pip = document.createElement("i");
        if (k <= f.level) pip.className = "on";
        lvl.appendChild(pip);
      }
      const nick = document.createElement("span");
      nick.className = "foe__nick";
      nick.textContent = `“${f.nick}”`;
      const rec = document.createElement("span");
      rec.className = "foe__rec";
      rec.textContent = recText(f.id);
      b.append(name, lvl, nick, rec);
      b.setAttribute("aria-label", `${f.name}, “${f.nick}”. Tingkat ${f.level} dari 3. ${recText(f.id)}`.trim());
      b.addEventListener("click", () => select(f.id));
      b.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = DATA.FIGHTERS[(i + d + DATA.FIGHTERS.length) % DATA.FIGHTERS.length];
        select(next.id, true);
      });
      el.foes.appendChild(b);
    });
    el.blurb.textContent = DATA.byId(selected).blurb;
  }

  function select(id, focus = false) {
    if (id !== selected && RW.sfx) RW.sfx.tick(0.4);
    selected = id;
    save.sel = id;
    persist();
    renderFoes();
    if (focus) { const b = el.foes.querySelector(`[data-foe="${id}"]`); if (b) b.focus(); }
    if (!live) { startAttract(); kick(); }
  }

  /* ---------- canvas size and projection ---------- */
  function layout() {
    const portrait = h > w * 1.05;
    if (live) return portrait ? { eye: 0.34, sy: 0.00145, sx: 0.00235, cx: 0.5 } : { eye: 0.3, sy: 0.00178, sx: 0.0036, cx: 0.5 };
    return portrait ? { eye: 0.21, sy: 0.00138, sx: 0.0029, cx: 0.5 } : { eye: 0.29, sy: 0.00172, sx: 0.0036, cx: 0.6 };
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${w}x${h}@${dpr}:${live}`;
    if (key === sizeKey) return;
    sizeKey = key;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const L = layout();
    P = SCENE.projector(w, h, L);
    P.cx = w * L.cx;
    P.baseCy = P.cy;
    backdrop = SCENE.buildBackdrop(P, dpr);
    vignette = SCENE.buildVignette(w, h, dpr);
  }

  /* ---------- particles: sweat, puffs, impact stars ---------- */
  function burst(at, kind) {
    if (!P || !at) return;
    const s = P.pt(at.x, at.y, at.z);
    const n = kind === "big" ? 18 : kind === "block" ? 6 : 11;
    const sc = Math.max(0.6, P.S);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (kind === "block" ? 110 : 280) * (0.35 + Math.random()) * sc;
      parts.push({ kind: kind === "block" ? "puff" : "drop", x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * sc, life: 0.45 + Math.random() * 0.3, max: 0.75, r: (1.6 + Math.random() * 2.6) * sc });
    }
    const size = Math.min(kind === "big" ? 150 : kind === "block" ? 50 : 90, (kind === "big" ? 44 : 30) * s.s);
    parts.push({ kind: kind === "block" ? "ring" : "star", x: s.x, y: s.y, life: 0.16, max: 0.16, r: size, rot: Math.random() });
  }

  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      if (q.vx !== undefined) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 900 * dt;
        q.vx *= 1 - dt * 2;
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt * 4;
      if (f.life <= 0) flashes.splice(i, 1);
    }
    white = Math.max(0, white - dt * 2.4);
  }

  function drawParts() {
    for (const q of parts) {
      const a = clamp(q.life / q.max, 0, 1);
      if (q.kind === "drop") {
        ctx.fillStyle = `rgba(226, 242, 255, ${0.85 * a})`;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, q.r, q.r * 1.4, Math.atan2(q.vy, q.vx) + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (q.kind === "puff") {
        ctx.fillStyle = `rgba(241, 234, 219, ${0.35 * a})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (2.4 - a), 0, Math.PI * 2);
        ctx.fill();
      } else if (q.kind === "ring") {
        ctx.strokeStyle = `rgba(241, 234, 219, ${0.7 * a})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (1.2 - a * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const r = q.r * (1.15 - a * 0.5);
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(255, 236, 170, ${0.9 * a})`;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const ang = (i * Math.PI) / 8;
          const rr = i % 2 === 0 ? r : r * 0.32;
          ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function flashBurst(n) {
    for (let i = 0; i < n; i++) flashes.push({ x: 0.04 + Math.random() * 0.92, y: Math.random(), life: 1, delay: Math.random() * 0.6 });
  }

  /* ---------- one frame ---------- */
  function render() {
    if (!P || !game) return;
    const m = game.m;
    const p = m.player;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drift = live ? 0 : Math.sin(attractT * 0.35) * 24;
    P.camX = p.cam.x + p.kick.x + drift;
    P.camY = p.cam.y + p.kick.y;
    P.cy = P.baseCy + p.cam.tilt * h;
    const amp = (reduced() ? 2 : 11) * p.shake * p.shake;
    const roll = (p.cam.roll + p.kick.roll) * (reduced() ? 0.35 : 1);
    ctx.save();
    ctx.translate(P.cx + (Math.random() - 0.5) * amp, P.cy + (Math.random() - 0.5) * amp);
    ctx.rotate(roll);
    ctx.translate(-P.cx, -P.cy);
    ctx.fillStyle = "#06080b";
    ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6);
    SCENE.drawBackdrop(ctx, P, backdrop);
    SCENE.drawFloor(ctx, P);
    SCENE.drawRopes(ctx, P);
    SCENE.drawLights(ctx, P, m.time + attractT);
    SCENE.drawFlashes(ctx, P, flashes.filter((f) => f.delay <= 0));
    BOXER.draw(ctx, P, m.F.look, m.opp.pose);
    drawParts();
    const gl = [[p.gl.l, -1], [p.gl.r, 1]].sort((a, b) => a[0].z - b[0].z);
    for (const [g, side] of gl) BOXER.playerGlove(ctx, P, playerLook, g, side);
    ctx.restore();

    // overlays: getting hit, low health, the special's flash, the room's vignette
    const low = live && p.hp / p.hpMax < 0.28 && m.phase === "fight" ? 0.16 * (0.5 + 0.5 * Math.sin(m.time * 6)) : 0;
    const red = Math.max(p.hurt * 0.5, low);
    if (red > 0.01) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, "rgba(207, 47, 42, 0)");
      g.addColorStop(1, `rgba(207, 47, 42, ${red})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (white > 0.01 && !reduced()) {
      ctx.fillStyle = `rgba(255, 255, 255, ${white})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(vignette, 0, 0, w, h);
  }

  /* ---------- words on screen ---------- */
  let callTimer = 0;
  function call(text, tone = "") {
    el.call.className = "ring__call";
    void el.call.offsetWidth;
    el.call.textContent = text;
    el.call.className = "ring__call is-on" + tone.split(" ").filter(Boolean).map((t) => " is-" + t).join("");
    window.clearTimeout(callTimer);
    callTimer = window.setTimeout(() => { el.call.className = "ring__call"; }, 1150);
  }

  const HINTS = {
    start: () => touchMode ? "Saat sarung tinjunya berkilat, menghindar dengan ◀ atau ▶." : "Saat sarung tinjunya berkilat, menghindar dengan ← atau →.",
    dodged: () => touchMode ? "Dia meleset dan terbuka. Balas: Jab, Straight!" : "Dia meleset dan terbuka. Balas: J lalu K!",
    blocked: () => touchMode ? "Kena guard. Tunggu celah, atau bongkar dengan Upper." : "Kena guard. Tunggu celah, atau bongkar dengan uppercut (I).",
    tired: () => "Stamina habis, pukulan melemah. Atur napas sebentar.",
    meter: () => touchMode ? "Bola 8 penuh! Tekan tombol 8 saat dia terbuka." : "Bola 8 penuh! Tekan Spasi saat dia terbuka.",
    hook: () => "Hook datang dari samping. Menghindarlah ke arah sebaliknya.",
    nospecial: () => "Bola 8 belum penuh. Isi dengan menghindar dan counter.",
  };
  function hint(key, force = false) {
    if (!live || !HINTS[key]) return;
    if (!force && (shown.has(key) || save.tut)) return;
    shown.add(key);
    el.hint.textContent = HINTS[key]();
    el.hint.hidden = false;
    hintT = 4;
  }

  function bubble(text) {
    el.bubble.textContent = text;
    el.bubble.hidden = false;
    bubbleT = 2.6;
    placeBubble();
  }
  function placeBubble() {
    if (el.bubble.hidden || !P || !game) return;
    const hd = game.m.opp.pose.head;
    const s = P.pt(hd.x, hd.y, hd.z);
    const x = clamp(s.x + 58 * s.s, 8, w - el.bubble.offsetWidth - 8);
    const y = clamp(s.y - 92 * s.s, 70, h - 120);
    el.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  const sfx = (name, ...args) => { if (live && RW.sfx && RW.sfx[name]) RW.sfx[name](...args); };
  const buzz = (ms) => { if (touchMode && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* not allowed */ } } };

  /* ---------- what the fight reports ---------- */
  function onEvent(e) {
    if (!live) return; // the shadow-boxing loop stays silent
    const m = game.m;
    switch (e.type) {
      case "throw":
        sfx("whoosh", e.kind === "jab" ? 0.3 : 0.45);
        break;
      case "special":
        sfx("whoosh", 1);
        white = 0.3;
        call("Pukulan Bola 8!", "small blue");
        break;
      case "land":
        if (e.by === "p") {
          sfx("punch", e.power ? 0.95 : 0.6, true);
          burst(e.at, e.power ? "big" : "hit");
          if (e.kind === "special") { white = 0.55; flashBurst(8); sfx("crowd", 0.8, 1.8); }
          else if (e.tag === "counter") call("Counter!", "small");
          else if (e.tag === "break") call("Guard terbelah!", "small");
          else if (e.power) sfx("crowd", 0.3, 0.9);
        } else {
          sfx("punch", e.big ? 1 : 0.8, true);
          burst(e.at, e.big ? "big" : "hit");
          if (e.big) white = 0.2;
          buzz(e.big ? 70 : 35);
          if (e.key === "hookL" || e.key === "hookR") hint("hook");
        }
        break;
      case "block":
        sfx("pat", 0.65);
        burst(e.at, "block");
        if (e.by === "o") hint("blocked");
        break;
      case "whiff":
        sfx("whoosh", 0.8);
        break;
      case "dodged":
        sfx("whoosh", 0.9);
        if (e.perfect) sfx("tick", 0.45);
        hint("dodged");
        break;
      case "windup":
        sfx("breath", e.big ? 1 : 0.4);
        if (e.big) bubble(m.F.id === "raihan" ? "Bola delapan, pojok kanan!" : "Rasakan ini!");
        break;
      case "daze":
        call("Goyah!", "small");
        sfx("crowd", 0.5, 1.2);
        break;
      case "guardbreak":
        call("Guard jebol!", "small red");
        break;
      case "tired":
        hint("tired");
        break;
      case "nospecial":
        hint("nospecial", true);
        break;
      case "taunt":
        bubble(e.text);
        break;
      case "round":
        call(e.last ? "Ronde terakhir" : `Ronde ${e.n}`);
        break;
      case "call":
        call(e.text, e.small ? "small" : "");
        if (e.text === "Tinju!" && m.round === 1) window.setTimeout(() => hint("start"), 900);
        break;
      case "bell":
        sfx("bell", e.n);
        break;
      case "kd":
        call("Knockdown!", e.who === "player" ? "red" : "");
        sfx("crowd", 1, 2.4);
        flashBurst(e.who === "opp" ? 12 : 5);
        if (e.who === "player") buzz(120);
        if (e.final) slowT = 1.3;
        break;
      case "count":
        el.countN.textContent = String(e.n);
        el.countN.classList.remove("is-tick");
        void el.countN.offsetWidth;
        el.countN.classList.add("is-tick");
        sfx("count", 0.7);
        break;
      case "getup":
        sfx("crowd", 0.5, 1);
        break;
      case "roundEnd":
        call(`Akhir ronde ${e.n}`, "small");
        break;
      case "corner":
        showCorner(e);
        break;
      case "result":
        pendingResult = e;
        resultT = e.method === "KO" || e.method === "TKO" ? 1.9 : 0.4;
        if (e.method === "KO" || e.method === "TKO") {
          call(e.method + "!", e.winner === "p" ? "" : "red");
          sfx("crowd", 1, 3.2);
          sfx("bell", 4);
          flashBurst(16);
        } else call("Keputusan juri", "small");
        record(e);
        break;
      default:
        break;
    }
  }

  /* ---------- HUD ---------- */
  const fmtClock = (s) => { const t = Math.ceil(Math.max(0, s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

  function hud(dt) {
    const m = game.m;
    const p = m.player;
    const o = m.opp;
    const ph = clamp(p.hp / p.hpMax, 0, 1);
    const oh = clamp(o.hp / o.hpMax, 0, 1);
    lag.p = ph > lag.p ? ph : Math.max(ph, lag.p - dt * 0.3);
    lag.o = oh > lag.o ? oh : Math.max(oh, lag.o - dt * 0.3);
    el.pHp.style.transform = `scaleX(${ph.toFixed(4)})`;
    el.pLag.style.transform = `scaleX(${lag.p.toFixed(4)})`;
    el.oHp.style.transform = `scaleX(${oh.toFixed(4)})`;
    el.oLag.style.transform = `scaleX(${lag.o.toFixed(4)})`;
    el.pHp.parentNode.classList.toggle("is-low", ph < 0.28);
    el.oHp.parentNode.classList.toggle("is-low", oh < 0.28);
    el.pSta.style.transform = `scaleX(${clamp(p.sta / p.staMax, 0, 1).toFixed(4)})`;
    el.pSta.parentNode.classList.toggle("is-tired", p.sta < 18);
    el.pSpirit.style.transform = `scaleX(${clamp(p.spirit / 100, 0, 1).toFixed(4)})`;
    const full = p.spirit >= 100;
    if (full && !el.meter.classList.contains("is-full")) hint("meter");
    el.meter.classList.toggle("is-full", full);
    el.special.classList.toggle("is-ready", full);
    const c = fmtClock(m.clock);
    if (c !== lastClock) { el.clock.textContent = c; lastClock = c; }
    el.clock.parentNode.classList.toggle("is-ending", m.phase === "fight" && m.clock <= 10);
    el.round.textContent = `R${m.round}`;
    el.oKd.textContent = "●".repeat(o.kd);
    const down = m.phase === "down" && !m.tko;
    el.count.hidden = !down;
    if (!down) el.countN.textContent = "";
    const pDown = down && m.downWho === "player" && p.state === "down";
    el.mash.hidden = !pDown;
    if (pDown) el.mashBar.style.transform = `scaleX(${clamp(p.mash / p.mashNeed, 0, 1).toFixed(3)})`;
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) el.hint.hidden = true; }
    if (bubbleT > 0) { bubbleT -= dt; placeBubble(); if (bubbleT <= 0) el.bubble.hidden = true; }
  }

  /* ---------- screens ---------- */
  function showScreen(name) {
    if (name !== "pause") screen = name;
    Object.entries(screens).forEach(([k, s]) => { s.hidden = k !== name; });
    const focusEl = name && screens[name].querySelector(name === "select" ? "[data-ring-start]" : "button.btn:not([hidden])");
    if (focusEl && live) focusEl.focus({ preventScroll: true });
  }

  function tally(dl, rows) {
    dl.textContent = "";
    for (const [k, v] of rows) {
      const d = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      d.append(dt, dd);
      dl.appendChild(d);
    }
  }

  function showCorner(e) {
    const m = game.m;
    const lg = e.log;
    $("[data-corner-title]").textContent = `Akhir ronde ${e.n}`;
    const lead = Math.round(lg.dealtP) - Math.round(lg.dealtO);
    $("[data-corner-kicker]").textContent = lead > 3 ? "Ronde ini milikmu" : lead < -3 ? `Ronde ini milik ${m.F.name}` : "Ronde ketat";
    tally($("[data-corner-tally]"), [
      ["Damage kamu", String(Math.round(lg.dealtP))],
      ["Damage lawan", String(Math.round(lg.dealtO))],
      ["Knockdown", `${lg.kdO} – ${lg.kdP}`],
    ]);
    const tips = DATA.TIPS[m.F.id] || [];
    $("[data-corner-tip]").textContent = tips[(e.n - 1) % tips.length] || "";
    $("[data-corner-next]").textContent = `Lanjut ronde ${e.n + 1}`;
    releaseAll();
    showScreen("corner");
  }

  const METHOD = { KO: "KO", TKO: "TKO", UD: "angka mutlak", SD: "angka terbagi", MD: "angka mayoritas", DRAW: "seri" };

  function showResult(r) {
    const m = game.m;
    const F = m.F;
    const win = r.winner === "p";
    const title = $("[data-result-title]");
    title.textContent = r.winner ? `${win ? "Menang" : "Kalah"} ${METHOD[r.method]}` : "Seri";
    title.classList.toggle("is-win", win);
    $("[data-result-kicker]").textContent = `${F.name} “${F.nick}” · Ronde ${r.round}, ${fmtClock(r.time)}`;
    $("[data-result-line]").textContent = `“${win ? F.winLine : F.loseLine}”`;
    const judges = $("[data-result-judges]");
    judges.textContent = "";
    judges.hidden = !r.judges;
    if (r.judges) {
      r.judges.forEach(([a, b], i) => {
        const j = document.createElement("div");
        j.className = "judge";
        const sm = document.createElement("small");
        sm.textContent = `Juri ${i + 1}`;
        const st = document.createElement("strong");
        st.textContent = `${a}–${b}`;
        j.append(sm, st);
        judges.appendChild(j);
      });
    }
    const s = r.stats.p;
    tally($("[data-result-tally]"), [
      ["Pukulan masuk", `${s.landed}/${s.thrown}`],
      ["Akurasi", `${s.thrown ? Math.round((100 * s.landed) / s.thrown) : 0}%`],
      ["Counter", String(s.counters)],
      ["Menghindar", String(s.dodges)],
      ["Knockdown", `${s.kd} – ${r.stats.o.kd}`],
    ]);
    const idx = DATA.FIGHTERS.findIndex((f) => f.id === F.id);
    const next = DATA.FIGHTERS[idx + 1];
    const nextBtn = $("[data-result-next]");
    nextBtn.hidden = !(win && next);
    if (next) nextBtn.dataset.next = next.id;
    releaseAll();
    showScreen("result");
  }

  function record(r) {
    const rec = save.rec[r.opp] || { tries: 0, wins: 0 };
    rec.tries++;
    if (r.winner === "p") rec.wins++;
    save.rec[r.opp] = rec;
    save.tut = true;
    persist();
    renderFoes();
  }

  /* ---------- input ---------- */
  const KEYS = {
    ArrowLeft: "dodgeL", KeyA: "dodgeL", ArrowRight: "dodgeR", KeyD: "dodgeR",
    ArrowDown: "block", KeyS: "block",
    KeyJ: "jab", KeyZ: "jab", KeyK: "straight", KeyX: "straight",
    KeyU: "hook", KeyC: "hook", KeyI: "upper", KeyV: "upper",
    Space: "special", ArrowUp: "special", KeyW: "special",
  };

  function releaseAll() {
    if (!game) return;
    game.release("block");
    $$(".pad__btn.is-down").forEach((b) => b.classList.remove("is-down"));
  }

  function setTouch(v) {
    touchMode = v;
    stage.classList.toggle("has-pad", live && v);
  }

  window.addEventListener("keydown", (e) => {
    if (!live) return;
    if (e.code === "Escape" || e.code === "KeyP") {
      e.preventDefault();
      if (screen === "result" && e.code === "Escape") exitLive();
      else setPause(!paused);
      return;
    }
    const a = KEYS[e.code];
    if (!a || paused || screen) return; // panels keep Space/Enter for their buttons
    e.preventDefault();
    if (touchMode) setTouch(false);
    if (e.repeat) return;
    game.press(a);
  });
  window.addEventListener("keyup", (e) => {
    if (!live || !game) return;
    const a = KEYS[e.code];
    if (a) game.release(a);
  });

  $$("[data-act]").forEach((btn) => {
    const a = btn.dataset.act;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
      btn.classList.add("is-down");
      if (game && live && !paused && !screen) game.press(a);
    });
    const up = () => { btn.classList.remove("is-down"); if (game) game.release(a); };
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  stage.addEventListener("touchstart", () => { if (live && !touchMode) setTouch(true); }, { passive: true });

  /* ---------- live mode ---------- */
  function newFight() {
    game = RW.ringSim.create(selected);
    lag.p = lag.o = 1;
    parts = [];
    flashes = [];
    white = 0;
    slowT = 0;
    pendingResult = null;
    resultT = -1;
    shown.clear();
    el.oName.textContent = DATA.byId(selected).name;
    el.hint.hidden = true;
    el.bubble.hidden = true;
    showScreen(null);
  }

  function enterLive() {
    live = true;
    paused = false;
    stage.classList.add("is-live");
    document.documentElement.classList.add("ring-open");
    el.hud.hidden = false;
    el.tools.hidden = false;
    el.pad.hidden = false;
    setTouch(coarse.matches);
    if (RW.sfx) RW.sfx.unlock();
    newFight();
    stage.focus({ preventScroll: true });
    resize();
    kick();
  }

  function exitLive() {
    live = false;
    paused = false;
    releaseAll();
    stage.classList.remove("is-live", "has-pad");
    document.documentElement.classList.remove("ring-open");
    el.hud.hidden = true;
    el.tools.hidden = true;
    el.pad.hidden = true;
    el.count.hidden = true;
    el.hint.hidden = true;
    el.bubble.hidden = true;
    el.call.className = "ring__call";
    startAttract();
    showScreen("select");
    resize();
    kick();
    el.start.focus({ preventScroll: true });
  }

  function setPause(v) {
    if (!live || !game) return;
    if (v && (screen === "result" || game.m.phase === "result")) return;
    paused = v;
    releaseAll();
    if (v) showScreen("pause");
    else showScreen(screen);
    last = performance.now();
  }

  function startAttract() {
    game = RW.ringSim.create(selected, { attract: true });
  }

  // sound: reuse the header toggle so both buttons stay in step
  const soundBtn = $("[data-ring-sound]");
  const syncSound = () => soundBtn.setAttribute("aria-pressed", String(!!(RW.sfx && RW.sfx.enabled)));
  soundBtn.addEventListener("click", () => {
    const headerBtn = document.querySelector("[data-sound-toggle]");
    if (headerBtn) headerBtn.click();
    else if (RW.sfx) RW.sfx.setEnabled(!RW.sfx.enabled);
    syncSound();
  });

  el.start.addEventListener("click", () => { syncSound(); enterLive(); });
  $("[data-ring-pause]").addEventListener("click", () => setPause(true));
  $("[data-ring-exit]").addEventListener("click", exitLive);
  $("[data-pause-resume]").addEventListener("click", () => setPause(false));
  $("[data-pause-restart]").addEventListener("click", () => { paused = false; newFight(); });
  $("[data-pause-exit]").addEventListener("click", exitLive);
  $("[data-corner-next]").addEventListener("click", () => { showScreen(null); game.nextRound(); });
  $("[data-result-again]").addEventListener("click", newFight);
  $("[data-result-exit]").addEventListener("click", exitLive);
  $("[data-result-next]").addEventListener("click", (e) => {
    selected = e.currentTarget.dataset.next || selected;
    save.sel = selected;
    persist();
    renderFoes();
    newFight();
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden && live && !screen) setPause(true); });
  window.addEventListener("blur", () => { if (live && !screen && game && game.m.phase === "fight") setPause(true); });

  /* ---------- the loop ---------- */
  function step(dt) {
    if (slowT > 0) slowT -= dt;
    const scale = slowT > 0 ? 0.35 : 1;
    if (!paused) {
      game.update(dt * scale);
      attractT += dt;
    }
    for (const e of game.drain()) onEvent(e);
    stepParts(dt);
    if (live) {
      hud(dt);
      if (!paused && game.m.phase === "fight") {
        crowdT -= dt;
        if (crowdT <= 0) { sfx("crowd", 0.16, 3.6); crowdT = 3.3; if (Math.random() < 0.6) flashBurst(1); }
      }
      if (resultT > 0) {
        resultT -= dt;
        if (resultT <= 0 && pendingResult) { showResult(pendingResult); pendingResult = null; }
      }
    }
  }

  function frame(now) {
    raf = 0;
    if (!live && !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 1 / 60);
    last = now;
    step(dt);
    render();
    if (live || !reduced()) raf = window.requestAnimationFrame(frame);
  }

  function kick() {
    if (raf) return;
    last = performance.now();
    raf = window.requestAnimationFrame(frame);
  }

  if ("ResizeObserver" in window) new ResizeObserver(() => { resize(); if (!raf) render(); }).observe(stage);
  else window.addEventListener("resize", () => { resize(); render(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    }, { rootMargin: "100px 0px" }).observe(stage);
  } else { visible = true; }

  renderFoes();
  startAttract();
  resize();
  render();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!raf) render(); });

  // read-only hook for tests
  RW.ring = { get game() { return game; }, get live() { return live; }, get screen() { return screen; } };
})();
