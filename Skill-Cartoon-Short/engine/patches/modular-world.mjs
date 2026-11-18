/**
 * Isolated Runtime Extension Patch: Modular 3D World Hook for New Stories
 *
 * Classification: NEW IMPLEMENTATION CODE / RUNTIME EXTENSION PATCH
 * Scope: Applied ONLY to non-Soldier custom story workspaces (e.g. zombie-supermarket-10s).
 * Never applied to vendor/cartoon-short-kit/ or engine/web/main.js (Soldier parity baseline).
 *
 * Preserves 100% of main.js's Three.js WebGL pipeline:
 * - Card 2D->3D alpha-tested character/FX billboards + blob shadows
 * - Pass A (MSAA HalfFloat color target with PCFSoftShadowMap + MeshToonMaterial)
 * - Pass B (swapForNd normal+depth target with alpha-discarded card depth)
 * - Pass C (16-tap depth-jump + surface-crease screen-space ink + saturation/lift/gain/vignette/flash)
 * - Pass D (48-tap Golden-angle circle-of-confusion Depth of Field + sRGB output)
 */

export const EXPECTED_MAIN_JS_SHA256 =
  'cedea9f4cccc747d3c54d1880f6434bdff1e6a9d1f1cfa5072d53d221aed1e56';

export function applyModularWorldPatch(originalMainJs) {
  const importAnchor =
    "import { SHOTS, TOTAL, shotAt, camAt, dofAt, LIGHTS, lightFor, actorsAt, worldAt, fxAt } from './story.js';";
  const worldStartAnchor = '// ---------- world ----------\nconst DECK = 6, HALF = 26, BW = 2.3; // deck top height, half length, half width';
  const cardsAnchor = '// ---------- cards ----------';
  const waterLightAnchor =
    '  waterU.deep.value.set(L.waterDeep); waterU.shal.value.set(L.waterShal); waterU.glint.value.set(L.glint);';
  const renderWorldAnchor =
    '  const W_ = worldAt(f); worldState(W_, f);\n  placeSun(L, new THREE.Vector3(...(C.shadowAt || C.look)));\n  drawActors([...actorsAt(f, T), ...fxAt(f, T)], camera);\n  helmetState(W_.helmet);';

  for (const [name, anchor] of [
    ['importAnchor', importAnchor],
    ['worldStartAnchor', worldStartAnchor],
    ['cardsAnchor', cardsAnchor],
    ['waterLightAnchor', waterLightAnchor],
    ['renderWorldAnchor', renderWorldAnchor],
  ]) {
    if (!originalMainJs.includes(anchor)) {
      throw new Error(`Modular world patch failed: missing ${name} in main.js`);
    }
  }

  let patched = originalMainJs.replace(
    importAnchor,
    "import * as STORY from './story.js';\nconst { SHOTS, TOTAL, shotAt, camAt, dofAt, LIGHTS, lightFor, actorsAt, worldAt, fxAt } = STORY;"
  );

  const startIdx = patched.indexOf(worldStartAnchor);
  const endIdx = patched.indexOf(cardsAnchor);
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error('Modular world patch failed: invalid world block boundaries');
  }

  const originalRomanWorldBlock = patched.slice(startIdx, endIdx);

  const replacementWorldBlock = `// ---------- world (modular story hook with untouched Roman fallback) ----------
const DECK = STORY.DECK ?? 6, HALF = 26, BW = 2.3;
const waterU = { t: { value: 0 }, deep: { value: new THREE.Color('#2f6f8f') }, shal: { value: new THREE.Color('#5fa8bf') }, glint: { value: new THREE.Color('#e9f6ff') } };
let clouds = [];
let customWorld = null;
let romanWorldRefs = null;
if (typeof STORY.buildWorld === 'function') {
  customWorld = STORY.buildWorld({ THREE, T, P, scene, camera, toon, texM, grad, add, box, uvScale, tbox, ndMat, waterNd, sky, hemi, sun });
  clouds = customWorld?.clouds || [];
} else {
${originalRomanWorldBlock
  .replace('const DECK = 6, HALF = 26, BW = 2.3; // deck top height, half length, half width\n', '')
  .replace(
    "const waterU = { t: { value: 0 }, deep: { value: new THREE.Color('#2f6f8f') }, shal: { value: new THREE.Color('#5fa8bf') }, glint: { value: new THREE.Color('#e9f6ff') } };\n",
    ''
  )
  .replace('const clouds = [];\n', '')}
  romanWorldRefs = { columns, entab, roofG, cella, bannerG, bannerCloth, gateStone, eagle, braces, helmet };
}

`;

  patched = patched.slice(0, startIdx) + replacementWorldBlock + patched.slice(endIdx);

  patched = patched.replace(
    waterLightAnchor,
    "  if (L.waterDeep) waterU.deep.value.set(L.waterDeep); if (L.waterShal) waterU.shal.value.set(L.waterShal); if (L.glint) waterU.glint.value.set(L.glint);"
  );

  // Guard Roman-only references inside worldState/helmetState when customWorld is active
  patched = patched.replace(
    'function worldState(S, f) {',
    'function worldState(S, f) {\n  if (customWorld) { if (typeof customWorld.updateWorld === "function") customWorld.updateWorld(S, f); return; }\n  const { columns, entab, roofG, cella, bannerG, bannerCloth, gateStone, eagle, braces } = romanWorldRefs;'
  );

  patched = patched.replace(
    'const helmetState = (h) => {',
    'const helmetState = (h) => {\n  if (customWorld) return;\n  const { helmet } = romanWorldRefs;'
  );

  return patched;
}
