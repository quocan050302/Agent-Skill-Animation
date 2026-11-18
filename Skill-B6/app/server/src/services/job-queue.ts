import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { JobKind, JobRecord, Ratio } from '@b6-studio/shared';
import { JOBS_DIR, PROJECTS_DIR, resolveMinFreeBytesRender } from '../config.js';
import { getFreeDiskBytes, readJsonFile, writeAtomicJson } from '../utils/fs-safe.js';
import type { CommandSpec } from './b6-command-adapter.js';
import type { StudioMeta } from './project-service.js';
import type { QaEvidenceResolver } from './qa-evidence-service.js';

interface QueuedTask {
  job: JobRecord;
  spec: CommandSpec;
  heavyEncode: boolean;
}

export class JobQueue extends EventEmitter {
  private readonly jobsDir: string;
  private readonly projectsDir: string;
  private readonly queue: QueuedTask[] = [];
  private readonly activeJobs = new Map<string, JobRecord>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly saveChains = new Map<string, Promise<void>>();
  private readonly activeRuns = new Set<Promise<void>>();
  private readonly activeProjectLocks = new Set<string>();
  private readonly cancelledJobIds = new Set<string>();
  private isShuttingDown = false;
  private activeHeavyCount = 0;
  private readonly maxHeavyConcurrency = 1;
  private readonly maxLightConcurrency = 2;
  private activeLightCount = 0;

  constructor(
    jobsDir = JOBS_DIR,
    projectsDir = PROJECTS_DIR,
    private readonly qaResolver?: QaEvidenceResolver,
  ) {
    super();
    this.jobsDir = jobsDir;
    this.projectsDir = projectsDir;
    fs.mkdirSync(this.jobsDir, { recursive: true });
    this.recoverInterruptedJobsSync();
  }

  private jobJsonPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private jobLogPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.log`);
  }

  private recoverInterruptedJobsSync(): void {
    const files = fs.readdirSync(this.jobsDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const p = path.join(this.jobsDir, f);
        const job = JSON.parse(fs.readFileSync(p, 'utf8')) as JobRecord;
        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'interrupted';
          job.completedAt = new Date().toISOString();
          job.stageLabel = 'Bị gián đoạn do server khởi động lại';
          job.errorMessage = 'Tiến trình bị ngắt khi server tắt hoặc khởi động lại; không giả lập job vẫn đang chạy.';
          fs.writeFileSync(p, JSON.stringify(job, null, 2) + '\n');
          fs.appendFileSync(
            this.jobLogPath(job.id),
            `[${job.completedAt}] [SYSTEM] Marked interrupted on server startup.\n`,
          );
        }
      } catch {
        // ignore unreadable job file
      }
    }
  }

  async listJobs(projectId?: string): Promise<JobRecord[]> {
    const files = (await fsp.readdir(this.jobsDir)).filter((f) => f.endsWith('.json'));
    const jobs: JobRecord[] = [];
    for (const f of files) {
      try {
        const job = await readJsonFile<JobRecord>(path.join(this.jobsDir, f));
        if (!projectId || job.projectId === projectId) {
          jobs.push(job);
        }
      } catch {
        // ignore corrupt
      }
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getJob(jobId: string): Promise<JobRecord> {
    if (!/^[a-zA-Z0-9_-]{4,80}$/.test(jobId)) {
      throw new Error('Job ID không hợp lệ.');
    }
    const mem = this.activeJobs.get(jobId);
    if (mem) {
      const clone = { ...mem };
      if (clone.status === 'running' && clone.startedAt) {
        clone.elapsedMs = Math.max(0, Date.now() - Date.parse(clone.startedAt));
      }
      return clone;
    }
    const p = this.jobJsonPath(jobId);
    if (!fs.existsSync(p)) {
      throw new Error(`Không tìm thấy job: ${jobId}`);
    }
    const job = await readJsonFile<JobRecord>(p);
    if (job.status === 'running' && job.startedAt) {
      job.elapsedMs = Math.max(0, Date.now() - Date.parse(job.startedAt));
    }
    return job;
  }

  async readLogs(jobId: string, tailLines = 300): Promise<string[]> {
    const logPath = this.jobLogPath(jobId);
    if (!fs.existsSync(logPath)) return [];
    const content = await fsp.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.slice(-tailLines);
  }

  async enqueue(opts: {
    projectId: string | null;
    kind: JobKind;
    ratio?: Ratio;
    spec: CommandSpec;
    heavyEncode?: boolean;
    estimatedTempBytes?: number;
  }): Promise<JobRecord> {
    const heavyEncode = opts.heavyEncode ?? ['draft', 'preview', 'render', 'review-pack'].includes(opts.kind);

    if (heavyEncode) {
      const freeBytes = getFreeDiskBytes(this.projectsDir);
      const minFreeRequired = resolveMinFreeBytesRender(opts.estimatedTempBytes ?? 150 * 1024 * 1024);
      if (freeBytes < minFreeRequired) {
        const freeMiB = Math.round(freeBytes / (1024 * 1024));
        const reqMiB = Math.round(minFreeRequired / (1024 * 1024));
        throw new Error(
          `Không đủ dung lượng đĩa trống để render (${freeMiB} MiB còn lại; yêu cầu tối thiểu ${reqMiB} MiB).`,
        );
      }
    }

    if (opts.projectId && this.activeProjectLocks.has(opts.projectId)) {
      throw new Error(`Dự án "${opts.projectId}" đang có một tác vụ B6 đang chạy. Hãy đợi xong hoặc hủy tác vụ hiện tại.`);
    }
    if (opts.projectId && this.queue.some((q) => q.job.projectId === opts.projectId)) {
      throw new Error(`Dự án "${opts.projectId}" đã có tác vụ đang nằm trong hàng đợi.`);
    }

    const jobId = `job-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const job: JobRecord = {
      id: jobId,
      projectId: opts.projectId,
      kind: opts.kind,
      ratio: opts.ratio,
      status: 'queued',
      stageLabel: 'Đang chờ trong hàng đợi',
      commandDisplay: opts.spec.displayCommand,
      cwd: opts.spec.cwd,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      elapsedMs: 0,
      exitCode: null,
      frameProgress: null,
      outputDir: opts.spec.outputDir,
      reportPath: opts.spec.reportPath,
      videoPath: null,
      resultJson: null,
      errorMessage: null,
    };

