import fs from 'node:fs';
import path from 'node:path';
import {
  APP_ROOT,
  FFMPEG_COMPAT_DIR,
  PYCACHE_DIR,
  SKILL_DIR,
  resolvePythonExe,
  resolveRealFfmpeg,
  resolveRealFfprobe,
} from '../config.js';
import { assertSafeId, resolveInsideRoot } from '../utils/fs-safe.js';

export interface CommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  displayCommand: string;
  outputDir: string | null;
  reportPath: string | null;
}

export class B6CommandAdapter {
  private buildEnv(): NodeJS.ProcessEnv {
    const pythonExe = resolvePythonExe();
    const realFfmpeg = resolveRealFfmpeg();
    const ffprobeExe = resolveRealFfprobe();
    const compatExe = path.join(FFMPEG_COMPAT_DIR, 'ffmpeg.exe');
    const pathParts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const venvScripts = path.dirname(pythonExe);

    const orderedPath = [
      ...(fs.existsSync(compatExe) ? [FFMPEG_COMPAT_DIR] : []),
      venvScripts,
      ...pathParts.filter((p) => path.resolve(p) !== path.resolve(FFMPEG_COMPAT_DIR) && path.resolve(p) !== path.resolve(venvScripts)),
    ].join(path.delimiter);

    return {
      ...process.env,
      PATH: orderedPath,
      B6_PYTHON: pythonExe,
      B6_REAL_FFMPEG: realFfmpeg,
      FFPROBE: ffprobeExe,
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPYCACHEPREFIX: PYCACHE_DIR,
    };
  }

  private nextOutputDir(projectDir: string, prefix: string): { rel: string; abs: string } {
    const outputsDir = path.join(projectDir, 'outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    let index = 1;
    while (fs.existsSync(path.join(outputsDir, `${prefix}-${String(index).padStart(2, '0')}`))) {
      index++;
    }
    const name = `${prefix}-${String(index).padStart(2, '0')}`;
    const rel = `outputs/${name}`;
    return { rel, abs: resolveInsideRoot(projectDir, rel) };
  }

  buildPreflight(projectDir: string, requiredViewsRel?: string): CommandSpec {
    const pythonExe = resolvePythonExe();
    const args = [path.join(projectDir, 'run.py'), 'preflight', projectDir, '--ratio', '9:16'];
    if (requiredViewsRel) {
      const rv = resolveInsideRoot(projectDir, requiredViewsRel, true);
      args.push('--required-views', rv);
    }
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py preflight . --ratio 9:16`,
      outputDir: null,
      reportPath: path.join(projectDir, 'character-preflight.json'),
    };
  }

  buildValidate(projectDir: string, ratio: '9:16' | '16:9'): CommandSpec {
    const pythonExe = resolvePythonExe();
    const args = [path.join(projectDir, 'run.py'), 'validate', projectDir, '--ratio', ratio];
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py validate . --ratio ${ratio}`,
      outputDir: null,
      reportPath: null,
    };
  }

