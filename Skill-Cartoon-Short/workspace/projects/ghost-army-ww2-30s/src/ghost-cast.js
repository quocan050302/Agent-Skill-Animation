/**
 * Cartoon Cast & Comic FX for "The Fake Army That Fooled the Nazis" (QA-TTS-01 Phase 6)
 * Classification: NEW IMPLEMENTATION CODE
 *
 * Concatenated after toonbase.js (+ roman.js) during hydration so all actors share
 * the exact bean-head Pen proportions, #241726 dark-plum ink outlines, and faceFront system.
 * Historically accurate 1944 U.S. 23rd HQ Special Troops outfits + neutral field scouts (zero Nazi emblems).
 */

FACE.ghost_smirk = { eye: ['dot', 'dot'], brow: [-2, 4], mouth: 'grin' };
FACE.ghost_strain = { eye: ['small', 'small'], brow: [-5, 5], mouth: 'wave' };
FACE.ghost_wink = { eye: ['dot', 'happy'], brow: [2, -3], mouth: 'grin' };
FACE.scout_shock = { eye: ['shock', 'shock'], brow: [-7, 7], mouth: 'O' };
FACE.scout_squint = { eye: ['small', 'small'], brow: [-4, 4], mouth: 'flat' };

const SKIN_LIGHT = '#f2c7a4';
const SKIN_TAN = '#d9a47e';
const US_OLIVE = '#68734d';
const US_HELMET = '#4a5739';
const US_PANTS = '#5a533e';
const SCOUT_GREY = '#5a6670';
const SCOUT_HELMET = '#424b54';

/**
 * 1944 U.S. 23rd Headquarters Special Troops soldier / artist / radio operator.
 */
