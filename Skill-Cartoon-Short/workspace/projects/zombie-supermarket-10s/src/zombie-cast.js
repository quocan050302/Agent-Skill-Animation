/**
 * Cartoon Zombie Character & Reaction FX on top of mromidev/claude-animated-shorts Pen (MIT)
 * Classification: NEW IMPLEMENTATION CODE (SHORT-01 Phase G)
 *
 * Concatenated after toonbase.js (+ roman.js) during zombie-supermarket-10s hydration so it
 * shares the exact bean-head proportions, #241726 dark-plum ink outlines, and faceFront system.
 */

FACE.zombie_eager = { eye: ['dot', 'small'], brow: [-3, 3], mouth: 'lick' };
FACE.zombie_confused = { eye: ['small', 'shock'], brow: [-5, 5], mouth: 'wave' };
FACE.zombie_scream = { eye: ['shock', 'shock'], brow: [-8, -7], mouth: 'O' };
FACE.zombie_despair = { eye: ['spiral', 'spiral'], brow: [-4, 3], mouth: 'frown' };

const ZOMBIE_SKIN = '#98c97e';
const ZOMBIE_HOODIE = '#5d4b7a';
const ZOMBIE_SHIRT = '#d6c8b4';
const ZOMBIE_PANTS = '#384654';

