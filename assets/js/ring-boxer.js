/* ring-boxer.js — draws a boxer from a pose: torso, trunks, IK arms, gloves,
   a head with expressions, and the player's own gloves seen from behind.
   Everything is vector, lit from above-left, outlined in warm ink. */
(() => {
  "use strict";
  const RW = (window.RW = window.RW || {});

  // iOS 15 and older Firefox have no roundRect on canvas
  const C2D = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
  if (C2D && !C2D.roundRect) {
    C2D.roundRect = function roundRect(x, y, w, h, r) {
      const rr = Math.min(typeof r === "number" ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
    };
  }

  /* ---------- colour helpers ---------- */
  const mixCache = new Map();
  function mix(hex, to, t) {
    const key = hex + to + t;
    if (mixCache.has(key)) return mixCache.get(key);
    const a = parseInt(hex.slice(1), 16);
    const b = parseInt(to.slice(1), 16);
    const ch = (n, s) => (n >> s) & 255;
    const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
    const out = `rgb(${m(16)}, ${m(8)}, ${m(0)})`;
    mixCache.set(key, out);
    return out;
  }
  const lit = (hex, t = 0.35) => mix(hex, "#ffffff", t);
  const dim = (hex, t = 0.35) => mix(hex, "#000000", t);

  /* ---------- shapes ---------- */
  function capsule(ctx, a, ra, b, rb) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.arc(a.x, a.y, ra, ang + Math.PI / 2, ang + Math.PI * 1.5);
    ctx.arc(b.x, b.y, rb, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
  }

  function shadeAcross(ctx, a, b, r, base, shade, light) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = Math.cos(ang) * r;
    const dy = Math.sin(ang) * r;
    // light comes from above-left: pick the normal that points up-left as the lit side
    const flip = dx + dy > 0 ? -1 : 1;
    const g = ctx.createLinearGradient(mx + dx * flip, my + dy * flip, mx - dx * flip, my - dy * flip);
    g.addColorStop(0, light);
    g.addColorStop(0.45, base);
    g.addColorStop(1, shade);
    return g;
  }

  function limb(ctx, a, ra, b, rb, look, ink) {
    capsule(ctx, a, ra, b, rb);
    ctx.fillStyle = shadeAcross(ctx, a, b, Math.max(ra, rb), look.skin, look.skinShade, look.skinLit);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, ra * 0.12);
    ctx.stroke();
  }

  /* A boxing glove facing the viewer. r is in px; thumb is -1 (left) or +1 (right). */
  function glove(ctx, x, y, r, col, shade, cuff, thumb, angle, ink, glint) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = ink;
    // cuff
    ctx.fillStyle = cuff;
    ctx.beginPath();
    ctx.roundRect(-r * 0.62, r * 0.5, r * 1.24, r * 0.75, r * 0.22);
    ctx.fill();
    ctx.stroke();
    // mitt and thumb
    const g = ctx.createRadialGradient(-r * 0.32, -r * 0.4, r * 0.08, 0, 0, r * 1.15);
    g.addColorStop(0, lit(col, 0.32));
    g.addColorStop(0.55, col);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.02, r * 0.9, r * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(thumb * r * 0.74, r * 0.22, r * 0.3, r * 0.5, thumb * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // knuckle crease and highlight
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(0, r * 0.62, r * 0.62, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.48, r * 0.34, r * 0.17, -0.55, 0, Math.PI * 2);
    ctx.fill();
    if (glint > 0.01) star(ctx, -r * 0.35, -r * 0.55, Math.min(r * (0.4 + glint * 0.55), 90), glint);
    ctx.restore();
  }

  /* four-point telegraph glint */
  function star(ctx, x, y, r, a) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 246, 214, ${Math.min(1, a)})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.16;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.7);
    g.addColorStop(0, `rgba(255, 240, 200, ${0.55 * a})`);
    g.addColorStop(1, "rgba(255, 240, 200, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  /* ---------- arms ---------- */
  const UPPER = 108;
  const FORE = 128; // forearm plus the hand inside the glove

  function elbowOf(sh, hand, side) {
    const dx = hand.x - sh.x;
    const dy = hand.y - sh.y;
    const dz = hand.z - sh.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const dd = Math.min(d, UPPER + FORE - 2);
    const a = (UPPER * UPPER - FORE * FORE + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
    // elbows hang down and stay tucked toward the ribs, the way a guard is held
    let px = side * 0.32;
    let py = 1;
    let pz = 0.12;
    const dot = px * ux + py * uy + pz * uz;
    px -= dot * ux;
    py -= dot * uy;
    pz -= dot * uz;
    const pl = Math.hypot(px, py, pz) || 1;
    return { x: sh.x + ux * a + (px / pl) * h, y: sh.y + uy * a + (py / pl) * h, z: sh.z + uz * a + (pz / pl) * h };
  }

  function arm(ctx, P, look, sh, hand, side, glint) {
    const el = elbowOf(sh, hand, side);
    const pS = P.pt(sh.x, sh.y, sh.z);
    const pE = P.pt(el.x, el.y, el.z);
    // wrist sits a little short of the glove centre
    const wx = hand.x + (el.x - hand.x) * 0.3;
    const wy = hand.y + (el.y - hand.y) * 0.3;
    const wz = hand.z + (el.z - hand.z) * 0.3;
    const pW = P.pt(wx, wy, wz);
    const pG = P.pt(hand.x, hand.y, hand.z);
    const ink = look.ink;
    limb(ctx, pS, 31 * pS.s, pE, 25 * pE.s, look, ink);
    limb(ctx, pE, 25 * pE.s, pW, 22 * pW.s, look, ink);
    // the glove leans along the forearm
    const ang = Math.atan2(pG.y - pE.y, pG.x - pE.x) + Math.PI / 2;
    const lean = Math.max(-0.7, Math.min(0.7, Math.atan2(Math.sin(ang), Math.cos(ang))));
    glove(ctx, pG.x, pG.y, 40 * pG.s, look.gloves, look.glovesShade, look.cuff, -side, lean * 0.6, ink, glint);
  }

  /* ---------- torso, trunks, legs ---------- */
  function torsoPath(ctx, pSL, pSR, pWL, pWR, neck, s) {
    ctx.beginPath();
    ctx.moveTo(pWR.x, pWR.y);
    ctx.bezierCurveTo(pWR.x - 14 * s, pWR.y - 70 * s, pSR.x - 10 * s, pSR.y + 72 * s, pSR.x - 6 * s, pSR.y + 10 * s);
    ctx.quadraticCurveTo(pSR.x - 2 * s, pSR.y - 22 * s, (pSR.x + neck.x) / 2, neck.y + 16 * s);
    ctx.quadraticCurveTo(neck.x, neck.y + 4 * s, (pSL.x + neck.x) / 2, neck.y + 16 * s);
    ctx.quadraticCurveTo(pSL.x + 2 * s, pSL.y - 22 * s, pSL.x + 6 * s, pSL.y + 10 * s);
    ctx.bezierCurveTo(pSL.x + 10 * s, pSL.y + 72 * s, pWL.x + 14 * s, pWL.y - 70 * s, pWL.x, pWL.y);
    ctx.closePath();
  }

  function torso(ctx, P, look, pose, shL, shR) {
    const b = look.build;
    const hip = pose.hip;
    const waistY = hip.y - 36;
    const wHalf = 68 * b.waist;
    const pSL = P.pt(shL.x, shL.y, shL.z);
    const pSR = P.pt(shR.x, shR.y, shR.z);
    const pWL = P.pt(hip.x + wHalf, waistY, hip.z);
    const pWR = P.pt(hip.x - wHalf, waistY, hip.z);
    const neck = P.pt(pose.chest.x, pose.chest.y - 24, pose.chest.z);
    const s = neck.s;

    torsoPath(ctx, pSL, pSR, pWL, pWR, neck, s);
    const vg = ctx.createLinearGradient(0, neck.y, 0, pWL.y);
    vg.addColorStop(0, look.skinLit);
    vg.addColorStop(0.5, look.skin);
    vg.addColorStop(1, look.skinShade);
    ctx.fillStyle = vg;
    ctx.fill();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = Math.max(1, 3 * s);
    ctx.stroke();

    ctx.save();
    torsoPath(ctx, pSL, pSR, pWL, pWR, neck, s);
    ctx.clip();
    // roundness: darker flanks
    const hg = ctx.createLinearGradient(pSR.x - 20 * s, 0, pSL.x + 20 * s, 0);
    hg.addColorStop(0, "rgba(0, 0, 0, 0.28)");
    hg.addColorStop(0.3, "rgba(0, 0, 0, 0)");
    hg.addColorStop(0.7, "rgba(0, 0, 0, 0)");
    hg.addColorStop(1, "rgba(0, 0, 0, 0.32)");
    ctx.fillStyle = hg;
    ctx.fillRect(pSR.x - 60 * s, neck.y - 10 * s, pSL.x - pSR.x + 120 * s, pWL.y - neck.y + 20 * s);

    const cx = (pSL.x + pSR.x) / 2;
    const chestY = (pSL.y + pSR.y) / 2;
    if (!look.top) {
      // pecs, a belly if he has one, navel
      ctx.strokeStyle = dim(look.skinShade, 0.2);
      ctx.lineWidth = Math.max(1, 2.4 * s);
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sd * 6 * s, chestY + 70 * s);
        ctx.quadraticCurveTo(cx + sd * 50 * s, chestY + 84 * s, cx + sd * 78 * s, chestY + 46 * s);
        ctx.stroke();
      }
      if (b.belly) {
        const by = (chestY + pWL.y) / 2 + 40 * s;
        const bg = ctx.createRadialGradient(cx - 20 * s, by - 30 * s, 10 * s, cx, by, 90 * s);
        bg.addColorStop(0, "rgba(255, 220, 190, 0.22)");
        bg.addColorStop(1, "rgba(255, 220, 190, 0)");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.ellipse(cx, by, 84 * s, 74 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx, by, 84 * s, 74 * s, 0, 0.2, Math.PI - 0.2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(cx, chestY + 90 * s);
        ctx.lineTo(cx, pWL.y - 30 * s);
        ctx.stroke();
      }
      ctx.fillStyle = dim(look.skinShade, 0.35);
      ctx.beginPath();
      ctx.ellipse(cx, pWL.y - 26 * s, 4 * s, 6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // singlet / tank top with a scooped neck and deep arm holes
      const tg = ctx.createLinearGradient(0, neck.y, 0, pWL.y);
      tg.addColorStop(0, lit(look.topColor, 0.12));
      tg.addColorStop(1, look.topShade);
      ctx.fillStyle = tg;
      const strap = look.top === "tank" ? 24 : 18;
      ctx.beginPath();
      ctx.moveTo(cx - (40 + strap) * s, neck.y + 8 * s);
      ctx.lineTo(cx - 40 * s, neck.y + 8 * s);
      ctx.quadraticCurveTo(cx, neck.y + 92 * s, cx + 40 * s, neck.y + 8 * s);
      ctx.lineTo(cx + (40 + strap) * s, neck.y + 8 * s);
      ctx.quadraticCurveTo(pSL.x - 30 * s, pSL.y + 50 * s, pSL.x + 4 * s, pSL.y + 96 * s);
      ctx.lineTo(pWL.x + 30 * s, pWL.y + 40 * s);
      ctx.lineTo(pWR.x - 30 * s, pWR.y + 40 * s);
      ctx.lineTo(pSR.x - 4 * s, pSR.y + 96 * s);
      ctx.quadraticCurveTo(pSR.x + 30 * s, pSR.y + 50 * s, cx - (40 + strap) * s, neck.y + 8 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(1, 2.2 * s);
      ctx.stroke();
      // fabric folds
      ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
      ctx.beginPath();
      ctx.moveTo(cx - 30 * s, chestY + 120 * s);
      ctx.quadraticCurveTo(cx - 6 * s, chestY + 135 * s, cx + 26 * s, chestY + 118 * s);
      ctx.stroke();
      if (look.top === "singlet") {
        // club badge on the chest
        ctx.fillStyle = look.trim;
        ctx.beginPath();
        ctx.arc(cx + 42 * s, chestY + 78 * s, 11 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = look.topColor;
        ctx.beginPath();
        ctx.arc(cx + 42 * s, chestY + 78 * s, 5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return { pWL, pWR, s };
  }

  function trunks(ctx, P, look, pose) {
    const b = look.build;
    const hip = pose.hip;
    const top = hip.y - 46;
    const w = 82 * b.waist;
    const pTL = P.pt(hip.x + w, top, hip.z);
    const pTR = P.pt(hip.x - w, top, hip.z);
    const pBL = P.pt(hip.x + w + 14, hip.y + 96, hip.z);
    const pBR = P.pt(hip.x - w - 14, hip.y + 96, hip.z);
    const crotch = P.pt(hip.x, hip.y + 70, hip.z);
    const s = pTL.s;
    ctx.beginPath();
    ctx.moveTo(pTR.x, pTR.y);
    ctx.lineTo(pTL.x, pTL.y);
    ctx.quadraticCurveTo(pTL.x + 12 * s, (pTL.y + pBL.y) / 2, pBL.x, pBL.y);
    ctx.lineTo(crotch.x + 10 * s, pBL.y + 6 * s);
    ctx.lineTo(crotch.x, crotch.y);
    ctx.lineTo(crotch.x - 10 * s, pBR.y + 6 * s);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.quadraticCurveTo(pTR.x - 12 * s, (pTR.y + pBR.y) / 2, pTR.x, pTR.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(pTR.x, 0, pTL.x, 0);
    g.addColorStop(0, look.trunksShade);
    g.addColorStop(0.42, lit(look.trunks, 0.1));
    g.addColorStop(1, look.trunksShade);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = Math.max(1, 3 * s);
    ctx.stroke();
    // side stripes
    ctx.fillStyle = look.trim;
    for (const sd of [-1, 1]) {
      const a = P.pt(hip.x + sd * (w - 6), top + 22, hip.z);
      const c = P.pt(hip.x + sd * (w + 8), hip.y + 92, hip.z);
      ctx.beginPath();
      ctx.moveTo(a.x - 5 * s, a.y);
      ctx.lineTo(a.x + 5 * s, a.y);
      ctx.lineTo(c.x + 5 * s, c.y);
      ctx.lineTo(c.x - 5 * s, c.y);
      ctx.fill();
    }
    // waistband
    const wbL = P.pt(hip.x + w + 2, top + 24, hip.z);
    ctx.fillStyle = look.trim;
    ctx.fillRect(pTR.x - 2 * s, pTR.y, wbL.x - pTR.x + 4 * s, wbL.y - pTR.y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(pTR.x - 2 * s, wbL.y - 5 * s, wbL.x - pTR.x + 4 * s, 5 * s);
    if (look.emblem) {
      // an 8-ball on the belt
      const c = P.pt(hip.x, top + 12, hip.z);
      ctx.fillStyle = "#121212";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 15 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f4eee0";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#121212";
      ctx.font = `800 ${Math.max(6, 10 * s)}px "Big Shoulders Display", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("8", c.x, c.y + 0.5 * s);
    }
  }

  function legs(ctx, P, look, pose) {
    const hip = pose.hip;
    const FLOOR = RW.ringScene.FLOOR;
    const kneel = pose.kneel || 0;
    for (const sd of [-1, 1]) {
      const top = P.pt(hip.x + sd * 42, hip.y + 80, hip.z);
      const kneeY = hip.y + 215 + (FLOOR - 12 - (hip.y + 215)) * kneel;
      const knee = P.pt(hip.x + sd * (48 + 10 * kneel), Math.min(kneeY, FLOOR - 12), hip.z + 40 * kneel);
      limb(ctx, top, 38 * top.s, knee, 30 * knee.s, look, look.ink);
      if (kneel < 0.6) {
        const foot = P.pt(hip.x + sd * 56, FLOOR - 20, hip.z - 10);
        limb(ctx, knee, 30 * knee.s, foot, 22 * foot.s, look, look.ink);
      }
    }
  }

  /* ---------- neck and head ---------- */
  function neck(ctx, P, look, pose) {
    const a = P.pt(pose.chest.x, pose.chest.y - 14, pose.chest.z);
    const b = P.pt(pose.head.x, pose.head.y + 46, pose.head.z);
    const s = a.s;
    ctx.beginPath();
    ctx.moveTo(a.x - 40 * s, a.y);
    ctx.lineTo(b.x - 30 * b.s, b.y);
    ctx.lineTo(b.x + 30 * b.s, b.y);
    ctx.lineTo(a.x + 40 * s, a.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, b.y, 0, a.y);
    g.addColorStop(0, dim(look.skinShade, 0.25));
    g.addColorStop(1, look.skin);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function headShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -66);
    ctx.bezierCurveTo(32, -66, 54, -44, 54, -8);
    ctx.bezierCurveTo(54, 22, 44, 46, 26, 60);
    ctx.quadraticCurveTo(0, 74, -26, 60);
    ctx.bezierCurveTo(-44, 46, -54, 22, -54, -8);
    ctx.bezierCurveTo(-54, -44, -32, -66, 0, -66);
    ctx.closePath();
  }

  function eyes(ctx, look, face, blink, gaze) {
    const eh = 6.2 * (look.eyeH || 1);
    const closed = blink > 0.5 && (face === "idle" || face === "angry" || face === "smirk" || face === "tired");
    ctx.lineCap = "round";
    for (const sd of [-1, 1]) {
      const x = sd * 21;
      const y = -2;
      ctx.strokeStyle = look.ink;
      if (face === "hurt") {
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(x + sd * 9, y - 5);
        ctx.lineTo(x - sd * 6, y);
        ctx.lineTo(x + sd * 9, y + 4);
        ctx.stroke();
        continue;
      }
      if (face === "ko" || closed) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y - 3, 9, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        continue;
      }
      const h = face === "angry" ? eh * 0.72 : eh;
      ctx.fillStyle = "#f6efe4";
      ctx.beginPath();
      ctx.ellipse(x, y, 10.5, h, 0, 0, Math.PI * 2);
      ctx.fill();
      let gx = gaze.x;
      let gy = gaze.y;
      if (face === "daze") gx += sd * 2.6;
      ctx.fillStyle = "#1c130e";
      ctx.beginPath();
      ctx.arc(x + gx, y + gy, Math.min(4.6, h * 0.85), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(x + gx - 1.4, y + gy - 1.6, 1.3, 0, Math.PI * 2);
      ctx.fill();
      // upper lid; heavy when dazed
      const lid = face === "daze" ? 0.55 : face === "tired" ? 0.3 : 0;
      if (lid) {
        ctx.fillStyle = look.skinShade;
        ctx.fillRect(x - 12, y - h - 1, 24, (h * 2 + 2) * lid);
      }
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(x, y, 10.5, h, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    }
  }

  function brows(ctx, look, face) {
    const set = {
      idle: [-15, -19], angry: [-9, -21], hurt: [-22, -14], daze: [-20, -21],
      ko: [-17, -15], smirk: [-15, -22], tired: [-20, -16],
    }[face] || [-15, -19];
    ctx.strokeStyle = look.hair === "shaggy" || look.hair === "bald" ? (look.hairColor || look.ink) : look.ink;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (const sd of [-1, 1]) {
      const outer = face === "smirk" && sd > 0 ? set[1] - 4 : set[1];
      ctx.beginPath();
      ctx.moveTo(sd * 9, set[0]);
      ctx.quadraticCurveTo(sd * 22, Math.min(set[0], outer) - 4, sd * 33, outer);
      ctx.stroke();
    }
  }

  function mouth(ctx, look, face, y) {
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    const open = (w, h) => {
      ctx.fillStyle = "#3b1512";
      ctx.beginPath();
      ctx.ellipse(0, y + 2, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.mouthguard;
      ctx.beginPath();
      ctx.ellipse(0, y + 2 - h * 0.45, w * 0.82, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    if (face === "angry") {
      ctx.fillStyle = look.mouthguard;
      ctx.beginPath();
      ctx.roundRect(-13, y - 4, 26, 9, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-11, y + 0.5);
      ctx.lineTo(11, y + 0.5);
      ctx.stroke();
    } else if (face === "hurt") open(11, 10);
    else if (face === "ko") open(8, 10);
    else if (face === "daze") open(7, 6);
    else if (face === "tired") open(8, 6);
    else if (face === "smirk") {
      ctx.beginPath();
      ctx.moveTo(-12, y + 1);
      ctx.quadraticCurveTo(2, y + 4, 13, y - 4);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-11, y);
      ctx.quadraticCurveTo(0, y + 2.5, 11, y);
      ctx.stroke();
    }
  }

  function hairBack(ctx, look) {
    if (look.hair !== "shaggy") return;
    ctx.fillStyle = look.hairColor;
    ctx.beginPath();
    ctx.ellipse(0, -24, 62, 56, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  function hairFront(ctx, look) {
    if (look.hair === "shaggy") {
      ctx.fillStyle = look.hairColor;
      ctx.beginPath();
      ctx.moveTo(-58, 6);
      ctx.bezierCurveTo(-68, -42, -50, -86, -4, -88);
      ctx.bezierCurveTo(46, -90, 70, -50, 60, 4);
      ctx.lineTo(54, 12);
      ctx.lineTo(50, -18);
      const fringe = [[44, -26], [36, -12], [29, -30], [20, -10], [12, -28], [3, -13], [-6, -31], [-16, -12], [-25, -30], [-34, -13], [-43, -27], [-51, -12]];
      for (const [x, y] of fringe) ctx.lineTo(x, y);
      ctx.lineTo(-55, 14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(140, 162, 186, 0.32)";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      for (const [x0, x1] of [[-30, -8], [-6, 14], [16, 36], [-44, -26]]) {
        ctx.beginPath();
        ctx.moveTo(x0, -74);
        ctx.quadraticCurveTo((x0 + x1) / 2 - 6, -52, x1, -30);
        ctx.stroke();
      }
    } else if (look.hair === "bald") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.beginPath();
      ctx.ellipse(-16, -50, 17, 8, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(20, 14, 10, 0.4)";
      ctx.lineWidth = 7;
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(0, -6, 50, sd < 0 ? Math.PI * 0.92 : Math.PI * 1.88, sd < 0 ? Math.PI * 1.12 : Math.PI * 2.08);
        ctx.stroke();
      }
    } else if (look.hair === "guard") {
      ctx.fillStyle = look.gear;
      ctx.beginPath();
      ctx.ellipse(0, -8, 66, 78, 0, 0, Math.PI * 2);
      ctx.roundRect(-35, -27, 70, 76, 24);
      ctx.fill("evenodd");
      ctx.strokeStyle = look.gearShade;
      ctx.lineWidth = 3;
      ctx.stroke();
      // brow pad, cheek pads, chin strap
      ctx.fillStyle = lit(look.gear, 0.12);
      ctx.beginPath();
      ctx.ellipse(0, -36, 42, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.gearShade;
      ctx.beginPath();
      ctx.roundRect(-30, 56, 60, 11, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      ctx.ellipse(-24, -62, 20, 9, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function head(ctx, P, look, pose) {
    const h = pose.head;
    const p = P.pt(h.x, h.y, h.z);
    const s = p.s * look.build.head;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(h.rot || 0);
    ctx.scale(s, s);
    hairBack(ctx, look);
    if (look.hair !== "guard") {
      ctx.fillStyle = look.skin;
      ctx.strokeStyle = look.ink;
      ctx.lineWidth = 3;
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sd * 53, 4, 9, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    headShape(ctx);
    const g = ctx.createRadialGradient(-16, -30, 6, 0, 0, 78);
    g.addColorStop(0, look.skinLit);
    g.addColorStop(0.55, look.skin);
    g.addColorStop(1, look.skinShade);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 3;
    ctx.stroke();

    // nose, cheeks, damage
    ctx.strokeStyle = dim(look.skinShade, 0.15);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.quadraticCurveTo(-5, 12, -1, 17);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 15, 7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    if (pose.flush > 0.02) {
      for (const sd of [-1, 1]) {
        const cg = ctx.createRadialGradient(sd * 32, 18, 1, sd * 32, 18, 16);
        cg.addColorStop(0, `rgba(214, 60, 48, ${0.4 * pose.flush})`);
        cg.addColorStop(1, "rgba(214, 60, 48, 0)");
        ctx.fillStyle = cg;
        ctx.fillRect(sd * 32 - 16, 2, 32, 32);
      }
    }
    if (pose.bruise > 0.02) {
      ctx.fillStyle = `rgba(92, 54, 110, ${0.42 * pose.bruise})`;
      ctx.beginPath();
      ctx.ellipse(-22, 10, 12, 7, 0.1, 0, Math.PI * 2);
      ctx.fill();
      if (pose.bruise > 0.55) {
        ctx.strokeStyle = "rgba(170, 30, 26, 0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(24, -27);
        ctx.lineTo(33, -22);
        ctx.stroke();
      }
    }

    const face = pose.face || "idle";
    eyes(ctx, look, face, pose.blink || 0, pose.gaze || { x: 0, y: 0 });
    brows(ctx, look, face);
    const mouthY = look.beard === "mustache" ? 39 : 35;
    mouth(ctx, look, face, mouthY);
    if (look.beard === "mustache") {
      ctx.fillStyle = look.hairColor;
      ctx.beginPath();
      ctx.moveTo(-25, 31);
      ctx.quadraticCurveTo(-14, 17, 0, 23);
      ctx.quadraticCurveTo(14, 17, 25, 31);
      ctx.quadraticCurveTo(27, 39, 21, 42);
      ctx.quadraticCurveTo(10, 31, 0, 33);
      ctx.quadraticCurveTo(-10, 31, -21, 42);
      ctx.quadraticCurveTo(-27, 39, -25, 31);
      ctx.fill();
    }
    hairFront(ctx, look);
    if (pose.sweat > 0.05) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * pose.sweat})`;
      for (const [x, y, r] of [[-28, -34, 2.6], [30, -30, 2.2], [40, 14, 2.4], [-40, 20, 2]]) {
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---------- the whole opponent, painter-sorted by depth ---------- */
  function draw(ctx, P, look, pose) {
    const W = 100 * look.build.sh;
    const ct = Math.cos(pose.twist || 0);
    const st = Math.sin(pose.twist || 0);
    const c = pose.chest;
    const shL = { x: c.x + W * ct, y: c.y + 6, z: c.z - W * st };
    const shR = { x: c.x - W * ct, y: c.y + 6, z: c.z + W * st };
    const glint = pose.glint || { l: 0, r: 0 };
    const items = [
      { z: c.z - 40, f: () => { legs(ctx, P, look, pose); trunks(ctx, P, look, pose); torso(ctx, P, look, pose, shL, shR); neck(ctx, P, look, pose); } },
      { z: pose.head.z + 8, f: () => head(ctx, P, look, pose) },
      { z: pose.l.z, f: () => arm(ctx, P, look, shL, pose.l, 1, glint.l) },
      { z: pose.r.z, f: () => arm(ctx, P, look, shR, pose.r, -1, glint.r) },
    ];
    items.sort((a, b) => a.z - b.z);
    for (const it of items) it.f();
  }

  /* ---------- the player's glove, seen from behind ---------- */
  function playerGlove(ctx, P, look, g, side) {
    const p = P.pt(g.x, g.y, g.z);
    const r = 41 * p.s;
    // the arm runs from the wrist back to a shoulder just outside the bottom of the view
    const sh = P.pt(P.camX + side * 135, P.camY + 380, P.D - 110);
    const wr = P.pt(g.x + side * 4, g.y + 36, g.z + 12);
    limb(ctx, wr, 25 * wr.s, sh, 50 * sh.s, look, look.ink);
    const armAng = Math.max(-0.9, Math.min(0.9, Math.atan2(sh.y - wr.y, sh.x - wr.x) - Math.PI / 2));
    if (g.glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const hg = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r * 1.9);
      hg.addColorStop(0, `rgba(121, 194, 240, ${0.55 * g.glow})`);
      hg.addColorStop(1, "rgba(121, 194, 240, 0)");
      ctx.fillStyle = hg;
      ctx.fillRect(p.x - r * 2, p.y - r * 2, r * 4, r * 4);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(armAng * 0.8 + (g.roll || 0));
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.fillStyle = look.cuff;
    ctx.beginPath();
    ctx.roundRect(-r * 0.66, r * 0.4, r * 1.32, r * 0.9, r * 0.26);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = look.glovesShade;
    ctx.fillRect(-r * 0.66, r * 0.68, r * 1.32, r * 0.2);
    const mg = ctx.createRadialGradient(-r * 0.3, -r * 0.42, r * 0.1, 0, 0, r * 1.15);
    mg.addColorStop(0, lit(look.gloves, 0.3));
    mg.addColorStop(0.55, look.gloves);
    mg.addColorStop(1, look.glovesShade);
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.08, r * 0.95, r * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-side * r * 0.8, r * 0.14, r * 0.3, r * 0.5, -side * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.arc(0, r * 0.3, r * 0.7, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.5, r * 0.36, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  RW.ringBoxer = { draw, playerGlove, glove, star, mix, lit, dim };
})();
