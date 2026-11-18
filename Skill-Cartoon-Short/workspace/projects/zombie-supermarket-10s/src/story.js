/**
 * New Original 10-Second Proof Story: "Sold Out at Fresh-Mart" (300 frames @ 30 FPS = 10.00 s)
 * Classification: NEW IMPLEMENTATION CODE (SHORT-01 Phase G)
 *
 * Exercises the real Three.js + Toon + Ink + DOF + Pen 2D card pipeline and engine/motion.js helpers:
 * - New 3D supermarket environment (checkered floor, stocked aisles, hero empty shelf, sliding doors,
 *   swinging ceiling sign, flickering fluorescent tubes, rolling tin can prop)
 * - Distinct character pose & expression progression (shamble/eager -> reach/confused -> scream close-up -> slump despair)
 * - Camera movement, whip/flash transition, shallow-DOF close-ups, continuous secondary motion, clear visual ending.
 */
import { M as EASE, blinkAt, camFromKeys, clamp, idle, lerp, q, ramp, walk } from './motion.js';
import {
  aisleSignCanvas,
  linoleumTiles,
  makeClampedTex,
  shelfMetal,
  soldOutPlacardCanvas,
  storeHeaderCanvas,
} from './paint-supermarket.js';

export const FPS = 30;
export const TOTAL = 300;
export const DECK = 0;

export const SHOTS = [
  { id: 'enter', a: 0, b: 74, light: 'storeBright' },
  { id: 'search', a: 75, b: 144, light: 'storeBright' },
  { id: 'emptyShelf', a: 145, b: 194, light: 'aisleSpot' },
  { id: 'reactionCloseup', a: 195, b: 249, light: 'dramaticFlicker' },
  { id: 'endingSlump', a: 250, b: 299, light: 'melancholyCool' },
];

export const shotAt = (f) => SHOTS.find((s) => f >= s.a && f <= s.b) || SHOTS[SHOTS.length - 1];

export const LIGHTS = {
  storeBright: {
    az: 125,
    el: 58,
    sky: '#e8f4fa',
    ground: '#9ab0b8',
    hemi: 1.32,
    sun: '#fffaf0',
    sunI: 2.1,
    fog: '#dcebf2',
    fogNear: 18,
    fogFar: 95,
    skyTop: '#243b55',
    skyHor: '#4b6cb7',
    sat: 1.12,
    vig: 0.18,
    shadowExt: 10,
  },
  aisleSpot: {
    az: 145,
    el: 52,
    sky: '#dcecf5',
    ground: '#8fa3ad',
    hemi: 1.18,
    sun: '#fff2d8',
    sunI: 2.45,
    fog: '#d5e4ec',
    fogNear: 14,
    fogFar: 80,
    skyTop: '#1f3247',
    skyHor: '#3d5a80',
    sat: 1.06,
    vig: 0.28,
    shadowExt: 8,
  },
  dramaticFlicker: {
    az: 160,
    el: 48,
    sky: '#d2e2f2',
    ground: '#707e94',
    hemi: 1.05,
    sun: '#ffe4cc',
    sunI: 2.6,
    fog: '#c4d4e6',
    fogNear: 12,
    fogFar: 70,
    skyTop: '#1a2639',
    skyHor: '#324a6d',
    sat: 1.18,
    gain: '#fff4ee',
    vig: 0.34,
    shadowExt: 7,
  },
  melancholyCool: {
    az: 115,
    el: 62,
    sky: '#c8dcf0',
    ground: '#788c9c',
    hemi: 1.12,
    sun: '#e6f2ff',
    sunI: 1.95,
    fog: '#c8dce8',
    fogNear: 14,
    fogFar: 85,
    skyTop: '#18283c',
    skyHor: '#2d4666',
    sat: 1.02,
    vig: 0.3,
    shadowExt: 10,
  },
};