export const zombieFront = (p, opts = {}) => {
  const {
    expr = 'zombie_eager',
    blink = 0,
    look = 0,
    facing = 0,
    seed = 17,
    L = 'shamble',
    R = 'shamble',
    tilt = 0,
    headTilt = 0,
    bob = 0,
    slump = 0, // 0..1 dramatic kneel/drop at ending
    step = 0,
    reachLift = 0,
    light = rad(-120),
    tears = false,
  } = opts;

  const lid = lidOf(blink);
  const H = headBlob(seed, 120, facing);
  const W = 2 * H.a;
  const HH = 2 * H.b;
  const u = W / 100;
  const sole = 975;
  const slumpPx = slump * 0.62 * HH;
  const legsL = 1.34;
  const torsoL = 1.08;
  const torsoBot = sole - legsL * HH - bob * HH + slumpPx;
  const chin = torsoBot - torsoL * HH;
  const hc = chin - H.b;
  const hipY = torsoBot - 0.12 * HH;
  const thick = thickAngle(light);
  const ow = 5 * u;
  const cx = 300;

  p.rot = null;

  // ---- legs (bend/kneel when slump > 0) ----
  for (const side of [-1, 1]) {
    const up = Math.max(0, Math.sin(Math.PI * 2 * (step + (side > 0 ? 0.5 : 0)))) * 28 * (step ? 1 : 0);
    const hx = cx + side * 16 * u;
    const fx = cx + side * (22 + slump * 14) * u;
    const fy = sole - 4 * u - up;
    const kneeX = (hx + fx) / 2 + side * (3 + slump * 22) * u;
    const kneeY = (hipY + fy) / 2 + slump * 18 * u;
    p.stroke(curve([hx, hipY], [kneeX, kneeY], [fx, fy]), 6.2 * u, ZOMBIE_PANTS);
    // Cartoon sneaker
    const shoeCol = side < 0 ? '#d94e47' : '#e8eef2';
    p.stroke([[fx - side * 4 * u, fy], [fx + side * 14 * u, fy + 0.5 * u]], 8 * u + 3, INK);
    p.stroke([[fx - side * 4 * u, fy], [fx + side * 14 * u, fy + 0.5 * u]], 8 * u, shoeCol);
  }

  // ---- torso (tattered purple hoodie over striped tee) ----
  p.rot = tilt ? [rad(tilt), cx, hipY] : null;
  const TB = {
    a: (0.42 * W) / 1.06,
    b: 0.5 * (torsoBot - (chin - 0.24 * HH)),
    nTop: 2.2,
    nBot: 2.6,
    egg: 0.14,
    asym: 0.04 * facing,
    rot: 0,
    noise: 0.008,
    seed: seed + 5,
  };
  const tcx = cx + 3 * u * facing;
  const tcy = torsoBot - TB.b;
  const tp = blobPts(tcx, tcy, TB);

  const S = (side) => [tcx + side * 0.85 * TB.a, chin + 0.13 * HH];
  const armPose = (side, pose) => {
    const s = S(side);
    const X = (k) => tcx + side * (TB.a * 1.08 + k * u);
    switch (pose) {
      case 'shamble':
        return {
          pts: [s, [X(28), s[1] + 0.06 * HH], [X(58), s[1] - 0.04 * HH + Math.sin(step * 6.28 + side) * 8 * u]],
          front: true,
        };
      case 'reach': {
        const lf = reachLift * 0.35 * HH;
        return {
          pts: [s, [X(38), s[1] - 0.05 * HH - lf * 0.5], [X(78), s[1] - 0.22 * HH - lf]],
          front: true,
        };
      }
      case 'cheek':
        return {
          pts: [s, [X(24), s[1] + 0.02 * HH], [cx + side * (H.a * 0.92), hc + 0.26 * H.b]],
          front: true,
        };
      case 'up':
        return {
          pts: [s, [X(22), s[1] - 0.32 * HH], [X(30), s[1] - 0.88 * HH]],
          front: false,
        };
      default:
        return { pts: [s, [X(6), s[1] + 0.45 * HH], [X(5), chin + 1.0 * HH]], front: false };
    }
  };

  const arms = [armPose(-1, L), armPose(1, R)];
  const drawZombieArm = (a) => {
    p.stroke(curve(a.pts[0], a.pts[1], a.pts[2]), 5.6 * u, mix(ZOMBIE_HOODIE, INK, 0.25));
    const [hx, hy] = a.pts[2];
    p.ell(hx, hy, 6.2 * u, 5.8 * u, ZOMBIE_SKIN, 2.8 * u);
  };

  for (const a of arms) if (!a.front) drawZombieArm(a);

  p.gradFill(tp, ZOMBIE_HOODIE, mul(ZOMBIE_HOODIE, SH_CLOTH), light);
  p.clip(tp, () => {
    // Inner V-patch of faded shirt + hoodie drawstring + ragged hem notch
    p.poly(
      [
        [tcx - 0.32 * TB.a, chin - 0.05 * HH],
        [tcx + 0.32 * TB.a, chin - 0.05 * HH],
        [tcx, chin + 0.42 * HH],
      ],
      ZOMBIE_SHIRT,
      2 * u
    );
    p.band([[tcx - 1.2 * TB.a, torsoBot - 0.16 * HH], [tcx + 1.2 * TB.a, torsoBot - 0.16 * HH]], '#43345b', 0.07 * HH, 1.5 * u);
    // Cute stitched patch on hoodie
    p.poly(rrect(tcx + 0.18 * TB.a, tcy - 8 * u, tcx + 0.56 * TB.a, tcy + 22 * u, 3 * u), '#7ba05b', 1.8 * u);
  });
  p.inkRing(tp, ow, thick);

  // ---- head (bean-head with zombie green skin, forehead stitch, messy tuft) ----
  const [cpx, cpy] = rotAbout([cx, chin], rad(tilt), [cx, hipY]);
  const Ah = tilt + headTilt;
  p.rot = Ah ? [rad(Ah), cx, chin, cpx - cx, cpy - chin] : null;

  const hp = blobPts(cx, hc, H);
  // Messy dark hair tufts on top
  for (const [dx, dy, rx_, ry_] of [
    [-22, -1.03, 18, 12],
    [4, -1.07, 22, 14],
    [28, -1.0, 15, 10],
  ]) {
    p.ell(cx + dx * u, hc + dy * H.b, rx_ * u, ry_ * u, '#2d332c', 3 * u);
  }

  p.shadedFill(hp, ZOMBIE_SKIN, mul(ZOMBIE_SKIN, [0.78, 0.86, 0.76]), light, H.a);
  p.clip(hp, () => {
    // Subtle cheek blush/bruise + stitched forehead scar
    for (const s of [-1, 1]) {
      p.ell(cx + s * 28 * u + 6 * u * facing, hc + 10 * u, 13 * u, 7 * u, '#7aa866', 0);
    }
    const sx0 = cx - 34 * u, sy0 = hc - 0.52 * H.b, sx1 = cx - 4 * u, sy1 = hc - 0.42 * H.b;
    p.stroke([[sx0, sy0], [sx1, sy1]], 2.4 * u, '#4a3548');
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      const px = sx0 + (sx1 - sx0) * t;
      const py = sy0 + (sy1 - sy0) * t;
      p.stroke([[px - 2 * u, py - 5 * u], [px + 2 * u, py + 5 * u]], 2.0 * u, '#4a3548');
    }
  });
  p.inkRing(hp, ow, thick);

  faceFront(p, cx, hc, W, expr, facing, look, lid, false, ZOMBIE_SKIN, undefined, false);

  if (tears) {
    for (const s of [-1, 1]) {
      p.ell(cx + s * 24 * u, hc + 8 * u, 5 * u, 10 * u, '#8ad8ff', 2 * u);
    }
  }

  p.rot = null;
  for (const a of arms) if (a.front) drawZombieArm(a);
};

/** Comic shock burst lines around zombie head during close-up reaction */
export const fxShockRays = (p, phase = 0) => {
  const g = p.g;
  g.save();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + phase * 0.25;
    const r0 = 185 + (i % 2) * 18;
    const r1 = 265 + ((i + 1) % 3) * 24;
    const p0 = [300 + Math.cos(a) * r0, 480 + Math.sin(a) * r0];
    const p1 = [300 + Math.cos(a) * r1, 480 + Math.sin(a) * r1];
    p.stroke([p0, p1], 10, '#ffe055');
    p.stroke([p0, p1], 4, INK);
  }
  g.restore();
};

/** Question / exclamation reaction badge */
export const fxExclaim = (p, wobble = 0) => {
  const g = p.g;
  g.save();
  g.translate(300, 500);
  g.rotate(wobble * 0.12);
  g.font = '900 220px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 26;
  g.strokeStyle = INK;
  g.strokeText('?!', 0, 0);
  g.fillStyle = '#ff5247';
  g.fillText('?!', 0, 0);
  g.restore();
};
