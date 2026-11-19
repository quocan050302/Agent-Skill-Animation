/**
 * NEW 30-Second Original Demo: "The Fake Army That Fooled the Nazis"
 * 900 frames @ 30 FPS = 30.00 seconds | 9:16 Native 1080x1920 | Three.js r160 + Pen 2D + Ink + 48-tap DOF
 * Classification: NEW IMPLEMENTATION CODE (QA-TTS-01 Phase 6)
 *
 * Historical inspiration: U.S. Army 23rd Headquarters Special Troops ("The Ghost Army", 1944).
 * 7 cohesive dynamic scenes synchronized to the real English spoken narration:
 *   1. hookSearchlight  (0..99,   0.00-3.30s): Night fog + sweeping searchlight reveals wobbling inflatable tank!
 *   2. scoutBinoculars  (100..244,3.33-8.13s): Ridge scouts peer through binoculars at decoy tank column.
 *   3. inflateRubber    (245..359,8.17-11.97s): 1944 U.S. engineers pump & effortlessly lift rubber Sherman tank!
 *   4. sonicTrucks      (360..476,12.00-15.87s): Camouflaged sound truck blasts stylized acoustic waves into dusk.
 *   5. spoofRadio       (477..563,15.90-18.77s): Field radio operator taps fake chatter as decoy convoy lights pass.
 *   6. impersonateTwist (564..797,18.80-26.57s): Wide crane pullback reveals small crew running massive decoy field.
 *   7. deceptionReveal  (798..899,26.60-29.97s): Iconic closing reveal beside bouncing rubber tank & Ghost Army crate.
 */
import { M as EASE, blinkAt, camFromKeys, clamp, idle, lerp, q, ramp, walk } from './motion.js';
import {
  crateStencilCanvas,
  dirtRoadTex,
  fieldGrassMud,
  makeClampedTex,
  radioFaceplateCanvas,
  rubberTankHull,
  tankTreadTex,
} from './paint-ghost.js';

export const FPS = 30;
export const TOTAL = 900;
export const DECK = 0;

export const SHOTS = [
  { id: 'hookSearchlight', a: 0, b: 99, light: 'nightSearchlight' },
  { id: 'scoutBinoculars', a: 100, b: 244, light: 'blueMist' },
  { id: 'inflateRubber', a: 245, b: 359, light: 'crispDay' },
  { id: 'sonicTrucks', a: 360, b: 476, light: 'amberDusk' },
  { id: 'spoofRadio', a: 477, b: 563, light: 'radioTwilight' },
  { id: 'impersonateTwist', a: 564, b: 797, light: 'goldenReveal' },
  { id: 'deceptionReveal', a: 798, b: 899, light: 'dawnHero' },
];

export const shotAt = (f) => SHOTS.find((s) => f >= s.a && f <= s.b) || SHOTS[SHOTS.length - 1];