export const lightFor = (S, f) => {
  const L = { ...LIGHTS[S.light] };
  // Continuous secondary fluorescent tube hum/flicker, heightened in reactionCloseup
  const subtleHum = 0.03 * Math.sin(f * 0.7);
  if (S.id === 'reactionCloseup') {
    const flicker = (f === 203 || f === 204 || f === 226 || f === 227) ? -0.55 : 0.12 * Math.sin(f * 1.9);
    L.sunI = Math.max(0.9, L.sunI + flicker);
    L.hemi = Math.max(0.75, L.hemi + flicker * 0.35);
  } else {
    L.sunI += subtleHum;
  }
  return L;
};

const CAM_KEYS = {
  enter: [
    { f: 0, pos: [0.12, 1.52, 2.95], look: [0.0, 1.38, -5.8], fov: 46 },
    { f: 42, pos: [0.05, 1.48, 3.05], look: [0.0, 1.32, -2.6], fov: 44, ease: 'smooth' },
    { f: 74, pos: [-0.35, 1.45, 2.85], look: [0.15, 1.26, -0.4], fov: 41, ease: 'smooth' },
  ],
  search: [
    { f: 75, pos: [-2.25, 1.46, 2.55], look: [0.74, 1.22, -0.14], fov: 44 },
    { f: 112, pos: [-2.05, 1.42, 2.25], look: [0.82, 1.16, -0.10], fov: 42, ease: 'smooth' },
    { f: 144, pos: [-1.92, 1.34, 2.08], look: [0.86, 1.02, -0.06], fov: 41, ease: 'easeOut' },
  ],
  emptyShelf: [
    { f: 145, pos: [-0.45, 1.48, 0.52], look: [1.88, 1.48, -0.24], fov: 36 },
    { f: 194, pos: [-0.02, 1.48, 0.16], look: [1.91, 1.49, -0.24], fov: 30, roll: 1.8, ease: 'smooth' },
  ],
  reactionCloseup: [
    { f: 195, pos: [-0.88, 1.37, 1.24], look: [0.25, 1.31, -0.22], fov: 34, roll: -2.2 },
    { f: 215, pos: [-0.68, 1.35, 0.96], look: [0.25, 1.32, -0.22], fov: 30.0, roll: -3.8, ease: 'back' },
    { f: 249, pos: [-0.62, 1.34, 0.88], look: [0.25, 1.32, -0.22], fov: 29.0, roll: -3.2, ease: 'smooth' },
  ],
  endingSlump: [
    { f: 250, pos: [-1.65, 1.22, 2.45], look: [0.35, 1.02, -0.22], fov: 40 },
    { f: 299, pos: [-2.15, 1.82, 3.45], look: [0.38, 1.05, -0.22], fov: 43, roll: 1.5, ease: 'smooth' },
  ],
};

const KICKS = [
  { f: 108, a: 0.025 }, // tin can hits linoleum floor
  { f: 145, a: 0.045 }, // whip-transition reveal onto SOLD OUT placard
  { f: 196, a: 0.05 },  // close-up scream impact
  { f: 258, a: 0.035 }, // zombie drops to knees
];

export const camAt = (f) => {
  const S = shotAt(f);
  const c = camFromKeys(CAM_KEYS[S.id], f, { creep: 0.001, kicks: KICKS });
  // Crisp motivated transition flash between Shot 2 (search) -> Shot 3 (emptyShelf) and into Shot 4 (reaction)
  c.flash =
    f >= 145 && f < 150
      ? (1 - (f - 145) / 5) * 0.72
      : f >= 195 && f < 198
        ? (1 - (f - 195) / 3) * 0.38
        : 0;
  c.shadowAt = [0.4, 0.8, -0.5];
  return c;
};

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const dofAt = (f) => {
  const S = shotAt(f);
  const C = camAt(f);
  switch (S.id) {
    case 'enter': {
      const zPos = lerp(-5.2, -0.35, EASE.smooth(ramp(f, 0, 72)));
      return { focus: dist3(C.pos, [0.05, 1.35, zPos]), cinf: 5.5 };
    }
    case 'search':
      return { focus: dist3(C.pos, [0.65, 1.3, -0.22]), cinf: 7.5 };
    case 'emptyShelf':
      return { focus: dist3(C.pos, [1.52, 1.34, -0.22]), cinf: 11.5 };
    case 'reactionCloseup':
      return { focus: dist3(C.pos, [0.25, 1.52, -0.22]), cinf: 14.0, near: 1.0 };
    case 'endingSlump':
      return { focus: dist3(C.pos, [0.28, 0.95, -0.22]), cinf: 6.5 };
  }
  return { focus: 4, cinf: 0 };
};

