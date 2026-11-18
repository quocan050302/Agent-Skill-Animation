#!/usr/bin/env node
/**
 * Safe, Deterministic, Cross-Platform Setup & Hydration Tool (SHORT-01)
 *
 * Replaces original tools/setup.sh dangerous operations:
 * - Never touches /tmp or deletes other processes'/users' directories.
 * - Never mutates vendor/cartoon-short-kit/ (immutable reference snapshot).
 * - Pins mromidev/claude-animated-shorts to exact commit e3b817b6afc6cd413466d43f11ba31209e034bbf.
 * - Pins three to exact version 0.160.0 via package-lock.json & SHA-256 check.
 * - Strips TypeScript types via Node >= 22.6 module.stripTypeScriptTypes with explicit error checks.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import moduleApi from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyModularWorldPatch, EXPECTED_MAIN_JS_SHA256 } from '../../engine/patches/modular-world.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function writeFileAtomic(destPath, data) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'atomic-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(
    tmpDir,
    `${path.basename(destPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, destPath);
}

export function checkFreeDiskMb(targetDir, minMb = 512) {
  const stats = fs.statfsSync(targetDir);
  const availBytes = Number(stats.bavail) * Number(stats.bsize);
  const availMb = Math.floor(availBytes / (1024 * 1024));
  if (availMb < minMb) {
    throw new Error(`DISK_PREFLIGHT_FAILED: ${availMb} MB available (< required ${minMb} MB) at ${targetDir}`);
  }
  return availMb;
}

function findPythonExecutable() {
  for (const cmd of ['python3', 'python']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe' });
      return cmd;
    } catch {
      // try next
    }
  }
  throw new Error('PYTHON_NOT_FOUND: python3 or python is required for cross-platform archive & audio tools.');
}

export function loadSourceManifest() {
  const manifestPath = path.join(PROJECT_ROOT, 'vendor', 'source-manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function extractKitSnapshot({ kitZipPath, vendorKitDir, manifest }) {
  const py = findPythonExecutable();
  if (fs.existsSync(vendorKitDir)) {
    // Verify existing snapshot without modifying it
    const existingReport = verifyVendorSnapshot({ vendorKitDir, manifest });
    if (existingReport.allMatched) {
      return { extracted: false, source: vendorKitDir, verification: existingReport };
    }
  }

  if (!kitZipPath || !fs.existsSync(kitZipPath)) {
    throw new Error(
      `KIT_ARCHIVE_MISSING: Cannot locate cartoon-short-kit.zip at "${kitZipPath || '(unset)'}". ` +
        'Pass --kit <path/to/cartoon-short-kit.zip> or set CARTOON_SHORT_KIT_ZIP.'
    );
  }

  const zipSha = sha256File(kitZipPath);
  if (zipSha !== manifest.archive.sha256) {
    throw new Error(
      `KIT_ARCHIVE_HASH_MISMATCH: Expected ${manifest.archive.sha256}, got ${zipSha} for ${kitZipPath}`
    );
  }

  const tempExtractDir = path.join(PROJECT_ROOT, 'workspace', 'cache', `extract-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tempExtractDir, { recursive: true });
  try {
    const pyScript = `
import os, sys, zipfile
zip_path, out_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'r') as zf:
    for info in zf.infolist():
        rel = info.filename
        if rel.startswith('/') or '..' in rel.split('/'):
            raise RuntimeError(f'Unsafe zip path: {rel}')
        zf.extract(info, out_dir)
`;
    execFileSync(py, ['-c', pyScript, kitZipPath, tempExtractDir], { stdio: 'pipe' });
    const extractedInner = path.join(tempExtractDir, 'cartoon-short-kit');
    if (!fs.existsSync(extractedInner)) {
      throw new Error('KIT_ARCHIVE_STRUCTURE_INVALID: Missing top-level cartoon-short-kit/ inside archive.');
    }
    fs.mkdirSync(path.dirname(vendorKitDir), { recursive: true });
    if (fs.existsSync(vendorKitDir)) {
      throw new Error(
        `IMMUTABLE_SNAPSHOT_CORRUPT: ${vendorKitDir} exists with hash mismatch; refusing automatic overwrite.`
      );
    }
    fs.renameSync(extractedInner, vendorKitDir);
  } finally {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }

  const verification = verifyVendorSnapshot({ vendorKitDir, manifest });
  if (!verification.allMatched) {
    throw new Error(`KIT_SNAPSHOT_VERIFY_FAILED: ${JSON.stringify(verification.mismatches)}`);
  }
  return { extracted: true, source: kitZipPath, verification };
}

export function verifyVendorSnapshot({ vendorKitDir, manifest }) {
  const results = [];
  const mismatches = [];
  for (const entry of manifest.entries) {
    const abs = path.join(vendorKitDir, entry.relativePath);
    if (!fs.existsSync(abs)) {
      mismatches.push({ relativePath: entry.relativePath, reason: 'MISSING' });
      continue;
    }
    const buf = fs.readFileSync(abs);
    const actualSha = sha256Buffer(buf);
    const actualSize = buf.length;
    const matched = actualSha === entry.sha256 && actualSize === entry.size;
    results.push({
      relativePath: entry.relativePath,
      expectedSha256: entry.sha256,
      actualSha256: actualSha,
      expectedSize: entry.size,
      actualSize,
      matched,
    });
    if (!matched) {
      mismatches.push({ relativePath: entry.relativePath, expectedSha: entry.sha256, actualSha });
    }
  }
  return { allMatched: mismatches.length === 0, checkedCount: results.length, mismatches, results };
}

export function ensurePinnedUpstreamToon({ manifest }) {
  const info = manifest.upstreamDependencies.claudeAnimatedShorts;
  const cacheRepoDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'upstream', 'claude-animated-shorts');
  const toonTsAbs = path.join(cacheRepoDir, info.toonTsPath);
  const licenseAbs = path.join(cacheRepoDir, 'LICENSE');

  const verifyCached = () =>
    fs.existsSync(toonTsAbs) &&
    fs.existsSync(licenseAbs) &&
    sha256File(toonTsAbs) === info.toonTsSha256 &&
    sha256File(licenseAbs) === info.licenseSha256;

  if (!verifyCached()) {
    const tmpCloneDir = path.join(
      PROJECT_ROOT,
      'workspace',
      'cache',
      'upstream',
      `clone-${process.pid}-${Date.now()}`
    );
    fs.mkdirSync(tmpCloneDir, { recursive: true });
    try {
      execFileSync('git', ['init', '-q', tmpCloneDir], { stdio: 'pipe' });
      execFileSync('git', ['-C', tmpCloneDir, 'remote', 'add', 'origin', info.repository], { stdio: 'pipe' });
      execFileSync('git', ['-C', tmpCloneDir, 'fetch', '-q', '--depth', '1', 'origin', info.pinnedCommit], {
        stdio: 'pipe',
      });
      execFileSync('git', ['-C', tmpCloneDir, 'checkout', '-q', 'FETCH_HEAD'], { stdio: 'pipe' });
      const head = execFileSync('git', ['-C', tmpCloneDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (head !== info.pinnedCommit) {
        throw new Error(`UPSTREAM_PIN_MISMATCH: Expected ${info.pinnedCommit}, got ${head}`);
      }
      fs.rmSync(cacheRepoDir, { recursive: true, force: true });
      fs.renameSync(tmpCloneDir, cacheRepoDir);
    } finally {
      if (fs.existsSync(tmpCloneDir)) {
        fs.rmSync(tmpCloneDir, { recursive: true, force: true });
      }
    }
  }

  if (!verifyCached()) {
    throw new Error('UPSTREAM_TOON_HASH_MISMATCH: Failed SHA-256 verification for toon.ts or MIT LICENSE.');
  }

  if (typeof moduleApi.stripTypeScriptTypes !== 'function') {
    throw new Error(
      `NODE_TS_STRIP_UNSUPPORTED: Node ${process.version} lacks module.stripTypeScriptTypes (requires >= 22.6.0).`
    );
  }

  const toonTsSource = fs.readFileSync(toonTsAbs, 'utf8');
  const toonBaseJs = moduleApi.stripTypeScriptTypes(toonTsSource, { mode: 'transform' });
  if (!toonBaseJs || !toonBaseJs.includes('export class Pen')) {
    throw new Error('TOON_STRIP_FAILED: Stripped toonbase.js did not retain expected Pen export.');
  }

  return { toonTsAbs, licenseAbs, toonBaseJs, toonBaseSha256: sha256Buffer(Buffer.from(toonBaseJs, 'utf8')) };
}

export function ensurePinnedThree({ manifest }) {
  const info = manifest.upstreamDependencies.three;
  const threeAbs = path.join(PROJECT_ROOT, info.moduleFile);
  if (!fs.existsSync(threeAbs)) {
    throw new Error(`THREE_MISSING: ${threeAbs} not found. Run npm install first.`);
  }
  const actualSha = sha256File(threeAbs);
  if (actualSha !== info.moduleSha256) {
    throw new Error(`THREE_HASH_MISMATCH: Expected ${info.moduleSha256}, got ${actualSha}`);
  }
  return { threeAbs, sha256: actualSha };
}

export function hydrateAll(options = {}) {
  const minFreeMb = Number(process.env.SHORT_MIN_FREE_DISK_MB || options.minFreeMb || 512);
  const availMb = checkFreeDiskMb(PROJECT_ROOT, minFreeMb);

  const manifest = loadSourceManifest();
  const vendorKitDir = path.join(PROJECT_ROOT, 'vendor', 'cartoon-short-kit');
  const defaultZip =
    options.kitZipPath ||
    process.env.CARTOON_SHORT_KIT_ZIP ||
    '/Users/macbook/Downloads/cartoon-short-kit.zip';

  const kitStatus = extractKitSnapshot({ kitZipPath: defaultZip, vendorKitDir, manifest });
  const threeStatus = ensurePinnedThree({ manifest });
  const toonStatus = ensurePinnedUpstreamToon({ manifest });

  // 1. Hydrate engine/web/ with 100% unmodified original Soldier engine files
  const engineWebDir = path.join(PROJECT_ROOT, 'engine', 'web');
  const copyExactFromKit = (relKit, destAbs) => {
    const srcAbs = path.join(vendorKitDir, relKit);
    const buf = fs.readFileSync(srcAbs);
    writeFileAtomic(destAbs, buf);
    return sha256Buffer(buf);
  };

  for (const name of ['index.html', 'main.js', 'motion.js', 'paint.js', 'roman.js']) {
    copyExactFromKit(path.join('engine', name), path.join(engineWebDir, name));
  }
  copyExactFromKit('example/soldier/story.js', path.join(engineWebDir, 'story.js'));
  writeFileAtomic(path.join(engineWebDir, 'lib', 'three.module.js'), fs.readFileSync(threeStatus.threeAbs));
  writeFileAtomic(path.join(engineWebDir, 'toonbase.js'), Buffer.from(toonStatus.toonBaseJs, 'utf8'));
  const romanBuf = fs.readFileSync(path.join(vendorKitDir, 'engine', 'roman.js'), 'utf8');
  const combinedToonJs = `${toonStatus.toonBaseJs}\n${romanBuf}`;
  writeFileAtomic(path.join(engineWebDir, 'toon.js'), Buffer.from(combinedToonJs, 'utf8'));

  // 2. Hydrate workspace/projects/soldier-baseline/web/ identically
  const soldierProjectDir = path.join(PROJECT_ROOT, 'workspace', 'projects', 'soldier-baseline');
  const soldierWebDir = path.join(soldierProjectDir, 'web');
  for (const name of ['index.html', 'main.js', 'motion.js', 'paint.js', 'roman.js', 'story.js', 'toonbase.js', 'toon.js']) {
    writeFileAtomic(path.join(soldierWebDir, name), fs.readFileSync(path.join(engineWebDir, name)));
  }
  writeFileAtomic(
    path.join(soldierWebDir, 'lib', 'three.module.js'),
    fs.readFileSync(path.join(engineWebDir, 'lib', 'three.module.js'))
  );

  // 3. Hydrate workspace/projects/zombie-supermarket-10s/web/ if authored src exists
  const zombieProjectDir = path.join(PROJECT_ROOT, 'workspace', 'projects', 'zombie-supermarket-10s');
  const zombieSrcDir = path.join(zombieProjectDir, 'src');
  let zombieHydrated = false;
  if (fs.existsSync(path.join(zombieSrcDir, 'story.js'))) {
    const zombieWebDir = path.join(zombieProjectDir, 'web');
    const origMain = fs.readFileSync(path.join(vendorKitDir, 'engine', 'main.js'), 'utf8');
    if (sha256Buffer(Buffer.from(origMain, 'utf8')) !== EXPECTED_MAIN_JS_SHA256) {
      throw new Error('Unexpected main.js SHA-256 before applying modular world patch.');
    }
    const patchedMain = applyModularWorldPatch(origMain);
    writeFileAtomic(path.join(zombieWebDir, 'index.html'), fs.readFileSync(path.join(engineWebDir, 'index.html')));
    writeFileAtomic(path.join(zombieWebDir, 'main.js'), Buffer.from(patchedMain, 'utf8'));
    writeFileAtomic(path.join(zombieWebDir, 'motion.js'), fs.readFileSync(path.join(engineWebDir, 'motion.js')));
    writeFileAtomic(path.join(zombieWebDir, 'paint.js'), fs.readFileSync(path.join(engineWebDir, 'paint.js')));
    writeFileAtomic(
      path.join(zombieWebDir, 'lib', 'three.module.js'),
      fs.readFileSync(path.join(engineWebDir, 'lib', 'three.module.js'))
    );
    writeFileAtomic(path.join(zombieWebDir, 'toonbase.js'), Buffer.from(toonStatus.toonBaseJs, 'utf8'));

    const zombieCastPath = path.join(zombieSrcDir, 'zombie-cast.js');
    const zombieCast = fs.existsSync(zombieCastPath) ? fs.readFileSync(zombieCastPath, 'utf8') : '';
    writeFileAtomic(
      path.join(zombieWebDir, 'toon.js'),
      Buffer.from(`${toonStatus.toonBaseJs}\n${romanBuf}\n${zombieCast}`, 'utf8')
    );

    for (const file of fs.readdirSync(zombieSrcDir)) {
      if (file.endsWith('.js')) {
        writeFileAtomic(path.join(zombieWebDir, file), fs.readFileSync(path.join(zombieSrcDir, file)));
      }
    }
    zombieHydrated = true;
  }

  return {
    ok: true,
    availDiskMb: availMb,
    kitExtracted: kitStatus.extracted,
    kitVerifiedCount: kitStatus.verification.checkedCount,
    threeSha256: threeStatus.sha256,
    toonTsSha256: manifest.upstreamDependencies.claudeAnimatedShorts.toonTsSha256,
    toonBaseSha256: toonStatus.toonBaseSha256,
    engineMainSha256: sha256File(path.join(engineWebDir, 'main.js')),
    zombieHydrated,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let kitZipPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--kit' && args[i + 1]) {
      kitZipPath = path.resolve(args[i + 1]);
      i++;
    }
  }
  const summary = hydrateAll({ kitZipPath });
  console.log(JSON.stringify(summary, null, 2));
}