export const LIGHTS = {
  nightSearchlight: {
    az: 135,
    el: 34,
    sky: '#4b6b94',
    ground: '#2d3a34',
    hemi: 0.92,
    sun: '#ffe8a8',
    sunI: 2.35,
    fog: '#354861',
    fogNear: 12,
    fogFar: 62,
    skyTop: '#162438',
    skyHor: '#3a5373',
    sat: 1.08,
    vig: 0.32,
    shadowExt: 14,
  },
  blueMist: {
    az: 112,
    el: 42,
    sky: '#7c9ec2',
    ground: '#48594c',
    hemi: 1.12,
    sun: '#e8f1ff',
    sunI: 2.05,
    fog: '#6e89a8',
    fogNear: 16,
    fogFar: 75,
    skyTop: '#243a54',
    skyHor: '#5d7c9c',
    sat: 1.04,
    vig: 0.25,
    shadowExt: 14,
  },
  crispDay: {
    az: 142,
    el: 54,
    sky: '#c9e4f5',
    ground: '#6d7a59',
    hemi: 1.32,
    sun: '#fff6de',
    sunI: 2.55,
    fog: '#b8d3e3',
    fogNear: 20,
    fogFar: 90,
    skyTop: '#2f6594',
    skyHor: '#8ab8d6',
    sat: 1.14,
    vig: 0.18,
    shadowExt: 12,
  },
  amberDusk: {
    az: 165,
    el: 28,
    sky: '#d99b6a',
    ground: '#4f543e',
    hemi: 1.12,
    sun: '#ffd08a',
    sunI: 2.65,
    fog: '#8a6b58',
    fogNear: 14,
    fogFar: 68,
    skyTop: '#2b3152',
    skyHor: '#c97b54',
    sat: 1.16,
    vig: 0.26,
    shadowExt: 14,
  },
  radioTwilight: {
    az: 128,
    el: 36,
    sky: '#6b85a8',
    ground: '#3d4539',
    hemi: 1.04,
    sun: '#ffe099',
    sunI: 2.4,
    fog: '#485c75',
    fogNear: 12,
    fogFar: 62,
    skyTop: '#1b2840',
    skyHor: '#4d6787',
    sat: 1.12,
    vig: 0.3,
    shadowExt: 10,
  },
  goldenReveal: {
    az: 148,
    el: 46,
    sky: '#f0d8a8',
    ground: '#6b754f',
    hemi: 1.28,
    sun: '#ffefc2',
    sunI: 2.6,
    fog: '#c9bfa0',
    fogNear: 22,
    fogFar: 96,
    skyTop: '#31577d',
    skyHor: '#d9b578',
    sat: 1.15,
    vig: 0.2,
    shadowExt: 16,
  },
  dawnHero: {
    az: 152,
    el: 40,
    sky: '#e8d0a2',
    ground: '#5d6b47',
    hemi: 1.26,
    sun: '#ffe8ad',
    sunI: 2.75,
    fog: '#b8b29b',
    fogNear: 18,
    fogFar: 88,
    skyTop: '#264466',
    skyHor: '#cf9e67',
    sat: 1.18,
    vig: 0.22,
    shadowExt: 12,
  },
};

export const lightFor = (S, f) => {
  const L = { ...LIGHTS[S.light] };
  if (S.id === 'hookSearchlight') {
    L.az = 115 + 45 * Math.sin(f * 0.045);
    L.sunI += 0.25 * Math.sin(f * 0.09);
  } else if (S.id === 'sonicTrucks') {
    L.sunI += 0.18 * Math.abs(Math.sin(f * 0.45));
  } else if (S.id === 'spoofRadio') {
    L.sunI += 0.14 * Math.sin(f * 0.6);
  }
  return L;
};