export const worldAt = (f) => {
  // Automatic entrance doors open as zombie enters (frames 0..55), glide shut later (frames 230..290)
  const openIn = EASE.smooth(ramp(f, 2, 34));
  const closeOut = EASE.smooth(ramp(f, 235, 285));
  const doorOpen = clamp(openIn * (1 - closeOut), 0, 1);

  // Physical action: tin can on hero shelf nudged at f=100, falls & bounces onto floor, rolls to rest
  let canState;
  if (f < 98) {
    canState = { x: 1.32, y: 1.30, z: -0.05, rx: 0, rz: 0.08 * Math.sin(f * 0.2) };
  } else if (f < 108) {
    const u = (f - 98) / 10;
    canState = {
      x: lerp(1.32, 0.96, u),
      y: 1.30 - 1.18 * u * u,
      z: lerp(-0.05, 0.08, u),
      rx: u * 2.4,
      rz: Math.PI * 0.5 * u,
    };
  } else {
    const t = (f - 108) / 30;
    const bounce = Math.abs(Math.sin(t * 7.5)) * Math.exp(-t * 4.2) * 0.28;
    const rollDist = Math.min(0.62, t * 0.55);
    canState = {
      x: 0.96 - rollDist,
      y: 0.12 + bounce,
      z: 0.08 + rollDist * 0.38,
      rx: 2.4 + rollDist * 7.5,
      rz: Math.PI * 0.5,
    };
  }

  return {
    doorOpen,
    signSwing: Math.sin(f * 0.095) * 0.055,
    fanSpin: f * 0.28,
    tubeFlicker: f === 203 || f === 204 || f === 226 || f === 227 ? 0.2 : 1.0,
    canState,
  };
};