export const usGhostSoldier = (p, opts = {}) => {
  const {
    expr = 'ghost_smirk',
    blink = 0,
    look = 0,
    facing = 0,
    seed = 23,
    L = 'hang',
    R = 'hang',
    tilt = 0,
    headTilt = 0,
    bob = 0,
    step = 0,
    pumpPhase = 0,
    skin = SKIN_LIGHT,
    role = 'engineer', // 'engineer' | 'radio' | 'artist' | 'commander'
    light = rad(-125),
  } = opts;

  const lid = lidOf(blink);
  const H = headBlob(seed, 118, facing);
  const W = 2 * H.a;
  const HH = 2 * H.b;
  const u = W / 100;
  const sole = 975;
  const legsL = 1.32;
  const torsoL = 1.06;
  const torsoBot = sole - legsL * HH - bob * HH;
  const chin = torsoBot - torsoL * HH;
  const hc = chin - H.b;
  const hipY = torsoBot - 0.12 * HH;
  const thick = thickAngle(light);
  const ow = 5 * u;
  const cx = 300;

  p.rot = null;

  // ---- legs & combat boots ----
  for (const side of [-1, 1]) {
    const up = Math.max(0, Math.sin(Math.PI * 2 * (step + (side > 0 ? 0.5 : 0)))) * 26 * (step ? 1 : 0);
    const hx = cx + side * 16 * u;
    const fx = cx + side * 20 * u;
    const fy = sole - 4 * u - up;
    const kx = (hx + fx) / 2 + side * 4 * u;
    const ky = (hipY + fy) / 2;
    p.stroke(curve([hx, hipY], [kx, ky], [fx, fy]), 6.2 * u, US_PANTS);
    p.stroke([[fx - side * 5 * u, fy], [fx + side * 15 * u, fy]], 8.4 * u + 3, INK);
    p.stroke([[fx - side * 5 * u, fy], [fx + side * 15 * u, fy]], 8.4 * u, '#4a3525');
  }

  // ---- torso (M43 olive drab field jacket + web belt) ----
  p.rot = tilt ? [rad(tilt), cx, hipY] : null;
  const TB = {
    a: (0.43 * W) / 1.06,
    b: 0.5 * (torsoBot - (chin - 0.22 * HH)),
    nTop: 2.3,
    nBot: 2.5,
    egg: 0.12,
    asym: 0.04 * facing,
    rot: 0,
    noise: 0.006,
    seed: seed + 11,
  };
  const tcx = cx + 3 * u * facing;
  const tcy = torsoBot - TB.b;
  const tp = blobPts(tcx, tcy, TB);

  const S = (side) => [tcx + side * 0.86 * TB.a, chin + 0.14 * HH];
  const armPose = (side, pose) => {
    const s = S(side);
    const X = (k) => tcx + side * (TB.a * 1.05 + k * u);
    switch (pose) {
      case 'pump': {
        const dy = Math.sin(pumpPhase * Math.PI * 2) * 28 * u;
        return { pts: [s, [X(28), s[1] + 0.18 * HH + dy * 0.4], [X(54), s[1] + 0.34 * HH + dy]], front: true };
      }
      case 'lift':
        return { pts: [s, [X(24), s[1] - 0.42 * HH], [cx + side * 34 * u, hc - 1.02 * H.b]], front: true };
      case 'morse': {
        const tap = Math.sin(pumpPhase * Math.PI * 6) * 10 * u;
        return { pts: [s, [X(26), s[1] + 0.24 * HH], [X(56), s[1] + 0.36 * HH + tap]], front: true };
      }
      case 'point':
        return { pts: [s, [X(32), s[1] - 0.08 * HH], [X(74), s[1] - 0.22 * HH]], front: true };
      case 'paint': {
        const sw = Math.sin(pumpPhase * Math.PI * 2) * 18 * u;
        return { pts: [s, [X(30), s[1] - 0.15 * HH], [X(62), s[1] - 0.38 * HH + sw]], front: true, brush: true };
      }
      case 'hip':
        return { pts: [s, [X(26), s[1] + 0.28 * HH], [tcx + side * 0.72 * TB.a, torsoBot - 0.18 * HH]], front: true };
      default:
        return { pts: [s, [X(8), s[1] + 0.42 * HH], [X(6), chin + 0.98 * HH]], front: false };
    }
  };

  const arms = [armPose(-1, L), armPose(1, R)];
  const drawArm = (a) => {
    p.stroke(curve(a.pts[0], a.pts[1], a.pts[2]), 5.8 * u, mix(US_OLIVE, INK, 0.22));
    const [hx, hy] = a.pts[2];
    p.ell(hx, hy, 6.2 * u, 5.6 * u, skin, 2.8 * u);
    if (a.brush) {
      // Comic paintbrush held in hand (Ghost Army artists!)
      p.stroke([[hx, hy], [hx + 22 * u, hy - 28 * u]], 4.2 * u, '#c48f45');
      p.ell(hx + 26 * u, hy - 34 * u, 9 * u, 6 * u, '#ffe055', 2.4 * u);
    }
  };

  for (const a of arms) if (!a.front) drawArm(a);

  p.gradFill(tp, US_OLIVE, mul(US_OLIVE, SH_CLOTH), light);
  p.clip(tp, () => {
    // Khaki collar + field pockets + web belt with brass buckle
    p.poly(
      [
        [tcx - 0.28 * TB.a, chin - 0.05 * HH],
        [tcx + 0.28 * TB.a, chin - 0.05 * HH],
        [tcx, chin + 0.34 * HH],
      ],
      '#b8a885',
      2 * u
    );
    p.band([[tcx - 1.2 * TB.a, torsoBot - 0.2 * HH], [tcx + 1.2 * TB.a, torsoBot - 0.2 * HH]], '#8a7e5a', 0.1 * HH, 1.8 * u);
    p.poly(rrect(tcx - 9 * u, torsoBot - 0.25 * HH, tcx + 9 * u, torsoBot - 0.14 * HH, 2 * u), '#e0ba4f', 1.8 * u);
    // Ghost patch chevron on sleeve/chest
    p.poly(rrect(tcx + 0.22 * TB.a, tcy - 14 * u, tcx + 0.54 * TB.a, tcy + 12 * u, 3 * u), '#e8e2d0', 1.6 * u);
  });
  p.inkRing(tp, ow, thick);

  // ---- head + M1 helmet (or radio headset) ----
  const [cpx, cpy] = rotAbout([cx, chin], rad(tilt), [cx, hipY]);
  const Ah = tilt + headTilt;
  p.rot = Ah ? [rad(Ah), cx, chin, cpx - cx, cpy - chin] : null;

  const hp = blobPts(cx, hc, H);
  p.shadedFill(hp, skin, mul(skin, [0.85, 0.8, 0.78]), light, H.a);
  p.inkRing(hp, ow, thick);

  faceFront(p, cx, hc, W, expr, facing, look, lid, false, skin, undefined, false);

  // Iconic rounded M1 U.S. Army helmet dome (olive drab with camouflage net strap)
  const helmY = hc - 0.56 * H.b;
  const helmPts = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const ang = Math.PI + t * Math.PI;
    helmPts.push([cx + Math.cos(ang) * (H.a * 1.14), helmY + Math.sin(ang) * (H.b * 0.78) + 12 * u]);
  }
  helmPts.push([cx + H.a * 1.18, helmY + 18 * u]);
  helmPts.push([cx - H.a * 1.18, helmY + 18 * u]);
  p.gradFill(helmPts, US_HELMET, mul(US_HELMET, [0.72, 0.76, 0.72]), light);
  p.inkRing(helmPts, ow * 0.92, thick);
  // Helmet band
  p.stroke([[cx - H.a * 1.05, helmY + 4 * u], [cx + H.a * 1.05, helmY + 4 * u]], 4.2 * u, '#2f3825');

  if (role === 'radio') {
    // Field radio headphones over helmet/ears
    for (const s of [-1, 1]) {
      p.ell(cx + s * (H.a * 1.04), hc - 4 * u, 11 * u, 17 * u, '#2a3036', 3 * u);
    }
    p.stroke(
      curve([cx + H.a * 0.95, hc + 8 * u], [cx + H.a * 0.45, hc + 32 * u], [cx + 12 * u, hc + 28 * u]),
      3.4 * u,
      INK
    );
  }

  p.rot = null;
  for (const a of arms) if (a.front) drawArm(a);
};