const CAM_KEYS = {
  hookSearchlight: [
    { f: 0, pos: [-2.8, 1.95, 5.4], look: [0.0, 1.15, -0.6], fov: 44 },
    { f: 52, pos: [-1.85, 1.78, 4.45], look: [0.0, 1.18, -0.35], fov: 41, ease: 'smooth' },
    { f: 99, pos: [-1.45, 1.68, 3.95], look: [0.0, 1.25, -0.2], fov: 38, roll: 1.4, ease: 'easeOut' },
  ],
  scoutBinoculars: [
    { f: 100, pos: [-11.4, 2.28, 3.8], look: [-9.2, 1.48, 0.65], fov: 42 },
    { f: 168, pos: [-10.5, 2.08, 2.95], look: [-8.9, 1.54, 0.68], fov: 36, ease: 'smooth' },
    { f: 244, pos: [-9.85, 1.96, 2.55], look: [-8.85, 1.58, 0.72], fov: 33, roll: -1.6, ease: 'back' },
  ],
  inflateRubber: [
    { f: 245, pos: [2.85, 1.52, 4.35], look: [0.1, 1.25, -0.15], fov: 44 },
    { f: 300, pos: [2.25, 1.48, 3.85], look: [0.05, 1.42, -0.15], fov: 41, ease: 'smooth' },
    { f: 359, pos: [1.95, 1.62, 3.55], look: [0.0, 1.65, -0.15], fov: 39, roll: 1.4, ease: 'easeOut' },
  ],
  sonicTrucks: [
    { f: 360, pos: [6.4, 2.38, 4.9], look: [10.4, 1.65, -0.25], fov: 48 },
    { f: 418, pos: [7.1, 2.25, 4.15], look: [10.45, 1.72, -0.3], fov: 44, ease: 'smooth' },
    { f: 476, pos: [7.45, 2.28, 3.75], look: [10.5, 1.78, -0.35], fov: 42, roll: -1.3, ease: 'smooth' },
  ],
  spoofRadio: [
    { f: 477, pos: [-14.2, 1.88, 12.6], look: [-12.0, 1.35, 9.2], fov: 40 },
    { f: 522, pos: [-13.4, 1.78, 11.75], look: [-12.0, 1.32, 9.2], fov: 36, ease: 'smooth' },
    { f: 563, pos: [-13.0, 1.74, 11.35], look: [-12.0, 1.32, 9.2], fov: 34, roll: 1.1, ease: 'easeOut' },
  ],
  impersonateTwist: [
    { f: 564, pos: [-1.8, 1.85, 5.0], look: [0.2, 1.25, -0.8], fov: 44 },
    { f: 680, pos: [-3.8, 3.55, 8.2], look: [0.3, 1.15, -2.8], fov: 48, ease: 'smooth' },
    { f: 797, pos: [-4.6, 4.65, 10.4], look: [0.5, 1.1, -3.6], fov: 50, ease: 'smooth' },
  ],
  deceptionReveal: [
    { f: 798, pos: [0.2, 1.55, 4.9], look: [0.15, 1.32, 0.3], fov: 43 },
    { f: 848, pos: [0.05, 1.48, 4.25], look: [0.15, 1.36, 0.2], fov: 39, ease: 'smooth' },
    { f: 899, pos: [-0.05, 1.48, 4.05], look: [0.15, 1.38, 0.2], fov: 38, roll: 0.7, ease: 'smooth' },
  ],
};

const KICKS = [
  { f: 64, a: 0.032 },  // hero rubber tank wobbles under searchlight
  { f: 182, a: 0.03 },  // scout shock reaction
  { f: 295, a: 0.04 },  // engineer lifts whole rubber tank overhead!
  { f: 388, a: 0.042 }, // acoustic speaker blast pulse
  { f: 428, a: 0.042 }, // second acoustic shock pulse
  { f: 800, a: 0.025 }, // closing reveal punch-in
];

export const camAt = (f) => {
  const S = shotAt(f);
  const c = camFromKeys(CAM_KEYS[S.id], f, { creep: 0.0012, kicks: KICKS });
  c.flash =
    (f >= 245 && f < 249)
      ? (1 - (f - 245) / 4) * 0.45
      : (f >= 798 && f < 801)
        ? (1 - (f - 798) / 3) * 0.35
        : 0;
  if (S.id === 'scoutBinoculars') c.shadowAt = [-9.0, 1.2, 0.8];
  else if (S.id === 'sonicTrucks') c.shadowAt = [10.4, 1.2, -0.4];
  else if (S.id === 'spoofRadio') c.shadowAt = [-12.0, 1.0, 9.2];
  else c.shadowAt = [0.2, 1.0, -0.4];
  return c;
};

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const dofAt = (f) => {
  const S = shotAt(f);
  const C = camAt(f);
  switch (S.id) {
    case 'hookSearchlight':
      return { focus: dist3(C.pos, [0.0, 1.15, -0.2]), cinf: 6.5 };
    case 'scoutBinoculars':
      return { focus: dist3(C.pos, [-8.9, 1.45, 0.7]), cinf: 8.0 };
    case 'inflateRubber':
      return { focus: dist3(C.pos, [0.0, 1.35, -0.15]), cinf: 6.2 };
    case 'sonicTrucks':
      return { focus: dist3(C.pos, [10.4, 1.65, -0.3]), cinf: 6.8 };
    case 'spoofRadio':
      return { focus: dist3(C.pos, [-12.0, 1.3, 9.2]), cinf: 8.5 };
    case 'impersonateTwist':
      return { focus: dist3(C.pos, [0.5, 1.2, -1.8]), cinf: 4.0 };
    default:
      return { focus: dist3(C.pos, [0.15, 1.35, 0.6]), cinf: 7.2 };
  }
};