export function buildWorld({ THREE, P, scene, toon, texM, add, box, tbox }) {
  const root = new THREE.Group();
  scene.add(root);

  const floorMat = texM(linoleumTiles(101), 7, 9);
  const shelfMat = texM(shelfMetal(102), 1, 1);
  const wallMat = toon({ color: '#eef4f7' });
  const trimTeal = toon({ color: '#247ba0' });
  const trimCoral = toon({ color: '#e85d56' });
  const chromeMat = toon({ color: '#b8c4cc' });
  const darkFrame = toon({ color: '#2b3945' });
  const glassMat = new THREE.MeshBasicMaterial({
    color: '#bce8ff',
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const ceilingMat = toon({ color: '#dde6ec' });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: '#fffef2' });
  const signFaceMat = new THREE.MeshToonMaterial({ map: makeClampedTex(aisleSignCanvas()) });
  const placardMat = new THREE.MeshToonMaterial({ map: makeClampedTex(soldOutPlacardCanvas()) });
  const headerMat = new THREE.MeshToonMaterial({ map: makeClampedTex(storeHeaderCanvas()) });

  // 1. Checkered supermarket floor + ceiling + side/back walls
  const floor = add(new THREE.PlaneGeometry(16, 22), floorMat, 0, 0, -1, root, { cast: false });
  floor.rotation.x = -Math.PI / 2;

  const ceiling = add(new THREE.PlaneGeometry(16, 22), ceilingMat, 0, 4.6, -1, root, { cast: false });
  ceiling.rotation.x = Math.PI / 2;

  add(tbox(16, 4.6, 0.25, 2), wallMat, 0, 2.3, 8.5, root, { cast: false });
  for (const sx of [-1, 1]) {
    add(tbox(0.25, 4.6, 20, 2), wallMat, sx * 6.8, 2.3, -1, root, { cast: false });
    add(tbox(0.28, 0.35, 20, 2), trimTeal, sx * 6.65, 1.1, -1, root, { cast: false });
  }

  // Back wall framing automatic glass doors at z = -8.0
  for (const sx of [-1, 1]) {
    add(tbox(4.6, 4.6, 0.28, 2), wallMat, sx * 4.5, 2.3, -8.0, root);
  }
  add(tbox(4.4, 1.5, 0.3, 2), wallMat, 0, 3.85, -8.0, root);
  const storeBanner = add(box(3.8, 0.85, 0.08), headerMat, 0, 3.65, -7.82, root, { cast: false });
  storeBanner.userData.ndSkip = false;

  // Automatic sliding doors
  const doorGroup = new THREE.Group();
  doorGroup.position.set(0, 0, -7.95);
  root.add(doorGroup);

  const makeDoorLeaf = (side) => {
    const g = new THREE.Group();
    add(box(1.12, 2.95, 0.08), chromeMat, 0, 1.48, 0, g);
    const pane = add(box(0.96, 2.65, 0.1), glassMat, 0, 1.48, 0, g, { cast: false });
    pane.userData.ndSkip = true;
    add(box(0.98, 0.14, 0.11), trimCoral, 0, 1.35, 0, g);
    g.position.x = side * 0.58;
    doorGroup.add(g);
    return g;
  };
  const doorL = makeDoorLeaf(-1);
  const doorR = makeDoorLeaf(1);

  // 2. Stocked left grocery aisle (x = -2.55) & background right shelf bays (x = +2.65, z < -1.8)
  const prodPalette = ['#f25f5c', '#ffe066', '#247ba0', '#70c1b3', '#f79d65', '#9b5de5'];
  const rProd = P.rng(202);

  const buildStockedGondola = (gx, gz, lenZ) => {
    const g = new THREE.Group();
    g.position.set(gx, 0, gz);
    root.add(g);
    add(box(0.14, 2.35, lenZ), darkFrame, 0, 1.18, 0, g);
    for (const tierY of [0.22, 0.78, 1.32, 1.86]) {
      add(box(0.95, 0.06, lenZ), shelfMat, 0, tierY, 0, g);
      const slots = Math.floor(lenZ / 0.34);
      for (let i = 0; i < slots; i++) {
        const pz = -lenZ * 0.45 + i * 0.34;
        const col = toon({ color: prodPalette[(i + Math.floor(tierY * 5)) % prodPalette.length] });
        for (const side of [-1, 1]) {
          const h = 0.24 + rProd() * 0.14;
          if (rProd() > 0.35) {
            add(box(0.22, h, 0.24), col, side * 0.28, tierY + 0.03 + h / 2, pz, g);
          } else {
            add(new THREE.CylinderGeometry(0.09, 0.09, h, 10), col, side * 0.28, tierY + 0.03 + h / 2, pz, g);
          }
        }
      }
    }
    // Coral endcap header
    add(box(1.0, 0.32, 0.12), trimCoral, 0, 2.2, lenZ / 2, g);
  };

  buildStockedGondola(-1.95, -2.4, 7.2);
  buildStockedGondola(2.05, -4.7, 3.6);

  // 3. HERO EMPTY SHELF BAY at (x = 1.68, z = -0.22), facing -x toward center aisle!
  const heroShelf = new THREE.Group();
  heroShelf.position.set(1.68, 0, -0.22);
  root.add(heroShelf);

  // Backboard & side uprights
  add(box(0.12, 2.45, 2.35), darkFrame, 0.32, 1.225, 0, heroShelf);
  for (const sz of [-1.14, 1.14]) {
    add(box(0.76, 2.45, 0.08), trimTeal, 0.0, 1.225, sz, heroShelf);
  }
  // Top canopy with "AISLE 4" trim
  add(box(0.82, 0.22, 2.38), trimCoral, -0.02, 2.38, 0, heroShelf);

  // Four bare shelves (completely stripped of brains!)
  for (const tierY of [0.22, 0.76, 1.24, 1.78]) {
    add(box(0.74, 0.06, 2.24), shelfMat, -0.04, tierY, 0, heroShelf);
  }

  // Prominent "SOLD OUT — NO BRAINS LEFT" placard mounted on the bare middle shelf backplane
  const placard = add(box(0.05, 0.42, 0.68), placardMat, 0.23, 1.52, -0.02, heroShelf);
  placard.rotation.z = 0.03;

  // 4. Rolling tin can prop (falls off shelf in Shot 2!)
  const canGroup = new THREE.Group();
  scene.add(canGroup);
  add(new THREE.CylinderGeometry(0.085, 0.085, 0.21, 14), toon({ color: '#e8453c' }), 0, 0, 0, canGroup);
  add(new THREE.CylinderGeometry(0.088, 0.088, 0.03, 14), chromeMat, 0, 0.095, 0, canGroup);
  add(new THREE.CylinderGeometry(0.088, 0.088, 0.03, 14), chromeMat, 0, -0.095, 0, canGroup);

  // 5. Swinging overhead "AISLE 4 — ORGANIC BRAINZ — 100% SOLD OUT!" hanging sign
  const signPivot = new THREE.Group();
  signPivot.position.set(0.0, 4.35, -1.85);
  root.add(signPivot);
  for (const sx of [-0.85, 0.85]) {
    add(new THREE.CylinderGeometry(0.02, 0.02, 1.15, 6), chromeMat, sx, -0.57, 0, signPivot, { cast: false });
  }
  add(box(2.15, 0.78, 0.1), signFaceMat, 0, -1.42, 0, signPivot);

  // 6. Ceiling fluorescent fixtures + spinning aisle ventilation fan (continuous secondary motion)
  const heroTubeMat = lampGlowMat.clone();
  for (const zLamp of [-6.0, -3.0, 0.0, 3.0]) {
    const fg = new THREE.Group();
    fg.position.set(0, 4.52, zLamp);
    root.add(fg);
    add(box(1.5, 0.08, 0.36), chromeMat, 0, 0, 0, fg, { cast: false });
    const tube = add(box(1.36, 0.05, 0.24), zLamp === 0.0 ? heroTubeMat : lampGlowMat, 0, -0.05, 0, fg, {
      cast: false,
    });
    tube.userData.ndSkip = true;
  }

  const ceilingFan = new THREE.Group();
  ceilingFan.position.set(-0.8, 4.35, -3.2);
  root.add(ceilingFan);
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10), chromeMat, 0, 0.1, 0, ceilingFan, { cast: false });
  for (let b = 0; b < 4; b++) {
    const blade = add(box(0.85, 0.03, 0.14), trimTeal, 0, 0, 0, ceilingFan, { cast: false });
    blade.rotation.y = (b * Math.PI) / 2;
    blade.position.set(Math.cos((b * Math.PI) / 2) * 0.42, -0.02, Math.sin((b * Math.PI) / 2) * 0.42);
  }

  return {
    clouds: [],
    updateWorld(S) {
      doorL.position.x = -0.58 - S.doorOpen * 0.96;
      doorR.position.x = 0.58 + S.doorOpen * 0.96;
      signPivot.rotation.x = S.signSwing;
      ceilingFan.rotation.y = S.fanSpin;
      heroTubeMat.color.setScalar(0.35 + 0.65 * S.tubeFlicker);
      if (S.canState) {
        canGroup.position.set(S.canState.x, S.canState.y, S.canState.z);
        canGroup.rotation.set(S.canState.rx || 0, 0.35, S.canState.rz || 0);
      }
    },
  };
}

