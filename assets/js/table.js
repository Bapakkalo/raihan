/* table.js — the playable 9-ball table in the hero.
   - Fixed sub-step physics: rolling resistance, elastic ball contacts, cushions
     with open pocket mouths, pocket capture.
   - Balls are rendered as rotating spheres (quaternion per ball), so numbers,
     stripes and the "measles" cue ball dots roll with the ball.
   - Controls: mouse (aim by hovering, drag back to set power), touch (drag
     back from the cue ball), keyboard (arrows + space). */
(() => {
  "use strict";

  const RW = window.RW || {};
  const hero = document.querySelector("[data-hero]");
  const table = document.querySelector("[data-table]");
  const felt = document.querySelector("[data-felt]");
  const canvas = document.querySelector("[data-hero-canvas]");
  if (!hero || !table || !felt || !canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const diamondsEl = table.querySelector("[data-diamonds]");
  const traySlots = Array.from(document.querySelectorAll("[data-tray] li"));
  const countEl = document.querySelector("[data-count]");
  const hintEl = document.querySelector("[data-hint]");
  const assistBtn = document.querySelector("[data-break]");
  const rerackBtn = document.querySelector("[data-rerack]");

  /* ---------- math ---------- */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (t) => t * t * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  const angleLerp = (a, b, t) => {
    const d = ((((b - a) % TAU) + TAU * 1.5) % TAU) - Math.PI;
    return a + d * t;
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (a) => {
    const m = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / m, a[1] / m, a[2] / m];
  };
  const perp3 = (c) => norm3(cross(c, Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const qaxis = (x, y, z, ang) => {
    const s = Math.sin(ang / 2);
    return [Math.cos(ang / 2), x * s, y * s, z * s];
  };
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const qnorm = (q) => {
    const m = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / m, q[1] / m, q[2] / m, q[3] / m];
  };
  const qrot = (q, v) => {
    const [w, x, y, z] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };

  const reduced = () => (RW.reducedMotion ? RW.reducedMotion() : false);
  const toast = (msg, opts) => RW.toast && RW.toast(msg, opts);
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  /* ---------- constants ---------- */
  const IVORY = "#f4eee0";
  const INK = "#15110d";
  const FONT = '"Schibsted Grotesk", system-ui, sans-serif';
  const SPECS = [
    null,
    { n: 1, c: "#e9b824" },
    { n: 2, c: "#2456c4" },
    { n: 3, c: "#cf2f2a" },
    { n: 4, c: "#6a35a3" },
    { n: 5, c: "#ea7420" },
    { n: 6, c: "#1b7f4a" },
    { n: 7, c: "#7e1f24" },
    { n: 8, c: "#141414" },
    { n: 9, c: "#e9b824", stripe: true },
  ];
  const CUE_DOTS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const E_BALL = 0.95; // ball–ball restitution
  const E_CUSH = 0.74; // cushion restitution
  const DAMP = 0.7; // velocity-proportional loss (1/s)
  const CAP_ANGLE = 0.9; // stripe ball white cap (radians from the pole)

  /* ---------- state ---------- */
  let W = 0;
  let H = 0;
  let L = 0;
  let R = 12;
  let landscape = true;
  let ox = 0;
  let oy = 0;
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  let VMAX = 3000;
  let DECEL = 150;
  let STOP = 5;
  let MAXPULL = 160;

  let pockets = [];
  let lights = [];
  let balls = [];
  let cue = null;
  let phase = "rest"; // rest | striking | rolling
  let shot = null;
  let racked = true;
  let interacted = false;
  let pocketCount = 0;
  let windup = null;
  let clock = 0;
  let lastClack = 0;
  let box = { x: 0, y: 0, w: 0, h: 0 }; // outer table edge, in felt coordinates

  const aim = { dragging: false, id: null, sx: 0, sy: 0, angle: 0, pull: 0, hover: false, mx: 0, my: 0, kb: false, kbAngle: 0, kbPower: 0.6 };
  const stick = { angle: 0, pull: 12, alpha: 0, from: 0, power: 0, t: 0, dur: 0.08, bx: 0, by: 0 };

  /* ---------- layout ---------- */
  function layout() {
    const tr = table.getBoundingClientRect();
    if (!tr.width) return;
    const rail = parseFloat(getComputedStyle(table).paddingTop) || 20;
    const newR = clamp((Math.min(tr.width, tr.height) - rail * 2) * 0.03, 7.5, 18);
    table.style.setProperty("--R", newR.toFixed(2) + "px");

    const hr = hero.getBoundingClientRect();
    const fr = felt.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = hr.width;
    ch = hr.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    ox = fr.left - hr.left;
    oy = fr.top - hr.top;
    box = { x: tr.left - fr.left, y: tr.top - fr.top, w: tr.width, h: tr.height };

    const nW = fr.width;
    const nH = fr.height;
    const nLand = nW >= nH;
    const flipped = balls.length && nLand !== landscape;
    const sx = W ? nW / W : 1;
    const sy = H ? nH / H : 1;
    W = nW;
    H = nH;
    L = Math.max(W, H);
    R = newR;
    landscape = nLand;
    VMAX = L * 3.1;
    DECEL = L * 0.16;
    STOP = L * 0.005;
    MAXPULL = clamp(L * 0.2, 80, 210);
    buildPockets();

    if (!balls.length || flipped) {
      rack(false);
    } else {
      for (const b of balls) {
        if (b.state !== "table") continue;
        b.x = clamp(b.x * sx, R, W - R);
        b.y = clamp(b.y * sy, R, H - R);
      }
      separate();
    }
    placeDiamonds(rail, tr, fr);
  }

  /* Pockets are modelled on real jaws rather than circles:
     - corner: the cushions stop CORNER_MOUTH from the corner; a ball drops once its
       centre crosses the jaw line (x + y < CORNER_JAW, measured inward from the corner)
     - side: the cushion stops SIDE_MOUTH either side of centre; a ball drops once its
       centre is SIDE_DEPTH from the cushion line. Clipping a jaw rattles it back out. */
  const CORNER_MOUTH = 2.1;
  const CORNER_JAW = 2.2;
  const SIDE_MOUTH = 1.45;
  const SIDE_DEPTH = 0.45;

  function buildPockets() {
    const k = 0.32 * R;
    const corner = (ax, ay) => ({ kind: "corner", ax, ay, sx: ax === 0 ? 1 : -1, sy: ay === 0 ? 1 : -1, x: ax === 0 ? -k : W + k, y: ay === 0 ? -k : H + k, hole: 1.85 * R });
    pockets = [corner(0, 0), corner(W, 0), corner(0, H), corner(W, H)];
    const side = { kind: "side", hole: 1.55 * R };
    if (landscape) {
      pockets.push(
        { ...side, wall: "t", ax: W / 2, ay: 0, sx: 0, sy: 1, x: W / 2, y: -0.7 * R },
        { ...side, wall: "b", ax: W / 2, ay: H, sx: 0, sy: -1, x: W / 2, y: H + 0.7 * R }
      );
      lights = [{ x: W * 0.27, y: H * 0.5 }, { x: W * 0.73, y: H * 0.5 }];
    } else {
      pockets.push(
        { ...side, wall: "l", ax: 0, ay: H / 2, sx: 1, sy: 0, x: -0.7 * R, y: H / 2 },
        { ...side, wall: "r", ax: W, ay: H / 2, sx: -1, sy: 0, x: W + 0.7 * R, y: H / 2 }
      );
      lights = [{ x: W * 0.5, y: H * 0.27 }, { x: W * 0.5, y: H * 0.73 }];
    }
  }

  function captured(x, y, p) {
    if (p.kind === "corner") {
      const lx = (x - p.ax) * p.sx;
      const ly = (y - p.ay) * p.sy;
      return lx + ly < CORNER_JAW * R && lx < 2.6 * R && ly < 2.6 * R;
    }
    const horizontal = p.wall === "t" || p.wall === "b";
    const along = horizontal ? Math.abs(x - p.ax) : Math.abs(y - p.ay);
    const depth = horizontal ? (y - p.ay) * p.sy : (x - p.ax) * p.sx;
    return along < SIDE_MOUTH * R && depth < SIDE_DEPTH * R;
  }

  // Is the cushion on `wall` open at this point (i.e. we are inside a pocket mouth)?
  function openAt(x, y, wall) {
    for (const p of pockets) {
      if (p.kind === "corner") {
        if ((wall === "t" && p.ay === 0) || (wall === "b" && p.ay === H)) { if ((x - p.ax) * p.sx < CORNER_MOUTH * R) return true; }
        if ((wall === "l" && p.ax === 0) || (wall === "r" && p.ax === W)) { if ((y - p.ay) * p.sy < CORNER_MOUTH * R) return true; }
      } else if (p.wall === wall) {
        const along = wall === "t" || wall === "b" ? Math.abs(x - p.ax) : Math.abs(y - p.ay);
        if (along < SIDE_MOUTH * R) return true;
      }
    }
    return false;
  }

  const hitsCushion = (x, y) =>
    (x < R && !openAt(x, y, "l")) || (x > W - R && !openAt(x, y, "r")) ||
    (y < R && !openAt(x, y, "t")) || (y > H - R && !openAt(x, y, "b"));

  function placeDiamonds(rail, tr, fr) {
    if (!diamondsEl) return;
    const fx = fr.left - tr.left;
    const fy = fr.top - tr.top;
    const top = rail / 2;
    const bottom = tr.height - rail / 2;
    const left = rail / 2;
    const right = tr.width - rail / 2;
    const longK = [1, 2, 3, 5, 6, 7].map((k) => k / 8);
    const shortK = [1, 2, 3].map((k) => k / 4);
    const pts = [];
    if (landscape) {
      longK.forEach((k) => pts.push([fx + W * k, top], [fx + W * k, bottom]));
      shortK.forEach((k) => pts.push([left, fy + H * k], [right, fy + H * k]));
    } else {
      longK.forEach((k) => pts.push([left, fy + H * k], [right, fy + H * k]));
      shortK.forEach((k) => pts.push([fx + W * k, top], [fx + W * k, bottom]));
    }
    if (diamondsEl.children.length !== pts.length) diamondsEl.innerHTML = pts.map(() => "<i></i>").join("");
    pts.forEach(([x, y], i) => {
      const el = diamondsEl.children[i];
      el.style.left = x.toFixed(1) + "px";
      el.style.top = y.toFixed(1) + "px";
    });
  }

  /* ---------- rack ---------- */
  const headSpot = () => (landscape ? [W * 0.25, H * 0.5] : [W * 0.5, H * 0.75]);

  function makeBall(spec, x, y, delay) {
    const axis = norm3([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    const q = spec.cue
      ? qaxis(axis[0], axis[1], axis[2], Math.random() * TAU)
      : qnorm(qmul(qaxis(0, 0, 1, (Math.random() - 0.5) * 0.7), qaxis(axis[0], axis[1], axis[2], (Math.random() - 0.5) * 0.45)));
    return { ...spec, x, y, vx: 0, vy: 0, q, state: "table", fall: 0, pocket: null, fx: 0, fy: 0, spawn: delay > 0 ? -delay : 1, rolls: 0 };
  }

  function rack(animate = true) {
    const rows = [1, 2, 3, 2, 1];
    const step = R * Math.sqrt(3) * 1.004;
    const gap = R * 2.004;
    const apex = landscape ? { x: W * 0.75, y: H * 0.5 } : { x: W * 0.5, y: H * 0.27 };
    const jitter = () => (Math.random() - 0.5) * R * 0.012;
    const slots = [];
    rows.forEach((count, row) => {
      for (let j = 0; j < count; j++) {
        const off = (j - (count - 1) / 2) * gap;
        slots.push(landscape
          ? { x: apex.x + row * step + jitter(), y: apex.y + off + jitter() }
          : { x: apex.x + off + jitter(), y: apex.y - row * step + jitter() });
      }
    });
    const rest = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
    let k = 0;
    // 9-ball rules: 1 on the apex, 9 in the middle
    balls = slots.map((s, i) => makeBall(SPECS[i === 0 ? 1 : i === 4 ? 9 : rest[k++]], s.x, s.y, animate ? 0.04 + i * 0.035 : 0));
    const [hx, hy] = headSpot();
    cue = makeBall({ n: 0, c: IVORY, cue: true }, hx, hy, animate ? 0.42 : 0);
    balls.push(cue);

    phase = "rest";
    shot = null;
    windup = null;
    racked = true;
    pocketCount = 0;
    aim.dragging = false;
    stick.alpha = 0;
    stick.pull = R;
    stick.angle = Math.atan2(apex.y - hy, apex.x - hx);
    traySlots.forEach((li) => {
      li.className = "";
      li.removeAttribute("data-n");
      li.style.removeProperty("--c");
    });
    if (countEl) countEl.textContent = "0";
    updateUi();
  }

  function separate() {
    const live = balls.filter((b) => b.state === "table");
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d >= 2 * R) continue;
          const push = (2 * R - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  /* ---------- physics ---------- */
  const isMoving = () => balls.some((b) => b.state === "table" && (b.vx || b.vy));
  const isFalling = () => balls.some((b) => b.state === "falling");

  const inMouth = (b, wall) => openAt(b.x, b.y, wall);

  function roll(b, dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    // rolling without slipping: axis ⟂ to travel in the table plane, angle = distance / radius
    b.q = qmul(qaxis(dy / d, -dx / d, 0, d / R), b.q);
    if (++b.rolls % 24 === 0) b.q = qnorm(b.q);
  }

  function sound(name, v) {
    if (!RW.sfx || v < 0.035) return;
    if (name === "clack") {
      const now = performance.now();
      if (now - lastClack < 12) return;
      lastClack = now;
    }
    RW.sfx[name](v);
  }

  function startFall(b, p) {
    b.state = "falling";
    b.fall = 0;
    b.pocket = p;
    b.fx = b.x;
    b.fy = b.y;
    b.fr = Math.hypot(b.x - p.x, b.y - p.y) + R;
    sound("pocket", clamp(Math.hypot(b.vx, b.vy) / (VMAX * 0.25), 0.35, 1));
    b.vx = 0;
    b.vy = 0;
  }

  function capture(b) {
    for (const p of pockets) {
      if (captured(b.x, b.y, p)) {
        startFall(b, p);
        return true;
      }
    }
    return false;
  }

  function substep(h) {
    const live = [];
    for (const b of balls) if (b.state === "table") live.push(b);

    for (const b of live) {
      if (!b.vx && !b.vy) continue;
      const sp = Math.hypot(b.vx, b.vy);
      const ns = sp - (DECEL + DAMP * sp) * h;
      if (ns <= STOP) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      const f = ns / sp;
      b.vx *= f;
      b.vy *= f;
      const dx = b.vx * h;
      const dy = b.vy * h;
      b.x += dx;
      b.y += dy;
      roll(b, dx, dy);
    }

    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = 2 * R;
        if (d2 >= min * min || d2 < 1e-9) continue;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const approach = dx * rvx + dy * rvy;
        if (approach < 0) {
          // Rewind the pair to the exact moment of contact so the contact normal
          // (and therefore the cut angle) matches the aiming guide.
          const vv = rvx * rvx + rvy * rvy;
          const c = d2 - min * min;
          let back = vv > 1e-9 ? (approach + Math.sqrt(Math.max(0, approach * approach - vv * c))) / vv : 0;
          back = clamp(back, 0, h);
          a.x -= a.vx * back; a.y -= a.vy * back;
          b.x -= b.vx * back; b.y -= b.vy * back;
          let nx = b.x - a.x;
          let ny = b.y - a.y;
          const nd = Math.hypot(nx, ny) || 1;
          nx /= nd;
          ny /= nd;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const imp = (-(1 + E_BALL) * rv) / 2;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
            sound("clack", -rv / (VMAX * 0.4));
          }
          a.x += a.vx * back; a.y += a.vy * back;
          b.x += b.vx * back; b.y += b.vy * back;
        }
        // whatever overlap is left (resting contact, rounding) is pushed apart
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const ed = Math.hypot(ex, ey) || 1e-6;
        if (ed < min) {
          const push = (min - ed) / 2;
          a.x -= (ex / ed) * push;
          a.y -= (ey / ed) * push;
          b.x += (ex / ed) * push;
          b.y += (ey / ed) * push;
        }
      }
    }

    for (const b of live) {
      if (b.state !== "table" || capture(b)) continue;
      if (b.x < R && !inMouth(b, "l")) {
        b.x = R;
        if (b.vx < 0) { sound("cushion", (-b.vx / VMAX) * 2.2); b.vx = -b.vx * E_CUSH; b.vy *= 0.94; }
      } else if (b.x > W - R && !inMouth(b, "r")) {
        b.x = W - R;
        if (b.vx > 0) { sound("cushion", (b.vx / VMAX) * 2.2); b.vx = -b.vx * E_CUSH; b.vy *= 0.94; }
      }
      if (b.y < R && !inMouth(b, "t")) {
        b.y = R;
        if (b.vy < 0) { sound("cushion", (-b.vy / VMAX) * 2.2); b.vy = -b.vy * E_CUSH; b.vx *= 0.94; }
      } else if (b.y > H - R && !inMouth(b, "b")) {
        b.y = H - R;
        if (b.vy > 0) { sound("cushion", (b.vy / VMAX) * 2.2); b.vy = -b.vy * E_CUSH; b.vx *= 0.94; }
      }
      // slipped through a pocket mouth without touching the capture zone
      if (b.x < -R || b.x > W + R || b.y < -R || b.y > H + R) {
        let best = pockets[0];
        let bd = Infinity;
        for (const p of pockets) {
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < bd) { bd = d; best = p; }
        }
        startFall(b, best);
      }
    }
  }

  function physics(dt) {
    let vmax = 0;
    for (const b of balls) if (b.state === "table") vmax = Math.max(vmax, Math.abs(b.vx) + Math.abs(b.vy));
    if (!vmax) return;
    const n = clamp(Math.ceil((vmax * dt) / (R * 0.3)), 1, 32);
    for (let i = 0; i < n; i++) substep(dt / n);
  }

  /* ---------- shots ---------- */
  function shoot(angle, power) {
    if (phase !== "rest" || !cue || cue.state !== "table") return;
    phase = "striking";
    stick.angle = angle;
    stick.from = Math.max(stick.pull, 2);
    stick.power = clamp(power, 0, 1);
    stick.t = 0;
    stick.dur = 0.045 + 0.065 * clamp(stick.from / MAXPULL, 0, 1);
    stick.alpha = 1;
    interacted = true;
    updateUi();
  }

  function nearestBall() {
    let best = null;
    let bd = Infinity;
    for (const b of balls) {
      if (b === cue || b.state !== "table") continue;
      const d = Math.hypot(b.x - cue.x, b.y - cue.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function pathClear(x1, y1, x2, y2, ignore) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    for (const b of balls) {
      if (b.state !== "table" || ignore.includes(b)) continue;
      const t = clamp(((b.x - x1) * dx + (b.y - y1) * dy) / len2, 0, 1);
      if (Math.hypot(b.x - (x1 + dx * t), b.y - (y1 + dy * t)) < 2 * R * 1.1) return false;
    }
    return true;
  }

  // Distance covered while slowing from v0 to v1 under dv/dt = -(DECEL + DAMP·v).
  function travel(v0, v1) {
    const c = DECEL / DAMP;
    return ((v0 - v1) - c * Math.log((v0 + c) / (v1 + c))) / DAMP;
  }
  // Launch speed needed to cover `dist` and still be moving at `arrive`.
  function speedFor(dist, arrive) {
    let lo = arrive;
    let hi = VMAX * 4;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (travel(mid, arrive) < dist) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // Aim points spread across a pocket's opening.
  function aimPoints(p) {
    if (p.kind === "corner") {
      const j = 1.25 * R;
      return [0.5, 0.32, 0.68, 0.16, 0.84].map((s) => ({ x: p.ax + p.sx * s * j, y: p.ay + p.sy * (1 - s) * j }));
    }
    const horizontal = p.wall === "t" || p.wall === "b";
    return [0, -0.45, 0.45, -0.85, 0.85].map((k) =>
      horizontal ? { x: p.ax + k * R, y: p.ay } : { x: p.ax, y: p.ay + k * R });
  }

  // Does a ball rolling straight from (x0,y0) through (x1,y1) drop before touching a cushion?
  function dropsIn(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const step = (R * 0.2) / len;
    for (let t = step; t < 1 + (3 * R) / len; t += step) {
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      for (const p of pockets) if (captured(x, y, p)) return true;
      if (hitsCushion(x, y)) return false;
    }
    return false;
  }

  // Look for the easiest pot: clear path to the ghost ball, clean run into the pocket, smallest cut.
  function bestShot() {
    let best = null;
    for (const b of balls) {
      if (b === cue || b.state !== "table") continue;
      for (const p of pockets) for (const aimAt of aimPoints(p)) {
        const ux = aimAt.x - b.x;
        const uy = aimAt.y - b.y;
        const ud = Math.hypot(ux, uy);
        const nx = ux / ud;
        const ny = uy / ud;
        const gx = b.x - nx * 2 * R;
        const gy = b.y - ny * 2 * R;
        if (gx < R || gx > W - R || gy < R || gy > H - R) continue;
        const cx = gx - cue.x;
        const cy = gy - cue.y;
        const cd = Math.hypot(cx, cy);
        if (cd < R) continue;
        const dx = cx / cd;
        const dy = cy / cd;
        const cos = dx * nx + dy * ny;
        if (cos < 0.4) continue; // thinner than ~66° is a bad bet
        const score = Math.acos(clamp(cos, -1, 1)) * 2.2 + (cd + ud) / L;
        if (best && score >= best.score) continue;
        if (!pathClear(cue.x, cue.y, gx, gy, [cue, b]) || !pathClear(b.x, b.y, aimAt.x, aimAt.y, [b])) continue;
        if (!dropsIn(b.x, b.y, aimAt.x, aimAt.y)) continue;
        // speed the object ball needs to reach the pocket still rolling,
        // then the cue speed that delivers it after the collision
        const vObj = speedFor(ud, VMAX * 0.12);
        const vCue = speedFor(cd, vObj / (((1 + E_BALL) / 2) * cos));
        const power = Math.pow(clamp((vCue / VMAX - 0.05) / 0.95, 0, 1), 1 / 1.25);
        best = { score, angle: Math.atan2(dy, dx), power: clamp(power, 0.18, 1) };
      }
    }
    return best;
  }

  function assist() {
    if (phase !== "rest" || windup || !cue || cue.state !== "table") return;
    let angle;
    let power;
    if (racked) {
      const one = balls.find((b) => b.n === 1 && b.state === "table") || nearestBall();
      if (!one) return;
      angle = Math.atan2(one.y - cue.y, one.x - cue.x) + (Math.random() - 0.5) * 0.012;
      power = 1;
    } else {
      const s = bestShot();
      if (s) {
        angle = s.angle;
        power = s.power;
      } else {
        const t = nearestBall();
        if (!t) return;
        angle = Math.atan2(t.y - cue.y, t.x - cue.x);
        power = 0.5;
        toast("Tidak ada pukulan lurus. Coba main safety.");
      }
    }
    windup = { t: 0, dur: 0.6, angle, power, from: stick.pull };
    interacted = true;
    updateUi();
  }

  function respawnCue() {
    const [hx, hy] = headSpot();
    const along = landscape ? [0, 1] : [1, 0];
    const free = (x, y) => balls.every((b) => b === cue || b.state !== "table" || Math.hypot(b.x - x, b.y - y) > 2.2 * R);
    let x = hx;
    let y = hy;
    for (let i = 0; i < 40; i++) {
      const off = Math.ceil(i / 2) * (i % 2 ? 1 : -1) * 2.4 * R;
      const px = clamp(hx + along[0] * off, R, W - R);
      const py = clamp(hy + along[1] * off, R, H - R);
      if (free(px, py)) { x = px; y = py; break; }
    }
    Object.assign(cue, { x, y, vx: 0, vy: 0, state: "table", fall: 0, pocket: null, spawn: -0.05 });
  }

  function onPocketed(b) {
    if (!shot) shot = { pocketed: [], scratch: false, isBreak: false };
    if (b.cue) {
      shot.scratch = true;
      return;
    }
    shot.pocketed.push(b.n);
    const slot = traySlots[pocketCount];
    if (slot) {
      slot.className = "ball" + (b.stripe ? " ball--stripe" : "");
      slot.dataset.n = String(b.n);
      slot.style.setProperty("--c", b.c);
    }
    pocketCount++;
    if (countEl) countEl.textContent = String(pocketCount);
  }

  function endShot() {
    const s = shot || { pocketed: [], scratch: false, isBreak: false };
    shot = null;
    phase = "rest";
    if (s.scratch) respawnCue();
    const left = balls.filter((b) => !b.cue && b.state === "table").length;

    if (left === 0) {
      toast("Meja bersih! Berani tantang Raihan langsung?", { action: { label: "Ajak sparring", href: "#kontak" }, duration: 6500 });
      window.setTimeout(() => {
        if (phase === "rest" && balls.every((b) => b.cue || b.state !== "table")) rack(true);
      }, 2600);
    } else if (s.pocketed.includes(9) && s.scratch) {
      toast("Bola 9 masuk, tapi bola putih ikut jatuh. Foul!");
    } else if (s.pocketed.includes(9)) {
      toast("Bola 9 masuk. Di 9-ball, itu artinya menang.");
    } else if (s.scratch) {
      toast("Scratch. Bola putih kembali ke titik awal.");
    } else if (s.isBreak && s.pocketed.length) {
      toast(`Break bagus: ${s.pocketed.length} bola langsung masuk.`);
    }
    updateUi();
  }

  /* ---------- per-frame update ---------- */
  function updateAim(dt) {
    if (windup) {
      windup.t += dt;
      const k = clamp(windup.t / windup.dur, 0, 1);
      stick.angle = angleLerp(stick.angle, windup.angle, 1 - Math.pow(1e-6, dt));
      stick.pull = lerp(windup.from, 4 + MAXPULL * (0.35 + 0.6 * windup.power), easeOut(clamp(k * 1.3 - 0.3, 0, 1)));
      if (k >= 1) {
        const w = windup;
        windup = null;
        stick.angle = w.angle;
        shoot(w.angle, w.power);
      }
      return;
    }
    if (aim.dragging) {
      stick.angle = aim.angle;
      stick.pull = 4 + aim.pull * MAXPULL;
      return;
    }
    let target = stick.angle;
    let pull;
    if (aim.kb) {
      target = aim.kbAngle;
      pull = 4 + aim.kbPower * MAXPULL * 0.5;
    } else if (aim.hover) {
      if (Math.hypot(aim.mx - cue.x, aim.my - cue.y) > R * 1.6) target = Math.atan2(aim.my - cue.y, aim.mx - cue.x);
      pull = R * 0.55;
    } else {
      const t = nearestBall();
      if (t) target = Math.atan2(t.y - cue.y, t.x - cue.x);
      // idle "practice strokes", like a player warming up
      pull = reduced() ? R * 0.6 : R * (0.45 + 1.1 * (0.5 - 0.5 * Math.cos(clock * 2.4)));
    }
    stick.angle = angleLerp(stick.angle, target, 1 - Math.pow(aim.hover || aim.kb ? 1e-7 : 0.02, dt));
    stick.pull = aim.hover || aim.kb ? lerp(stick.pull, pull, 1 - Math.pow(1e-4, dt)) : pull;
  }

  function update(dt) {
    clock += dt;
    for (const b of balls) if (b.spawn < 1) b.spawn = Math.min(1, b.spawn + dt * 3.4);

    if (phase === "striking") {
      stick.t += dt;
      const t = Math.min(1, stick.t / stick.dur);
      stick.pull = lerp(stick.from, -R * 0.1, easeIn(t));
      stick.bx = cue.x;
      stick.by = cue.y;
      if (t >= 1) {
        const speed = VMAX * (0.05 + 0.95 * Math.pow(stick.power, 1.25));
        cue.vx = Math.cos(stick.angle) * speed;
        cue.vy = Math.sin(stick.angle) * speed;
        sound("strike", 0.25 + stick.power * 0.75);
        shot = { pocketed: [], scratch: false, isBreak: racked };
        racked = false;
        phase = "rolling";
        updateUi();
      }
    } else if (phase === "rolling") {
      stick.pull = Math.max(-R * 1.4, stick.pull - dt * R * 12); // follow-through
    }

    if (phase === "rolling") physics(dt);

    for (const b of balls) {
      if (b.state !== "falling") continue;
      b.fall += dt / 0.3;
      if (b.fall >= 1) {
        b.state = "gone";
        onPocketed(b);
      }
    }

    if (phase === "rolling" && !isMoving() && !isFalling()) endShot();

    const showStick = phase !== "rolling" && cue && cue.state === "table" && cue.spawn >= 1;
    stick.alpha = clamp(stick.alpha + (showStick ? dt * 3.2 : -dt * 4), 0, 1);
    if (phase === "rest" && cue && cue.state === "table") updateAim(dt);
  }

  /* ---------- drawing ---------- */
  function lightInfo(x, y) {
    // returns per-lamp direction + intensity used for highlights and shadows
    const h = L * 0.32; // lamp height above the felt
    return lights.map((l) => {
      const dx = l.x - x;
      const dy = l.y - y;
      const d = Math.hypot(dx, dy);
      // half-vector between the light direction and the (straight down) view
      const lz = h / Math.hypot(d, h);
      const hv = norm3([dx / Math.hypot(d, h), dy / Math.hypot(d, h), lz + 1]);
      return { hx: hv[0], hy: hv[1], sx: d ? -dx / d : 0, sy: d ? -dy / d : 0, k: clamp(d / (L * 0.5), 0, 1), i: 1 / (1 + Math.pow(d / (L * 0.55), 2)) };
    });
  }

  function drawPockets() {
    for (const p of pockets) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.hole * 1.17, 0, TAU);
      const liner = ctx.createRadialGradient(p.x, p.y, p.hole, p.x, p.y, p.hole * 1.17);
      liner.addColorStop(0, "#3a2416");
      liner.addColorStop(1, "#1d120b");
      ctx.fillStyle = liner;
      ctx.fill();
      const g = ctx.createRadialGradient(p.x, p.y - p.hole * 0.15, p.hole * 0.1, p.x, p.y, p.hole);
      g.addColorStop(0, "#000");
      g.addColorStop(0.72, "#040302");
      g.addColorStop(1, "#140d08");
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.hole, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  function spawnScale(b) {
    return b.spawn <= 0 ? 0 : easeOutBack(Math.min(1, b.spawn));
  }

  function drawShadow(b) {
    const s = spawnScale(b);
    if (s <= 0) return;
    for (const li of lightInfo(b.x, b.y)) {
      const off = R * (0.15 + 0.5 * li.k);
      const sx = b.x + li.sx * off;
      const sy = b.y + li.sy * off;
      const r = R * (1.08 + 0.25 * li.k) * s;
      const g = ctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
      const a = 0.5 * li.i + 0.12;
      g.addColorStop(0, `rgba(0, 14, 28, ${a})`);
      g.addColorStop(0.55, `rgba(0, 14, 28, ${a * 0.55})`);
      g.addColorStop(1, "rgba(0, 14, 28, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
    }
  }

  // A white cap of a stripe ball, as the visible outline of a spherical cap.
  function cap(x, y, r, c) {
    const ca = Math.cos(CAP_ANGLE);
    const sa = Math.sin(CAP_ANGLE);
    const e1 = perp3(c);
    const e2 = cross(c, e1);
    const pts = [];
    let visible = 0;
    for (let i = 0; i < 30; i++) {
      const t = (i / 30) * TAU;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      let px = c[0] * ca + sa * (ct * e1[0] + st * e2[0]);
      let py = c[1] * ca + sa * (ct * e1[1] + st * e2[1]);
      const pz = c[2] * ca + sa * (ct * e1[2] + st * e2[2]);
      if (pz > 0) {
        // hidden behind the sphere: slide it to the silhouette
        const m = Math.hypot(px, py) || 1;
        px /= m;
        py /= m;
      } else visible++;
      pts.push(px, py);
    }
    if (!visible) return;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(x + pts[i] * r, y + pts[i + 1] * r);
    ctx.closePath();
    ctx.fillStyle = IVORY;
    ctx.fill();
  }

  // A small flat disk on the sphere (number circle, cue ball dot), projected exactly.
  function spot(x, y, r, c, up, ang, fill, label) {
    if (c[2] > 0.12) return; // facing away from the viewer
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const rt = cross(up, c);
    ctx.save();
    ctx.transform(rt[0] * r * sa, rt[1] * r * sa, -up[0] * r * sa, -up[1] * r * sa, x + c[0] * r * ca, y + c[1] * r * ca);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    if (label && c[2] < -0.1) {
      ctx.scale(0.01, 0.01);
      ctx.fillStyle = INK;
      ctx.font = `700 ${label.length > 1 ? 92 : 112}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 8);
    }
    ctx.restore();
  }

  function shade(x, y, r) {
    const info = lightInfo(x, y);
    // rim darkening, biased away from the brightest lamp
    const main = info[0].i > info[1].i ? info[0] : info[1];
    const rim = ctx.createRadialGradient(x - main.sx * r * 0.25, y - main.sy * r * 0.25, r * 0.1, x, y, r * 1.02);
    rim.addColorStop(0, "rgba(0, 0, 0, 0)");
    rim.addColorStop(0.62, "rgba(0, 0, 0, 0.05)");
    rim.addColorStop(1, "rgba(0, 10, 24, 0.52)");
    ctx.fillStyle = rim;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // bounce light from the blue felt on the side facing away from the lamp
    const bx = x + main.sx * r * 0.62;
    const by = y + main.sy * r * 0.62;
    const bounce = ctx.createRadialGradient(bx, by, 0, bx, by, r * 0.75);
    bounce.addColorStop(0, "rgba(90, 175, 235, 0.22)");
    bounce.addColorStop(1, "rgba(90, 175, 235, 0)");
    ctx.fillStyle = bounce;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // one specular highlight per lamp
    for (const li of info) {
      const hx = x + li.hx * r;
      const hy = y + li.hy * r;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);
      const a = 0.35 + 0.6 * li.i;
      g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
      g.addColorStop(0.16, `rgba(255, 255, 255, ${a * 0.45})`);
      g.addColorStop(0.55, "rgba(255, 255, 255, 0.04)");
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function drawBall(b, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = b.cue ? IVORY : b.c;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (b.stripe) {
      const a = qrot(b.q, [0, 1, 0]);
      cap(x, y, r, a);
      cap(x, y, r, [-a[0], -a[1], -a[2]]);
    }
    if (b.cue) {
      for (const d of CUE_DOTS) {
        const c = qrot(b.q, d);
        spot(x, y, r, c, perp3(c), 0.15, "#b8322a", null);
      }
    } else {
      const up = qrot(b.q, [0, -1, 0]);
      const label = String(b.n);
      spot(x, y, r, qrot(b.q, [0, 0, -1]), up, 0.5, IVORY, label);
      spot(x, y, r, qrot(b.q, [0, 0, 1]), up, 0.5, IVORY, label);
    }
    shade(x, y, r);
    ctx.restore();
  }

  function drawFalling(b) {
    const p = b.pocket;
    const t = clamp(b.fall, 0, 1);
    const e = easeOut(t);
    const x = lerp(b.fx, p.x, e);
    const y = lerp(b.fy, p.y, e);
    const r = R * lerp(1, 0.62, e);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, lerp(Math.max(b.fr, p.hole), p.hole, clamp(t * 2.2, 0, 1)), 0, TAU);
    ctx.clip();
    drawBall(b, x, y, r);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.85 * e})`;
    ctx.beginPath();
    ctx.arc(x, y, r + 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function raycast(px, py, dx, dy) {
    let best = Infinity;
    let target = null;
    for (const b of balls) {
      if (b === cue || b.state !== "table") continue;
      const fx = b.x - px;
      const fy = b.y - py;
      const tca = fx * dx + fy * dy;
      if (tca <= 0) continue;
      const d2 = fx * fx + fy * fy - tca * tca;
      const rr = 4 * R * R;
      if (d2 > rr) continue;
      const t = tca - Math.sqrt(rr - d2);
      if (t > 0 && t < best) { best = t; target = b; }
    }
    let tw = Infinity;
    let nx = 0;
    let ny = 0;
    if (dx > 1e-6) { const t = (W - R - px) / dx; if (t < tw) { tw = t; nx = -1; ny = 0; } }
    if (dx < -1e-6) { const t = (R - px) / dx; if (t < tw) { tw = t; nx = 1; ny = 0; } }
    if (dy > 1e-6) { const t = (H - R - py) / dy; if (t < tw) { tw = t; nx = 0; ny = -1; } }
    if (dy < -1e-6) { const t = (R - py) / dy; if (t < tw) { tw = t; nx = 0; ny = 1; } }
    if (best < tw) return { t: best, ball: target };
    return { t: Math.max(0, tw), wall: { nx, ny } };
  }

  function drawGuide(angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const hit = raycast(cue.x, cue.y, dx, dy);
    const ex = cue.x + dx * hit.t;
    const ey = cue.y + dy * hit.t;
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = stick.alpha;
    ctx.strokeStyle = "rgba(244, 238, 224, 0.6)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([1.5, 6]);
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * R * 1.2, cue.y + dy * R * 1.2);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ex, ey, R, 0, TAU);
    ctx.strokeStyle = "rgba(244, 238, 224, 0.6)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    if (hit.ball) {
      const b = hit.ball;
      let nx = b.x - ex;
      let ny = b.y - ey;
      const nd = Math.hypot(nx, ny) || 1;
      nx /= nd;
      ny /= nd;
      const cos = dx * nx + dy * ny;
      const len = R * (1.5 + 6.5 * cos);
      ctx.strokeStyle = "rgba(244, 238, 224, 0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + nx * R * 1.15, b.y + ny * R * 1.15);
      ctx.lineTo(b.x + nx * (R * 1.15 + len), b.y + ny * (R * 1.15 + len));
      ctx.stroke();
      let tx = dx - cos * nx;
      let ty = dy - cos * ny;
      const tl = Math.hypot(tx, ty);
      if (tl > 0.05) {
        tx /= tl;
        ty /= tl;
        ctx.setLineDash([1.5, 5]);
        ctx.strokeStyle = "rgba(244, 238, 224, 0.42)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ex + tx * R * 1.2, ey + ty * R * 1.2);
        ctx.lineTo(ex + tx * R * (1.2 + 5 * tl), ey + ty * R * (1.2 + 5 * tl));
        ctx.stroke();
      }
    } else if (hit.wall) {
      const { nx, ny } = hit.wall;
      const dot = dx * nx + dy * ny;
      const rx = dx - 2 * dot * nx;
      const ry = dy - 2 * dot * ny;
      ctx.setLineDash([1.5, 6]);
      ctx.strokeStyle = "rgba(244, 238, 224, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex + rx * R * 1.2, ey + ry * R * 1.2);
      ctx.lineTo(ex + rx * R * 5, ey + ry * R * 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPulse() {
    const t = (clock % 1.8) / 1.8;
    ctx.save();
    ctx.strokeStyle = `rgba(244, 238, 224, ${0.55 * (1 - t)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, R * (1.25 + t * 1.6), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawPower() {
    const r = R * 1.9;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(244, 238, 224, 0.16)";
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = aim.pull > 0.9 ? "#ffb98a" : "rgba(244, 238, 224, 0.9)";
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * aim.pull);
    ctx.stroke();
    ctx.restore();
  }

  // Cue stick, modelled on Raihan's own: navy forearm with ivory diamond inlays.
  function drawStick() {
    const bx = phase === "rolling" ? stick.bx : cue.x;
    const by = phase === "rolling" ? stick.by : cue.y;
    const back = stick.angle + Math.PI;
    const gap = R + 3 + stick.pull;
    const len = clamp(L * 0.62, 240, 720);
    const wT = R * 0.46;
    const wB = R * 1.08;
    const half = (s) => (wT + (wB - wT) * s) / 2;

    ctx.save();
    ctx.globalAlpha = stick.alpha;
    ctx.translate(bx + Math.cos(back) * gap, by + Math.sin(back) * gap);
    ctx.rotate(back);

    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(0, -half(0));
      ctx.lineTo(len, -half(1));
      ctx.arcTo(len + half(1), -half(1), len + half(1), 0, half(1) * 0.5);
      ctx.arcTo(len + half(1), half(1), len, half(1), half(1) * 0.5);
      ctx.lineTo(0, half(0));
      ctx.arc(0, 0, half(0), Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
    };

    // shadow on the felt
    ctx.save();
    ctx.shadowColor = "rgba(0, 10, 20, 0.55)";
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowOffsetX = 5 * dpr;
    ctx.shadowOffsetY = 12 * dpr;
    ctx.fillStyle = "#1b2546";
    outline();
    ctx.fill();
    ctx.restore();

    ctx.save();
    outline();
    ctx.clip();
    const seg = (s0, s1, fill) => {
      const x0 = s0 * len;
      const x1 = s1 * len + (s1 >= 1 ? half(1) + 1 : 0);
      ctx.fillStyle = fill;
      ctx.fillRect(x0 - (s0 <= 0 ? half(0) + 1 : 0), -wB, x1 - x0 + (s0 <= 0 ? half(0) + 1 : 0), wB * 2);
    };
    const maple = ctx.createLinearGradient(0, -half(0.3), 0, half(0.3));
    maple.addColorStop(0, "#b8935a");
    maple.addColorStop(0.32, "#f2deb0");
    maple.addColorStop(0.6, "#dcbf86");
    maple.addColorStop(1, "#9c7843");
    seg(0, 0.008, "#3f86c6"); // chalked tip
    seg(0.008, 0.024, "#f1ead9"); // ferrule
    seg(0.024, 0.56, maple); // shaft
    seg(0.56, 0.566, "#c9a35f"); // joint
    seg(0.566, 0.78, "#1b2546"); // forearm
    seg(0.78, 0.786, "#efe7d6");
    seg(0.786, 0.925, "#141414"); // wrap
    seg(0.925, 0.931, "#efe7d6");
    seg(0.931, 0.99, "#1b2546"); // butt sleeve
    seg(0.99, 1, "#0b0b0b"); // bumper
    // ivory diamond inlays on the forearm
    ctx.fillStyle = "#f1ead9";
    [[0.6, 0.68], [0.69, 0.765]].forEach(([s0, s1]) => {
      const x0 = s0 * len;
      const x1 = s1 * len;
      const hm = half((s0 + s1) / 2) * 0.62;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo((x0 + x1) / 2, -hm);
      ctx.lineTo(x1, 0);
      ctx.lineTo((x0 + x1) / 2, hm);
      ctx.closePath();
      ctx.fill();
    });
    // wrap texture
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let s = 0.79; s < 0.92; s += 0.006) {
      ctx.beginPath();
      ctx.moveTo(s * len, -wB);
      ctx.lineTo(s * len + 3, wB);
      ctx.stroke();
    }
    // roundness
    const round = ctx.createLinearGradient(0, -wB / 2, 0, wB / 2);
    round.addColorStop(0, "rgba(0, 0, 0, 0.25)");
    round.addColorStop(0.28, "rgba(255, 255, 255, 0.32)");
    round.addColorStop(0.45, "rgba(255, 255, 255, 0)");
    round.addColorStop(0.75, "rgba(0, 0, 0, 0.12)");
    round.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    ctx.fillStyle = round;
    ctx.fillRect(-wB, -wB, len + wB * 2, wB * 2);
    ctx.restore();
    ctx.restore();
  }

  function draw() {
    if (!cue) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(ox, oy);

    drawPockets();
    const guide = phase === "rest" && cue.state === "table" && (aim.dragging || aim.hover || aim.kb || windup);
    if (guide && stick.alpha > 0.2) drawGuide(stick.angle);
    for (const b of balls) if (b.state === "table") drawShadow(b);
    for (const b of balls) if (b.state === "falling") drawFalling(b);
    for (const b of balls) {
      if (b.state !== "table") continue;
      const s = spawnScale(b);
      if (s > 0) drawBall(b, b.x, b.y, R * s);
    }
    if (!interacted && phase === "rest" && cue.state === "table" && cue.spawn >= 1) drawPulse();
    if (aim.dragging && aim.pull > 0) drawPower();
    if (stick.alpha > 0.01 && (cue.state === "table" || phase === "rolling")) {
      drawStick();
      fadeBeyondTable();
    }
  }

  // The butt of the cue fades out a little past the rail, so it never sits on top of the page UI.
  function fadeBeyondTable() {
    const f = coarse ? 26 : 70;
    const m = 4;
    const x0 = box.x - m;
    const y0 = box.y - m;
    const x1 = box.x + box.w + m;
    const y1 = box.y + box.h + m;
    const left = -ox;
    const top = -oy;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const band = (gx0, gy0, gx1, gy1, rx, ry, rw, rh) => {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, "rgba(0, 0, 0, 0)");
      g.addColorStop(1, "rgba(0, 0, 0, 1)");
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };
    band(0, y1, 0, y1 + f, left, y1, cw, ch);
    band(0, y0, 0, y0 - f, left, top, cw, y0 - top);
    band(x0, 0, x0 - f, 0, left, top, x0 - left, ch);
    band(x1, 0, x1 + f, 0, x1, top, cw, ch);
    ctx.restore();
  }

  /* ---------- UI ---------- */
  function setHint() {
    if (!hintEl) return;
    if (aim.kb) {
      hintEl.textContent = `←/→ membidik · ↑/↓ tenaga ${Math.round(aim.kbPower * 100)}% · Spasi memukul`;
    } else if (coarse) {
      hintEl.textContent = "Sentuh bola putih, tarik ke belakang, lalu lepas.";
    } else {
      hintEl.textContent = "Arahkan kursor, klik, tarik ke belakang, lalu lepas.";
    }
  }

  function updateUi() {
    const busy = phase !== "rest" || !!windup;
    if (assistBtn) {
      assistBtn.disabled = busy;
      assistBtn.textContent = racked ? "Break" : "Bantu bidik";
    }
    if (rerackBtn) rerackBtn.disabled = phase === "striking" || !!windup;
    table.classList.toggle("is-busy", phase === "rolling");
  }

  /* ---------- input ---------- */
  const feltPoint = (e) => {
    const fr = felt.getBoundingClientRect();
    return { x: e.clientX - fr.left, y: e.clientY - fr.top };
  };

  table.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || phase !== "rest" || windup || !cue || cue.state !== "table" || cue.spawn < 1) return;
    const p = feltPoint(e);
    const isMouse = e.pointerType === "mouse";
    // touch must start on (or near) the cue ball so the page can still scroll
    if (!isMouse && Math.hypot(p.x - cue.x, p.y - cue.y) > Math.max(R * 3.4, 36)) return;
    aim.dragging = true;
    aim.id = e.pointerId;
    aim.sx = p.x;
    aim.sy = p.y;
    aim.pull = 0;
    aim.angle = stick.angle;
    interacted = true;
    table.classList.add("is-aiming");
    try { table.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (isMouse) e.preventDefault();
  });

  // Block scrolling only for a touch that started an aim.
  table.addEventListener("touchstart", (e) => { if (aim.dragging) e.preventDefault(); }, { passive: false });
  table.addEventListener("touchmove", (e) => { if (aim.dragging) e.preventDefault(); }, { passive: false });

  table.addEventListener("pointermove", (e) => {
    const p = feltPoint(e);
    if (aim.dragging && e.pointerId === aim.id) {
      const vx = p.x - aim.sx;
      const vy = p.y - aim.sy;
      const len = Math.hypot(vx, vy);
      if (len > 6) aim.angle = Math.atan2(-vy, -vx);
      aim.pull = clamp((len - 6) / MAXPULL, 0, 1);
      return;
    }
    if (e.pointerType === "mouse") {
      aim.mx = p.x;
      aim.my = p.y;
      aim.hover = true;
    }
  });

  const endDrag = (e, cancelled) => {
    if (!aim.dragging || e.pointerId !== aim.id) return;
    aim.dragging = false;
    table.classList.remove("is-aiming");
    if (!cancelled && aim.pull > 0.04) shoot(aim.angle, aim.pull);
    aim.pull = 0;
  };
  table.addEventListener("pointerup", (e) => endDrag(e, false));
  table.addEventListener("pointercancel", (e) => endDrag(e, true));
  table.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !aim.dragging) aim.hover = false; });

  table.addEventListener("focus", () => {
    if (!table.matches(":focus-visible")) return;
    aim.kb = true;
    aim.kbAngle = stick.angle;
    setHint();
  });
  table.addEventListener("blur", () => {
    aim.kb = false;
    setHint();
  });
  table.addEventListener("keydown", (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    if (!aim.kb) { aim.kb = true; aim.kbAngle = stick.angle; }
    interacted = true;
    const step = e.shiftKey ? 0.004 : 0.03;
    if (e.key === "ArrowLeft") aim.kbAngle -= step;
    if (e.key === "ArrowRight") aim.kbAngle += step;
    if (e.key === "ArrowUp") aim.kbPower = clamp(aim.kbPower + 0.1, 0.1, 1);
    if (e.key === "ArrowDown") aim.kbPower = clamp(aim.kbPower - 0.1, 0.1, 1);
    if (e.key === " " || e.key === "Enter") shoot(aim.kbAngle, aim.kbPower);
    setHint();
  });

  if (assistBtn) assistBtn.addEventListener("click", assist);
  if (rerackBtn) rerackBtn.addEventListener("click", () => { rack(true); RW.sfx && RW.sfx.tick(); });

  /* ---------- loop ---------- */
  let raf = 0;
  let last = 0;
  let onScreen = true;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    if (onScreen && !document.hidden) raf = window.requestAnimationFrame(frame);
  }
  function kick() {
    if (raf || !onScreen || document.hidden) return;
    last = performance.now();
    raf = window.requestAnimationFrame(frame);
  }

  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    kick();
  }, { rootMargin: "120px" }).observe(hero);
  document.addEventListener("visibilitychange", kick);

  let resizeRaf = 0;
  new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeRaf);
    resizeRaf = window.requestAnimationFrame(() => {
      layout();
      draw();
    });
  }).observe(hero);

  layout();
  setHint();
  kick();

  // read-only hook for automated tests
  RW.table = {
    get state() {
      return { phase, W, H, R, landscape, balls: balls.map((b) => ({ n: b.n, x: Math.round(b.x), y: Math.round(b.y), state: b.state })), pocketCount };
    },
    feltRect: () => felt.getBoundingClientRect(),
    cue: () => (cue ? { x: cue.x, y: cue.y } : null),
  };
})();