export const worldAt = (f) => {
  const S = shotAt(f);
  const searchSwing = Math.sin(f * 0.048) * 0.52;

  // Rubber tank squish/inflation/lift physics driven per shot
  let heroTankScale = [1, 1, 1];
  let heroTankY = 0;
  let heroTankRotZ = 0;
  let heroTankRotX = 0;
  if (S.id === 'hookSearchlight') {
    const wob = f >= 60 ? Math.sin((f - 60) * 0.42) * 0.14 : Math.sin(f * 0.12) * 0.025;
    heroTankScale = [1 + wob * 0.5, 1 - wob * 0.45, 1 + wob * 0.35];
    heroTankRotZ = wob * 0.45;
  } else if (S.id === 'inflateRubber') {
    const inf = EASE.smooth(ramp(f, 248, 286));
    const lift = EASE.back(ramp(f, 290, 326));
    const wobble = Math.sin(f * 0.38) * 0.09;
    heroTankScale = [0.72 + inf * 0.28 + wobble * 0.35, 0.48 + inf * 0.52 - wobble * 0.25, 0.85 + inf * 0.15];
    heroTankY = lift * 1.18 + Math.sin(f * 0.26) * 0.06 * lift;
    heroTankRotZ = lift * 0.22 + wobble * 0.55;
    heroTankRotX = lift * -0.08;
  } else if (S.id === 'impersonateTwist') {
    const bounce = Math.abs(Math.sin(f * 0.16)) * 0.22;
    heroTankY = 0.52 + bounce;
    heroTankRotZ = Math.sin(f * 0.16) * 0.14;
  } else if (S.id === 'deceptionReveal') {
    const bob = Math.sin(f * 0.18) * 0.06;
    heroTankScale = [1 + bob * 0.5, 1 - bob * 0.45, 1];
    heroTankY = 0.05 + Math.abs(bob) * 0.5;
    heroTankRotZ = 0.11 + bob * 0.5;
  }

  // Convoy headlights moving along ridge road in spoofRadio + scoutBinoculars
  const convoyPhase = (f * 0.015) % 1;
  const speakerPulse = S.id === 'sonicTrucks' ? 1 + 0.14 * Math.abs(Math.sin(f * 0.55)) : 1;
  const antennaSway = Math.sin(f * 0.22) * 0.14;

  return {
    showSearchlight: S.id === 'hookSearchlight',
    searchSwing,
    heroTankScale,
    heroTankY,
    heroTankRotZ,
    heroTankRotX,
    convoyPhase,
    speakerPulse,
    antennaSway,
  };
};