export const actorsAt = (f, T) => {
  const S = shotAt(f);
  const out = [];
  const idl = idle(f, 17);
  const blk = blinkAt(f, 17);

  const pushZombie = (opts, pos, extra = {}) => {
    const quantized = {
      seed: 17,
      bob: q(idl.bob, 3),
      tilt: q(idl.tilt, 1),
      headTilt: q(idl.headTilt, 1),
      blink: blk,
      ...opts,
    };
    out.push({
      key: 'zombie:' + JSON.stringify(quantized),
      draw: (p) => T.zombieFront(p, quantized),
      x: pos[0],
      y: pos[1],
      z: pos[2],
      ground: 0,
      ...extra,
    });
  };

  switch (S.id) {
    case 'enter': {
      const w = walk(f, 0, 2.2, 0.72);
      const zPos = clamp(-5.6 + w.dist, -5.6, -0.32);
      pushZombie(
        {
          expr: 'zombie_eager',
          L: 'shamble',
          R: 'shamble',
          step: q(w.phase, 2),
          look: q(0.35 * Math.sin(f * 0.14), 1),
        },
        [0.05, 0, zPos]
      );
      break;
    }
    case 'search': {
      const reachAmt = EASE.smooth(ramp(f, 82, 102));
      const postKnock = f >= 108;
      pushZombie(
        {
          expr: postKnock ? 'zombie_confused' : 'zombie_eager',
          facing: 1,
          L: 'hang',
          R: 'reach',
          reachLift: q(reachAmt, 2),
          look: 0.7,
          headTilt: q(postKnock ? -6 : 4 * Math.sin(f * 0.2), 1),
        },
        [0.32, 0, -0.22]
      );
      break;
    }
    case 'emptyShelf': {
      // Zombie visible slightly out-of-focus in foreground left edge while camera focuses on bare shelf
      pushZombie(
        {
          expr: 'zombie_confused',
          facing: 1,
          L: 'hang',
          R: 'hang',
          look: 0.8,
        },
        [-0.35, 0, -0.58]
      );
      break;
    }
    case 'reactionCloseup': {
      const jit = f > 202 ? (f % 2 === 0 ? 0.012 : -0.012) : 0;
      pushZombie(
        {
          expr: 'zombie_scream',
          facing: 0,
          blink: 0,
          L: 'cheek',
          R: 'cheek',
          headTilt: q(4.5 * Math.sin(f * 0.85), 1),
          bob: q(0.018 * Math.abs(Math.sin(f * 0.6)), 3),
        },
        [0.25, 0, -0.22 + jit],
        { order: 3 }
      );
      break;
    }
    case 'endingSlump': {
      const sl = EASE.easeOut(ramp(f, 252, 272));
      pushZombie(
        {
          expr: 'zombie_despair',
          facing: 0,
          blink: 0,
          L: 'up',
          R: 'up',
          slump: q(sl, 2),
          tears: f >= 262,
          headTilt: q(7 * Math.sin(f * 0.25), 1),
        },
        [0.25, 0, -0.22]
      );
      break;
    }
  }
  return out;
};

