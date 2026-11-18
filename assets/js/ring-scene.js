/* ring-scene.js — the arena around the fighters: a one-point projection,
   the crowd (cached), the ring floor in table felt, ropes, posts and light.
   World units: y points down, z points at the camera, the opponent stands at z = 0. */
(() => {
  "use strict";
  const RW = (window.RW = window.RW || {});

  const D = 640;          // camera distance from the opponent's body plane
  const FLOOR = 430;      // ring canvas, measured from the opponent's hips
  const HALF = 1150;      // ring half-width
  const FAR = -1150;      // far rope line
  const ROPES = [170, 300, 430, 560];

  /* Seeded random so the crowd looks the same after every resize. */
  const rng = (seed) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  function projector(w, h, layout = {}) {
    const S = Math.min(h * (layout.sy || 0.00178), w * (layout.sx || 0.0036));
    return {
      w, h, S, D,
      cx: w / 2,
      cy: h * (layout.eye || 0.3),
      camX: 0,
      camY: -300,
      pt(x, y, z) {
        const k = D / Math.max(30, D - z);
        return { x: this.cx + (x - this.camX) * this.S * k, y: this.cy + (y - this.camY) * this.S * k, s: this.S * k };
      },
    };
  }

  /* ---------------------------------------------------------------------
     Backdrop: dark hall, crowd rows rising into the dark, a band of haze.
     Rendered once per size with a margin, then slid for parallax.
     --------------------------------------------------------------------- */
  const PARALLAX = 0.27; // roughly the projection scale of the crowd

  function buildBackdrop(P, dpr) {
    const margin = Math.ceil(P.w * 0.22 + 40);
    const W = P.w + margin * 2;
    const H = P.h;
    const c = document.createElement("canvas");
    c.width = Math.ceil(W * dpr);
    c.height = Math.ceil(H * dpr);
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = margin + P.cx;

    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#06080b");
    bg.addColorStop(Math.max(0.05, P.cy / H - 0.08), "#0d0e10");
    bg.addColorStop(Math.min(0.95, P.cy / H + 0.18), "#1a1410");
    bg.addColorStop(1, "#0a0807");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // warm spill on the back wall, behind the crowd
    const glow = g.createRadialGradient(cx, P.cy + P.h * 0.08, 10, cx, P.cy + P.h * 0.08, P.w * 0.75);
    glow.addColorStop(0, "rgba(255, 178, 110, 0.16)");
    glow.addColorStop(1, "rgba(255, 178, 110, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    const rand = rng(7);
    const pt = (x, y, z) => {
      const k = D / (D - z);
      return { x: cx + x * P.S * k, y: P.cy + (y - P.camY) * P.S * k, s: P.S * k };
    };
    const tones = ["#15110e", "#1b1612", "#211b16", "#18130f", "#251e18", "#1d1814"];
    for (let i = 11; i >= 0; i--) {
      const z = -1650 - i * 230;
      const yHead = 360 - i * 135;
      const k = D / (D - z);
      const span = (W / 2 + 60) / (P.S * k);
      const lit = Math.max(0, 1 - i / 7);
      for (let x = -span; x < span; x += 118 + rand() * 30) {
        const p = pt(x + (rand() - 0.5) * 40, yHead + (rand() - 0.5) * 30, z);
        const s = p.s;
        g.fillStyle = tones[(rand() * tones.length) | 0];
        g.beginPath();
        g.ellipse(p.x, p.y + 72 * s, 60 * s, 44 * s, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(p.x, p.y, 26 * s, 0, Math.PI * 2);
        g.fill();
        if (rand() < 0.09) {
          // an arm in the air
          g.strokeStyle = g.fillStyle;
          g.lineWidth = 16 * s;
          g.lineCap = "round";
          const side = rand() < 0.5 ? -1 : 1;
          g.beginPath();
          g.moveTo(p.x + side * 40 * s, p.y + 60 * s);
          g.lineTo(p.x + side * 62 * s, p.y - 70 * s);
          g.stroke();
        }
        if (lit > 0) {
          g.strokeStyle = `rgba(255, 196, 140, ${0.22 * lit})`;
          g.lineWidth = Math.max(0.6, 3 * s);
          g.beginPath();
          g.arc(p.x, p.y, 25 * s, Math.PI * 1.1, Math.PI * 1.9);
          g.stroke();
        }
        if (rand() < 0.05) {
          // a phone filming the fight
          g.fillStyle = "rgba(196, 222, 255, 0.75)";
          g.fillRect(p.x - 9 * s, p.y + 10 * s, 18 * s, 26 * s);
        }
      }
    }

    // haze over the crowd so the fighters separate from it
    const hz = g.createLinearGradient(0, P.cy - P.h * 0.2, 0, P.cy + P.h * 0.3);
    hz.addColorStop(0, "rgba(40, 46, 56, 0)");
    hz.addColorStop(0.5, "rgba(46, 52, 62, 0.22)");
    hz.addColorStop(1, "rgba(20, 18, 16, 0)");
    g.fillStyle = hz;
    g.fillRect(0, 0, W, H);

    return { canvas: c, margin, W, H };
  }

  function drawBackdrop(ctx, P, bd) {
    const shift = -P.camX * P.S * PARALLAX;
    const sy = (P.camY + 300) * P.S * -PARALLAX;
    ctx.drawImage(bd.canvas, -bd.margin + shift, sy, bd.W, bd.H);
    if (sy > 0) { ctx.fillStyle = "#06080b"; ctx.fillRect(-bd.margin, 0, bd.W, sy + 1); }
  }

  /* ---------------------------------------------------------------------
     Ring floor: tournament felt, lit from above, an 8-ball printed mid-ring.
     --------------------------------------------------------------------- */
  function drawFloor(ctx, P) {
    const zNear = D - 110;
    const a = P.pt(-HALF, FLOOR, FAR);
    const b = P.pt(HALF, FLOOR, FAR);
    const c = P.pt(HALF, FLOOR, zNear);
    const d = P.pt(-HALF, FLOOR, zNear);
    const lg = ctx.createLinearGradient(0, a.y, 0, P.h);
    lg.addColorStop(0, "#0f3f66");
    lg.addColorStop(0.45, "#185f93");
    lg.addColorStop(1, "#1c679c");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();

    // outer stripe of the mat, 60 units in from the ropes
    ctx.strokeStyle = "rgba(241, 234, 219, 0.16)";
    ctx.lineWidth = Math.max(1, 10 * a.s);
    const e = P.pt(-HALF + 70, FLOOR, FAR + 70);
    const f = P.pt(HALF - 70, FLOOR, FAR + 70);
    const gN = P.pt(HALF - 70, FLOOR, zNear);
    const hN = P.pt(-HALF + 70, FLOOR, zNear);
    ctx.beginPath();
    ctx.moveTo(hN.x, hN.y);
    ctx.lineTo(e.x, e.y);
    ctx.lineTo(f.x, f.y);
    ctx.lineTo(gN.x, gN.y);
    ctx.stroke();

    // the printed 8-ball, foreshortened
    const ctr = P.pt(0, FLOOR, -820);
    const rx = 250 * ctr.s;
    const top = P.pt(0, FLOOR, -1070);
    const bot = P.pt(0, FLOOR, -570);
    const ry = Math.max(2, (bot.y - top.y) / 2);
    const my = (bot.y + top.y) / 2;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#0b2c47";
    ctx.beginPath();
    ctx.ellipse(ctr.x, my, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(241, 234, 219, 0.55)";
    ctx.beginPath();
    ctx.ellipse(ctr.x, my, rx * 0.42, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // pool of light in the middle of the ring
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const sp = P.pt(0, FLOOR, -700);
    ctx.translate(sp.x, sp.y);
    ctx.scale(1, 0.28);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 900 * sp.s);
    rg.addColorStop(0, "rgba(120, 190, 240, 0.32)");
    rg.addColorStop(1, "rgba(120, 190, 240, 0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, 900 * sp.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------
     Ropes, the felt-blue spacer and the far corner posts.
     --------------------------------------------------------------------- */
  function rope(ctx, p1, p2, w1, w2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(p1.x + nx * w1, p1.y + ny * w1);
    ctx.lineTo(p2.x + nx * w2, p2.y + ny * w2);
    ctx.lineTo(p2.x - nx * w2, p2.y - ny * w2);
    ctx.lineTo(p1.x - nx * w1, p1.y - ny * w1);
    ctx.closePath();
    ctx.fill();
  }

  function post(ctx, P, side) {
    const x = side * HALF;
    const base = P.pt(x, FLOOR + 40, FAR);
    const top = P.pt(x, FLOOR - 640, FAR);
    const s = base.s;
    const pg = ctx.createLinearGradient(base.x - 26 * s, 0, base.x + 26 * s, 0);
    pg.addColorStop(0, "#1c1a18");
    pg.addColorStop(0.45, "#6b665e");
    pg.addColorStop(1, "#141311");
    ctx.fillStyle = pg;
    ctx.fillRect(base.x - 24 * s, top.y, 48 * s, base.y - top.y);
    // padded turnbuckle cover
    const padTop = P.pt(x, FLOOR - ROPES[3] - 34, FAR).y;
    const padBot = P.pt(x, FLOOR - ROPES[0] + 34, FAR).y;
    const col = side < 0 ? ["#cf2f2a", "#8c1d19"] : ["#2456c4", "#173a8a"];
    const cg = ctx.createLinearGradient(base.x - 46 * s, 0, base.x + 46 * s, 0);
    cg.addColorStop(0, col[1]);
    cg.addColorStop(0.4, col[0]);
    cg.addColorStop(1, col[1]);
    ctx.fillStyle = cg;
    const r = 18 * s;
    const x0 = base.x - 46 * s;
    const wd = 92 * s;
    ctx.beginPath();
    ctx.moveTo(x0 + r, padTop);
    ctx.arcTo(x0 + wd, padTop, x0 + wd, padBot, r);
    ctx.arcTo(x0 + wd, padBot, x0, padBot, r);
    ctx.arcTo(x0, padBot, x0, padTop, r);
    ctx.arcTo(x0, padTop, x0 + wd, padTop, r);
    ctx.fill();
  }

  function drawRopes(ctx, P) {
    post(ctx, P, -1);
    post(ctx, P, 1);
    for (let i = 0; i < ROPES.length; i++) {
      const y = FLOOR - ROPES[i];
      const a = P.pt(-HALF, y, FAR);
      const b = P.pt(HALF, y, FAR);
      const w = 7 * a.s;
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(a.x, a.y + w * 0.6, b.x - a.x, w * 1.2);
      ctx.fillStyle = "#e8dfca";
      ctx.fillRect(a.x, a.y - w, b.x - a.x, w * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.fillRect(a.x, a.y - w, b.x - a.x, w * 0.6);
      // side ropes run from the far posts past the camera
      for (const side of [-1, 1]) {
        const p1 = P.pt(side * HALF, y, FAR);
        const p2 = P.pt(side * HALF, y, D - 120);
        ctx.fillStyle = "#d9cfb8";
        rope(ctx, p1, p2, 7 * p1.s, 7 * p2.s);
      }
    }
    // spacer strap in the middle of the far side
    const t = P.pt(0, FLOOR - ROPES[3] - 10, FAR);
    const bt = P.pt(0, FLOOR - ROPES[0] + 10, FAR);
    ctx.fillStyle = "#1c679c";
    ctx.fillRect(t.x - 16 * t.s, t.y, 32 * t.s, bt.y - t.y);
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.fillRect(t.x - 16 * t.s, t.y, 7 * t.s, bt.y - t.y);
  }

  /* ---------------------------------------------------------------------
     Light from above: soft beams with dust turning in them.
     --------------------------------------------------------------------- */
  const motes = (() => {
    const r = rng(42);
    return Array.from({ length: 46 }, () => ({ x: r(), y: r(), sp: 0.2 + r() * 0.6, ph: r() * 6.28, sz: 0.6 + r() * 1.4 }));
  })();

  function drawLights(ctx, P, t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const floorY = P.pt(0, FLOOR, -700).y;
    const drift = -P.camX * P.S * 0.18;
    for (let i = -1; i <= 1; i++) {
      const xTop = P.cx + i * P.w * 0.3 + drift;
      const xBot = P.cx + i * P.w * 0.12 + drift * 0.6;
      const wTop = P.w * 0.05;
      const wBot = P.w * (i === 0 ? 0.42 : 0.3);
      const g = ctx.createLinearGradient(0, 0, 0, floorY);
      g.addColorStop(0, `rgba(255, 226, 182, ${i === 0 ? 0.13 : 0.07})`);
      g.addColorStop(1, "rgba(255, 226, 182, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(xTop - wTop, -4);
      ctx.lineTo(xTop + wTop, -4);
      ctx.lineTo(xBot + wBot, floorY);
      ctx.lineTo(xBot - wBot, floorY);
      ctx.closePath();
      ctx.fill();
    }
    for (const m of motes) {
      const x = ((m.x + Math.sin(t * 0.1 * m.sp + m.ph) * 0.03) % 1) * P.w + drift * 0.5;
      const y = ((m.y + t * 0.012 * m.sp) % 1) * floorY;
      const a = 0.18 + 0.18 * Math.sin(t * m.sp + m.ph);
      ctx.fillStyle = `rgba(255, 236, 205, ${Math.max(0, a)})`;
      ctx.fillRect(x, y, m.sz, m.sz);
    }
    ctx.restore();
  }

  /* Camera flashes from the crowd, owned by the caller: [{x, y, life}] in 0..1 screen space. */
  function drawFlashes(ctx, P, flashes) {
    if (!flashes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const f of flashes) {
      const x = f.x * P.w - P.camX * P.S * PARALLAX;
      const y = P.cy + (f.y - 0.5) * P.h * 0.3;
      const r = (6 + 22 * f.life) * Math.max(0.6, P.S);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.9 * f.life})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function buildVignette(w, h, dpr) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = Math.hypot(w, h) * 0.62;
    const grad = g.createRadialGradient(w / 2, h * 0.45, r * 0.35, w / 2, h * 0.45, r);
    grad.addColorStop(0, "rgba(0, 0, 0, 0)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0.62)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
  }

  RW.ringScene = { D, FLOOR, projector, buildBackdrop, drawBackdrop, drawFloor, drawRopes, drawLights, drawFlashes, buildVignette };
})();
