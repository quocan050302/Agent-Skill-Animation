import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SKILL_DIR, VENDOR_ROOT } from '../config.js';

export interface UpstreamInfo {
  ok: boolean;
  repoUrl: string;
  localPath: string;
  branch: string;
  commitSha: string;
  license: string;
  primaryReference: {
    id: string;
    path: string;
    expectedSha256: string;
    actualSha256: string | null;
    verified: boolean;
  };
  packCheck: {
    ok: boolean;
    files?: number;
    error?: string;
  };
}

export class UpstreamService {
  getInfo(): UpstreamInfo {
    const exists = fs.existsSync(path.join(VENDOR_ROOT, '.git'));
    let branch = 'unknown';
    let commitSha = 'unknown';
    if (exists) {
      const bRes = spawnSync('git', ['branch', '--show-current'], { cwd: VENDOR_ROOT, encoding: 'utf8', shell: false });
      if (bRes.status === 0) branch = bRes.stdout.trim() || 'HEAD';
      const sRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: VENDOR_ROOT, encoding: 'utf8', shell: false });
      if (sRes.status === 0) commitSha = sRes.stdout.trim();
    }

    const styleStandardPath = path.join(SKILL_DIR, 'assets', 'b6', 'style-standard.json');
    let refId = 'sample-1-eiffel-portrait-v44';
    let refRel = 'reference/eiffel-portrait-v44.mp4';
    let expectedSha = '';
    let actualSha: string | null = null;
    if (fs.existsSync(styleStandardPath)) {
      const std = JSON.parse(fs.readFileSync(styleStandardPath, 'utf8')) as {
        reference: { id: string; path: string; sha256: string };
      };
      refId = std.reference.id;
      refRel = std.reference.path;
      expectedSha = std.reference.sha256;
      const absRef = path.join(SKILL_DIR, 'assets', 'b6', refRel);
      if (fs.existsSync(absRef)) {
        actualSha = crypto.createHash('sha256').update(fs.readFileSync(absRef)).digest('hex');
      }
    }

    const packRes = spawnSync(
      process.execPath,
      [path.join(SKILL_DIR, 'scripts', 'b6-dynamic-meme.mjs'), 'check-pack'],
      { cwd: SKILL_DIR, encoding: 'utf8', shell: false, timeout: 15000 },
    );
    let packOk = packRes.status === 0;
    let packFiles: number | undefined;
    let packError: string | undefined;
    if (packOk) {
      try {
        const parsed = JSON.parse(packRes.stdout) as { ok?: boolean; files?: number };
        packOk = Boolean(parsed.ok);
        packFiles = parsed.files;
      } catch {
        packOk = false;
      }
    } else {
      packError = packRes.stderr || packRes.stdout;
    }

    const licensePath = path.join(VENDOR_ROOT, 'LICENSE');
    const license = fs.existsSync(licensePath) ? 'MIT License (bundled)' : 'Unknown';

    return {
      ok: exists && Boolean(actualSha && actualSha === expectedSha) && packOk,
      repoUrl: 'https://github.com/kaomei/stickman-video-director',
      localPath: VENDOR_ROOT,
      branch,
      commitSha,
      license,
      primaryReference: {
        id: refId,
        path: path.join(SKILL_DIR, 'assets', 'b6', refRel),
        expectedSha256: expectedSha,
        actualSha256: actualSha,
        verified: Boolean(actualSha && actualSha === expectedSha),
      },
      packCheck: {
        ok: packOk,
        files: packFiles,
        error: packError,
      },
    };
  }
}