export function buildWorld({ THREE, P, scene, toon, texM, add, box, tbox }) {
  const root = new THREE.Group();
  scene.add(root);

  const groundMat = texM(fieldGrassMud(401), 12, 12, '#d8e4c8');
  const roadMat = texM(dirtRoadTex(409), 2, 16, '#dfd0ba');
  const hullMat = toon({ map: makeClampedTex(rubberTankHull(402)) });
  const treadMat = texM(tankTreadTex(), 3, 1);
  const oliveDark = toon({ color: '#424e35' });
  const oliveMid = toon({ color: '#5c6b49' });
  const steelMat = toon({ color: '#454f57' });
  const woodMat = toon({ color: '#876844' });
  const pineMat = toon({ color: '#2d4732' });
  const trunkMat = toon({ color: '#594230' });
  const tentMat = toon({ color: '#787d56' });
  const radioFaceMat = new THREE.MeshToonMaterial({ map: makeClampedTex(radioFaceplateCanvas()) });
  const crateMat = new THREE.MeshToonMaterial({ map: makeClampedTex(crateStencilCanvas()) });
  const beamMat = new THREE.MeshBasicMaterial({
    color: '#ffe9a6',
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const headlightMat = new THREE.MeshBasicMaterial({ color: '#fff2b2' });

  // 1. European meadow terrain + dirt convoy road
  const ground = add(new THREE.PlaneGeometry(76, 76), groundMat, 0, 0, 0, root, { cast: false });
  ground.rotation.x = -Math.PI / 2;

  const road = add(new THREE.PlaneGeometry(3.2, 56), roadMat, 3.8, 0.015, -6, root, { cast: false });
  road.rotation.x = -Math.PI / 2;

  // Distant low hills for depth parallax
  for (const [hx, hz, rx, ry, rz] of [
    [-16, -24, 14, 4.2, 9],
    [4, -28, 18, 5.1, 10],
    [22, -22, 14, 3.8, 9],
  ]) {
    const hill = add(new THREE.SphereGeometry(1, 14, 10), oliveDark, hx, -0.4, hz, root, { cast: false });
    hill.scale.set(rx, ry, rz);
  }

  // Helper: Stylized 3D Inflatable Sherman Tank
  const makeInflatableTank = (x, z, rotY = 0, scale = 1) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    root.add(g);

    // Dual treads
    for (const sx of [-0.92, 0.92]) {
      add(box(0.46, 0.62, 2.75), treadMat, sx, 0.34, 0, g);
      for (let wz = -0.95; wz <= 0.96; wz += 0.48) {
        const wheel = add(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 12), steelMat, sx, 0.28, wz, g);
        wheel.rotation.z = Math.PI / 2;
      }
    }
    // Rounded plump rubber hull
    add(box(1.62, 0.78, 2.48), hullMat, 0, 0.84, 0, g);
    // Turret dome + cannon barrel
    add(new THREE.CylinderGeometry(0.62, 0.74, 0.58, 14), oliveMid, 0, 1.48, -0.05, g);
    const barrel = add(new THREE.CylinderGeometry(0.085, 0.11, 1.95, 10), oliveDark, 0, 1.54, 1.15, g);
    barrel.rotation.x = Math.PI / 2 - 0.08;
    // Hatch
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10), oliveDark, 0.18, 1.82, -0.18, g);
    return g;
  };

  // Hero inflatable tank at center staging field + background decoy rows
  const heroTank = makeInflatableTank(0.0, -0.35, 0.28, 1.0);
  const decoyTanks = [
    makeInflatableTank(-3.4, -4.6, 0.2, 0.95),
    makeInflatableTank(2.2, -5.2, 0.24, 0.95),
    makeInflatableTank(-1.2, -8.8, 0.16, 0.92),
    makeInflatableTank(4.6, -9.6, 0.26, 0.92),
    makeInflatableTank(-4.9, -9.2, 0.22, 0.9),
  ];

  // Sweeping searchlight beam tower (Shot 1 Hook — positioned left-back so beam sweeps cleanly over hero tank)
  const searchlightPivot = new THREE.Group();
  searchlightPivot.position.set(-4.6, 0.4, -3.4);
  root.add(searchlightPivot);
  add(new THREE.CylinderGeometry(0.32, 0.4, 0.6, 12), steelMat, 0, 0.3, 0, searchlightPivot);
  const beamCone = add(new THREE.ConeGeometry(1.75, 9.2, 16, 1, true), beamMat, 2.2, 1.35, 3.2, searchlightPivot, {
    cast: false,
  });
  beamCone.rotation.x = -Math.PI / 2 + 0.14;
  beamCone.rotation.z = -0.35;
  beamCone.userData.ndSkip = true;

  // Air pump compressor + wooden Ghost Army crate beside hero tank (Shots 3, 6, 7)
  add(box(1.15, 0.72, 0.78), crateMat, -1.35, 0.36, 1.05, root);
  add(box(0.68, 0.52, 0.48), steelMat, -2.25, 0.26, 0.45, root);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.65, 10), toon({ color: '#d9534f' }), -2.25, 0.58, 0.45, root);

  // 2. Ridge vantage area at x = -9 (Shot 2: Scout Binoculars)
  add(box(5.5, 0.55, 5.2), oliveDark, -9.2, 0.25, 0.8, root);
  add(box(0.95, 0.58, 0.75), woodMat, -10.3, 0.8, 1.5, root);

  // 3. Sonic Sound Truck at x = 10.6 (Shot 4: Hidden Speakers — angled 3/4 so cab, horns & acoustic waves read clearly!)
  const soundTruck = new THREE.Group();
  soundTruck.position.set(10.6, 0, -0.4);
  soundTruck.rotation.y = 0.65;
  root.add(soundTruck);
  add(box(1.9, 0.95, 3.8), oliveMid, 0, 0.92, 0, soundTruck);
  add(box(1.78, 0.85, 1.35), oliveDark, 0, 1.72, -1.05, soundTruck);
  for (const [wx, wz] of [[-0.98, 1.1], [0.98, 1.1], [-0.98, -1.1], [0.98, -1.1]]) {
    const wh = add(new THREE.CylinderGeometry(0.4, 0.4, 0.32, 12), treadMat, wx, 0.4, wz, soundTruck);
    wh.rotation.z = Math.PI / 2;
  }
  // Giant twin directional loudspeaker horns on truck bed facing out toward camera-left dusk valley!
  const hornGroup = new THREE.Group();
  hornGroup.position.set(0, 1.92, 0.55);
  soundTruck.add(hornGroup);
  for (const sx of [-0.5, 0.5]) {
    const horn = add(new THREE.ConeGeometry(0.56, 1.05, 14), steelMat, sx, 0.2, 0.55, hornGroup);
    horn.rotation.x = -Math.PI / 2;
    add(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 10), oliveDark, sx, 0.2, -0.05, hornGroup);
  }

  // 4. Field Spoof Radio Tent cleanly separated at x = -12, z = 9.2 (Shot 5: Fake Radio Messages)
  const radioArea = new THREE.Group();
  radioArea.position.set(-12.0, 0, 9.2);
  root.add(radioArea);
  add(box(2.3, 0.74, 0.92), woodMat, 0.15, 0.37, 0, radioArea);
  // Place SPOOF NET radio on right side of desk so operator stands clearly unobstructed on left!
  add(box(1.06, 0.62, 0.55), radioFaceMat, 0.58, 1.05, 0.05, radioArea);
  const tentRoof = add(new THREE.ConeGeometry(3.6, 2.2, 4), tentMat, 0, 3.1, -1.35, radioArea, { cast: false });
  tentRoof.rotation.y = Math.PI / 4;
  const antenna = add(new THREE.CylinderGeometry(0.028, 0.04, 2.6, 8), steelMat, 1.12, 2.1, -0.15, radioArea);

  // Moving convoy decoy headlight pods along distant road
  const convoyLights = [];
  for (let i = 0; i < 4; i++) {
    const pod = new THREE.Group();
    root.add(pod);
    add(box(1.1, 0.7, 1.6), oliveDark, 0, 0.45, 0, pod);
    for (const sx of [-0.36, 0.36]) {
      const lamp = add(new THREE.SphereGeometry(0.14, 10, 10), headlightMat, sx, 0.55, 0.84, pod, { cast: false });
      lamp.userData.ndSkip = true;
    }
    convoyLights.push(pod);
  }

  // Stylized pine trees framing staging perimeters (clear of central crane pullback sightlines!)
  const treePositions = [
    [-7.4, -3.5, 1.15],
    [-8.6, -8.8, 1.35],
    [6.4, -4.5, 1.15],
    [7.8, -8.5, 1.35],
    [14.2, -3.4, 1.25],
    [13.4, 2.2, 1.05],
    [-12.6, -1.8, 1.25],
    [-6.8, 3.2, 0.95],
    [-15.2, 7.2, 1.1],
    [-9.2, 7.6, 1.0],
  ];
  for (const [tx, tz, ts] of treePositions) {
    const tg = new THREE.Group();
    tg.position.set(tx, 0, tz);
    tg.scale.setScalar(ts);
    root.add(tg);
    add(new THREE.CylinderGeometry(0.18, 0.26, 1.3, 8), trunkMat, 0, 0.65, 0, tg);
    add(new THREE.ConeGeometry(1.15, 2.1, 8), pineMat, 0, 2.1, 0, tg);
    add(new THREE.ConeGeometry(0.86, 1.7, 8), pineMat, 0, 3.15, 0, tg);
  }

  return {
    clouds: [],
    updateWorld(S) {
      searchlightPivot.rotation.y = S.searchSwing;
      beamCone.visible = S.showSearchlight;
      heroTank.scale.set(S.heroTankScale[0], S.heroTankScale[1], S.heroTankScale[2]);
      heroTank.position.y = S.heroTankY;
      heroTank.rotation.z = S.heroTankRotZ;
      heroTank.rotation.x = S.heroTankRotX;

      hornGroup.scale.setScalar(S.speakerPulse);
      antenna.rotation.z = S.antennaSway;

      // Subtle breeze sway on distant inflatable decoy tanks
      for (let i = 0; i < decoyTanks.length; i++) {
        decoyTanks[i].rotation.z = Math.sin(S.convoyPhase * Math.PI * 4 + i) * 0.03;
      }

      // Convoy decoy lights glide smoothly along road
      for (let i = 0; i < convoyLights.length; i++) {
        const z = -22 + ((S.convoyPhase + i * 0.25) % 1) * 30;
        convoyLights[i].position.set(3.8, 0, z);
      }
    },
  };
}

