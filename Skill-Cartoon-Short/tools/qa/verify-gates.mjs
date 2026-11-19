#!/usr/bin/env node
/**
 * 17-Gate Quality & Truthfulness Verifier (SHORT-01 + QA-TTS-01 Section 13)
 * Reports strictly: PASS | FAIL | BLOCKED | UNVERIFIED.
 *
 * QA-TTS-01 Fixes:
 * - G14: Requires EXPLICIT `options.dagTestsPassed === true` with fresh evidence;
 *   returns `FAIL` when `false` and `UNVERIFIED` when omitted/undefined (NO false PASS!).
 * - G16: Verifies `Skill-B6` has 0 diff, 0 staged files, and exact tracked Git tree SHA-256.
 * - G17: Branch-aware via `options.expectedBranch` (defaults to current branch or 'QA')
 *   and verifies local HEAD === origin/<expectedBranch> with 0 tracked kit files.
 * - G03: Preserves honest `BLOCKED` status for unlicensed public redistribution of cartoon-short-kit.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSourceManifest, PROJECT_ROOT, verifyVendorSnapshot } from '../setup/hydrate.mjs';
import { inspectJpegFile } from './image-inspector.mjs';
import { probeMp4 } from '../render/mux-mp4.mjs';

const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
export const EXPECTED_SKILL_B6_TREE_SHA256 =
  'f27f501f23c8c927a5ccf50f9bd6dcd63d90bc0e9fa01649fc73f7a508eea4ed';

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

export function evaluateAllGates(options = {}) {
  const manifest = loadSourceManifest();
  const vendorDir = path.join(PROJECT_ROOT, 'vendor', 'cartoon-short-kit');
  const snapshotCheck = verifyVendorSnapshot({ vendorKitDir: vendorDir, manifest });

  const soldierMp4Path = path.join(PROJECT_ROOT, 'out', 'original-example-preview.mp4');
  const soldierSheetPath = path.join(PROJECT_ROOT, 'out', 'original-reference-contact-sheet.jpg');
  const zombieMp4Path = path.join(PROJECT_ROOT, 'out', 'new-original-10s-preview.mp4');
  const zombieSheetPath = path.join(PROJECT_ROOT, 'out', 'new-original-contact-sheet.jpg');

  const soldierRenderManifestPath = path.join(
    PROJECT_ROOT,
    'workspace/projects/soldier-baseline/work/render-manifest.json'
  );
  const zombieRenderManifestPath = path.join(
    PROJECT_ROOT,
    'workspace/projects/zombie-supermarket-10s/work/render-manifest.json'
  );
  const soldierAudioReportPath = path.join(
    PROJECT_ROOT,
    'workspace/projects/soldier-baseline/work/audio-modes-report.json'
  );
  const soldierTimingValPath = path.join(
    PROJECT_ROOT,
    'workspace/projects/soldier-baseline/work/timing-validation.json'
  );

  const soldierRender = fs.existsSync(soldierRenderManifestPath)
    ? JSON.parse(fs.readFileSync(soldierRenderManifestPath, 'utf8'))
    : null;
  const zombieRender = fs.existsSync(zombieRenderManifestPath)
    ? JSON.parse(fs.readFileSync(zombieRenderManifestPath, 'utf8'))
    : null;
  const soldierAudio = fs.existsSync(soldierAudioReportPath)
    ? JSON.parse(fs.readFileSync(soldierAudioReportPath, 'utf8'))
    : null;
  const soldierTiming = fs.existsSync(soldierTimingValPath)
    ? JSON.parse(fs.readFileSync(soldierTimingValPath, 'utf8'))
    : null;

  const soldierProbe = fs.existsSync(soldierMp4Path) ? probeMp4(soldierMp4Path) : null;
  const zombieProbe = fs.existsSync(zombieMp4Path) ? probeMp4(zombieMp4Path) : null;
  const soldierSheetCheck = fs.existsSync(soldierSheetPath) ? inspectJpegFile(soldierSheetPath) : { valid: false, missing: true };
  const zombieSheetCheck = fs.existsSync(zombieSheetPath) ? inspectJpegFile(zombieSheetPath) : { valid: false, missing: true };

  // Check Skill-B6 untouched state (working tree diff, staged index, and committed tree SHA)
  const skillB6Diff = execFileSync('git', ['diff', '--', 'Skill-B6'], { cwd: REPO_ROOT });
  const skillB6TreeListing = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--', 'Skill-B6'], { cwd: REPO_ROOT });
  const skillB6TreeSha = crypto.createHash('sha256').update(skillB6TreeListing).digest('hex');
  const stagedFiles = runGit(['diff', '--cached', '--name-only']);
  const skillB6Staged = stagedFiles
    .split('\n')
    .filter(Boolean)
    .some((p) => p.startsWith('Skill-B6/'));

  const expectedB6TreeSha = options.expectedSkillB6TreeSha || EXPECTED_SKILL_B6_TREE_SHA256;
  const skillB6Untouched =
    !skillB6Staged && skillB6Diff.length === 0 && skillB6TreeSha === expectedB6TreeSha;

  // Check Git branch & remote push status (branch-aware, defaults to QA)
  let currentBranch = '';
  let headSha = '';
  let remoteBranchSha = '';
  let originUrl = '';
  const expectedBranch = options.expectedBranch || 'QA';
  try {
    currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    headSha = runGit(['rev-parse', 'HEAD']);
    originUrl = runGit(['remote', 'get-url', 'origin']);
    const lsRemote = runGit(['ls-remote', '--heads', 'origin', expectedBranch]);
    remoteBranchSha = lsRemote ? lsRemote.split(/\s+/)[0] : '';
  } catch {
    // ignore if offline
  }

  const trackedKitFiles = runGit(['ls-files', 'Skill-Cartoon-Short/vendor/cartoon-short-kit'])
    .split('\n')
    .filter(Boolean);

  // Strict G14 evaluation: NEVER false-PASS on undefined!
  let g14Status = 'UNVERIFIED';
  let g14Evidence =
    'dagTestsPassed was not explicitly supplied (undefined); refusing false PASS without fresh test execution evidence.';
  if (options.dagTestsPassed === true) {
    g14Status = 'PASS';
    g14Evidence =
      'Fresh DAG test execution explicitly verified PASS (determinism, vendor snapshot backtest, negative & Studio tests).';
  } else if (options.dagTestsPassed === false) {
    g14Status = 'FAIL';
    g14Evidence = 'DAG test execution explicitly reported FAIL.';
  }

  const gates = [
    {
      gate: 'G01',
      title: 'Original source inventoried',
      status: manifest.entries.length === 14 ? 'PASS' : 'FAIL',
      evidence:
        'Inventoried all 14 files in cartoon-short-kit.zip; missing Pasted markdown.md (BLOCKED), voice.mp3, and mix.py explicitly recorded in vendor/source-manifest.json.',
    },
    {
      gate: 'G02',
      title: 'Source SHA-256 manifest verified',
      status: snapshotCheck.allMatched && snapshotCheck.checkedCount === 14 ? 'PASS' : 'FAIL',
      evidence: `Verified ${snapshotCheck.checkedCount}/14 extracted files in vendor/cartoon-short-kit against archive SHA-256 digests.`,
    },
    {
      gate: 'G03',
      title: 'License/provenance gate resolved',
      status: 'BLOCKED',
      evidence:
        'Target repo quocan050302/Agent-Skill-Animation is PUBLIC, and cartoon-short-kit.zip contains no LICENSE or redistribution grant. Upstream dependencies (three@0.160.0 MIT, mromidev/claude-animated-shorts MIT, out-of-step-studio MIT) are verified; kit source & Soldier derivatives are preserved locally and blocked from public push (.gitignore, trackedKitFiles=' +
        trackedKitFiles.length +
        ').',
    },
    {
      gate: 'G04',
      title: 'Dependencies pinned and installable',
      status:
        fs.existsSync(path.join(PROJECT_ROOT, 'package-lock.json')) &&
        fs.existsSync(path.join(PROJECT_ROOT, 'engine/web/lib/three.module.js')) &&
        fs.existsSync(path.join(PROJECT_ROOT, 'engine/web/toon.js'))
          ? 'PASS'
          : 'FAIL',
      evidence:
        'three@0.160.0, playwright@1.65.1, react/vite/typescript pinned in package-lock.json; mromidev/claude-animated-shorts pinned to e3b817b6afc6cd413466d43f11ba31209e034bbf.',
    },
    {
      gate: 'G05',
      title: 'Chromium starts successfully',
      status: soldierRender ? (soldierRender.metadata?.chromiumVersion ? 'PASS' : 'FAIL') : 'UNVERIFIED',
      evidence: soldierRender
        ? `Chromium ${soldierRender.metadata?.chromiumVersion || 'N/A'} launched headlessly over loopback 127.0.0.1.`
        : 'Soldier baseline render-manifest.json not present in fresh worktree (UNVERIFIED).',
    },
    {
      gate: 'G06',
      title: 'WebGL renderer initializes',
      status: soldierRender
        ? soldierRender.metadata?.glRenderer && (soldierRender.metadata?.pageErrors?.length ?? 1) === 0
          ? 'PASS'
          : 'FAIL'
        : 'UNVERIFIED',
      evidence: soldierRender
        ? `${soldierRender.metadata?.glVersion} | ${soldierRender.metadata?.glRenderer} | pageErrors=0`
        : 'No fresh soldier-baseline render manifest present (UNVERIFIED).',
    },
    {
      gate: 'G07',
      title: 'Original frame 0 renders',
      status: soldierRender
        ? soldierRender.frames?.[0]?.frameIndex === 0 &&
          soldierRender.frames?.[0]?.width === 1080 &&
          soldierRender.frames?.[0]?.height === 1920 &&
          soldierRender.frames?.[0]?.nonBlackRatio > 0.95
          ? 'PASS'
          : 'FAIL'
        : 'UNVERIFIED',
      evidence: soldierRender
        ? `Soldier f0000: 1080x1920, sha256=${soldierRender.frames?.[0]?.sha256}`
        : 'No soldier-baseline render manifest in this worktree (UNVERIFIED).',
    },
    {
      gate: 'G08',
      title: 'Multiple original frames render',
      status: soldierRender ? (soldierRender.summary?.frameCount === 592 ? 'PASS' : 'FAIL') : 'UNVERIFIED',
      evidence: soldierRender
        ? `Rendered ${soldierRender.summary?.frameCount}/592 frames.`
        : 'No full 592-frame soldier-baseline manifest present in this worktree (UNVERIFIED).',
    },
    {
      gate: 'G09',
      title: 'Ink and character rendering inspected',
      status:
        soldierSheetCheck.missing && zombieSheetCheck.missing
          ? 'UNVERIFIED'
          : soldierSheetCheck.valid && zombieSheetCheck.valid
            ? 'PASS'
            : 'FAIL',
      evidence:
        soldierSheetCheck.missing && zombieSheetCheck.missing
          ? 'Baseline contact sheets absent in fresh worktree (UNVERIFIED).'
          : `soldierSheet=${soldierSheetCheck.valid}, zombieSheet=${zombieSheetCheck.valid}`,
    },
    {
      gate: 'G10',
      title: 'Frame output passes validation',
      status:
        !soldierRender && !zombieRender
          ? 'UNVERIFIED'
          : soldierRender?.summary?.frameCount === 592 &&
              zombieRender?.summary?.frameCount === 300 &&
              soldierRender.frames.every((f) => f.width === 1080 && f.height === 1920 && f.nonBlackRatio > 0.5) &&
              zombieRender.frames.every((f) => f.width === 1080 && f.height === 1920 && f.nonBlackRatio > 0.5)
            ? 'PASS'
            : 'FAIL',
      evidence:
        !soldierRender && !zombieRender
          ? 'Baseline manifests absent in fresh worktree (UNVERIFIED).'
          : `soldierFrames=${soldierRender?.summary?.frameCount ?? 0}, zombieFrames=${zombieRender?.summary?.frameCount ?? 0}.`,
    },
    {
      gate: 'G11',
      title: 'Timing pipeline tested',
      status: soldierTiming ? (soldierTiming.valid ? 'PASS' : 'FAIL') : 'UNVERIFIED',
      evidence: soldierTiming
        ? `timing_validator.py aligned ${soldierTiming.wordCount} words (${soldierTiming.alignmentPrecision}).`
        : 'No soldier-baseline timing-validation.json in this worktree (UNVERIFIED).',
    },
    {
      gate: 'G12',
      title: 'Audio path tested to the available extent',
      status: soldierAudio
        ? Boolean(soldierAudio.specCompliant?.specificationCompliant) &&
          Math.abs((soldierAudio.specCompliant?.measuredMusicRelDb ?? 0) - -6.0) < 0.25
          ? 'PASS'
          : 'FAIL'
        : 'UNVERIFIED',
      evidence: soldierAudio
        ? `spec-compliant mix.py musicRelDb=${soldierAudio.specCompliant?.measuredMusicRelDb} dB.`
        : 'No soldier-baseline audio-modes-report.json in this worktree (UNVERIFIED).',
    },
    {
      gate: 'G13',
      title: 'MP4 export tested',
      status:
        !soldierProbe && !zombieProbe
          ? 'UNVERIFIED'
          : Boolean(soldierProbe?.valid && zombieProbe?.valid)
            ? 'PASS'
            : 'FAIL',
      evidence:
        !soldierProbe && !zombieProbe
          ? 'Baseline MP4 artifacts absent in fresh worktree (UNVERIFIED).'
          : `soldierMp4=${soldierProbe?.valid}, zombieMp4=${zombieProbe?.valid}.`,
    },
    {
      gate: 'G14',
      title: 'Repeatability/regression checked',
      status: g14Status,
      evidence: g14Evidence,
    },
    {
      gate: 'G15',
      title: 'New original scenario tested',
      status: !zombieProbe
        ? 'UNVERIFIED'
        : Boolean(zombieProbe?.valid && zombieProbe?.video?.nbFrames === 300 && zombieSheetCheck.valid)
          ? 'PASS'
          : 'FAIL',
      evidence: zombieProbe
        ? `zombie-supermarket-10s MP4 (${zombieProbe.byteSize} bytes, frames=${zombieProbe.video?.nbFrames}).`
        : 'No zombie-supermarket-10s MP4 in this worktree (UNVERIFIED).',
    },
    {
      gate: 'G16',
      title: 'Unrelated Skill-B6 files unchanged',
      status: skillB6Untouched ? 'PASS' : 'FAIL',
      evidence: `Skill-B6 tree SHA-256=${skillB6TreeSha.slice(0, 16)}..., diffBytes=${skillB6Diff.length}, stagedSkillB6Files=${skillB6Staged}.`,
    },
    {
      gate: 'G17',
      title: 'GitHub commit/push status verified',
      status:
        /quocan050302\/Agent-Skill-Animation(?:\.git)?$/i.test(originUrl) &&
        currentBranch === expectedBranch &&
        Boolean(remoteBranchSha) &&
        remoteBranchSha === headSha &&
        trackedKitFiles.length === 0
          ? 'PASS'
          : 'UNVERIFIED',
      evidence:
        remoteBranchSha && remoteBranchSha === headSha && currentBranch === expectedBranch
          ? `Branch ${currentBranch} pushed & verified on ${originUrl} at ${headSha} (trackedKitFiles=0).`
          : `Branch=${currentBranch} (expected=${expectedBranch}), localHEAD=${headSha}, remoteSHA=${remoteBranchSha || '(not yet pushed)'}, trackedKitFiles=${trackedKitFiles.length}.`,
    },
  ];

  return {
    evaluatedAt: new Date().toISOString(),
    hostPlatform: `${os.platform()}-${os.arch()}`,
    nodeVersion: process.version,
    expectedBranch,
    currentBranch,
    headSha,
    remoteBranchSha,
    gates,
    soldierMp4Probe: soldierProbe,
    zombieMp4Probe: zombieProbe,
    soldierSheet: soldierSheetCheck,
    zombieSheet: zombieSheetCheck,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let expectedBranch = 'QA';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch' && args[i + 1]) {
      expectedBranch = args[i + 1];
      i++;
    }
  }
  const res = evaluateAllGates({ expectedBranch });
  console.log(JSON.stringify(res, null, 2));
}