const FX = (key, draw, pos, s, extra = {}) => ({
  key,
  draw,
  x: pos[0],
  y: pos[1],
  z: pos[2],
  s,
  blob: false,
  shadow: false,
  order: 5,
  ...extra,
});

export const fxAt = (f, T) => {
  const S = shotAt(f);
  const out = [];

  // Dust puff when knocked tin can hits floor & shelf dust lifts
  if (S.id === 'search' && f >= 108 && f < 126) {
    const k = q((f - 108) / 18, 2);
    out.push(FX('canDust:' + k, (p) => T.fxDust(p, k, '#dce6eb'), [0.85, 0.08, 0.12], 0.35));
  }

  // Question/exclamation badge in emptyShelf reveal
  if (S.id === 'emptyShelf' && f >= 156) {
    const wob = q(Math.sin(f * 0.45), 1);
    out.push(FX('exclaim:' + wob, (p) => T.fxExclaim(p, wob), [1.22, 1.62, 0.18], 0.34));
  }

  // Comic shock rays + flying sweat drops during extreme reaction close-up
  if (S.id === 'reactionCloseup') {
    const ph = q((f - 195) % 6, 0);
    out.push(FX('rays:' + ph, (p) => T.fxShockRays(p, ph), [0.35, 0.62, -0.22], 0.95, { order: 2 }));
    for (const [side, seedOff] of [
      [-1, 0],
      [1, 0.45],
    ]) {
      const cyc = ((f - 195) * 0.06 + seedOff) % 1;
      out.push(
        FX(
          'sweat',
          (p) => T.fxDrip(p),
          [0.25, 1.72 - cyc * 0.38, -0.22 + side * (0.28 + cyc * 0.18)],
          0.14
        )
      );
    }
  }

  // Dramatic cartoon gloom puff on kneel impact in endingSlump
  if (S.id === 'endingSlump' && f >= 256 && f < 276) {
    const k = q((f - 256) / 20, 2);
    out.push(FX('slumpPuff:' + k, (p) => T.fxDust(p, k, '#cfdbe3'), [0.25, 0.04, -0.15], 0.52));
  }

  return out;
};
