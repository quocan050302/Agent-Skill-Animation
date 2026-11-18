#!/usr/bin/env node
/**
 * Hydrate .gitignored upstream B6 artifacts (`engine/`, `fonts/`, `reference/`, plus
 * missing runner helpers) into one or all projects under `workspace/projects/`,
 * verified strictly against pinned `upstream-lock.json`.
 *
 * Non-destructive: NEVER overwrites authored project files (`story.json`, `captions.json`,
 * `formats/*.json`, `scene.py`, `scene_runtime.py`, `scene-control.json`, `assets/`,
 * `characters/`, `audio/`, `studio.meta.json`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, fb = null) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fb;
};
const getMultiOpt = (f) => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === f && i + 1 < args.length) out.push(args[i + 1]);
  }
  return out;
};

const scriptDir = path.dirname(path.resolve(process.argv[1]));
const APP_ROOT = path.resolve(getOpt('--root', path.resolve(scriptDir, '..')));
const LOCK_PATH = path.join(APP_ROOT, 'upstream-lock.json');
const dryRun = hasFlag('--dry-run');
const verifyOnly = hasFlag('--verify') || hasFlag('--verify-only');
const hydrateAll = hasFlag('--all') || getMultiOpt('--project').length === 0;

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function getFreeBytes(targetPath) {
  let probe = path.resolve(targetPath);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (typeof fs.statfsSync === 'function') {
    const st = fs.statfsSync(probe);
    return Number(st.bavail) * Number(st.bsize);
  }
  return Number.POSITIVE_INFINITY;
}

if (!fs.existsSync(LOCK_PATH)) {
  console.error(`Missing upstream lock file: ${LOCK_PATH}`);
  process.exit(1);
}
const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));

const VENDOR_DIR = path.resolve(
  getOpt('--vendor-dir', process.env.B6_VENDOR_DIR || path.join(APP_ROOT, 'vendor', 'stickman-video-director')),
);
const SKILL_DIR = path.join(VENDOR_DIR, lock.skillSubdir);

function checkVendorCheckout() {
  if (!fs.existsSync(path.join(VENDOR_DIR, '.git'))) {
    throw new Error(`Vendor checkout missing at ${VENDOR_DIR}. Run scripts/setup.ps1 or scripts/setup.sh first.`);
  }
  const headRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: VENDOR_DIR, encoding: 'utf8', shell: false });
  if (headRes.status !== 0) {
    throw new Error(`Failed reading vendor git HEAD: ${headRes.stderr}`);
  }
  const actualSha = headRes.stdout.trim();
  if (actualSha !== lock.commitSha) {
    throw new Error(
      `Upstream vendor SHA mismatch: expected ${lock.commitSha}, got ${actualSha}. Do not quietly upgrade upstream without updating upstream-lock.json & re-verifying.`,
    );
  }
  const statusRes = spawnSync('git', ['status', '--porcelain'], { cwd: VENDOR_DIR, encoding: 'utf8', shell: false });
  if (statusRes.status !== 0 || statusRes.stdout.trim().length > 0) {
    throw new Error(`Vendor checkout is dirty at ${VENDOR_DIR}; refuse to hydrate from modified vendor tree.`);
  }
  return actualSha;
}

const vendorSha = checkVendorCheckout();

const { checkPack } = await import(pathToFileURL(path.join(SKILL_DIR, 'scripts', 'b6-dynamic-meme.mjs')).href);
const { checkHKPack, initHK } = await import(pathToFileURL(path.join(SKILL_DIR, 'scripts', 'b6-hong-kong.mjs')).href);
const { PUBLIC_CAPTION_FONT, checkPublicCaptionFont, provisionPublicCaptionFont } = await import(
  pathToFileURL(path.join(SKILL_DIR, 'scripts', 'b6-fonts.mjs')).href
);

const packStatus = checkPack();
const fontStatus = checkPublicCaptionFont(SKILL_DIR);

const styleStandardPath = path.join(SKILL_DIR, 'assets', 'b6', 'style-standard.json');
const styleStandard = JSON.parse(fs.readFileSync(styleStandardPath, 'utf8'));
const refRel = styleStandard.reference.path;
const refExpectedSha = styleStandard.reference.sha256;
const refSrcPath = path.join(SKILL_DIR, 'assets', 'b6', refRel);
if (!fs.existsSync(refSrcPath) || sha256File(refSrcPath) !== refExpectedSha) {
  throw new Error(`Upstream reference artifact invalid or missing: ${refSrcPath}`);
}

const PROJECTS_ROOT = path.join(APP_ROOT, 'workspace', 'projects');
const projectTargets = [];

if (getMultiOpt('--project').length > 0) {
  for (const spec of getMultiOpt('--project')) {
    const asPath = path.isAbsolute(spec) ? spec : path.join(PROJECTS_ROOT, spec);
    if (!fs.existsSync(asPath) || !fs.existsSync(path.join(asPath, 'project.json'))) {
      throw new Error(`Project directory missing project.json: ${asPath}`);
    }
    projectTargets.push(path.resolve(asPath));
  }
} else if (hydrateAll && fs.existsSync(PROJECTS_ROOT)) {
  for (const entry of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(PROJECTS_ROOT, entry.name);
    if (fs.existsSync(path.join(candidate, 'project.json'))) {
      projectTargets.push(path.resolve(candidate));
    }
  }
}

// Disk space check (>= max(1 GiB, 2 * estimatedTempBytes))
const estimatedPerProjectBytes = 90 * 1024 * 1024;
const minFreeRequired = Math.max(1024 * 1024 * 1024, projectTargets.length * estimatedPerProjectBytes * 2);
const freeBytes = getFreeBytes(APP_ROOT);
if (!verifyOnly && freeBytes < minFreeRequired) {
  throw new Error(
    `Insufficient free disk space to hydrate projects (${Math.round(freeBytes / 1048576)} MiB free, require >= ${Math.round(minFreeRequired / 1048576)} MiB).`,
  );
}

const MOTION_RUNTIME_DIR = path.join(APP_ROOT, 'motion_runtime');
const MOTION_MANIFEST_PATH = path.join(MOTION_RUNTIME_DIR, 'manifest.json');
const motionManifest = fs.existsSync(MOTION_MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MOTION_MANIFEST_PATH, 'utf8'))
  : null;
if (motionManifest?.files) {
  for (const [fname, meta] of Object.entries(motionManifest.files)) {
    const abs = path.join(MOTION_RUNTIME_DIR, fname);
    if (!fs.existsSync(abs) || sha256File(abs) !== meta.sha256) {
      throw new Error(`Shared motion_runtime integrity mismatch for ${fname} against motion_runtime/manifest.json`);
    }
  }
}

const ARTICULATED_RUNTIME_FILES = ['b6_motion_core.py', 'b6_motion_render.py', 'b6_motion_qc.py'];

const HELPER_SCRIPTS = [
  ['b6_production.py', 'run.py'],
  ['b6_motion_review.py', 'motion_review.py'],
  ['b6_space.py', 'b6_space.py'],
  ['b6_caption.py', 'caption_renderer.py'],
  ['b6_puppet.py', 'b6_puppet.py'],
  ['b6_asset_roles.py', 'b6_asset_roles.py'],
  ['b6_actions.py', 'b6_actions.py'],
  ['b6_iteration.py', 'b6_iteration.py'],
  ['b6_character_preflight.py', 'b6_character_preflight.py'],
];

const results = [];
let overallOk = true;

for (const projDir of projectTargets) {
  const id = path.basename(projDir);
  const actions = [];
  const errors = [];

  // 1. Engine check/hydrate
  const engineDir = path.join(projDir, 'engine');
  let engineOk = false;
  if (fs.existsSync(path.join(engineDir, 'manifest.json'))) {
    try {
      checkHKPack(engineDir);
      engineOk = true;
    } catch {
      engineOk = false;
    }
  }
  if (!engineOk) {
    if (verifyOnly) {
      errors.push('engine/ missing or fails integrity check');
    } else if (dryRun) {
      actions.push('would_hydrate:engine');
    } else {
      const staging = path.join(projDir, `.engine.hydrating.${process.pid}.${Date.now()}`);
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      try {
        initHK(staging, '16:9');
        if (fs.existsSync(engineDir)) fs.rmSync(engineDir, { recursive: true, force: true });
        fs.renameSync(staging, engineDir);
        checkHKPack(engineDir);
        actions.push('hydrated:engine');
      } finally {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      }
    }
  }

  // 2. Public caption fonts check/hydrate
  const fontSpecs = [
    [PUBLIC_CAPTION_FONT.source, PUBLIC_CAPTION_FONT.path, PUBLIC_CAPTION_FONT.sha256],
    [PUBLIC_CAPTION_FONT.licenseSource, PUBLIC_CAPTION_FONT.licensePath, PUBLIC_CAPTION_FONT.licenseSha256],
  ];
  const needFont = fontSpecs.some(([, destRel, digest]) => {
    const abs = path.join(projDir, destRel);
    return !fs.existsSync(abs) || sha256File(abs) !== digest;
  });
  if (needFont) {
    if (verifyOnly) {
      errors.push('fonts/ArchivoBlack missing or SHA mismatch');
    } else if (dryRun) {
      actions.push('would_hydrate:fonts');
    } else {
      fs.mkdirSync(path.join(projDir, 'fonts'), { recursive: true });
      for (const [srcRel, destRel, digest] of fontSpecs) {
        const destAbs = path.join(projDir, destRel);
        if (!fs.existsSync(destAbs) || sha256File(destAbs) !== digest) {
          fs.copyFileSync(path.join(SKILL_DIR, srcRel), destAbs);
        }
      }
      actions.push('hydrated:fonts');
    }
  }

  // 3. Reference video check/hydrate
  const refDestAbs = path.join(projDir, refRel);
  const needRef = !fs.existsSync(refDestAbs) || sha256File(refDestAbs) !== refExpectedSha;
  if (needRef) {
    if (verifyOnly) {
      errors.push(`${refRel} missing or SHA mismatch`);
    } else if (dryRun) {
      actions.push(`would_hydrate:${refRel}`);
    } else {
      fs.mkdirSync(path.dirname(refDestAbs), { recursive: true });
      fs.copyFileSync(refSrcPath, refDestAbs);
      if (sha256File(refDestAbs) !== refExpectedSha) {
        throw new Error(`Copied ${refRel} SHA mismatch inside ${id}`);
      }
      actions.push(`hydrated:${refRel}`);
    }
  }

  // 4. Restore missing runner Python helpers ONLY if missing (never overwrite edited helpers)
  for (const [srcName, destName] of HELPER_SCRIPTS) {
    const destAbs = path.join(projDir, destName);
    if (!fs.existsSync(destAbs)) {
      if (verifyOnly) {
        errors.push(`missing helper: ${destName}`);
      } else if (dryRun) {
        actions.push(`would_restore:${destName}`);
      } else {
        fs.copyFileSync(path.join(SKILL_DIR, 'scripts', srcName), destAbs);
        actions.push(`restored_missing:${destName}`);
      }
    }
  }

  // 4b. Hydrate articulated motion_runtime helpers ONLY for projects opting into articulated_v1
  const projectJson = JSON.parse(fs.readFileSync(path.join(projDir, 'project.json'), 'utf8'));
  const controlPath = path.join(projDir, 'scene-control.json');
  const controlJson = fs.existsSync(controlPath) ? JSON.parse(fs.readFileSync(controlPath, 'utf8')) : null;
  const usesArticulated =
    projectJson?.motion_mode === 'articulated_v1' || controlJson?.motionMode === 'articulated_v1';
  if (usesArticulated && motionManifest?.files) {
    for (const fname of ARTICULATED_RUNTIME_FILES) {
      const destAbs = path.join(projDir, fname);
      const srcAbs = path.join(MOTION_RUNTIME_DIR, fname);
      const expectedSha = motionManifest.files[fname]?.sha256;
      const missingOrStale = !fs.existsSync(destAbs) || (expectedSha && sha256File(destAbs) !== expectedSha);
      if (missingOrStale) {
        if (verifyOnly) {
          errors.push(`motion_runtime helper missing/mismatch: ${fname}`);
        } else if (dryRun) {
          actions.push(`would_hydrate_motion:${fname}`);
        } else {
          fs.copyFileSync(srcAbs, destAbs);
          actions.push(`hydrated_motion:${fname}`);
        }
      }
    }
  }

  // 5. Ensure runtime subdirs exist cleanly
  if (!verifyOnly && !dryRun) {
    for (const sub of ['assets/inbox', 'assets/production', 'assets/reference', 'assets/requests', 'audio']) {
      fs.mkdirSync(path.join(projDir, sub), { recursive: true });
    }
  }

  if (errors.length > 0) overallOk = false;
  results.push({
    project: id,
    dir: projDir,
    ok: errors.length === 0,
    actions: actions.length > 0 ? actions : ['already_hydrated'],
    errors,
  });
}

// Keep unused import clean (`provisionPublicCaptionFont` validated)
void provisionPublicCaptionFont;

const summary = {
  ok: overallOk,
  dryRun,
  verifyOnly,
  appRoot: APP_ROOT,
  vendorDir: VENDOR_DIR,
  vendorSha,
  expectedSha: lock.commitSha,
  packFiles: packStatus.files,
  fontVariant: fontStatus.variant,
  projects: results,
};

console.log(JSON.stringify(summary, null, 2));
if (!overallOk) process.exit(1);