/**
 * Distant WW2 reconnaissance scout with binoculars (neutral historical tunic — zero Nazi emblems/glorification).
 */
export const scoutObserverFront = (p, opts = {}) => {
  const {
    expr = 'scout_squint',
    blink = 0,
    look = 0,
    facing = 0,
    seed = 51,
    binocularsUp = true,
    tilt = 0,
    headTilt = 0,
    bob = 0,
    light = rad(-125),
  } = opts;

  const lid = lidOf(blink);
  const H = headBlob(seed, 118, facing);
  const W = 2 * H.a;
  const HH = 2 * H.b;
  const u = W / 100;
  const sole = 975;
  const legsL = 1.32;
  const torsoL = 1.06;
  const torsoBot = sole - legsL * HH - bob * HH;
  const chin = torsoBot - torsoL * HH;
  const hc = chin - H.b;
  const hipY = torsoBot - 0.12 * HH;
  const thick = thickAngle(light);
  const ow = 5 * u;
  const cx = 300;

  p.rot = null;
  for (const side of [-1, 1]) {
    const hx = cx + side * 16 * u;
    const fx = cx + side * 20 * u;
    const fy = sole - 4 * u;
    p.stroke(curve([hx, hipY], [(hx + fx) / 2, (hipY + fy) / 2], [fx, fy]), 6.2 * u, '#434c54');
    p.stroke([[fx - side * 5 * u, fy], [fx + side * 15 * u, fy]], 8.4 * u + 3, INK);
    p.stroke([[fx - side * 5 * u, fy], [fx + side * 15 * u, fy]], 8.4 * u, '#2a2e33');
  }

  p.rot = tilt ? [rad(tilt), cx, hipY] : null;
  const TB = {
    a: (0.43 * W) / 1.06,
    b: 0.5 * (torsoBot - (chin - 0.22 * HH)),
    nTop: 2.3,
    nBot: 2.5,
    egg: 0.12,
    asym: 0.04 * facing,
    rot: 0,
    noise: 0.006,
    seed: seed + 7,
  };
  const tcx = cx + 3 * u * facing;
  const tcy = torsoBot - TB.b;
  const tp = blobPts(tcx, tcy, TB);

  p.gradFill(tp, SCOUT_GREY, mul(SCOUT_GREY, SH_CLOTH), light);
  p.clip(tp, () => {
    p.band([[tcx - 1.2 * TB.a, torsoBot - 0.2 * HH], [tcx + 1.2 * TB.a, torsoBot - 0.2 * HH]], '#2d333a', 0.1 * HH, 1.8 * u);
  });
  p.inkRing(tp, ow, thick);

  const [cpx, cpy] = rotAbout([cx, chin], rad(tilt), [cx, hipY]);
  const Ah = tilt + headTilt;
  p.rot = Ah ? [rad(Ah), cx, chin, cpx - cx, cpy - chin] : null;

  const hp = blobPts(cx, hc, H);
  p.shadedFill(hp, SKIN_TAN, mul(SKIN_TAN, [0.85, 0.8, 0.78]), light, H.a);
  p.inkRing(hp, ow, thick);
  faceFront(p, cx, hc, W, expr, facing, look, lid, false, SKIN_TAN, undefined, false);

  // Neutral peaked field cap
  const capY = hc - 0.62 * H.b;
  p.ell(cx, capY, H.a * 1.05, H.b * 0.42, SCOUT_HELMET, ow * 0.85);
  p.poly(
    [
      [cx - H.a * 0.9, capY + 8 * u],
      [cx + H.a * 1.25, capY + 14 * u],
      [cx + H.a * 0.8, capY + 26 * u],
      [cx - H.a * 0.85, capY + 20 * u],
    ],
    '#2f363d',
    ow * 0.75
  );

  // Arms holding field binoculars (up to eyes or lowered in shock!)
  p.rot = null;
  const binoY = binocularsUp ? hc - 4 * u : chin + 0.34 * HH;
  for (const side of [-1, 1]) {
    const s = [tcx + side * 0.86 * TB.a, chin + 0.14 * HH];
    const hand = [cx + side * 24 * u, binoY + 6 * u];
    p.stroke(curve(s, [tcx + side * 1.15 * TB.a, (s[1] + hand[1]) / 2 + 12 * u], hand), 5.6 * u, mix(SCOUT_GREY, INK, 0.2));
    p.ell(hand[0], hand[1], 6 * u, 5.6 * u, SKIN_TAN, 2.6 * u);
  }
  // Dual binocular barrels with cyan glass glint
  for (const side of [-1, 1]) {
    p.ell(cx + side * 17 * u, binoY, 15 * u, 13 * u, '#252b31', 3.6 * u);
    p.ell(cx + side * 17 * u, binoY, 9 * u, 8 * u, '#78c6e8', 2 * u);
  }
};

