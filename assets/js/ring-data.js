/* ring-data.js — numbers and words for the boxing game: punches, attacks,
   the three sparring partners, corner tips. No logic lives here. */
(() => {
  "use strict";
  const RW = (window.RW = window.RW || {});

  /* Player punches. Times in seconds from the button press:
     hit = contact check, cancel = earliest next action, end = back in guard. */
  const PUNCHES = {
    jab:      { hand: "l", hit: 0.10, cancel: 0.19, end: 0.25, dmg: 4,  sta: 6 },
    straight: { hand: "r", hit: 0.14, cancel: 0.26, end: 0.33, dmg: 7,  sta: 9 },
    hook:     { hand: "l", hit: 0.21, cancel: 0.38, end: 0.46, dmg: 9,  sta: 14, power: true, arc: 1 },
    upper:    { hand: "r", hit: 0.22, cancel: 0.40, end: 0.48, dmg: 10, sta: 16, power: true, rise: true, breaks: true },
    special:  { hand: "r", hit: 0.26, cancel: 0.50, end: 0.60, dmg: 18, sta: 0,  power: true, unblockable: true },
  };

  /* Opponent attacks. hand "l" is HIS left = the glove on the right of the screen.
     side: where a hook comes from (+1 = screen right). Dodging toward that side walks into it.
     block: share of damage that still gets through a raised guard. */
  const ATTACKS = {
    jab:      { hand: "l", windup: 0.32, strike: 0.11, recover: 0.28, whiff: 0.50, dmg: 6,  side: 0,  block: 0 },
    straight: { hand: "r", windup: 0.42, strike: 0.13, recover: 0.34, whiff: 0.65, dmg: 10, side: 0,  block: 0.15 },
    hookL:    { hand: "l", windup: 0.50, strike: 0.16, recover: 0.40, whiff: 0.85, dmg: 13, side: 1,  block: 0.35 },
    hookR:    { hand: "r", windup: 0.50, strike: 0.16, recover: 0.40, whiff: 0.85, dmg: 13, side: -1, block: 0.35 },
    upper:    { hand: "r", windup: 0.56, strike: 0.15, recover: 0.42, whiff: 0.95, dmg: 15, side: 0,  block: 1, breaks: true },
    hay:      { hand: "r", windup: 0.95, strike: 0.20, recover: 0.50, whiff: 1.45, dmg: 24, side: 0,  block: 1, breaks: true, big: true },
  };

  const FIGHTERS = [
    {
      id: "joko",
      name: "Joko",
      nick: "Jab Doang",
      level: 1,
      record: "2–9–1, amatir",
      blurb: "Baru tiga minggu latihan. Jab-nya rajin, sisanya belum.",
      look: {
        skin: "#c98f5e", skinLit: "#e2ad7c", skinShade: "#985f39",
        hair: "guard", gear: "#c8302b", gearShade: "#8c1d19",
        top: "singlet", topColor: "#e9b824", topShade: "#b4860f",
        trunks: "#e9b824", trunksShade: "#b4860f", trim: "#17130f",
        gloves: "#e9b824", glovesShade: "#a87a0c", cuff: "#17130f",
        build: { sh: 0.92, waist: 0.9, head: 1, belly: 0 },
        ink: "#24160d", eyeH: 1, mouthguard: "#2456c4",
      },
      ai: {
        hp: 120, dmg: 0.75, windup: 1.6, recover: 1.5, react: 0.28, stun: 1.1,
        slip: 0.03, cover: 0.2, drop: 0.6, gap: [1.4, 2.5], combo: 0.15, feint: 0,
        moves: { jab: 7, straight: 3 }, burst: 5, shell: 5, tough: 0.8, adapt: false,
      },
      taunts: ["Jab… jab… jab…", "Aku cuma bisa jab, tapi rajin!", "Pelan-pelan, aku baru minggu ketiga.", "Kata coach: jangan merem."],
      winLine: "Oke, minggu depan aku latihan hook.",
      loseLine: "Kalah sama jab doang? Coba tahan ↓ untuk blok.",
    },
    {
      id: "toni",
      name: "Bang Toni",
      nick: "Tukang Hook",
      level: 2,
      record: "14–6–0",
      blurb: "Pensiunan petinju kampung. Hook kiri-kanannya masih berat.",
      look: {
        skin: "#a8693f", skinLit: "#c78a5d", skinShade: "#764426",
        hair: "bald", hairColor: "#1b1410", beard: "mustache",
        top: null,
        trunks: "#7e1f24", trunksShade: "#521216", trim: "#c9a35f",
        gloves: "#232120", glovesShade: "#0d0c0b", cuff: "#c8302b",
        build: { sh: 1.1, waist: 1.14, head: 1.06, belly: 1 },
        ink: "#1e120a", eyeH: 0.95, mouthguard: "#f1eadb",
      },
      ai: {
        hp: 180, dmg: 0.9, windup: 1.2, recover: 1.15, react: 0.2, stun: 0.95,
        slip: 0.08, cover: 0.45, drop: 0.45, gap: [1.0, 1.9], combo: 0.25, feint: 0.18,
        moves: { jab: 2, straight: 1, hookL: 4, hookR: 4, upper: 1, hay: 1 }, burst: 4, shell: 4, tough: 1, adapt: false,
      },
      taunts: ["Hook kiri atau kanan? Tebak!", "Jangan cuma ngeblok, Dik.", "Perut ini bukan lemak. Ini peredam.", "Sini, sini!"],
      winLine: "Hook-ku kebaca… Kamu boleh juga.",
      loseLine: "Hook datang dari samping. Menghindar ke arah sebaliknya.",
    },
    {
      id: "raihan",
      name: "Raihan",
      nick: "Si Stik",
      level: 3,
      record: "Rahasia sasana",
      blurb: "Pemilik ring ini. Membaca polamu seperti membaca posisi bola.",
      look: {
        skin: "#e0b18b", skinLit: "#f1c9a5", skinShade: "#b6845f",
        hair: "shaggy", hairColor: "#141110",
        top: "tank", topColor: "#2f3b3c", topShade: "#1c2425",
        trunks: "#1c679c", trunksShade: "#0f4570", trim: "#f1eadb", emblem: true,
        gloves: "#cf2f2a", glovesShade: "#8e1c18", cuff: "#f1eadb",
        build: { sh: 0.98, waist: 0.86, head: 0.97, belly: 0 },
        ink: "#1a110c", eyeH: 0.72, mouthguard: "#f1eadb",
      },
      ai: {
        hp: 240, dmg: 1.2, windup: 0.85, recover: 0.8, react: 0.14, stun: 0.75,
        slip: 0.35, cover: 0.55, drop: 0.3, gap: [0.9, 1.8], combo: 0.5, feint: 0.3,
        moves: { jab: 4, straight: 3, hookL: 2, hookR: 2, upper: 2, hay: 1 }, burst: 3, shell: 3, tough: 1.15, adapt: true,
      },
      taunts: ["Disiplin, bukan emosi.", "Baca dulu, baru pukul.", "Fokus. Kayak bidik bola delapan.", "Better than yesterday."],
      winLine: "Bagus. Rematch minggu depan — di Enggi Pool, bawa stik.",
      loseLine: "Raihan masih juara sasana. Perhatikan bahunya sebelum uppercut.",
    },
  ];

  const TIPS = {
    joko: [
      "Sarung tinjunya berkilat sebelum memukul. Itu tanda untuk menghindar.",
      "Setelah pukulannya meleset, dia terbuka. Balas cepat: jab lalu straight.",
      "Ragu? Tahan blok. Jab Joko tidak tembus guard.",
      "Guard-nya sering turun. Itu kesempatan jab masuk.",
    ],
    toni: [
      "Hook datang dari samping. Menghindarlah ke arah sebaliknya.",
      "Hook yang diblok tetap terasa. Lebih baik menghindar lalu balas.",
      "Guard-nya rapat? Uppercut bisa membelahnya.",
      "Kalau dia berteriak dan menarik tangan jauh ke belakang, jangan diblok. Menghindar.",
    ],
    raihan: [
      "Guard Raihan turun bukan berarti lengah. Kadang itu umpan.",
      "Uppercut-nya menembus blok. Bahunya turun dulu, lalu menghindar.",
      "Jangan menghindar ke sisi yang sama terus. Dia membaca polamu.",
      "Pukulan Bola 8 tidak bisa diblok. Simpan untuk saat dia terbuka.",
    ],
  };

  RW.ringData = {
    ROUNDS: 3,
    ROUND_TIME: 60,
    COUNT_STEP: 0.8, // seconds per referee count
    PLAYER: { hp: 100, sta: 100 },
    PLAYER_LOOK: { gloves: "#1c679c", glovesShade: "#0f4570", cuff: "#f1eadb", skin: "#d9a47a", skinShade: "#a87452", wrap: "#f1eadb" },
    PUNCHES,
    ATTACKS,
    FIGHTERS,
    TIPS,
    byId: (id) => FIGHTERS.find((f) => f.id === id) || FIGHTERS[0],
  };
})();