  buildDraft(
    projectDir: string,
    ratio: '9:16' | '16:9',
    draftScale: 0.5 | 0.75 = 0.5,
    start = 0,
    seconds?: number,
    trustedCode = false,
  ): CommandSpec {
    if (!trustedCode) {
      throw new Error('Cần xác nhận trustedCode để chạy Python scene local (--trusted-code).');
    }
    const pythonExe = resolvePythonExe();
    const out = this.nextOutputDir(projectDir, 'draft');
    const args = [
      path.join(projectDir, 'run.py'),
      'draft',
      projectDir,
      '--ratio',
      ratio,
      '--trusted-code',
      '--draft-scale',
      String(draftScale),
      '--start',
      String(start),
      ...(seconds !== undefined ? ['--seconds', String(seconds)] : []),
      '--output',
      out.rel,
    ];
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py draft . --ratio ${ratio} --trusted-code --draft-scale ${draftScale} --output ${out.rel}`,
      outputDir: out.abs,
      reportPath: path.join(out.abs, 'report.json'),
    };
  }

  buildPreview(
    projectDir: string,
    ratio: '9:16' | '16:9',
    start = 0,
    seconds?: number,
    trustedCode = false,
  ): CommandSpec {
    if (!trustedCode) {
      throw new Error('Cần xác nhận trustedCode để chạy Python scene local (--trusted-code).');
    }
    const pythonExe = resolvePythonExe();
    const out = this.nextOutputDir(projectDir, 'preview');
    const args = [
      path.join(projectDir, 'run.py'),
      'preview',
      projectDir,
      '--ratio',
      ratio,
      '--trusted-code',
      '--start',
      String(start),
      ...(seconds !== undefined ? ['--seconds', String(seconds)] : []),
      '--output',
      out.rel,
    ];
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py preview . --ratio ${ratio} --trusted-code --output ${out.rel}`,
      outputDir: out.abs,
      reportPath: path.join(out.abs, 'report.json'),
    };
  }

  buildReviewPack(
    projectDir: string,
    ratio: '9:16' | '16:9',
    reportRel: string,
    previousReviewRel?: string,
  ): CommandSpec {
    const pythonExe = resolvePythonExe();
    resolveInsideRoot(projectDir, reportRel, true);
    const out = this.nextOutputDir(projectDir, 'review');
    const args = [
      path.join(projectDir, 'run.py'),
      'review-pack',
      projectDir,
      '--ratio',
      ratio,
      '--report',
      reportRel,
      '--output',
      out.rel,
    ];
    if (previousReviewRel) {
      resolveInsideRoot(projectDir, previousReviewRel, true);
      args.push('--review', previousReviewRel);
    }
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py review-pack . --ratio ${ratio} --report ${reportRel} --output ${out.rel}`,
      outputDir: out.abs,
      reportPath: path.join(out.abs, 'motion-review.json'),
    };
  }

  buildCheckReview(
    projectDir: string,
    ratio: '9:16' | '16:9',
    reviewRel: string,
    reportRel?: string,
  ): CommandSpec {
    const pythonExe = resolvePythonExe();
    resolveInsideRoot(projectDir, reviewRel, true);
    const args = [
      path.join(projectDir, 'run.py'),
      'check-review',
      projectDir,
      '--ratio',
      ratio,
      '--review',
      reviewRel,
    ];
    if (reportRel) {
      resolveInsideRoot(projectDir, reportRel, true);
      args.push('--report', reportRel);
    }
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py check-review . --ratio ${ratio} --review ${reviewRel}`,
      outputDir: null,
      reportPath: resolveInsideRoot(projectDir, reviewRel, true),
    };
  }

  buildApprove(
    projectDir: string,
    ratio: '9:16' | '16:9',
    reportRel: string,
    reviewRel: string,
    note: string,
  ): CommandSpec {
    if (!note || !note.trim()) {
      throw new Error('Phải nhập ghi chú phê duyệt thực tế của người dùng.');
    }
    const pythonExe = resolvePythonExe();
    resolveInsideRoot(projectDir, reportRel, true);
    resolveInsideRoot(projectDir, reviewRel, true);
    const args = [
      path.join(projectDir, 'run.py'),
      'approve',
      projectDir,
      '--ratio',
      ratio,
      '--report',
      reportRel,
      '--review',
      reviewRel,
      '--note',
      note.trim(),
    ];
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py approve . --ratio ${ratio} --report ${reportRel} --review ${reviewRel}`,
      outputDir: null,
      reportPath: path.join(projectDir, `approval-${ratio.replace(':', 'x')}.json`),
    };
  }

  buildRender(
    projectDir: string,
    ratio: '9:16' | '16:9',
    trustedCode = false,
  ): CommandSpec {
    if (!trustedCode) {
      throw new Error('Cần xác nhận trustedCode để chạy render full local (--trusted-code).');
    }
    const pythonExe = resolvePythonExe();
    const out = this.nextOutputDir(projectDir, 'film');
    const args = [
      path.join(projectDir, 'run.py'),
      'render',
      projectDir,
      '--ratio',
      ratio,
      '--trusted-code',
      '--output',
      out.rel,
    ];
    return {
      executable: pythonExe,
      args,
      cwd: projectDir,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} run.py render . --ratio ${ratio} --trusted-code --output ${out.rel}`,
      outputDir: out.abs,
      reportPath: path.join(out.abs, 'report.json'),
    };
  }

  buildDoctor(): CommandSpec {
    const pythonExe = resolvePythonExe();
    return {
      executable: process.execPath,
      args: [path.join(SKILL_DIR, 'scripts', 'autopilot.mjs'), 'doctor', '--style', 'B6', '--python', pythonExe],
      cwd: SKILL_DIR,
      env: this.buildEnv(),
      displayCommand: `node scripts/autopilot.mjs doctor --style B6`,
      outputDir: null,
      reportPath: null,
    };
  }

  buildAnalyzeEditorial(
    projectDir: string,
    ratio: '9:16' | '16:9',
    opts: {
      videoRel?: string;
      reportRel?: string;
      evidenceRel?: string;
    } = {},
  ): CommandSpec {
    const pythonExe = resolvePythonExe();
    const cliPath = path.join(APP_ROOT, 'editorial_runtime', 'b6_editorial_cli.py');
    if (!fs.existsSync(cliPath)) {
      throw new Error('Không tìm thấy editorial_runtime/b6_editorial_cli.py.');
    }

    let reportAbs: string | null = null;
    if (opts.reportRel) {
      reportAbs = resolveInsideRoot(projectDir, opts.reportRel, true);
    }

    let videoRel = opts.videoRel;
    if (!videoRel && reportAbs) {
      try {
        const rep = JSON.parse(fs.readFileSync(reportAbs, 'utf8')) as { video?: string };
        if (typeof rep.video === 'string' && rep.video.length > 0) {
          videoRel = rep.video;
        }
      } catch {
        throw new Error(`Không đọc được report JSON hợp lệ từ "${opts.reportRel}".`);
      }
    }
    if (!videoRel) {
      throw new Error('Cần có videoRel hoặc preview report chứa đường dẫn video MP4 để phân tích Editorial.');
    }
    const videoAbs = resolveInsideRoot(projectDir, videoRel, true);

    const outDirAbs = reportAbs ? path.dirname(reportAbs) : this.nextOutputDir(projectDir, 'editorial').abs;
    const outDirRel = path.relative(projectDir, outDirAbs).replace(/\\/g, '/');

    const args = [
      cliPath,
      '--video',
      videoAbs,
      '--out-dir',
      outDirAbs,
      '--ratio',
      ratio,
      '--chart',
      '--contact-sheet',
    ];

    const sceneControlPath = path.join(projectDir, 'scene-control.json');
    if (fs.existsSync(sceneControlPath)) {
      args.push('--scene-control', sceneControlPath);
    }
    if (reportAbs) {
      args.push('--report', reportAbs);
    }

    const evCandidates = [
      opts.evidenceRel ? resolveInsideRoot(projectDir, opts.evidenceRel, false) : null,
      path.join(outDirAbs, 'editorial_evidence.json'),
      path.join(outDirAbs, 'motion_evidence.json'),
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));
    if (evCandidates[0]) {
      args.push('--evidence', evCandidates[0]);
    }

    return {
      executable: pythonExe,
      args,
      cwd: APP_ROOT,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} editorial_runtime/b6_editorial_cli.py --video ${videoRel} --out-dir ${outDirRel} --ratio ${ratio}`,
      // Never point outputDir at an existing preview folder so job cancel cannot delete rendered preview artifacts.
      outputDir: null,
      reportPath: path.join(outDirAbs, 'editorial_qc.json'),
    };
  }

  buildAnalyzeSemantic(
    projectDir: string,
    ratio: '9:16' | '16:9',
    opts: {
      videoRel?: string;
      reportRel?: string;
      evidenceRel?: string;
    } = {},
  ): CommandSpec {
    const pythonExe = resolvePythonExe();
    const cliPath = path.join(APP_ROOT, 'semantic_runtime', 'b6_semantic_cli.py');
    if (!fs.existsSync(cliPath)) {
      throw new Error('Không tìm thấy semantic_runtime/b6_semantic_cli.py.');
    }

    let reportAbs: string | null = null;
    if (opts.reportRel) {
      reportAbs = resolveInsideRoot(projectDir, opts.reportRel, true);
    }

    let videoRel = opts.videoRel;
    if (!videoRel && reportAbs) {
      try {
        const rep = JSON.parse(fs.readFileSync(reportAbs, 'utf8')) as { video?: string };
        if (typeof rep.video === 'string' && rep.video.length > 0) {
          videoRel = rep.video;
        }
      } catch {
        throw new Error(`Không đọc được report JSON hợp lệ từ "${opts.reportRel}".`);
      }
    }
    if (!videoRel) {
      throw new Error('Cần có videoRel hoặc preview report chứa đường dẫn video MP4 để phân tích Semantic.');
    }
    const videoAbs = resolveInsideRoot(projectDir, videoRel, true);
    const outDirAbs = reportAbs ? path.dirname(reportAbs) : path.dirname(videoAbs);
    const outDirRel = path.relative(projectDir, outDirAbs).replace(/\\/g, '/');
    const sceneControlPath = path.join(projectDir, 'scene-control.json');
    if (!fs.existsSync(sceneControlPath)) {
      throw new Error('Thiếu scene-control.json để kiểm định Semantic.');
    }

    const args = [
      cliPath,
      '--video',
      videoAbs,
      '--out-dir',
      outDirAbs,
      '--scene-control',
      sceneControlPath,
    ];
    if (reportAbs) {
      args.push('--report', reportAbs);
    }
    const evCandidates = [
      opts.evidenceRel ? resolveInsideRoot(projectDir, opts.evidenceRel, false) : null,
      path.join(outDirAbs, 'semantic-evidence.jsonl'),
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));
    if (evCandidates[0]) {
      args.push('--evidence', evCandidates[0]);
    }

    return {
      executable: pythonExe,
      args,
      cwd: APP_ROOT,
      env: this.buildEnv(),
      displayCommand: `${path.basename(pythonExe)} semantic_runtime/b6_semantic_cli.py --video ${videoRel} --out-dir ${outDirRel} (${ratio})`,
      outputDir: null,
      reportPath: path.join(outDirAbs, 'semantic_qc.json'),
    };
  }

  assertSafeOutputRel(projectId: string, rel: string): string {
    assertSafeId(projectId);
    return rel;
  }
}