/** Stylized concentric acoustic speaker waves (Scene 4: Sound Trucks) */
export const fxSoundWaves = (p, phase = 0) => {
  const g = p.g;
  g.save();
  g.translate(180, 500);
  for (let i = 0; i < 4; i++) {
    const prog = (phase + i * 0.25) % 1;
    const rad = 75 + prog * 280;
    const alpha = Math.max(0, 1 - prog);
    g.strokeStyle = `rgba(36, 23, 38, ${(alpha * 0.9).toFixed(2)})`;
    g.lineWidth = 24;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 0, rad, -0.78, 0.78);
    g.stroke();

    g.strokeStyle = `rgba(255, 224, 85, ${(alpha * 0.95).toFixed(2)})`;
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, rad, -0.78, 0.78);
    g.stroke();
  }
  g.restore();
};

/** Crackling radio wave arcs radiating from field antenna (Scene 5: Spoof Radio) */
export const fxRadioWaves = (p, phase = 0) => {
  const g = p.g;
  g.save();
  g.translate(300, 520);
  for (let i = 0; i < 3; i++) {
    const prog = (phase + i * 0.33) % 1;
    const rad = 60 + prog * 210;
    const alpha = Math.max(0, 1 - prog);
    for (const dir of [-1, 1]) {
      const a0 = dir > 0 ? -0.65 : Math.PI - 0.65;
      const a1 = dir > 0 ? 0.65 : Math.PI + 0.65;
      g.strokeStyle = `rgba(36, 23, 38, ${(alpha * 0.85).toFixed(2)})`;
      g.lineWidth = 20;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(0, 0, rad, a0, a1);
      g.stroke();

      g.strokeStyle = `rgba(56, 189, 248, ${(alpha * 0.95).toFixed(2)})`;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(0, 0, rad, a0, a1);
      g.stroke();
    }
  }
  g.restore();
};

/** Inflatable rubber air-whoosh puff + comic "PFFFT!" lines (Scene 1 & 3) */
export const fxAirPuff = (p, k = 0) => {
  const g = p.g;
  g.save();
  g.translate(300, 520);
  const alpha = Math.max(0, 1 - k);
  for (let i = 0; i < 5; i++) {
    const ang = -0.8 + i * 0.4;
    const r = 40 + k * 190;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    g.fillStyle = `rgba(240, 248, 255, ${(alpha * 0.88).toFixed(2)})`;
    g.strokeStyle = `rgba(36, 23, 38, ${(alpha * 0.85).toFixed(2)})`;
    g.lineWidth = 8;
    g.beginPath();
    g.arc(x, y, 28 + (1 - k) * 26, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.restore();
};

/** Comic surprise exclamation over binoculars scout (Scene 2) */
export const fxScoutShock = (p, wob = 0) => {
  const g = p.g;
  g.save();
  g.translate(300, 500);
  g.rotate(wob * 0.12);
  g.font = '900 200px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 26;
  g.strokeStyle = INK;
  g.strokeText('?!', 0, 0);
  g.fillStyle = '#ffe055';
  g.fillText('?!', 0, 0);
  g.restore();
};