    this.activeJobs.set(jobId, job);
    await this.saveJob(job);
    await fsp.writeFile(
      this.jobLogPath(jobId),
      `[${job.createdAt}] [QUEUE] ${opts.spec.displayCommand}\n`,
      'utf8',
    );

    this.queue.push({ job, spec: opts.spec, heavyEncode });
    void this.pump();
    return { ...job };
  }

  private emitJobEvent(jobId: string, event: string, data: unknown): void {
    this.emit(`job:${jobId}`, { event, data });
  }

  private async appendLog(jobId: string, line: string): Promise<void> {
    const clean = line.replace(/\r?\n$/, '');
    if (!clean) return;
    const stamped = `[${new Date().toISOString()}] ${clean}\n`;
    await fsp.appendFile(this.jobLogPath(jobId), stamped, 'utf8');
    this.emitJobEvent(jobId, 'log', { line: stamped.trimEnd() });
  }

  private async saveJob(job: JobRecord): Promise<void> {
    const snapshot: JobRecord = { ...job };
    const prev = this.saveChains.get(job.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        await writeAtomicJson(this.jobJsonPath(job.id), snapshot);
        this.emitJobEvent(job.id, 'status', snapshot);
      });
    this.saveChains.set(job.id, next);
    await next;
  }

  private async pump(): Promise<void> {
    if (this.isShuttingDown) return;
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      if (item.job.projectId && this.activeProjectLocks.has(item.job.projectId)) continue;
      if (item.heavyEncode && this.activeHeavyCount >= this.maxHeavyConcurrency) continue;
      if (!item.heavyEncode && this.activeLightCount >= this.maxLightConcurrency) continue;

      this.queue.splice(i, 1);
      i--;
      const p = this.runTask(item).finally(() => {
        this.activeRuns.delete(p);
      });
      this.activeRuns.add(p);
    }
  }

  private async runTask(item: QueuedTask): Promise<void> {
    const { job, spec, heavyEncode } = item;
    if (job.projectId) this.activeProjectLocks.add(job.projectId);
    if (heavyEncode) this.activeHeavyCount++;
    else this.activeLightCount++;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const allStdout: string[] = [];
    const allStderr: string[] = [];

    try {
      if (this.cancelledJobIds.has(job.id)) {
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        job.stageLabel = 'Đã hủy trước khi chạy';
        await this.cleanupCancelledOutput(job.outputDir);
        return;
      }

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.stageLabel = `Đang chạy ${job.kind}`;
      await this.saveJob(job);

      if (this.cancelledJobIds.has(job.id)) {
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        job.stageLabel = 'Đã hủy bởi người dùng';
        await this.cleanupCancelledOutput(job.outputDir);
        return;
      }

      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.activeProcesses.set(job.id, child);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          allStdout.push(line);
          void this.appendLog(job.id, `[OUT] ${line}`);
          this.inspectProgressLine(job, line);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          allStderr.push(line);
          void this.appendLog(job.id, `[ERR] ${line}`);
        }
      });

      const exitCode: number | null = await new Promise((resolve) => {
        child.on('error', (err) => {
          allStderr.push(err.message);
          void this.appendLog(job.id, `[SPAWN ERROR] ${err.message}`);
          resolve(-1);
        });
        child.on('exit', (code) => resolve(code));
      });

      if (stdoutBuffer.trim()) {
        allStdout.push(stdoutBuffer.trim());
        await this.appendLog(job.id, `[OUT] ${stdoutBuffer.trim()}`);
      }
      if (stderrBuffer.trim()) {
        allStderr.push(stderrBuffer.trim());
        await this.appendLog(job.id, `[ERR] ${stderrBuffer.trim()}`);
      }

      this.activeProcesses.delete(job.id);
      job.completedAt = new Date().toISOString();
      job.elapsedMs = job.startedAt ? Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt)) : 0;
      job.exitCode = exitCode;

      if (this.cancelledJobIds.has(job.id)) {
        job.status = 'cancelled';
        job.stageLabel = 'Đã hủy bởi người dùng';
        await this.cleanupCancelledOutput(job.outputDir);
      } else if (exitCode === 0) {
        const parsed = this.extractResultJson(allStdout.join('\n'), job.reportPath);
        job.resultJson = parsed;
        let verificationError: string | null = null;
        const requiresArtifactCheck = ['draft', 'preview', 'render', 'review-pack'].includes(job.kind);

        if (requiresArtifactCheck) {
          if (job.reportPath && !fs.existsSync(job.reportPath)) {
            verificationError = `Thiếu tệp báo cáo đầu ra sau khi kết thúc ${job.kind}: ${path.basename(job.reportPath)}`;
          } else if (['draft', 'preview', 'render'].includes(job.kind)) {
            const videoRel = parsed && typeof parsed.video === 'string' ? parsed.video : null;
            if (!videoRel || !job.projectId) {
              verificationError = `Báo cáo ${job.kind} thiếu trường video đầu ra.`;
            } else {
              const videoAbs = path.resolve(this.projectsDir, job.projectId, videoRel);
              if (!fs.existsSync(videoAbs) || fs.statSync(videoAbs).size <= 0) {
                verificationError = `Tệp video đầu ra bị thiếu hoặc rỗng: ${videoRel}`;
              } else {
                job.videoPath = videoRel;
              }
            }
            if (!verificationError && parsed && parsed.technical_status && parsed.technical_status !== 'pass' && job.kind !== 'draft') {
              verificationError = `Báo cáo ${job.kind} ghi technical_status=${String(parsed.technical_status)}`;
            }
          }
        }

        if (verificationError) {
          job.status = 'failed';
          job.stageLabel = `Lỗi xác minh artifact ${job.kind}`;
          job.errorMessage = verificationError;
        } else {
          job.status = 'succeeded';
          job.stageLabel = `Hoàn tất ${job.kind}`;
          if (parsed && typeof parsed.video === 'string' && job.projectId && !job.videoPath) {
            job.videoPath = parsed.video;
          }
          if (job.projectId && ['preview', 'render'].includes(job.kind)) {
            const metaPath = path.join(this.projectsDir, job.projectId, 'studio.meta.json');
            if (fs.existsSync(metaPath)) {
              try {
                const meta = await readJsonFile<StudioMeta>(metaPath);
                meta.lastRenderedRevision = Number(meta.revision ?? 1);
                await writeAtomicJson(metaPath, meta);
              } catch {
                // non-fatal
              }
            }
          }
        }

        if (job.projectId) {
          this.qaResolver?.invalidateProject(path.join(this.projectsDir, job.projectId));
        }
      } else {
        job.status = 'failed';
        job.stageLabel = `Lỗi ${job.kind} (exit ${exitCode})`;
        job.errorMessage = allStderr.slice(-8).join('\n') || allStdout.slice(-6).join('\n') || `Command exited with ${exitCode}`;
      }
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.stageLabel = `Lỗi hệ thống`;
      job.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (job.projectId) this.activeProjectLocks.delete(job.projectId);
      if (heavyEncode) this.activeHeavyCount--;
      else this.activeLightCount--;
      try {
        await this.saveJob(job);
      } finally {
        this.cancelledJobIds.delete(job.id);
        this.activeJobs.delete(job.id);
        this.saveChains.delete(job.id);
      }
      void this.pump();
    }
  }

  private inspectProgressLine(job: JobRecord, line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      const obj = JSON.parse(trimmed) as { checked_frame?: number; total?: number };
      if (typeof obj.checked_frame === 'number' && typeof obj.total === 'number' && obj.total > 0) {
        job.frameProgress = { checkedFrame: obj.checked_frame, totalFrames: obj.total };
        if (job.startedAt) {
          job.elapsedMs = Math.max(0, Date.now() - Date.parse(job.startedAt));
        }
        job.stageLabel = `Đang render frame ${obj.checked_frame}/${obj.total}`;
        void this.saveJob(job);
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  private extractResultJson(stdout: string, reportPath: string | null): Record<string, unknown> | null {
    const idx = stdout.lastIndexOf('RESULT ');
    if (idx >= 0) {
      try {
        return JSON.parse(stdout.slice(idx + 7).trim()) as Record<string, unknown>;
      } catch {
        // fallback to reportPath
      }
    }
    try {
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed) as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    if (reportPath && fs.existsSync(reportPath)) {
      try {
        return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async cleanupCancelledOutput(outputDir: string | null): Promise<void> {
    if (!outputDir) return;
    try {
      const realProjects = fs.realpathSync(this.projectsDir);
      const resolved = path.resolve(outputDir);
      if (resolved.startsWith(realProjects + path.sep) && fs.existsSync(resolved)) {
        await fsp.rm(resolved, { recursive: true, force: true });
      }
    } catch {
      // never delete outside projects
    }
  }

  async cancelJob(jobId: string): Promise<JobRecord> {
    const job = this.activeJobs.get(jobId) ?? (await this.getJob(jobId));
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
      return { ...job };
    }

    this.cancelledJobIds.add(jobId);

    const queuedIndex = this.queue.findIndex((q) => q.job.id === jobId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.stageLabel = 'Đã hủy khỏi hàng đợi';
      await this.appendLog(jobId, '[CANCEL] Removed from queue.');
      await this.saveJob(job);
      this.activeJobs.delete(jobId);
      this.cancelledJobIds.delete(jobId);
      return { ...job };
    }

    job.status = 'cancelled';
    job.stageLabel = 'Đang hủy tiến trình...';
    const child = this.activeProcesses.get(jobId);
    if (!child || !child.pid) {
      await this.appendLog(jobId, '[CANCEL] Cancel requested during startup.');
      await this.saveJob(job);
      return { ...job };
    }

    await this.appendLog(jobId, `[CANCEL] Terminating PID ${child.pid} process tree...`);
    await this.saveJob(job);

    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, timeout: 8000 });
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 2500);
    }
    return { ...job };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const activeIds = [
      ...this.queue.map((q) => q.job.id),
      ...this.activeProcesses.keys(),
      ...this.activeJobs.keys(),
    ];
    for (const id of new Set(activeIds)) {
      await this.cancelJob(id).catch(() => {});
    }
    await Promise.allSettled([...this.activeRuns, ...this.saveChains.values()]);
  }
}
