/* core.js — shared helpers: motion preference, synthesized sound effects, toast.
   Loaded first; exposes window.RW for table.js and main.js. */
(() => {
  "use strict";

  document.documentElement.classList.remove("no-js");

  const RW = (window.RW = window.RW || {});
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  RW.reducedMotion = () => motionQuery.matches;
  RW.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const storage = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); } catch { /* private mode: ignore */ }
    },
  };
  RW.storage = storage;

  /* ---------------------------------------------------------------------
     Sound — every effect is synthesized, so no audio files are loaded.
     The AudioContext is only created after a user gesture.
     --------------------------------------------------------------------- */
  let enabled = storage.get("rw-sound") !== "off";
  let ac = null;
  let master = null;
  let noiseBuffer = null;
  let voices = 0;

  function ensureContext() {
    if (!enabled) return null;
    if (!ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ac = new Ctx();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ac.createGain();
      master.gain.value = 0.55;
      master.connect(comp).connect(ac.destination);
      noiseBuffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }

  function voice(duration) {
    if (voices > 18) return false;
    voices++;
    window.setTimeout(() => { voices--; }, duration * 1000 + 30);
    return true;
  }

  function tone(freq, peak, decay, { type = "sine", delay = 0, glideTo = 0 } = {}) {
    const ctx = ensureContext();
    if (!ctx || peak <= 0.001 || !voice(decay + delay)) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  function burst(peak, decay, filterType, freq, q = 1, delay = 0) {
    const ctx = ensureContext();
    if (!ctx || peak <= 0.001 || !voice(decay + delay)) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + decay + 0.02);
  }

  const v01 = (v) => RW.clamp(v, 0, 1);

  RW.sfx = {
    get enabled() { return enabled; },
    setEnabled(value) {
      enabled = value;
      storage.set("rw-sound", value ? "on" : "off");
      if (value) ensureContext();
    },
    unlock() { ensureContext(); },
    /** ball against ball: short, bright "clack" */
    clack(v) {
      v = v01(v);
      tone(2500 + Math.random() * 700, 0.42 * v, 0.05, { type: "triangle" });
      burst(0.32 * v, 0.018, "bandpass", 4200, 1.4);
    },
    /** ball against the rubber cushion: dull thump */
    cushion(v) {
      v = v01(v);
      tone(150, 0.32 * v, 0.09, { glideTo: 90 });
      burst(0.16 * v, 0.05, "lowpass", 900, 0.8);
    },
    /** cue tip on the cue ball */
    strike(v) {
      v = v01(v);
      tone(1500, 0.3 * v, 0.035, { type: "triangle" });
      burst(0.36 * v, 0.03, "bandpass", 2600, 1);
    },
    /** ball dropping into a pocket and rattling down the return */
    pocket(v) {
      v = v01(v);
      tone(130, 0.5 * v, 0.24, { glideTo: 62 });
      burst(0.22 * v, 0.1, "bandpass", 650, 1.6);
      [0.1, 0.17, 0.23].forEach((d, i) => tone(820 - i * 130, 0.1 * v, 0.045, { type: "triangle", delay: d }));
    },
    /** iron plate onto a bar */
    clank(v) {
      v = v01(v);
      [310, 742, 1290, 2110, 2960].forEach((f, i) =>
        tone(f * (0.985 + Math.random() * 0.03), (0.22 * v) / Math.sqrt(i + 1), 0.45 - i * 0.07)
      );
      burst(0.3 * v, 0.05, "highpass", 1800, 0.7);
    },
    /** soft UI tick */
    tick(v = 0.4) {
      tone(1900, 0.12 * v01(v), 0.025, { type: "triangle" });
    },
  };

  // Unlock audio on the first gesture anywhere.
  const unlockOnce = () => {
    ensureContext();
    window.removeEventListener("pointerdown", unlockOnce, true);
    window.removeEventListener("keydown", unlockOnce, true);
  };
  window.addEventListener("pointerdown", unlockOnce, true);
  window.addEventListener("keydown", unlockOnce, true);

  /* ---------------------------------------------------------------------
     Toast — one polite status message at a time, optional action link.
     --------------------------------------------------------------------- */
  let toastEl = null;
  let toastTimer = 0;
  RW.toast = (message, { action = null, duration = 3600 } = {}) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = "";
    const text = document.createElement("span");
    text.textContent = message;
    toastEl.appendChild(text);
    if (action) {
      const link = document.createElement("a");
      link.href = action.href;
      link.textContent = action.label;
      link.addEventListener("click", () => toastEl.classList.remove("is-show"));
      toastEl.appendChild(link);
    }
    // restart the entrance if a toast is already visible
    toastEl.classList.remove("is-show");
    void toastEl.offsetWidth;
    toastEl.classList.add("is-show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-show"), duration);
  };
})();