export const actorsAt = (f, T) => {
  const S = shotAt(f);
  const out = [];
  const idl = idle(f, 23);
  const blk = blinkAt(f, 23);

  const pushUS = (opts, pos, extra = {}) => {
    const qOpts = {
      seed: 23,
      bob: q(idl.bob, 3),
      tilt: q(idl.tilt, 1),
      headTilt: q(idl.headTilt, 1),
      blink: blk,
      ...opts,
    };
    out.push({
      key: 'us:' + JSON.stringify(qOpts),
      draw: (p) => T.usGhostSoldier(p, qOpts),
      x: pos[0],
      y: pos[1],
      z: pos[2],
      ground: 0,
      ...extra,
    });
  };

  const pushScout = (opts, pos, extra = {}) => {
    const qOpts = {
      seed: 51,
      bob: q(idle(f, 51).bob, 3),
      tilt: q(idle(f, 51).tilt, 1),
      headTilt: q(idle(f, 51).headTilt, 1),
      blink: blinkAt(f, 51),
      ...opts,
    };
    out.push({
      key: 'scout:' + JSON.stringify(qOpts),
      draw: (p) => T.scoutObserverFront(p, qOpts),
      x: pos[0],
      y: pos[1],
      z: pos[2],
      ground: 0.52,
      ...extra,
    });
  };

  switch (S.id) {
    case 'hookSearchlight': {
      // One sneaky U.S. Ghost Army soldier peeking beside the wobbling rubber tank!
      pushUS(
        {
          expr: f >= 60 ? 'ghost_wink' : 'ghost_smirk',
          facing: 1,
          L: 'hip',
          R: f >= 60 ? 'point' : 'hang',
          look: -0.4,
        },
        [-1.35, 0, 0.85]
      );
      break;
    }
    case 'scoutBinoculars': {
      const shocked = f >= 180;
      pushScout(
        {
          expr: shocked ? 'scout_shock' : 'scout_squint',
          facing: 1,
          binocularsUp: !shocked,
          headTilt: q(shocked ? -7 : 2 * Math.sin(f * 0.14), 1),
        },
        [-8.85, 0.52, 0.72]
      );
      pushScout(
        {
          seed: 59,
          expr: shocked ? 'scout_shock' : 'scout_squint',
          facing: 0.5,
          binocularsUp: true,
          headTilt: q(3 * Math.cos(f * 0.11), 1),
        },
        [-9.75, 0.52, 0.25]
      );
      break;
    }
    case 'inflateRubber': {
      const pumping = f < 290;
      const pPhase = q((f * 0.09) % 1, 2);
      // Engineer pumping air compressor
      pushUS(
        {
          seed: 31,
          expr: pumping ? 'ghost_strain' : 'ghost_smirk',
          facing: 1,
          L: 'pump',
          R: 'pump',
          pumpPhase: pPhase,
        },
        [-1.55, 0, 1.05]
      );
      // Strong cartoon Ghost Army soldier effortlessly lifting the entire inflatable tank overhead!
      pushUS(
        {
          seed: 23,
          expr: f >= 294 ? 'ghost_wink' : 'ghost_smirk',
          facing: 0,
          L: f >= 288 ? 'lift' : 'hip',
          R: f >= 288 ? 'lift' : 'point',
        },
        [0.15, 0, 0.78]
      );
      break;
    }
    case 'sonicTrucks': {
      const pPhase = q((f * 0.11) % 1, 2);
      pushUS(
        {
          seed: 37,
          role: 'radio',
          expr: 'ghost_smirk',
          facing: -0.5,
          L: 'morse',
          R: 'point',
          pumpPhase: pPhase,
        },
        [8.95, 0, 1.45]
      );
      break;
    }
    case 'spoofRadio': {
      const pPhase = q((f * 0.13) % 1, 2);
      pushUS(
        {
          seed: 41,
          role: 'radio',
          expr: 'ghost_smirk',
          facing: 0.4,
          L: 'hip',
          R: 'morse',
          pumpPhase: pPhase,
          headTilt: q(4 * Math.sin(f * 0.2), 1),
        },
        [-12.48, 0, 9.1]
      );
      break;
    }
    case 'impersonateTwist': {
      const w = walk(f, 564, 1.4, 0.55);
      const pPhase = q((f * 0.08) % 1, 2);
      pushUS(
        { seed: 23, expr: 'ghost_smirk', L: 'lift', R: 'lift', step: q(w.phase, 2) },
        [-0.78, 0, 0.85]
      );
      pushUS(
        { seed: 31, expr: 'ghost_wink', L: 'lift', R: 'lift', step: q((w.phase + 0.5) % 1, 2) },
        [0.82, 0, 0.78]
      );
      pushUS(
        { seed: 47, role: 'artist', expr: 'ghost_smirk', facing: -1, L: 'hip', R: 'paint', pumpPhase: pPhase },
        [2.05, 0, 1.65]
      );
      break;
    }
    case 'deceptionReveal': {
      const pPhase = q((f * 0.07) % 1, 2);
      pushUS(
        {
          seed: 23,
          role: 'artist',
          expr: 'ghost_wink',
          facing: 0,
          L: 'hip',
          R: 'paint',
          pumpPhase: pPhase,
          headTilt: q(3 * Math.sin(f * 0.14), 1),
        },
        [0.18, 0, 1.72],
        { order: 3 }
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

  if (S.id === 'hookSearchlight' && f >= 62 && f < 90) {
    const k = q((f - 62) / 28, 2);
    out.push(FX('airHook:' + k, (p) => T.fxAirPuff(p, k), [0.85, 0.92, 0.45], 0.55));
  }

  if (S.id === 'scoutBinoculars' && f >= 180) {
    const wob = q(Math.sin(f * 0.4), 1);
    out.push(FX('scoutShock:' + wob, (p) => T.fxScoutShock(p, wob), [-8.65, 2.25, 0.85], 0.36));
  }

  if (S.id === 'inflateRubber' && f >= 252 && f < 292) {
    const k = q(((f - 252) % 16) / 16, 2);
    out.push(FX('airPump:' + k, (p) => T.fxAirPuff(p, k), [-0.95, 0.78, 0.72], 0.44));
  }

  if (S.id === 'sonicTrucks') {
    const ph = q(((f - 360) % 18) / 18, 2);
    out.push(FX('soundWaves:' + ph, (p) => T.fxSoundWaves(p, ph), [9.85, 2.05, 0.45], 1.35));
  }

  if (S.id === 'spoofRadio') {
    const ph = q(((f - 477) % 16) / 16, 2);
    out.push(FX('radioWaves:' + ph, (p) => T.fxRadioWaves(p, ph), [-10.92, 2.35, 9.05], 0.96));
  }

  return out;
};
