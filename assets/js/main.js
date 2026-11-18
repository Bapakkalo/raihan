/* main.js — page interactions (everything except the hero table). */
(() => {
  "use strict";

  const RW = window.RW || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => (RW.reducedMotion ? RW.reducedMotion() : false);
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const sfx = (name, v) => RW.sfx && RW.sfx[name] && RW.sfx[name](v);

  /* ---------- header: solid on scroll, hide on scroll down ---------- */
  const header = $("[data-header]");
  const menuBtn = $("[data-menu]");
  let lastY = window.scrollY;
  let ticking = false;

  function onScroll() {
    ticking = false;
    const y = window.scrollY;
    if (!header) return;
    header.classList.toggle("is-solid", y > 16);
    if (!header.classList.contains("is-open")) {
      const down = y > lastY + 4;
      const up = y < lastY - 4;
      if (down && y > 420) header.classList.add("is-hidden");
      else if (up || y < 420) header.classList.remove("is-hidden");
    }
    lastY = y;
  }
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  function setMenu(open) {
    if (!header || !menuBtn) return;
    header.classList.toggle("is-open", open);
    header.classList.remove("is-hidden");
    menuBtn.setAttribute("aria-expanded", String(open));
    const label = $(".menu-btn__label", menuBtn);
    if (label) label.textContent = open ? "Tutup" : "Menu";
    document.body.classList.toggle("menu-open", open);
    if (open) {
      const first = $(".nav__list a", header);
      if (first) first.focus({ preventScroll: true });
    }
  }
  if (menuBtn) {
    menuBtn.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
    $$(".nav__list a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setMenu(false);
        menuBtn.focus();
      }
    });
    window.matchMedia("(min-width: 920px)").addEventListener("change", (e) => { if (e.matches) setMenu(false); });
  }

  /* ---------- active nav item ---------- */
  const navLinks = $$(".nav__list a");
  const sections = navLinks.map((a) => $(a.getAttribute("href"))).filter(Boolean);
  const heroSection = $("[data-hero]");
  if (heroSection) sections.unshift(heroSection); // back at the table: nothing is "current"
  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => {
          if (a.getAttribute("href") === "#" + entry.target.id) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- sound toggle ---------- */
  const soundBtn = $("[data-sound-toggle]");
  if (soundBtn && RW.sfx) {
    const sync = () => {
      soundBtn.setAttribute("aria-pressed", String(RW.sfx.enabled));
      soundBtn.title = RW.sfx.enabled ? "Matikan suara efek" : "Nyalakan suara efek";
    };
    sync();
    soundBtn.addEventListener("click", () => {
      RW.sfx.setEnabled(!RW.sfx.enabled);
      sync();
      sfx("tick", 0.6);
      if (RW.toast) RW.toast(RW.sfx.enabled ? "Suara efek nyala." : "Suara efek mati.", { duration: 1800 });
    });
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = $$("[data-reveal]");
  if ("IntersectionObserver" in window && !reduced()) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- profil: two-tables photo slider ---------- */
  (function duo() {
    const root = $("[data-duo]");
    if (!root) return;
    const stage = $(".duo__stage", root);
    const range = $(".duo__range", root);
    const tagA = $(".duo__tag--a", root);
    const tagB = $(".duo__tag--b", root);
    let touched = false;

    const set = (v) => {
      v = clamp(v, 0, 100);
      stage.style.setProperty("--pos", v + "%");
      range.value = String(Math.round(v));
      range.setAttribute("aria-valuetext", v > 70 ? "Lebih banyak meja rapat" : v < 30 ? "Lebih banyak meja biliar" : "Setengah-setengah");
      if (tagA) tagA.style.opacity = v < 18 ? "0" : "1";
      if (tagB) tagB.style.opacity = v > 82 ? "0" : "1";
    };

    range.addEventListener("input", () => { touched = true; set(Number(range.value)); });
    stage.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      touched = true;
      const r = stage.getBoundingClientRect();
      set(((e.clientX - r.left) / r.width) * 100);
    });
    set(50);

    // a one-time nudge so people see it moves
    if (!reduced() && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const keys = [[0, 50], [450, 30], [1050, 68], [1500, 50]];
        const t0 = performance.now() + 500;
        const step = (now) => {
          if (touched) return;
          const t = now - t0;
          if (t < 0) return window.requestAnimationFrame(step);
          let i = 0;
          while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
          const [ta, va] = keys[i];
          const [tb, vb] = keys[i + 1];
          const k = clamp((t - ta) / (tb - ta), 0, 1);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          set(va + (vb - va) * e);
          if (t < keys[keys.length - 1][0]) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
      }, { threshold: 0.6 });
      io.observe(stage);
    }
  })();

  /* ---------- kerja: cue ball spin simulator ---------- */
  (function spin() {
    const root = $("[data-spin]");
    if (!root) return;
    const face = $("[data-spin-face]", root);
    const dot = $("[data-spin-dot]", root);
    const nameEl = $("[data-spin-name]", root);
    const descEl = $("[data-spin-desc]", root);
    const replay = $("[data-spin-replay]", root);
    const presets = $$("[data-preset]", root);
    const el = {
      cueLine: $("[data-d-cue-line]", root),
      objLine: $("[data-d-obj-line]", root),
      post: $("[data-d-post]", root),
      ghost: $("[data-d-ghost]", root),
      obj: $("[data-d-obj]", root),
      cue: $("[data-d-cue]", root),
    };
    const LIMIT = 62; // miscue limit on the face (radius 100)
    const RB = 8; // diagram ball radius
    const T = { x0: 18 + RB, y0: 18 + RB, x1: 382 - RB, y1: 242 - RB };
    const C = { x: 62, y: 172 }; // cue ball start
    const O = { x: 178, y: 96 }; // object ball
    const P = { x: 200, y: 12 }; // top side pocket
    const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
    const u = norm(P.x - O.x, P.y - O.y);
    const G = { x: O.x - u.x * 2 * RB, y: O.y - u.y * 2 * RB }; // ghost ball
    const d = norm(G.x - C.x, G.y - C.y);
    const cos = d.x * u.x + d.y * u.y;
    const sin = Math.sqrt(1 - cos * cos);
    const tan = norm(d.x - cos * u.x, d.y - cos * u.y);

    const set = (el, attrs) => Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, typeof v === "number" ? v.toFixed(2) : v));
    set(el.cueLine, { x1: C.x, y1: C.y, x2: G.x, y2: G.y });
    set(el.objLine, { x1: O.x, y1: O.y, x2: P.x, y2: P.y + 6 });
    set(el.ghost, { cx: G.x, cy: G.y });
    const start = $("[data-d-start]", root);
    if (start) set(start, { cx: C.x, cy: C.y });

    let tip = { x: 0, y: 0.6 }; // -1..1, y>0 = top spin
    let path = [];
    let anim = 0;

    // Cue ball after contact: tangent-line velocity (the 90° rule) plus the spin
    // taking hold along the original line (≈ 2/7 of the speed for natural roll).
    function simulate(tx, ty) {
      const V = 560;
      const MU = 250;
      const spinF = ty >= 0 ? ty * 1.3 : ty * 2.4;
      let vx = tan.x * V * sin;
      let vy = tan.y * V * sin;
      const ax = d.x * (2 / 7) * spinF * V * cos;
      const ay = d.y * (2 / 7) * spinF * V * cos;
      let left = 1;
      let x = G.x;
      let y = G.y;
      let t = 0;
      let bounces = 0;
      const dt = 1 / 240;
      const pts = [{ x, y, t }];
      for (let i = 0; i < 240 * 5; i++) {
        if (left > 0) {
          const f = Math.min(left, dt / 0.24);
          vx += ax * f;
          vy += ay * f;
          left -= f;
        }
        const sp = Math.hypot(vx, vy);
        if (sp < 6 && left <= 0) break;
        const ns = Math.max(0, sp - MU * dt);
        vx *= sp ? ns / sp : 0;
        vy *= sp ? ns / sp : 0;
        x += vx * dt;
        y += vy * dt;
        t += dt;
        let hit = false;
        if (x < T.x0) { x = T.x0; vx = -vx; hit = true; }
        if (x > T.x1) { x = T.x1; vx = -vx; hit = true; }
        if (y < T.y0) { y = T.y0; vy = -vy; hit = true; }
        if (y > T.y1) { y = T.y1; vy = -vy; hit = true; }
        if (hit) {
          bounces++;
          // side spin bends the rebound: right english turns it to the right of travel
          const a = tx * 0.5;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const nvx = vx * c - vy * s;
          const nvy = vx * s + vy * c;
          vx = nvx * 0.8;
          vy = nvy * 0.8;
        }
        if (i % 3 === 0) pts.push({ x, y, t });
        if (bounces > 3) break;
      }
      pts.push({ x, y, t });
      return pts;
    }

    function describe(tx, ty) {
      const pct = (v) => Math.round(Math.abs(v) * 100) + "%";
      let name;
      let desc;
      if (ty > 0.12) {
        name = "Follow " + pct(ty);
        desc = "Topspin mendorong bola putih ikut maju setelah kontak.";
      } else if (ty < -0.12) {
        name = "Draw " + pct(ty);
        desc = "Backspin menarik bola putih mundur setelah kontak.";
      } else {
        name = "Stun";
        desc = "Tanpa spin saat kontak, bola putih meluncur di garis tangen — 90° dari arah bola sasaran.";
      }
      if (Math.abs(tx) > 0.12) {
        name += ` · english ${tx > 0 ? "kanan" : "kiri"} ${pct(tx)}`;
        desc += ` Spin samping mengubah sudut pantul di bantalan.`;
      }
      return { name, desc };
    }

    function render(animate) {
      dot.setAttribute("cx", (tip.x * LIMIT).toFixed(2));
      dot.setAttribute("cy", (-tip.y * LIMIT).toFixed(2));
      path = simulate(tip.x, tip.y);
      el.post.setAttribute("d", "M" + path.map((p) => p.x.toFixed(1) + " " + p.y.toFixed(1)).join("L"));
      const { name, desc } = describe(tip.x, tip.y);
      nameEl.textContent = name;
      descEl.textContent = desc;
      presets.forEach((b) => {
        const [px, py] = b.dataset.preset.split(",").map(Number);
        b.setAttribute("aria-pressed", String(Math.abs(px - tip.x) < 0.02 && Math.abs(py - tip.y) < 0.02));
      });
      if (animate) play();
      else finalPose();
    }

    function finalPose() {
      window.cancelAnimationFrame(anim);
      const end = path[path.length - 1];
      set(el.cue, { cx: end.x, cy: end.y });
      set(el.obj, { cx: P.x, cy: P.y });
      el.obj.style.opacity = "0";
      el.post.style.strokeDasharray = "none";
    }

    // Animate: approach → contact → object ball to the pocket, cue ball along the path.
    function play() {
      window.cancelAnimationFrame(anim);
      if (reduced()) return finalPose();
      const approach = 0.42;
      const total = approach + Math.max(path[path.length - 1].t, 0.7) + 0.2;
      const postLen = el.post.getTotalLength();
      el.post.style.strokeDasharray = postLen + " " + postLen;
      el.obj.style.opacity = "1";
      let clacked = false;
      let dropped = false;
      const t0 = performance.now();
      const frame = (now) => {
        const t = (now - t0) / 1000;
        if (t < approach) {
          const k = t / approach;
          const e = k * (2 - k) * 0.35 + k * 0.65;
          set(el.cue, { cx: C.x + (G.x - C.x) * e, cy: C.y + (G.y - C.y) * e });
          set(el.obj, { cx: O.x, cy: O.y });
          el.post.style.strokeDashoffset = String(postLen);
        } else {
          if (!clacked) { clacked = true; sfx("clack", 0.55); }
          const tt = t - approach;
          // object ball: decelerating run into the pocket
          const ko = clamp(tt / 0.55, 0, 1);
          const eo = 1 - Math.pow(1 - ko, 2);
          set(el.obj, { cx: O.x + (P.x - O.x) * eo, cy: O.y + (P.y - O.y) * eo });
          if (ko >= 1) {
            el.obj.style.opacity = "0";
            if (!dropped) { dropped = true; sfx("pocket", 0.4); }
          }
          // cue ball: follow the simulated path by its own clock
          let i = 0;
          while (i < path.length - 1 && path[i + 1].t < tt) i++;
          const a = path[i];
          const b = path[Math.min(i + 1, path.length - 1)];
          const k = b.t > a.t ? clamp((tt - a.t) / (b.t - a.t), 0, 1) : 1;
          set(el.cue, { cx: a.x + (b.x - a.x) * k, cy: a.y + (b.y - a.y) * k });
          const frac = clamp(i / (path.length - 1), 0, 1);
          el.post.style.strokeDashoffset = String(postLen * (1 - frac));
        }
        if (t < total) anim = window.requestAnimationFrame(frame);
        else finalPose();
      };
      anim = window.requestAnimationFrame(frame);
    }

    let debounce = 0;
    const setTip = (x, y, animate = true) => {
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      tip = { x, y };
      window.clearTimeout(debounce);
      render(false);
      if (animate) debounce = window.setTimeout(() => render(true), 260);
    };

    const toTip = (e) => {
      const pt = face.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(face.getScreenCTM().inverse());
      return { x: p.x / LIMIT, y: -p.y / LIMIT };
    };
    let dragging = false;
    face.addEventListener("pointerdown", (e) => {
      dragging = true;
      face.classList.add("is-dragging");
      face.setPointerCapture(e.pointerId);
      const t = toTip(e);
      setTip(t.x, t.y);
    });
    face.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const t = toTip(e);
      setTip(t.x, t.y);
    });
    const stop = () => { dragging = false; face.classList.remove("is-dragging"); };
    face.addEventListener("pointerup", stop);
    face.addEventListener("pointercancel", stop);
    face.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.02 : 0.1;
      const map = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
      if (!map[e.key]) return;
      e.preventDefault();
      setTip(clamp(tip.x + map[e.key][0], -1, 1), clamp(tip.y + map[e.key][1], -1, 1));
    });
    presets.forEach((b) => b.addEventListener("click", () => {
      const [x, y] = b.dataset.preset.split(",").map(Number);
      setTip(x, y);
    }));
    if (replay) replay.addEventListener("click", () => render(true));

    render(false);
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        window.setTimeout(() => render(true), 400);
      }, { threshold: 0.5 });
      io.observe(root);
    }
  })();

  /* ---------- kerja: reel video ---------- */
  (function reel() {
    const root = $("[data-reel]");
    if (!root) return;
    const video = $("video", root);
    const source = $("source", video);
    const playBtn = $("[data-reel-play]", root);
    const bigBtn = $("[data-reel-big]", root);
    const soundBtn = $("[data-reel-sound]", root);
    const bar = $("[data-reel-progress]", root);
    const errorEl = $("[data-reel-error]", root);
    let userPaused = false;
    let inView = false;

    // Phones can refuse *autoplay* (iOS Low Power Mode, Android data saver), but they
    // always allow play() called directly inside a tap. So autoplay is a bonus; the
    // big play button is the guaranteed path.
    const sync = () => {
      const playing = !video.paused && !video.ended;
      root.classList.toggle("is-playing", playing);
      playBtn.setAttribute("aria-label", playing ? "Jeda video" : "Putar video");
    };
    const fail = () => {
      root.classList.add("is-error");
      if (errorEl) errorEl.hidden = false;
      sync();
    };
    const play = (fromTap) => {
      if (root.classList.contains("is-error")) return;
      if (fromTap) userPaused = false;
      const p = video.play();
      if (p && p.catch) {
        p.catch((err) => {
          sync();
          // a tap that still fails means the file itself can't play here
          if (fromTap && err && err.name !== "AbortError") fail();
        });
      }
    };
    const toggle = () => {
      if (video.paused || video.ended) play(true);
      else { userPaused = true; video.pause(); }
    };

    ["play", "playing", "pause", "ended"].forEach((ev) => video.addEventListener(ev, sync));
    video.addEventListener("timeupdate", () => {
      if (video.duration) bar.style.transform = `scaleX(${video.currentTime / video.duration})`;
    });
    if (source) source.addEventListener("error", fail);
    video.addEventListener("error", fail);

    playBtn.addEventListener("click", toggle);
    if (bigBtn) bigBtn.addEventListener("click", toggle);
    video.addEventListener("click", toggle);
    soundBtn.addEventListener("click", () => {
      video.muted = !video.muted;
      soundBtn.setAttribute("aria-pressed", String(!video.muted));
      soundBtn.setAttribute("aria-label", video.muted ? "Nyalakan suara video" : "Matikan suara video");
      if (!video.muted && video.paused) play(true);
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (inView && !userPaused && !reduced()) play(false);
        else if (!inView && !video.paused) video.pause();
      }, { threshold: 0.45 }).observe(root);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) video.pause();
      else if (inView && !userPaused && !reduced()) play(false);
    });
    sync();
  })();

  /* ---------- jejak: tabs on a scoring wire ---------- */
  (function track() {
    const tabs = $$(".wire__tab");
    const bead = $(".wire__bead");
    if (!tabs.length || !bead) return;
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));

    const moveBead = (tab) => {
      bead.style.setProperty("--w", tab.offsetWidth + "px");
      bead.style.setProperty("--x", tab.offsetLeft + "px");
    };
    const showPanel = (panel) => {
      panel.classList.remove("is-in");
      void panel.offsetWidth;
      window.requestAnimationFrame(() => panel.classList.add("is-in"));
    };
    const select = (tab, focus = true) => {
      tabs.forEach((t, i) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
        if (on) showPanel(panels[i]);
      });
      moveBead(tab);
      if (focus) tab.focus();
      sfx("tick", 0.5);
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (e) => {
        let next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") next = tabs[0];
        if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next); }
      });
    });

    const initial = tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];
    moveBead(initial);
    window.addEventListener("resize", () => moveBead(tabs.find((t) => t.getAttribute("aria-selected") === "true")));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveBead(tabs.find((t) => t.getAttribute("aria-selected") === "true")));

    // beads slide into place the first time the list is seen
    if ("IntersectionObserver" in window && !reduced()) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      }, { threshold: 0.3 });
      panels.forEach((p) => io.observe(p));
    } else {
      panels.forEach((p) => p.classList.add("is-in"));
    }
  })();

  /* ---------- hobi: image that trails the cursor ---------- */
  (function hobbies() {
    const list = $("[data-hobbies]");
    const float = $("[data-hobby-float]");
    if (!list || !float) return;
    const rows = $$(".hobby", list);
    const imgs = rows.map((row) => {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.dataset.src = row.dataset.img;
      if (row.dataset.pos) img.style.objectPosition = row.dataset.pos;
      float.appendChild(img);
      return img;
    });
    let loaded = false;
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let active = false;
    let raf = 0;

    const loop = () => {
      raf = 0;
      x += (tx - x) * 0.16;
      y += (ty - y) * 0.16;
      const rot = clamp((tx - x) * 0.06, -9, 9);
      float.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -58%) rotate(${rot.toFixed(2)}deg)`;
      if (active || Math.abs(tx - x) + Math.abs(ty - y) > 0.5) raf = window.requestAnimationFrame(loop);
    };

    rows.forEach((row, i) => {
      row.addEventListener("pointerenter", (e) => {
        if (!fine.matches || e.pointerType !== "mouse") return;
        if (!loaded) {
          loaded = true;
          imgs.forEach((img) => { img.src = img.dataset.src; });
        }
        if (!active) { x = tx = e.clientX; y = ty = e.clientY; }
        active = true;
        imgs.forEach((img, j) => img.classList.toggle("is-active", j === i));
        float.classList.add("is-on");
        if (!raf) raf = window.requestAnimationFrame(loop);
      });
    });
    list.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      if (active && !raf) raf = window.requestAnimationFrame(loop);
    });
    list.addEventListener("pointerleave", () => {
      active = false;
      float.classList.remove("is-on");
    });
    window.addEventListener("scroll", () => {
      if (!active) return;
      active = false;
      float.classList.remove("is-on");
    }, { passive: true });
  })();

  /* ---------- gym: progressive-overload barbell ---------- */
  (function barbell() {
    const root = $("[data-barbell]");
    if (!root) return;
    const svg = $("[data-bb-svg]", root);
    const NS = "http://www.w3.org/2000/svg";
    const shaft = $("[data-bb-shaft]", root);
    const sleeveL = $("[data-bb-sleeve-l]", root);
    const sleeveR = $("[data-bb-sleeve-r]", root);
    const platesG = $("[data-bb-plates]", root);
    const collarsG = $("[data-bb-collars]", root);
    const totalEl = $("[data-bb-total]", root);
    const msgEl = $("[data-bb-msg]", root);
    const plateBtns = $$("[data-plate]", root);
    const undoBtn = $("[data-bb-undo]", root);
    const clearBtn = $("[data-bb-clear]", root);

    // IWF colours; bumper plates share one diameter, change plates are smaller
    const SPEC = {
      25: { c: "#c8302b", h: 214, t: 27 },
      20: { c: "#1f4fb4", h: 214, t: 23 },
      15: { c: "#e2b021", h: 214, t: 19 },
      10: { c: "#1b7f4a", h: 214, t: 15 },
      5: { c: "#ece5d4", h: 120, t: 13, ink: "#17130f" },
      2.5: { c: "#3a3631", h: 94, t: 10 },
    };
    const BAR = 20;
    const CX = 400;
    const Y0 = 150;
    const X0 = 22;
    const X1 = 778;
    const COL_L = 228;
    const COL_R = 572;
    const SLEEVE = COL_L - X0 - 14;
    const MESSAGES = [
      [0, "Bar kosong. Semua mulai dari sini."],
      [60, "Pemanasan selesai."],
      [100, "Tiga digit. Mulai serius."],
      [140, "Fokus. Tarik napas. Bracing."],
      [180, "Ini sudah wilayah PR."],
      [220, "Oke, jangan ego lifting, bro."],
      [270, "Gila. Tapi besok tetap balik lagi."],
    ];

    const plates = []; // { w, enter, leaving, gL, gR }
    let sag = 0;
    let sagV = 0;
    let shown = BAR;
    let raf = 0;

    const total = () => BAR + plates.filter((p) => !p.leaving).reduce((s, p) => s + p.w * 2, 0);
    const used = () => plates.filter((p) => !p.leaving).reduce((s, p) => s + SPEC[p.w].t + 1.5, 0);
    const yAt = (x) => Y0 + sag * Math.pow((x - CX) / (X1 - CX), 2);
    const slope = (x) => (2 * sag * (x - CX)) / Math.pow(X1 - CX, 2);
    const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));

    const pts = (a, b) => {
      const out = [];
      for (let x = a; x <= b + 0.1; x += 12) out.push(`${x.toFixed(1)},${yAt(x).toFixed(2)}`);
      out.push(`${b.toFixed(1)},${yAt(b).toFixed(2)}`);
      return out.join(" ");
    };

    function plateEl(w) {
      const s = SPEC[w];
      const g = document.createElementNS(NS, "g");
      const body = document.createElementNS(NS, "rect");
      body.setAttribute("x", String(-s.t / 2));
      body.setAttribute("y", String(-s.h / 2));
      body.setAttribute("width", String(s.t));
      body.setAttribute("height", String(s.h));
      body.setAttribute("rx", "3");
      body.setAttribute("fill", s.c);
      const rim = document.createElementNS(NS, "rect");
      rim.setAttribute("x", String(-s.t / 2 + 1.5));
      rim.setAttribute("y", String(-s.h / 2 + 4));
      rim.setAttribute("width", String(Math.max(1.5, s.t * 0.22)));
      rim.setAttribute("height", String(s.h - 8));
      rim.setAttribute("rx", "1");
      rim.setAttribute("fill", "rgba(255,255,255,0.22)");
      const shade = document.createElementNS(NS, "rect");
      shade.setAttribute("x", String(s.t / 2 - Math.max(2, s.t * 0.25)));
      shade.setAttribute("y", String(-s.h / 2 + 2));
      shade.setAttribute("width", String(Math.max(2, s.t * 0.25) - 0.5));
      shade.setAttribute("height", String(s.h - 4));
      shade.setAttribute("fill", "rgba(0,0,0,0.25)");
      g.append(body, rim, shade);
      if (s.h > 150) {
        const label = document.createElementNS(NS, "text");
        label.textContent = fmt(w);
        label.setAttribute("transform", "rotate(-90)");
        label.setAttribute("x", "0");
        label.setAttribute("y", String(s.t * 0.18));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("fill", s.ink || "rgba(255,255,255,0.85)");
        label.setAttribute("font-family", "Big Shoulders Display, sans-serif");
        label.setAttribute("font-weight", "800");
        label.setAttribute("font-size", String(Math.min(16, s.t * 0.62)));
        g.append(label);
      }
      platesG.append(g);
      return g;
    }

    const collar = (() => {
      const make = () => {
        const g = document.createElementNS(NS, "g");
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", "-6");
        r.setAttribute("y", "-19");
        r.setAttribute("width", "12");
        r.setAttribute("height", "38");
        r.setAttribute("rx", "2.5");
        r.setAttribute("fill", "#a9a49a");
        const hl = document.createElementNS(NS, "rect");
        hl.setAttribute("x", "-4");
        hl.setAttribute("y", "-17");
        hl.setAttribute("width", "3");
        hl.setAttribute("height", "34");
        hl.setAttribute("fill", "rgba(255,255,255,0.4)");
        g.append(r, hl);
        collarsG.append(g);
        return g;
      };
      return [make(), make()];
    })();

    const place = (g, x, dy, opacity) => {
      const ang = (Math.atan(slope(x)) * 180) / Math.PI;
      g.setAttribute("transform", `translate(${x.toFixed(2)} ${(yAt(x) + dy).toFixed(2)}) rotate(${ang.toFixed(2)})`);
      g.style.opacity = String(opacity);
    };

    function draw() {
      shaft.setAttribute("points", pts(COL_L, COL_R));
      sleeveL.setAttribute("points", pts(X0, COL_L - 6));
      sleeveR.setAttribute("points", pts(COL_R + 6, X1));
      place(collar[0], COL_L, 0, 1);
      place(collar[1], COL_R, 0, 1);
      let edgeL = COL_L - 7;
      let edgeR = COL_R + 7;
      for (const p of plates) {
        const s = SPEC[p.w];
        const e = p.leaving ? 1 - p.enter : p.enter;
        const slide = (1 - easeOut(clamp(e, 0, 1))) * 70;
        const lift = (1 - easeOut(clamp(e, 0, 1))) * -14;
        const cxL = edgeL - s.t / 2;
        const cxR = edgeR + s.t / 2;
        place(p.gL, cxL - slide, lift, clamp(e * 1.6, 0, 1));
        place(p.gR, cxR + slide, lift, clamp(e * 1.6, 0, 1));
        edgeL -= (s.t + 1.5) * clamp(e, 0, 1);
        edgeR += (s.t + 1.5) * clamp(e, 0, 1);
      }
    }
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    function tick(dt) {
      let busy = false;
      for (const p of plates) {
        if (p.enter < 1) {
          p.enter = Math.min(1, p.enter + dt / (reduced() ? 0.01 : 0.26));
          busy = true;
          if (p.enter >= 1 && !p.leaving) {
            sagV += 26 + p.w * 2.4; // plates landing whip the bar
            sfx("clank", 0.35 + p.w / 40);
          }
        }
      }
      for (let i = plates.length - 1; i >= 0; i--) {
        const p = plates[i];
        if (p.leaving && p.enter >= 1) {
          p.gL.remove();
          p.gR.remove();
          plates.splice(i, 1);
        }
      }
      const target = Math.min(30, (total() - BAR) * 0.085);
      const k = 170;
      const c = 9;
      sagV += (-k * (sag - target) - c * sagV) * dt;
      sag += sagV * dt;
      if (Math.abs(sag - target) > 0.05 || Math.abs(sagV) > 0.05) busy = true;
      else { sag = target; sagV = 0; }
      const t = total();
      if (shown !== t) {
        const diff = t - shown;
        shown = Math.abs(diff) < 0.6 ? t : shown + diff * Math.min(1, dt * 14);
        busy = true;
      }
      totalEl.textContent = fmt(Math.abs(shown - t) < 0.6 ? t : Math.round(shown));
      draw();
      return busy;
    }

    let last = 0;
    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      raf = tick(dt) ? window.requestAnimationFrame(loop) : 0;
    };
    const kick = () => {
      if (raf) return;
      last = performance.now();
      raf = window.requestAnimationFrame(loop);
    };

    function update() {
      const t = total();
      let msg = MESSAGES[0][1];
      for (const [min, m] of MESSAGES) if (t >= min) msg = m;
      if (msgEl.textContent !== msg) msgEl.textContent = msg;
      const room = SLEEVE - used();
      plateBtns.forEach((b) => { b.disabled = SPEC[b.dataset.plate].t + 1.5 > room; });
      const any = plates.some((p) => !p.leaving);
      undoBtn.disabled = !any;
      clearBtn.disabled = !any;
      svg.setAttribute("aria-label", `Barbel dengan beban total ${fmt(t)} kilogram`);
    }

    plateBtns.forEach((btn) => btn.addEventListener("click", () => {
      const w = Number(btn.dataset.plate);
      if (SPEC[w].t + 1.5 > SLEEVE - used()) {
        if (RW.toast) RW.toast("Sleeve penuh. Ganti piringan yang lebih berat.");
        return;
      }
      plates.push({ w, enter: 0, leaving: false, gL: plateEl(w), gR: plateEl(w) });
      update();
      kick();
    }));
    undoBtn.addEventListener("click", () => {
      const p = [...plates].reverse().find((q) => !q.leaving);
      if (!p) return;
      p.leaving = true;
      p.enter = 0;
      update();
      kick();
    });
    clearBtn.addEventListener("click", () => {
      plates.forEach((p) => { if (!p.leaving) { p.leaving = true; p.enter = 0; } });
      update();
      kick();
    });

    // start with a warm-up load so it reads as a barbell straight away
    plates.push({ w: 20, enter: 1, leaving: false, gL: plateEl(20), gR: plateEl(20) });
    shown = total();
    sag = Math.min(30, (shown - BAR) * 0.085);
    totalEl.textContent = fmt(shown);
    update();
    draw();
  })();

  /* ---------- testimonials ---------- */
  (function quotes() {
    const root = $("[data-quotes]");
    if (!root) return;
    const tabs = $$(".quotes__btn", root);
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    const DURATION = 8000;
    let index = 0;
    let timer = 0;
    let paused = false;
    let inView = false;
    root.style.setProperty("--q-dur", DURATION + "ms");

    const show = (i, focus = false) => {
      index = (i + tabs.length) % tabs.length;
      tabs.forEach((t, j) => {
        const on = j === index;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      // restart the progress animation
      root.classList.remove("is-auto");
      void root.offsetWidth;
      if (!reduced() && inView) root.classList.add("is-auto");
      if (focus) tabs[index].focus();
      schedule();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      if (reduced() || paused || !inView) return;
      timer = window.setTimeout(() => show(index + 1), DURATION);
    };

    tabs.forEach((t, i) => {
      t.addEventListener("click", () => show(i));
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); show(i + 1, true); }
        if (e.key === "ArrowLeft") { e.preventDefault(); show(i - 1, true); }
      });
    });
    const pause = (v) => {
      paused = v;
      root.classList.toggle("is-paused", v);
      if (v) window.clearTimeout(timer);
      else show(index);
    };
    root.addEventListener("pointerenter", () => pause(true));
    root.addEventListener("pointerleave", () => pause(false));
    root.addEventListener("focusin", () => pause(true));
    root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) pause(false); });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (inView) show(index);
        else window.clearTimeout(timer);
      }, { threshold: 0.4 }).observe(root);
    }
  })();

  /* ---------- copy email ---------- */
  $$("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(value);
        ok = true;
      } catch {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
      }
      sfx("tick", 0.6);
      if (RW.toast) RW.toast(ok ? "Email disalin: " + value : "Tidak bisa menyalin. Email: " + value);
    });
  });

  /* ---------- year ---------- */
  $$("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
