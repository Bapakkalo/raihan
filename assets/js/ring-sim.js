/* ring-sim.js — the fight itself, with no DOM: the player (punches, dodges,
   guard, stamina, the Bola 8 meter), the opponent's AI and animation, rounds,
   knockdowns, the referee's count and the judges. The page reads m.view,
   m.oppPose and m.events every frame. Fixed step, so it can be tested headless. */
(() => {
  "use strict";
  const RW = (window.RW = window.RW || {});
  const DATA = RW.ringData;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const qbez = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
  const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

  const CAM_Y = -300;
  const CHEST_Y = -232;
  const HEAD_DY = -96;
  const STRIKE_Z = 420; // how close an opponent's glove comes when it lands
  const DODGE = { total: 0.46, out: 0.07, back: 0.3, from: 0.03, to: 0.36, counter: 0.26, shift: 122 };

  const emit = (m, type, data = {}) => { data.type = type; m.events.push(data); };

  /* =====================================================================
     PLAYER
     ===================================================================== */
  function makePlayer() {
    return {
      hp: DATA.PLAYER.hp, hpMax: DATA.PLAYER.hp, sta: DATA.PLAYER.sta, staMax: DATA.PLAYER.sta, spirit: 0,
      state: "idle", t: 0, punch: null, dodgeDir: 0, dodgeStart: 0,
      blockHeld: false, guard: 0, stunT: 0, hitT: 0, staDelay: 0,
      buffer: null, bufferT: 0, kd: 0, kdRound: 0, mash: 0, mashNeed: 0,
      hurt: 0, kick: { x: 0, y: 0, roll: 0, vx: 0, vy: 0, vr: 0 }, shake: 0,
      cam: { x: 0, y: CAM_Y, roll: 0, tilt: 0 },
      gl: { l: { x: -70, y: -85, z: 230, glow: 0, roll: 0 }, r: { x: 70, y: -85, z: 230, glow: 0, roll: 0 } },
    };
  }

  const PUNCH_KEYS = ["jab", "straight", "hook", "upper", "special"];

  function canAct(p) {
    if (p.state === "idle" || p.state === "block") return true;
    if (p.state === "punch") return p.punch.t >= p.punch.def.cancel;
    if (p.state === "dodge") return p.t >= DODGE.counter;
    return false;
  }

  function press(m, action) {
    const p = m.player;
    if (action === "block") {
      p.blockHeld = true;
      if (m.phase === "fight" && p.state === "idle") setP(p, "block");
      return;
    }
    if (m.phase === "down" && m.downWho === "player") {
      if (PUNCH_KEYS.includes(action)) { p.mash += 1; emit(m, "mash", { v: p.mash / p.mashNeed }); }
      return;
    }
    if (m.phase !== "fight") return;
    if (canAct(p)) act(m, action);
    else { p.buffer = action; p.bufferT = 0.16; }
  }

  function release(m, action) {
    const p = m.player;
    if (action === "block") {
      p.blockHeld = false;
      if (p.state === "block") setP(p, "idle");
    }
  }

  function setP(p, state) { p.state = state; p.t = 0; }

  function act(m, action) {
    const p = m.player;
    if (action === "dodgeL" || action === "dodgeR") {
      setP(p, "dodge");
      p.dodgeDir = action === "dodgeL" ? -1 : 1;
      p.dodgeStart = m.time;
      p.punch = null;
      m.adapt.dodges.push(p.dodgeDir);
      if (m.adapt.dodges.length > 6) m.adapt.dodges.shift();
      emit(m, "step", { dir: p.dodgeDir });
      return;
    }
    if (!PUNCH_KEYS.includes(action)) return;
    const def = DATA.PUNCHES[action];
    if (action === "special" && p.spirit < 100) { emit(m, "nospecial"); return; }
    const tired = def.sta > 0 && p.sta < def.sta;
    p.sta = Math.max(0, p.sta - def.sta);
    p.staDelay = 0.7;
    if (action === "special") p.spirit = 0;
    const o = m.opp;
    // aim at where his head is now; if he slips, the glove still goes there and misses
    const target = { x: o.pose.head.x, y: o.pose.head.y + 14, z: o.pose.head.z + 52 };
    p.punch = { kind: action, def, t: 0, resolved: false, tired, speed: tired ? 0.72 : 1, target, side: def.hand === "l" ? -1 : 1 };
    setP(p, "punch");
    m.stats.p.thrown++;
    if (tired) emit(m, "tired");
    if (action === "special") emit(m, "special");
    else emit(m, "throw", { kind: action });
    oppSeesPunch(m, p.punch);
  }

  function stepPlayer(m, dt) {
    const p = m.player;
    p.t += dt;
    if (p.bufferT > 0) {
      p.bufferT -= dt;
      if (p.buffer && canAct(p) && m.phase === "fight") { const b = p.buffer; p.buffer = null; act(m, b); }
    }
    switch (p.state) {
      case "punch": {
        const pn = p.punch;
        pn.t += dt * pn.speed;
        if (!pn.resolved && pn.t >= pn.def.hit) { pn.resolved = true; resolvePunch(m, pn); }
        if (pn.t >= pn.def.end + (pn.whiffed ? 0.12 : 0)) { p.punch = null; setP(p, p.blockHeld ? "block" : "idle"); }
        break;
      }
      case "dodge":
        if (p.t >= DODGE.total) setP(p, p.blockHeld ? "block" : "idle");
        break;
      case "hit":
        if (p.t >= p.hitT) setP(p, p.blockHeld ? "block" : "idle");
        break;
      case "stun":
        if (p.t >= p.stunT) setP(p, p.blockHeld ? "block" : "idle");
        break;
      case "idle":
        if (p.blockHeld && m.phase === "fight") setP(p, "block");
        break;
      default:
        break;
    }
    // guard raise (0..1)
    const wantGuard = p.state === "block" ? 1 : 0;
    p.guard = wantGuard ? Math.min(1, p.guard + dt / 0.07) : Math.max(0, p.guard - dt / 0.06);
    // stamina
    p.staDelay -= dt;
    if (p.staDelay <= 0 && p.state !== "punch") p.sta = Math.min(p.staMax, p.sta + dt * (p.state === "block" ? 7 : 24));
    p.hurt = Math.max(0, p.hurt - dt * 2.6);
    p.shake = Math.max(0, p.shake - dt * 3.2);
    // camera kick springs
    const k = p.kick;
    k.vx += (-160 * k.x - 16 * k.vx) * dt; k.x += k.vx * dt;
    k.vy += (-160 * k.y - 16 * k.vy) * dt; k.y += k.vy * dt;
    k.vr += (-140 * k.roll - 14 * k.vr) * dt; k.roll += k.vr * dt;
    playerView(m, dt);
  }

  function playerView(m, dt) {
    const p = m.player;
    // where the head is: dodge offset, crouch when guarding, knockdown drop
    let dx = 0;
    let roll = 0;
    if (p.state === "dodge") {
      const t = p.t;
      const e = t < DODGE.out ? easeOut(t / DODGE.out) : t < DODGE.back ? 1 : 1 - easeInOut((t - DODGE.back) / (DODGE.total - DODGE.back));
      dx = p.dodgeDir * DODGE.shift * e;
      roll = p.dodgeDir * 0.065 * e;
    }
    let dy = p.guard * 12;
    let tilt = 0;
    if (m.phase === "down" && m.downWho === "player") {
      const e = easeOut(clamp(m.phaseT / 0.5, 0, 1));
      dy += 170 * e;
      roll += 0.34 * e;
      tilt = -0.05 * e;
    } else if (p.state === "getup") {
      dy += 170 * (1 - easeInOut(clamp(p.t / 0.8, 0, 1)));
    }
    const cam = p.cam;
    const f = 1 - Math.exp(-dt * 40);
    cam.x += (dx - cam.x) * f;
    cam.y += (CAM_Y + dy - cam.y) * f;
    cam.roll += (roll - cam.roll) * f;
    cam.tilt += (tilt - cam.tilt) * f;

    // gloves, in world space, carried by the head
    const X = cam.x + p.kick.x;
    const Y = cam.y + p.kick.y;
    for (const side of [-1, 1]) {
      const g = side < 0 ? p.gl.l : p.gl.r;
      let x = X + side * 70;
      let y = Y + 215;
      let z = 232;
      let groll = 0;
      // guard raises the gloves in front of the face
      x = lerp(x, X + side * 40, p.guard);
      y = lerp(y, Y + 112, p.guard);
      z = lerp(z, 300, p.guard);
      if (p.state === "dodge") { y += 10; }
      const pn = p.punch;
      if (pn && pn.side === side) {
        const d = pn.def;
        const T = pn.target;
        const hold = 0.04;
        let e;
        if (pn.t < d.hit) {
          const u = pn.t / d.hit;
          e = d.power ? (u < 0.3 ? -0.1 * Math.sin((u / 0.3) * Math.PI) : easeOut((u - 0.3) / 0.7)) : easeOut(u);
        } else if (pn.t < d.hit + hold) e = 1;
        else e = 1 - easeInOut(clamp((pn.t - d.hit - hold) / (d.end - d.hit - hold), 0, 1));
        const ex = Math.max(0, e);
        const tx = T.x - side * 10;
        if (pn.kind === "hook") {
          const cx = (x + tx) / 2 + side * 150;
          x = qbez(x, cx, tx, ex);
          y = qbez(y, (y + T.y) / 2 - 30, T.y, ex);
          z = qbez(z, (z + T.z) / 2 + 30, T.z, ex);
          groll = -side * 1.1 * ex;
        } else if (pn.kind === "upper") {
          x = qbez(x, (x + tx) / 2, tx, ex);
          y = qbez(y, y + 90, T.y + 18, ex);
          z = qbez(z, (z + T.z) / 2 + 40, T.z, ex);
          groll = side * 0.3 * ex;
        } else {
          x = lerp(x, tx, ex);
          y = lerp(y, T.y, ex);
          z = lerp(z, T.z, ex) + (e < 0 ? -e * 120 : 0);
        }
      }
      g.x = x;
      g.y = y;
      g.z = z;
      g.roll = groll;
      const special = p.spirit >= 100 ? 0.35 + 0.25 * Math.sin(m.time * 6) : 0;
      g.glow = pn && pn.kind === "special" ? 1 : side > 0 ? special : special * 0.6;
    }
  }

  /* the player's punch arrives: what did it meet? */
  function resolvePunch(m, pn) {
    const o = m.opp;
    const d = pn.def;
    const at = { x: pn.target.x, y: pn.target.y, z: pn.target.z };
    if (o.state === "down" || o.state === "getup" || m.phase !== "fight") return;
    if (o.state === "slip" && o.t >= 0.04 && o.t <= 0.36) {
      pn.whiffed = true;
      m.player.sta = Math.max(0, m.player.sta - d.sta * 0.5);
      emit(m, "whiff", { by: "p", at });
      o.counterNow = true;
      return;
    }
    let dmg = d.dmg * (pn.tired ? 0.5 : 1);
    let tag = "";
    const atk = o.state === "attack" ? o.atk : null;
    if (atk && (atk.phase === "windup" || atk.phase === "strike")) {
      // only a power punch stops a punch that is already coming; a jab just trades
      if ((d.power || d.unblockable) && !atk.armor) { tag = "counter"; dmg *= 1.5; }
      else tag = "trade";
    } else if (atk && atk.phase === "whiff") { tag = "punish"; dmg *= 1.1; }
    else if (o.state === "daze") dmg *= 1.1;
    else if (o.state === "hit") dmg *= Math.max(0.5, 1 - 0.13 * o.combo);
    else {
      const guarded = o.state === "cover" || (o.state === "idle" && o.guard === "high") || (atk && atk.phase === "recover" && o.guard === "high" && atk.t > 0.6 * atk.dur);
      if (guarded && !d.unblockable) {
        if (d.breaks) tag = "break";
        else if (d.arc && o.state !== "cover") { dmg *= 0.5; tag = "around"; }
        else {
          emit(m, "block", { by: "o", at });
          o.blockedT = 0.2;
          oppAfterBlock(m);
          return;
        }
      }
    }
    landOnOpp(m, pn, dmg, tag, at);
  }

  /* =====================================================================
     OPPONENT — decisions
     ===================================================================== */
  function makeOpp(F) {
    const ai = F.ai;
    return {
      F, ai, hp: ai.hp, hpMax: ai.hp,
      state: "idle", t: 0, atk: null, queue: null, lastKey: "",
      next: ai.gap[1] + 0.4, guard: "high", guardT: 2.2,
      slipDir: 1, combo: 0, comboT: 0, hitT: 0.3, coverT: 0.8, burst: false,
      dazeT: 0, dazes: 0, recent: [], kd: 0, kdRound: 0,
      pendingSlip: null, pendingCover: null, counterNow: false, feintFollow: false,
      blockedT: 0, tauntCool: 3, blinkT: 2.5, blink: 0, flush: 0, hitFace: 0,
      kick: { x: 0, y: 0, z: 0, r: 0, vx: 0, vy: 0, vz: 0, vr: 0 },
      par: null, pose: null,
    };
  }

  function setO(o, state) { o.state = state; o.t = 0; }

  /* he sees a punch coming: slip it, cover up, or eat it */
  function oppSeesPunch(m, pn) {
    const o = m.opp;
    const ai = o.ai;
    const r = m.rng;
    m.adapt.spam = Math.min(6, m.adapt.spam + 1);
    if (o.state !== "idle") return;
    // a flurry is easy to see coming: shell up, then answer
    if (m.adapt.spam >= ai.shell) {
      setO(o, "cover");
      o.coverT = 0.55;
      o.burst = true;
      m.adapt.spam = 0;
      return;
    }
    // a dropped guard can be bait: he is already waiting for your punch
    if (o.guard === "open" && ai.adapt && r() < 0.65) {
      setO(o, "slip");
      o.slipDir = r() < 0.5 ? -1 : 1;
      o.t = 0.02;
      return;
    }
    if (pn.def.hit - ai.react < 0.02) return; // too quick to read
    const spam = ai.adapt ? m.adapt.spam * 0.06 : 0;
    if (r() < ai.slip + (pn.def.power ? 0.12 : 0) + spam) o.pendingSlip = { t: ai.react, dir: r() < 0.5 ? -1 : 1 };
    else if (r() < ai.cover * 0.6 + spam) o.pendingCover = { t: ai.react };
  }

  /* a punch bounced off his guard; good fighters make you pay for that */
  function oppAfterBlock(m) {
    const o = m.opp;
    if (o.state === "idle" && (o.ai.adapt || m.rng() < 0.3)) { o.next = Math.min(o.next, 0.14); o.feintFollow = true; }
  }

  function landOnOpp(m, pn, dmg, tag, at) {
    const o = m.opp;
    const p = m.player;
    const power = !!pn.def.power;
    if (tag === "counter") {
      o.atk = null;
      o.queue = null;
      emit(m, "interrupt");
    }
    o.hp = Math.max(0, o.hp - dmg);
    o.recent.push({ t: m.time, d: dmg });
    o.combo = o.comboT > 0 ? o.combo + 1 : 1;
    o.comboT = 0.9;
    m.stats.p.landed++;
    if (power) m.stats.p.power++;
    if (tag === "counter" || tag === "punish") m.stats.p.counters++;
    m.cur.dealtP += dmg;
    p.spirit = Math.min(100, p.spirit + (tag === "counter" ? 14 : tag === "punish" ? 10 : power ? 7 : 5));
    const dir = -pn.side;
    const k = o.kick;
    const f = power ? 1.6 : 1;
    if (pn.kind === "upper") { k.vy -= 300 * f; k.vz -= 150; k.vr += dir * 1.1; }
    else { k.vx += dir * 270 * f; k.vz -= 230 * f; k.vr += dir * 2.3 * f; }
    o.flush = 1;
    o.hitFace = 0.4;
    m.hitstop = power || tag ? 0.075 : 0.045;
    emit(m, "land", { by: "p", kind: pn.kind, power, tag, dmg, at });
    if (o.hp <= 0) { knockdown(m, "opp"); return; }
    if (tag === "trade") return; // he walks through it and his punch keeps coming
    const recent = o.recent.filter((e) => m.time - e.t < 3).reduce((s, e) => s + e.d, 0);
    if (o.state !== "daze" && (pn.kind === "special" || recent >= o.hpMax * 0.32 * (1 + o.dazes * 0.35))) {
      setO(o, "daze");
      o.dazeT = pn.kind === "special" ? 1.8 : 1.5;
      o.dazes++;
      o.recent = [];
      emit(m, "daze");
      return;
    }
    if (o.state === "daze") return;
    if (o.combo >= o.ai.burst) {
      setO(o, "cover");
      o.coverT = 0.85;
      o.combo = 0;
      o.burst = true;
      emit(m, "burst");
      return;
    }
    setO(o, "hit");
    o.hitT = (power ? 0.38 : 0.24) * (o.ai.stun || 1) * Math.max(0.6, 1 - 0.08 * o.combo);
  }

  function chooseAttack(m) {
    const o = m.opp;
    const ai = o.ai;
    const w = Object.assign({}, ai.moves);
    if (ai.adapt) {
      const ds = m.adapt.dodges;
      if (ds.length >= 4) {
        const left = ds.filter((d) => d < 0).length / ds.length;
        // a hook coming from the side you keep dodging toward
        if (left > 0.65) w.hookR = (w.hookR || 0) + 3;
        if (left < 0.35) w.hookL = (w.hookL || 0) + 3;
      }
      if (m.adapt.blocks >= 3) w.upper = (w.upper || 0) + 3;
    }
    if (w.hay && (o.hp > o.hpMax * 0.6 || o.lastKey === "hay" || m.rng() < 0.5)) delete w.hay;
    const keys = Object.keys(w);
    let roll = m.rng() * keys.reduce((s, k) => s + w[k], 0);
    for (const k of keys) { roll -= w[k]; if (roll <= 0) return k; }
    return keys[0];
  }

  function startAttack(m, key, opts = {}) {
    const o = m.opp;
    const ai = o.ai;
    const def = DATA.ATTACKS[key];
    const mult = opts.fast ? 0.5 : opts.combo ? 0.62 : 1;
    o.atk = {
      key, def, phase: "windup", t: 0,
      windup: def.windup * ai.windup * mult,
      strike: def.strike,
      recover: def.recover * ai.recover,
      whiff: def.whiff * ai.recover,
      feint: !opts.fast && !opts.combo && !def.big && m.rng() < ai.feint,
      armor: !!opts.fast, // answers after a block or a flurry can't be stopped
      tx: 0, dur: 1, result: "",
    };
    o.lastKey = key;
    o.guard = "high";
    setO(o, "attack");
    emit(m, "windup", { key, big: !!def.big, fast: !!(opts.fast || opts.combo) });
  }

  function stepAttack(m, dt) {
    const o = m.opp;
    const a = o.atk;
    const p = m.player;
    const r = m.rng;
    a.t += dt;
    if (a.phase === "windup") {
      if (a.feint && a.t >= a.windup * 0.55) {
        emit(m, "feint");
        o.atk = null;
        setO(o, "idle");
        o.next = 0.16 + r() * 0.14;
        o.feintFollow = true;
        return;
      }
      if (a.t >= a.windup) { a.phase = "strike"; a.t = 0; }
    } else if (a.phase === "strike") {
      a.tx = a.def.side && p.state === "dodge" && p.dodgeDir === a.def.side ? p.cam.x : 0;
      if (a.t >= a.strike) {
        const res = resolveAttack(m, a);
        a.result = res;
        a.phase = res === "dodged" ? "whiff" : "recover";
        a.t = 0;
        a.dur = res === "dodged" ? a.whiff : a.recover * (res === "blocked" ? 0.8 : 1);
        if (res !== "dodged" && !o.queue && (a.key === "jab" || a.key === "straight") && r() < o.ai.combo) {
          const mv = o.ai.moves;
          o.queue = a.key === "jab" ? pick(mv.hookL ? ["straight", "jab", "hookL"] : ["straight", "jab"], r) : mv.upper ? pick(["upper", "jab", "hookR"], r) : "jab";
          if (!DATA.ATTACKS[o.queue] || (!mv[o.queue] && o.queue !== "jab" && o.queue !== "straight")) o.queue = "jab";
        }
      }
    } else if (a.t >= a.dur * (o.queue && a.phase === "recover" ? 0.35 : 1)) {
      const q = o.queue;
      o.queue = null;
      o.atk = null;
      setO(o, "idle");
      o.next = lerp(o.ai.gap[0], o.ai.gap[1], r()) * (a.phase === "whiff" ? 1.15 : 1);
      if (q && m.phase === "fight") startAttack(m, q, { combo: true });
    }
  }

  /* his glove arrives: did the player get out of the way? */
  function resolveAttack(m, a) {
    const p = m.player;
    const o = m.opp;
    const def = a.def;
    const at = { x: a.tx, y: CAM_Y + 24, z: STRIKE_Z };
    if (m.phase !== "fight") return "blocked"; // shadow boxing: nobody to hit
    if (p.state === "dodge" && p.t >= DODGE.from && p.t <= DODGE.to && !(def.side && p.dodgeDir === def.side)) {
      const perfect = m.time - p.dodgeStart <= 0.17;
      p.spirit = Math.min(100, p.spirit + (perfect ? 16 : 10));
      m.stats.p.dodges++;
      emit(m, "dodged", { perfect, key: a.key, at });
      return "dodged";
    }
    if (p.state === "down" || p.state === "getup") return "dodged";
    let dmg = def.dmg * o.ai.dmg;
    if (p.state === "block" && p.guard > 0.6) {
      m.adapt.blocks = Math.min(5, m.adapt.blocks + 1);
      if (!def.breaks) {
        p.sta -= def.dmg * 0.55;
        if (p.sta <= 0) {
          p.sta = 0;
          emit(m, "guardbreak", { by: "p" });
          hurtPlayer(m, dmg * 0.6, a, at);
          p.hitT += 0.2;
          return "hit";
        }
        const chip = dmg * def.block;
        if (chip > 0) { p.hp = Math.max(1, p.hp - chip); m.cur.dealtO += chip; }
        p.kick.vy += 70;
        p.shake = Math.max(p.shake, 0.22);
        p.staDelay = 0.5;
        emit(m, "block", { by: "p", at, key: a.key });
        return "blocked";
      }
      emit(m, "guardbreak", { by: "p" });
      p.hitT = 0.2;
    } else m.adapt.blocks = Math.max(0, m.adapt.blocks - 1);
    if (p.state === "punch" && p.punch && p.punch.t < p.punch.def.hit) dmg *= 1.3;
    hurtPlayer(m, dmg, a, at);
    return "hit";
  }

  function hurtPlayer(m, dmg, a, at) {
    const p = m.player;
    const def = a.def;
    p.hp = Math.max(0, p.hp - dmg);
    m.cur.dealtO += dmg;
    m.stats.o.landed++;
    p.punch = null;
    setP(p, "hit");
    p.hitT = def.big ? 0.6 : def.breaks ? 0.45 : 0.32;
    p.hurt = 1;
    p.shake = def.big ? 1 : 0.6;
    // his left glove comes from the right of the screen and knocks the view left
    const dir = def.hand === "l" ? -1 : 1;
    const f = def.big ? 1.7 : def.side ? 1.3 : 1;
    if (a.key === "upper") p.kick.vy -= 380;
    else { p.kick.vx += dir * 300 * f; p.kick.vr += -dir * 1.4 * f; }
    m.hitstop = def.big ? 0.1 : 0.05;
    emit(m, "land", { by: "o", key: a.key, dmg, big: !!def.big, at });
    if (p.hp <= 0) knockdown(m, "player");
  }

  function stepOpp(m, dt) {
    const o = m.opp;
    const ai = o.ai;
    const r = m.rng;
    o.t += dt;
    o.comboT -= dt;
    o.tauntCool -= dt;
    o.blockedT -= dt;
    o.hitFace -= dt;
    o.flush = Math.max(0, o.flush - dt * 1.4);
    o.blinkT -= dt;
    if (o.blinkT <= 0) { o.blink = 0.13; o.blinkT = 2 + r() * 3.5; }
    o.blink = Math.max(0, o.blink - dt);
    const k = o.kick;
    k.vx += (-150 * k.x - 13 * k.vx) * dt; k.x += k.vx * dt;
    k.vy += (-150 * k.y - 13 * k.vy) * dt; k.y += k.vy * dt;
    k.vz += (-150 * k.z - 13 * k.vz) * dt; k.z += k.vz * dt;
    k.vr += (-130 * k.r - 11 * k.vr) * dt; k.r += k.vr * dt;
    m.adapt.spam = Math.max(0, m.adapt.spam - dt * 1.6);

    // "attract" is the shadow-boxing loop shown before a fight starts
    if (m.phase === "fight" || m.phase === "attract") {
      if (o.pendingSlip) {
        o.pendingSlip.t -= dt;
        if (o.pendingSlip.t <= 0) {
          if (o.state === "idle") { setO(o, "slip"); o.slipDir = o.pendingSlip.dir; }
          o.pendingSlip = null;
        }
      }
      if (o.pendingCover) {
        o.pendingCover.t -= dt;
        if (o.pendingCover.t <= 0) {
          if (o.state === "idle") { setO(o, "cover"); o.coverT = 0.5; }
          o.pendingCover = null;
        }
      }
      switch (o.state) {
        case "idle": {
          o.guardT -= dt;
          if (o.guardT <= 0) {
            if (o.guard === "high" && r() < ai.drop) {
              o.guard = "open";
              o.guardT = lerp(0.6, 1.2, r());
              if (o.tauntCool <= 0 && r() < 0.5) { emit(m, "taunt", { text: pick(o.F.taunts, r) }); o.tauntCool = 7; }
            } else { o.guard = "high"; o.guardT = lerp(1.4, 3.4, r()); }
          }
          if (o.counterNow) { o.counterNow = false; startAttack(m, "straight", { fast: true }); break; }
          o.next -= dt * (m.player.state === "block" ? 1.35 : 1);
          if (o.next <= 0) {
            const quick = o.feintFollow;
            o.feintFollow = false;
            startAttack(m, chooseAttack(m), quick ? { combo: true } : {});
          }
          break;
        }
        case "attack":
          stepAttack(m, dt);
          break;
        case "hit":
          if (o.t >= o.hitT) { setO(o, "idle"); if (ai.adapt) o.next = Math.min(o.next, 0.4); }
          break;
        case "slip":
          if (o.counterNow && o.t >= 0.3) { o.counterNow = false; startAttack(m, "straight", { fast: true }); }
          else if (o.t >= 0.42) setO(o, "idle");
          break;
        case "cover":
          if (o.t >= o.coverT) {
            setO(o, "idle");
            if (o.burst) { o.burst = false; startAttack(m, "jab", { fast: true }); }
          }
          break;
        case "daze":
          if (o.t >= o.dazeT) { setO(o, "idle"); o.guard = "high"; o.guardT = 2; o.next = 0.7; }
          break;
        default:
          break;
      }
    }
    poseOpp(m, dt);
  }

  /* =====================================================================
     OPPONENT — animation. Gloves are placed relative to the chest; the
     punching hand follows its attack curve, everything else is smoothed.
     ===================================================================== */
  const KEYS = ["hx", "hy", "hz", "side", "crouch", "lean", "twist", "headX", "headY", "headZ", "rot", "lx", "ly", "lz", "rx", "ry", "rz", "kneel"];
  const HAND = { l: ["lx", "ly", "lz"], r: ["rx", "ry", "rz"] };
  const GUARD = { lx: 56, ly: -50, lz: 96, rx: -56, ry: -44, rz: 96 };
  const OPEN = { lx: 72, ly: 46, lz: 52, rx: -72, ry: 52, rz: 52 };
  const COVER = { lx: 26, ly: -88, lz: 122, rx: -26, ry: -88, rz: 122 };
  const LOW = { lx: 64, ly: 66, lz: 38, rx: -64, ry: 72, rz: 38 };
  const AP = {
    jab:      { hand: "l", wind: { x: 62, y: -58, z: 64 }, twistW: 0.1, twistS: -0.3, leanS: 16 },
    straight: { hand: "r", wind: { x: -64, y: -52, z: 56 }, twistW: -0.12, twistS: 0.4, leanS: 24, crouchW: 6 },
    hookL:    { hand: "l", wind: { x: 162, y: -64, z: 4 }, ctrl: { x: 150, y: -72, z: 300 }, twistW: 0.3, twistS: -0.45, sideW: 12, sideS: -16 },
    hookR:    { hand: "r", wind: { x: -162, y: -64, z: 4 }, ctrl: { x: -150, y: -72, z: 300 }, twistW: -0.3, twistS: 0.45, sideW: -12, sideS: 16 },
    upper:    { hand: "r", wind: { x: -46, y: 76, z: 46 }, ctrl: { x: -30, y: 46, z: 300 }, twistW: -0.15, twistS: 0.32, crouchW: 38, crouchS: -12, dy: 34 },
    hay:      { hand: "r", wind: { x: -198, y: -94, z: -86 }, ctrl: { x: -212, y: -92, z: 280 }, twistW: -0.5, twistS: 0.6, leanW: -20, leanS: 40, sideW: -22, sideS: 14 },
  };

  function setHand(tg, h, v) { tg[h + "x"] = v.x; tg[h + "y"] = v.y; tg[h + "z"] = v.z; }
  const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
  const bez3 = (a, c, b, t) => ({ x: qbez(a.x, c.x, b.x, t), y: qbez(a.y, c.y, b.y, t), z: qbez(a.z, c.z, b.z, t) });

  function attackPose(m, tg, glint) {
    const a = m.opp.atk;
    if (!a) return null;
    const ap = AP[a.key];
    const H = ap.hand;
    const guard = { x: tg[H + "x"], y: tg[H + "y"], z: tg[H + "z"] };
    const chest = { x: tg.hx + tg.side, y: CHEST_Y + tg.hy + tg.crouch, z: tg.hz + tg.lean };
    const T = { x: a.tx - chest.x, y: CAM_Y + 24 + (ap.dy || 0) - chest.y, z: STRIKE_Z - chest.z };
    const W = ap.wind;
    const body = (from, to, e) => {
      tg.twist = lerp(from.twist, to.twist, e);
      tg.crouch += lerp(from.crouch, to.crouch, e);
      tg.side += lerp(from.side, to.side, e);
      tg.lean += lerp(from.lean, to.lean, e);
    };
    const rest = { twist: tg.twist, crouch: 0, side: 0, lean: 0 };
    const wound = { twist: ap.twistW || 0, crouch: ap.crouchW || 0, side: ap.sideW || 0, lean: ap.leanW || 0 };
    const struck = { twist: ap.twistS || 0, crouch: ap.crouchS || 0, side: ap.sideS || 0, lean: ap.leanS || 0 };
    if (a.phase === "windup") {
      const w = clamp(a.t / a.windup, 0, 1);
      const e = easeOut(w);
      setHand(tg, H, lerp3(guard, W, e));
      body(rest, wound, e);
      glint[H] = clamp(1 - Math.abs(w - 0.8) / 0.3, 0, 1) * (a.def.big ? 1.25 : 1);
      if (a.def.big) tg.headZ -= 12 * e;
      return null;
    }
    if (a.phase === "strike") {
      const s = easeOut(clamp(a.t / a.strike, 0, 1));
      setHand(tg, H, ap.ctrl ? bez3(W, ap.ctrl, T, s) : lerp3(W, T, s));
      body(wound, struck, s);
      glint[H] = 0.4 * (1 - s);
      return H;
    }
    // recover, or the long stumble of a whiff
    const u = clamp(a.t / a.dur, 0, 1);
    if (a.phase === "whiff") {
      const hold = u < 0.4 ? 0 : easeInOut((u - 0.4) / 0.6);
      const over = { x: T.x * 0.9, y: T.y + 30, z: T.z * 0.82 };
      setHand(tg, H, lerp3(over, guard, hold));
      body({ twist: struck.twist, crouch: 10, side: struck.side, lean: struck.lean + 26 }, rest, hold);
      tg.headY += 10 * (1 - hold);
      return null;
    }
    const e = easeInOut(u);
    setHand(tg, H, lerp3(T, guard, e));
    body(struck, rest, e);
    return null;
  }

  function downPose(tg, e) {
    tg.kneel = e;
    tg.hy = lerp(tg.hy, 215, e);
    tg.hx *= 1 - e;
    tg.crouch += 40 * e;
    tg.lean += 30 * e;
    tg.headY += 24 * e;
    tg.rot = lerp(tg.rot, 0.15, e);
    tg.twist *= 1 - e;
    setHand(tg, "l", lerp3({ x: tg.lx, y: tg.ly, z: tg.lz }, { x: 84, y: 150, z: 40 }, e));
    setHand(tg, "r", lerp3({ x: tg.rx, y: tg.ry, z: tg.rz }, { x: -84, y: 156, z: 40 }, e));
  }

  function poseOpp(m, dt) {
    const o = m.opp;
    const t = m.time;
    const tg = {
      hx: Math.sin(t * 1.5) * 26, hy: -Math.abs(Math.sin(t * 4.4)) * 7, hz: Math.sin(t * 0.7) * 18,
      side: 0, crouch: 0, lean: 0, twist: Math.sin(t * 1.5) * 0.05,
      headX: 0, headY: 0, headZ: 6, rot: Math.sin(t * 1.5 + 1) * 0.03, kneel: 0, ...GUARD,
    };
    let face = o.hp / o.hpMax < 0.3 ? "tired" : "idle";
    let snap = null;
    const glint = { l: 0, r: 0 };
    switch (o.state) {
      case "idle":
        if (o.guard === "open" || (m.phase === "down" && m.downWho === "player")) {
          Object.assign(tg, OPEN);
          face = "smirk";
          tg.rot += 0.06;
        }
        break;
      case "cover":
        Object.assign(tg, COVER);
        tg.crouch += 14;
        face = "angry";
        break;
      case "slip": {
        const e = Math.sin(Math.PI * clamp(o.t / 0.42, 0, 1));
        tg.side = o.slipDir * 74 * e;
        tg.headX = o.slipDir * 26 * e;
        tg.crouch += 22 * e;
        tg.rot = o.slipDir * 0.15 * e;
        tg.twist = o.slipDir * 0.1 * e;
        break;
      }
      case "hit":
        face = "hurt";
        tg.lz -= 28; tg.rz -= 28; tg.ly += 16; tg.ry += 16;
        tg.lean -= 12;
        break;
      case "daze":
        Object.assign(tg, LOW);
        face = "daze";
        tg.headX = Math.sin(t * 2.8) * 16;
        tg.rot = Math.sin(t * 2.8 + 0.6) * 0.13;
        tg.side = Math.sin(t * 1.9) * 16;
        tg.crouch += 12;
        break;
      case "attack":
        snap = attackPose(m, tg, glint);
        face = o.atk && o.atk.phase === "whiff" ? "tired" : "angry";
        break;
      case "down":
        downPose(tg, easeOut(clamp(o.t / 0.6, 0, 1)));
        face = "ko";
        break;
      case "getup":
        downPose(tg, 1 - easeInOut(clamp(o.t / 0.95, 0, 1)));
        face = o.t < 0.6 ? "ko" : "tired";
        break;
      default:
        break;
    }
    if (o.hitFace > 0 && o.state !== "down" && o.state !== "getup") face = "hurt";

    if (!o.par) o.par = { ...tg };
    const fb = 1 - Math.exp(-dt * 14);
    const fh = 1 - Math.exp(-dt * 30);
    for (const key of KEYS) {
      let f = fb;
      if (HAND.l.includes(key)) f = snap === "l" ? 1 : fh;
      else if (HAND.r.includes(key)) f = snap === "r" ? 1 : fh;
      o.par[key] += (tg[key] - o.par[key]) * f;
    }
    const pr = o.par;
    const k = o.kick;
    const hip = { x: pr.hx, y: pr.hy, z: pr.hz };
    const chest = { x: hip.x + pr.side, y: CHEST_Y + pr.hy + pr.crouch, z: hip.z + pr.lean + k.z * 0.35 };
    o.pose = {
      hip, chest, twist: pr.twist,
      head: { x: chest.x + pr.headX + k.x, y: chest.y + HEAD_DY + pr.headY + k.y, z: chest.z + pr.headZ + k.z, rot: pr.rot + k.r },
      l: { x: chest.x + pr.lx, y: chest.y + pr.ly, z: chest.z + pr.lz },
      r: { x: chest.x + pr.rx, y: chest.y + pr.ry, z: chest.z + pr.rz },
      face, blink: o.blink > 0 ? 1 : 0, glint, flush: o.flush,
      bruise: clamp((0.62 - o.hp / o.hpMax) / 0.5, 0, 1),
      sweat: clamp((m.round - 1) * 0.3 + (1 - o.hp / o.hpMax) * 0.6 - 0.15, 0, 1),
      kneel: pr.kneel,
      gaze: { x: clamp((m.player.cam.x - hip.x) * 0.012, -3, 3), y: 0.6 },
    };
  }

  /* =====================================================================
     MATCH — rounds, knockdowns, the count, the judges
     ===================================================================== */
  const newRound = () => ({ dealtP: 0, dealtO: 0, kdP: 0, kdO: 0 });

  function knockdown(m, who) {
    m.phase = "down";
    m.phaseT = 0;
    m.downWho = who;
    m.count = 0;
    m.countT = -0.7;
    if (who === "opp") {
      const o = m.opp;
      o.kd++;
      o.kdRound++;
      o.atk = null;
      o.queue = null;
      setO(o, "down");
      m.cur.kdO++;
      m.stats.p.kd++;
      const r = m.rng();
      o.getUpAt = o.kd >= 3 ? 99 : o.kd === 1 ? 3 + r * 2 : 5 + r * 2.5;
      if (o.ai.tough > 1.1 && o.kd < 3) o.getUpAt -= 1;
      if (o.kdRound >= 3) m.tko = true;
    } else {
      const p = m.player;
      p.kd++;
      p.kdRound++;
      p.punch = null;
      setP(p, "down");
      p.mash = 0;
      p.mashNeed = 9 + 6 * (p.kd - 1);
      m.cur.kdP++;
      m.stats.o.kd++;
      if (p.kdRound >= 3) m.tko = true;
      const o = m.opp;
      o.atk = null;
      o.queue = null;
      setO(o, "idle");
    }
    emit(m, "kd", { who, n: who === "opp" ? m.opp.kd : m.player.kd, final: m.tko || (who === "opp" && m.opp.getUpAt > 10) });
  }

  function stepDown(m, dt) {
    const who = m.downWho;
    const p = m.player;
    const o = m.opp;
    if (m.tko) { if (m.phaseT > 1.8) finish(m, who === "opp" ? "p" : "o", "TKO"); return; }
    m.countT += dt;
    const stillDown = who === "opp" ? o.state === "down" : p.state === "down";
    if (m.countT >= DATA.COUNT_STEP && stillDown) {
      m.countT -= DATA.COUNT_STEP;
      m.count++;
      emit(m, "count", { n: m.count, who });
      if (m.count >= 10) { finish(m, who === "opp" ? "p" : "o", "KO"); return; }
    }
    if (who === "opp") {
      if (o.state === "down" && m.count >= o.getUpAt) { setO(o, "getup"); emit(m, "getup", { who }); }
      if (o.state === "getup" && o.t >= 1.05) resume(m);
    } else {
      p.mash = Math.max(0, p.mash - dt * 1.5);
      if (p.state === "down" && m.count >= 1 && p.mash >= p.mashNeed) { setP(p, "getup"); emit(m, "getup", { who }); }
      if (p.state === "getup" && p.t >= 0.9) resume(m);
    }
  }

  function resume(m) {
    const p = m.player;
    const o = m.opp;
    if (m.downWho === "opp") {
      o.hp = o.hpMax * [0.6, 0.45, 0.3][Math.min(2, o.kd - 1)];
      setO(o, "idle");
      o.guard = "high";
      o.guardT = 2;
      o.next = 1.1;
      o.recent = [];
    } else {
      p.hp = p.hpMax * [0.5, 0.36, 0.24][Math.min(2, p.kd - 1)];
      p.sta = p.staMax;
      setP(p, "idle");
      o.next = Math.max(o.next, 1.2);
    }
    m.phase = "fight";
    m.phaseT = 0;
    m.downWho = null;
    emit(m, "call", { text: "Lanjut!", small: true });
  }

  function stopAction(m) {
    const p = m.player;
    const o = m.opp;
    p.punch = null;
    if (p.state !== "down") setP(p, "idle");
    o.atk = null;
    o.queue = null;
    if (o.state !== "down") setO(o, "idle");
  }

  function nextRound(m) {
    if (m.phase !== "corner") return;
    const p = m.player;
    const o = m.opp;
    m.logs.push(m.cur);
    m.cur = newRound();
    m.round++;
    m.clock = DATA.ROUND_TIME;
    p.hp = Math.min(p.hpMax, p.hp + (p.hpMax - p.hp) * 0.3);
    o.hp = Math.min(o.hpMax, o.hp + (o.hpMax - o.hp) * 0.22);
    p.sta = p.staMax;
    p.kdRound = 0;
    o.kdRound = 0;
    o.next = 1.4;
    o.guard = "high";
    stopAction(m);
    m.phase = "intro";
    m.phaseT = 0;
    m.flags = {};
  }

  function decide(m) {
    m.logs.push(m.cur);
    m.cur = newRound();
    const judges = [0, 1, 2].map(() => {
      let a = 0;
      let b = 0;
      for (const r of m.logs) {
        const n = () => 1 + (m.rng() - 0.5) * 0.3;
        const dp = r.dealtP * n();
        const dO = r.dealtO * n();
        let sp = 10;
        let so = 10;
        if (Math.abs(dp - dO) >= 4) { if (dp > dO) so = 9; else sp = 9; }
        sp -= r.kdP;
        so -= r.kdO;
        a += sp;
        b += so;
      }
      return [a, b];
    });
    const pw = judges.filter(([a, b]) => a > b).length;
    const ow = judges.filter(([a, b]) => b > a).length;
    let winner = null;
    let method = "DRAW";
    if (pw === 3 || ow === 3) { winner = pw === 3 ? "p" : "o"; method = "UD"; }
    else if (pw === 2 && ow === 1) { winner = "p"; method = "SD"; }
    else if (ow === 2 && pw === 1) { winner = "o"; method = "SD"; }
    else if (pw === 2 || ow === 2) { winner = pw === 2 ? "p" : "o"; method = "MD"; }
    finish(m, winner, method, judges);
  }

  function finish(m, winner, method, judges = null) {
    if (m.phase === "result") return;
    if (!judges) m.logs.push(m.cur);
    m.phase = "result";
    m.phaseT = 0;
    m.result = { winner, method, round: m.round, time: DATA.ROUND_TIME - m.clock, judges, stats: m.stats, opp: m.F.id };
    emit(m, "result", m.result);
  }

  function stepMatch(m, dt) {
    m.phaseT += dt;
    switch (m.phase) {
      case "intro":
        if (!m.flags.round && m.phaseT > 0.15) { m.flags.round = true; emit(m, "round", { n: m.round, last: m.round === DATA.ROUNDS }); }
        if (!m.flags.bell && m.phaseT > 1.45) { m.flags.bell = true; emit(m, "bell", { n: 1 }); emit(m, "call", { text: "Tinju!" }); }
        if (m.phaseT > 1.9) { m.phase = "fight"; m.phaseT = 0; }
        break;
      case "fight":
        m.clock -= dt;
        if (m.clock <= 0) {
          m.clock = 0;
          stopAction(m);
          m.phase = "roundEnd";
          m.phaseT = 0;
          emit(m, "bell", { n: 3 });
          emit(m, "roundEnd", { n: m.round });
        }
        break;
      case "down":
        stepDown(m, dt);
        break;
      case "roundEnd":
        if (m.phaseT > 1.9) {
          if (m.round >= DATA.ROUNDS) decide(m);
          else { m.phase = "corner"; m.phaseT = 0; emit(m, "corner", { n: m.round, log: { ...m.cur } }); }
        }
        break;
      case "corner":
        if (m.phaseT > 14) nextRound(m);
        break;
      default:
        break;
    }
  }

  function tick(m, dt) {
    if (m.hitstop > 0) { m.hitstop -= dt; return; }
    m.time += dt;
    stepMatch(m, dt);
    stepPlayer(m, dt);
    stepOpp(m, dt);
  }

  function create(fighterId, opts = {}) {
    const F = DATA.byId(fighterId);
    let seed = opts.seed || ((Date.now() % 2147483646) + 1);
    const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const m = {
      F, rng, phase: opts.attract ? "attract" : "intro", phaseT: 0, round: 1, clock: DATA.ROUND_TIME, time: 0,
      hitstop: 0, events: [], flags: {}, downWho: null, count: 0, countT: 0, tko: false, result: null,
      player: makePlayer(), opp: makeOpp(F),
      stats: { p: { thrown: 0, landed: 0, power: 0, counters: 0, dodges: 0, kd: 0 }, o: { landed: 0, kd: 0 } },
      cur: newRound(), logs: [], adapt: { dodges: [], blocks: 0, spam: 0 },
    };
    poseOpp(m, 1);
    playerView(m, 1);
    const STEP = 1 / 120;
    let acc = 0;
    return {
      m,
      update(dt) {
        acc += Math.min(dt, 0.1);
        while (acc >= STEP) { acc -= STEP; tick(m, STEP); }
      },
      press: (a) => press(m, a),
      release: (a) => release(m, a),
      nextRound: () => nextRound(m),
      drain() { const e = m.events; m.events = []; return e; },
    };
  }

  RW.ringSim = { create, DODGE };
})();
