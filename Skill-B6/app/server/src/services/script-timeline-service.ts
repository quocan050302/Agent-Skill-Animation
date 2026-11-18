import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CaptionCue, PatchProjectInput, ShotItem } from '@b6-studio/shared';
import { APP_ROOT, resolvePythonExe, resolveRealFfprobe } from '../config.js';
import { readJsonFile, resolveInsideRoot, sha256File, writeAtomicFile, writeAtomicJson } from '../utils/fs-safe.js';
import { EditorBindingService, SCENE_RUNTIME_PY_SOURCE } from './editor-binding-service.js';
import type { ProjectDetail, ProjectService } from './project-service.js';
import type { QaEvidenceResolver } from './qa-evidence-service.js';

export interface TimelineValidationResult {
  valid: boolean;
  errors: string[];
  totalDuration: number;
}

export function validateTimelineData(
  shots: ShotItem[],
  captions: CaptionCue[],
  narration: string,
  expectedDuration: number | null,
): TimelineValidationResult {
  const errors: string[] = [];

  if (shots.length > 0) {
    let cursor = 0;
    const seenIds = new Set<string>();
    for (const shot of shots) {
      if (seenIds.has(shot.id)) {
        errors.push(`Trùng mã phân cảnh (shot id): ${shot.id}`);
      }
      seenIds.add(shot.id);
      if (Math.abs(shot.start - cursor) > 0.001) {
        errors.push(`Phân cảnh "${shot.id}" bị hở hoặc chồng lấn thời gian (bắt đầu ${shot.start}s, mong đợi ${cursor.toFixed(3)}s).`);
      }
      if (shot.end <= shot.start) {
        errors.push(`Phân cảnh "${shot.id}" có thời lượng <= 0.`);
      }
      if (shot.end - shot.start < 0.9 && !shot.short_cut_reason?.trim()) {
        errors.push(`Phân cảnh "${shot.id}" dưới 0.9s nhưng chưa có lý do (short_cut_reason).`);
      }
      const keys = shot.cameraKeys ?? [];
      if (keys.length === 0 || Math.abs(keys[0].t) > 0.001) {
        errors.push(`Phân cảnh "${shot.id}" cần keyframe camera đầu tiên tại t=0.`);
      } else {
        let prevT = -1;
        for (const k of keys) {
          if (k.t <= prevT) {
            errors.push(`Phân cảnh "${shot.id}": các keyframe camera phải tăng dần theo thời gian.`);
            break;
          }
          if (k.t > shot.end - shot.start + 0.001) {
            errors.push(`Phân cảnh "${shot.id}": keyframe camera vượt quá thời lượng shot.`);
            break;
          }
          prevT = k.t;
        }
      }
      if (shot.motion) {
        const m = shot.motion;
        if (![m.startX, m.endX, m.startY, m.endY].every((v) => Number.isFinite(v))) {
          errors.push(`Phân cảnh "${shot.id}": tọa độ motion startX/endX/startY/endY phải hữu hạn.`);
        }
        if (m.gait) {
          if (!Number.isFinite(m.gait.cadenceHz) || m.gait.cadenceHz <= 0 || m.gait.cadenceHz > 8) {
            errors.push(`Phân cảnh "${shot.id}": gait.cadenceHz phải nằm trong (0, 8].`);
          }
          if (!Number.isFinite(m.gait.strideLen) || m.gait.strideLen <= 0) {
            errors.push(`Phân cảnh "${shot.id}": gait.strideLen phải > 0.`);
          }
          if (!Number.isFinite(m.gait.footLift) || m.gait.footLift < 0) {
            errors.push(`Phân cảnh "${shot.id}": gait.footLift phải >= 0.`);
          }
        }
        if (m.contacts) {
          const seenContact = new Set<string>();
          const span = shot.end - shot.start + 0.001;
          for (const c of m.contacts) {
            if (seenContact.has(c.id)) {
              errors.push(`Phân cảnh "${shot.id}": trùng contact id "${c.id}".`);
            }
            seenContact.add(c.id);
            if (!Number.isFinite(c.t0) || !Number.isFinite(c.t1) || c.t1 <= c.t0 || c.t1 > span) {
              errors.push(`Phân cảnh "${shot.id}": khoảng contact "${c.id}" không hợp lệ trong thời lượng shot.`);
            }
          }
        }
      }
      cursor = shot.end;
    }

    if (expectedDuration !== null && Math.abs(cursor - expectedDuration) > 1 / 30) {
      errors.push(`Tổng thời lượng phân cảnh (${cursor.toFixed(3)}s) không khớp thời lượng dự án (${expectedDuration}s).`);
    }
  }

  let capEnd = 0;
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    if (/[\r\n]/.test(c.text) || !c.text.trim()) {
      errors.push(`Phụ đề #${i + 1} phải là 1 dòng duy nhất và không rỗng.`);
    }
    if (c.start < capEnd - 0.001) {
      errors.push(`Phụ đề #${i + 1} bị chồng lấn thời gian với câu trước.`);
    }
    if (c.end <= c.start) {
      errors.push(`Phụ đề #${i + 1} có thời gian kết thúc <= bắt đầu.`);
    }
    if (expectedDuration !== null && c.end > expectedDuration + 0.001) {
      errors.push(`Phụ đề #${i + 1} vượt quá tổng thời lượng dự án (${expectedDuration}s).`);
    }
    capEnd = c.end;
  }

  if (narration.trim() && captions.length > 0) {
    const joined = captions.map((c) => c.text.trim()).join(' ').trim();
    if (joined !== narration.trim()) {
      errors.push('Chuỗi phụ đề ghép lại chưa khớp chính xác với nội dung narration trong story.json.');
    }
  }

  const totalDuration = shots.length > 0 ? shots[shots.length - 1].end : expectedDuration ?? 0;
  return {
    valid: errors.length === 0,
    errors,
    totalDuration,
  };
}

function normalizeShotsFromPlan(rawShots: Array<Record<string, unknown>>): ShotItem[] {
  return rawShots.map((s, idx) => ({
    id: String(s.id ?? `shot_${idx + 1}`),
    start: Number(s.start ?? 0),
    end: Number(s.end ?? 0),
    actor: String(s.actor ?? ''),
    environment: String(s.environment ?? ''),
    sceneGoal: String(s.sceneGoal ?? ''),
    composition: String(s.composition ?? 'wide'),
    action: String(s.action ?? 'action'),
    expression: String(s.expression ?? 'neutral'),
    props: Array.isArray(s.props) ? s.props.map(String) : [],
    staging: (s.staging && typeof s.staging === 'object' ? s.staging : {}) as ShotItem['staging'],
    camera: String(s.camera ?? 'hold'),
    cameraKeys: Array.isArray(s.cameraKeys)
      ? (s.cameraKeys as ShotItem['cameraKeys'])
      : Array.isArray(s.camera_keys)
      ? (s.camera_keys as ShotItem['cameraKeys'])
      : [{ t: 0, x: 0, y: -210, z: 0, fov: 55 }],
    easing: s.easing as ShotItem['easing'],
    actorStart: s.actorStart as ShotItem['actorStart'],
    actorEnd: s.actorEnd as ShotItem['actorEnd'],
    propKeyframes: Array.isArray(s.propKeyframes) ? (s.propKeyframes as ShotItem['propKeyframes']) : undefined,
    motionMode: s.motionMode as ShotItem['motionMode'],
    motion: s.motion as ShotItem['motion'],
    cameraPreset: s.cameraPreset as ShotItem['cameraPreset'],
    visualBeat: s.visualBeat as ShotItem['visualBeat'],
    editorial: s.editorial as ShotItem['editorial'],
    semanticActions: Array.isArray(s.semanticActions)
      ? (s.semanticActions as ShotItem['semanticActions'])
      : Array.isArray(s.semantic_actions)
      ? (s.semantic_actions as ShotItem['semanticActions'])
      : undefined,
    transition: String(s.transition ?? 'cut'),
    short_cut_reason: typeof s.short_cut_reason === 'string' ? s.short_cut_reason : undefined,
    asset_inputs: Array.isArray(s.asset_inputs) ? s.asset_inputs.map(String) : [],
    sfx: typeof s.sfx === 'string' ? s.sfx : '',
  }));
}

export class ScriptTimelineService {
  private readonly projectLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly editorBindingService: EditorBindingService = new EditorBindingService(),
    private readonly qaResolver?: QaEvidenceResolver,
    private readonly onBeforeCommitFile?: (relPath: string, writeIndex: number) => void | Promise<void>,
  ) {}

  private async withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.projectLocks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const nextChain = prev.catch(() => {}).then(() => gate);
    this.projectLocks.set(projectId, nextChain);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.projectLocks.get(projectId) === nextChain) {
        this.projectLocks.delete(projectId);
      }
    }
  }

  async patchProject(projectId: string, patch: PatchProjectInput): Promise<{ detail: ProjectDetail; validation: TimelineValidationResult }> {
    return this.withProjectLock(projectId, async () => {
      const dir = this.projectService.getProjectDir(projectId);
      const current = await this.projectService.getProject(projectId);
      const currentRevision = Number(current.meta.revision ?? 1);

      if (patch.expectedRevision !== undefined && patch.expectedRevision !== currentRevision) {
        const conflictErr = new Error(
          `Xung đột phiên bản chỉnh sửa (revision hiện tại ${currentRevision}, client gửi ${patch.expectedRevision}). Vui lòng tải lại dữ liệu mới nhất.`,
        ) as Error & { statusCode?: number };
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      const now = new Date().toISOString();
      const nextRevision = currentRevision + 1;
      const meta = {
        ...current.meta,
        updatedAt: now,
        revision: nextRevision,
      };
      if (patch.title !== undefined) meta.title = patch.title.trim();
      if (patch.premise !== undefined) meta.premise = patch.premise;
      if (patch.hook !== undefined) meta.hook = patch.hook;
      if (patch.activeRatio !== undefined) meta.activeRatio = patch.activeRatio;
      if (patch.requestSceneSyncNote) {
        meta.sceneSyncRequests = [
          ...(meta.sceneSyncRequests ?? []),
          {
            id: `sync-${crypto.randomUUID().slice(0, 8)}`,
            createdAt: now,
            note: patch.requestSceneSyncNote,
            status: 'pending',
          },
        ];
      }

      const projectJson = { ...current.projectJson };
      if (patch.duration !== undefined) {
        projectJson.duration = patch.duration;
        if (typeof patch.duration === 'number') {
          meta.targetDuration = patch.duration;
        }
      }
      if (patch.stage !== undefined) {
        projectJson.stage = patch.stage;
      }

      const storyJson = { ...current.storyJson };
      if (patch.title !== undefined) {
        storyJson.title = patch.title.trim();
      }
      if (patch.narration !== undefined) {
        storyJson.narration = patch.narration;
      }
      if (patch.beats !== undefined) {
        storyJson.beats = patch.beats;
      }
      if (patch.narration !== undefined || patch.beats !== undefined) {
        if ((storyJson.narration as string)?.trim() && Array.isArray(storyJson.beats) && storyJson.beats.length > 0) {
          storyJson.status = 'authored';
        }
      }

      let captionsJson = [...current.captionsJson];
      if (patch.captions !== undefined) {
        captionsJson = patch.captions;
      }

      const activeRatio = meta.activeRatio;
      const formatRel = ((projectJson.formats as Record<string, string>) ?? {})[activeRatio];
      let planPath: string | null = null;
      let planObj: Record<string, unknown> | null = null;
      let updatedShots: ShotItem[] = [];

      if (formatRel) {
        planPath = resolveInsideRoot(dir, formatRel, true);
        planObj = await readJsonFile<Record<string, unknown>>(planPath);
        if (patch.shots !== undefined) {
          planObj.shots = patch.shots.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            actor: s.actor,
            environment: s.environment,
            sceneGoal: s.sceneGoal,
            composition: s.composition,
            action: s.action,
            expression: s.expression,
            props: s.props,
            staging: s.staging,
            camera: s.camera,
            camera_keys: s.cameraKeys,
            ...(s.easing ? { easing: s.easing } : {}),
            ...(s.actorStart ? { actorStart: s.actorStart } : {}),
            ...(s.actorEnd ? { actorEnd: s.actorEnd } : {}),
            ...(s.propKeyframes?.length ? { propKeyframes: s.propKeyframes } : {}),
            ...(s.motionMode ? { motionMode: s.motionMode } : {}),
            ...(s.motion ? { motion: s.motion } : {}),
            ...(s.cameraPreset ? { cameraPreset: s.cameraPreset } : {}),
            ...(s.visualBeat ? { visualBeat: s.visualBeat } : {}),
            ...(s.editorial ? { editorial: s.editorial } : {}),
            ...(s.semanticActions?.length ? { semanticActions: s.semanticActions } : {}),
            transition: s.transition,
            ...(s.short_cut_reason ? { short_cut_reason: s.short_cut_reason } : {}),
            ...(s.asset_inputs?.length ? { asset_inputs: s.asset_inputs } : {}),
            ...(s.sfx ? { sfx: s.sfx } : {}),
          }));
          updatedShots = patch.shots;
        } else if (Array.isArray(planObj.shots)) {
          updatedShots = normalizeShotsFromPlan(planObj.shots as Array<Record<string, unknown>>);
        }
        if (patch.castInventory !== undefined) {
          planObj.cast_inventory = patch.castInventory;
        }
        if (patch.nativeLayoutReason !== undefined && planObj.caption && typeof planObj.caption === 'object') {
          (planObj.caption as Record<string, unknown>).native_layout_reason = patch.nativeLayoutReason;
        }
      }

      const expectedDuration = typeof projectJson.duration === 'number' ? projectJson.duration : null;
      const validation = validateTimelineData(
        updatedShots,
        captionsJson,
        String(storyJson.narration ?? ''),
        expectedDuration,
      );

      if (!validation.valid) {
        const valErr = new Error(
          `Dữ liệu timeline không hợp lệ (đã hủy ghi để giữ nguyên trạng thái trước đó): ${validation.errors.join(' | ')}`,
        ) as Error & { statusCode?: number };
        valErr.statusCode = 400;
        throw valErr;
      }

      const controlPath = path.join(dir, 'scene-control.json');
      const hasControlFile = fs.existsSync(controlPath);
      const existingControl = hasControlFile ? await readJsonFile<Record<string, unknown>>(controlPath) : null;
      const effectiveMotionMode =
        patch.motionMode ??
        (projectJson.motion_mode as ShotItem['motionMode'] | undefined) ??
        (existingControl?.motionMode as ShotItem['motionMode'] | undefined);
      const effectiveEditorialMode =
        patch.editorialMode ??
        (projectJson.editorial_mode as PatchProjectInput['editorialMode'] | undefined) ??
        (existingControl?.editorialMode as PatchProjectInput['editorialMode'] | undefined);
      const effectiveEditorialProfile =
        patch.editorialProfile ??
        (existingControl?.editorialProfile as PatchProjectInput['editorialProfile'] | undefined);
      const effectiveDirectorBeats =
        patch.directorBeats ??
        (Array.isArray(existingControl?.directorBeats)
          ? (existingControl.directorBeats as NonNullable<PatchProjectInput['directorBeats']>)
          : undefined);
      const effectiveSemanticMode =
        patch.semanticMode ??
        (projectJson.semantic_mode as PatchProjectInput['semanticMode'] | undefined) ??
        (existingControl?.semanticMode as PatchProjectInput['semanticMode'] | undefined);
      const effectiveSemanticActions =
        patch.semanticActions ??
        (Array.isArray(existingControl?.semanticActions)
          ? (existingControl.semanticActions as NonNullable<PatchProjectInput['semanticActions']>)
          : undefined);
      if (patch.motionMode !== undefined) {
        projectJson.motion_mode = patch.motionMode;
      }
      if (patch.editorialMode !== undefined) {
        projectJson.editorial_mode = patch.editorialMode;
        if (planObj) planObj.editorialMode = patch.editorialMode;
      }
      if (patch.editorialProfile !== undefined && planObj) {
        planObj.editorialProfile = patch.editorialProfile;
      }
      if (patch.directorBeats !== undefined && planObj) {
        planObj.directorBeats = patch.directorBeats;
      }
      if (patch.semanticMode !== undefined) {
        projectJson.semantic_mode = patch.semanticMode;
        if (planObj) planObj.semanticMode = patch.semanticMode;
      }
      if (patch.semanticActions !== undefined && planObj) {
        planObj.semanticActions = patch.semanticActions;
      }

      const hasRichCanonical = updatedShots.some((s) =>
        Boolean(
          s.actorStart ||
            s.actorEnd ||
            s.propKeyframes?.length ||
            s.easing ||
            s.motion ||
            s.motionMode === 'articulated_v1' ||
            s.cameraPreset ||
            s.visualBeat ||
            s.editorial ||
            s.semanticActions?.length,
        ),
      ) || effectiveEditorialMode === 'editorial_v1' || effectiveSemanticMode === 'semantic_v1' || Boolean(effectiveSemanticActions?.length);
      const voiceCfg = projectJson.voice as { sha256?: string } | undefined;

      const canonicalPlan = this.editorBindingService.buildCanonicalScenePlan({
        revision: nextRevision,
        ratio: activeRatio,
        width: activeRatio === '9:16' ? 720 : 1280,
        height: activeRatio === '9:16' ? 1280 : 720,
        duration: expectedDuration ?? (validation.totalDuration > 0 ? validation.totalDuration : meta.targetDuration),
        narration: String(storyJson.narration ?? ''),
        voiceSha256: typeof voiceCfg?.sha256 === 'string' ? voiceCfg.sha256 : null,
        voiceTextSha256: typeof meta.voiceTextSha256 === 'string' ? meta.voiceTextSha256 : null,
        ...(effectiveMotionMode ? { motionMode: effectiveMotionMode } : {}),
        ...(effectiveEditorialMode ? { editorialMode: effectiveEditorialMode } : {}),
        ...(effectiveEditorialProfile ? { editorialProfile: effectiveEditorialProfile } : {}),
        ...(effectiveSemanticMode ? { semanticMode: effectiveSemanticMode } : {}),
        ...(effectiveSemanticActions?.length ? { semanticActions: effectiveSemanticActions } : {}),
        ...(effectiveDirectorBeats?.length ? { directorBeats: effectiveDirectorBeats } : {}),
        shots: updatedShots,
        captions: captionsJson,
      });

      if (hasControlFile || hasRichCanonical) {
        const planCheck = await this.editorBindingService.validateCanonicalScenePlan(canonicalPlan, dir);
        if (!planCheck.valid) {
          const planErr = new Error(
            `Kế hoạch scene-control không hợp lệ (đã hủy ghi): ${planCheck.errors.join(' | ')}`,
          ) as Error & { statusCode?: number };
          planErr.statusCode = 400;
          throw planErr;
        }
      }

      // Multi-file transactional write journal: snapshot all targets before mutating disk, rollback ALL on failure
      const stagedWrites: Array<{ relPath: string; absPath: string; content: string }> = [];
      if (planPath && planObj) {
        stagedWrites.push({
          relPath: formatRel ?? 'formats/plan.json',
          absPath: planPath,
          content: `${JSON.stringify(planObj, null, 2)}\n`,
        });
      }
      if (hasControlFile || hasRichCanonical) {
        stagedWrites.push({
          relPath: 'scene-control.json',
          absPath: controlPath,
          content: `${JSON.stringify(canonicalPlan, null, 2)}\n`,
        });
        const curInputs = Array.isArray(projectJson.inputs) ? [...(projectJson.inputs as string[])] : [];
        if (!curInputs.includes('scene-control.json')) {
          curInputs.push('scene-control.json');
        }
        const sceneRuntimeAbs = path.join(dir, 'scene_runtime.py');
        const curRuntimeText = fs.existsSync(sceneRuntimeAbs) ? fs.readFileSync(sceneRuntimeAbs, 'utf8') : '';
        if (
          !curRuntimeText ||
          (effectiveEditorialMode === 'editorial_v1' && !curRuntimeText.includes('camera_editorial_at')) ||
          (effectiveSemanticMode === 'semantic_v1' && !curRuntimeText.includes('semantic_state_at'))
        ) {
          stagedWrites.push({
            relPath: 'scene_runtime.py',
            absPath: sceneRuntimeAbs,
            content: SCENE_RUNTIME_PY_SOURCE,
          });
          if (!curInputs.includes('scene_runtime.py')) {
            curInputs.push('scene_runtime.py');
          }
        }
        if (effectiveEditorialMode === 'editorial_v1') {
          for (const edFile of ['b6_editorial_contract.py', 'b6_editorial_director.py']) {
            if (!curInputs.includes(edFile)) {
              curInputs.push(edFile);
            }
            const srcAbs = path.join(APP_ROOT, 'editorial_runtime', edFile);
            const destAbs = path.join(dir, edFile);
            if (fs.existsSync(srcAbs)) {
              const srcContent = fs.readFileSync(srcAbs, 'utf8');
              const destContent = fs.existsSync(destAbs) ? fs.readFileSync(destAbs, 'utf8') : '';
              if (destContent !== srcContent) {
                stagedWrites.push({ relPath: edFile, absPath: destAbs, content: srcContent });
              }
            }
          }
        }
        if (effectiveSemanticMode === 'semantic_v1') {
          for (const semFile of ['b6_semantic_contract.py', 'b6_semantic_evidence.py', 'b6_semantic_qc.py']) {
            if (!curInputs.includes(semFile)) {
              curInputs.push(semFile);
            }
            const srcAbs = path.join(APP_ROOT, 'semantic_runtime', semFile);
            const destAbs = path.join(dir, semFile);
            if (fs.existsSync(srcAbs)) {
              const srcContent = fs.readFileSync(srcAbs, 'utf8');
              const destContent = fs.existsSync(destAbs) ? fs.readFileSync(destAbs, 'utf8') : '';
              if (destContent !== srcContent) {
                stagedWrites.push({ relPath: semFile, absPath: destAbs, content: srcContent });
              }
            }
          }
        }
        projectJson.inputs = curInputs;
      }
      const storyAbs = resolveInsideRoot(dir, String(projectJson.story ?? 'story.json'));
      const captionsAbs = resolveInsideRoot(dir, String(projectJson.captions ?? 'captions.json'));
      stagedWrites.push(
        {
          relPath: 'studio.meta.json',
          absPath: path.join(dir, 'studio.meta.json'),
          content: `${JSON.stringify(meta, null, 2)}\n`,
        },
        {
          relPath: 'project.json',
          absPath: path.join(dir, 'project.json'),
          content: `${JSON.stringify(projectJson, null, 2)}\n`,
        },
        {
          relPath: String(projectJson.story ?? 'story.json'),
          absPath: storyAbs,
          content: `${JSON.stringify(storyJson, null, 2)}\n`,
        },
        {
          relPath: String(projectJson.captions ?? 'captions.json'),
          absPath: captionsAbs,
          content: `${JSON.stringify(captionsJson, null, 2)}\n`,
        },
      );

      const snapshots = stagedWrites.map((w) => ({
        absPath: w.absPath,
        existed: fs.existsSync(w.absPath),
        prevBuffer: fs.existsSync(w.absPath) ? fs.readFileSync(w.absPath) : null,
      }));
      const committedCount: number[] = [];
      try {
        for (let i = 0; i < stagedWrites.length; i++) {
          const entry = stagedWrites[i];
          if (this.onBeforeCommitFile) {
            await this.onBeforeCommitFile(entry.relPath, i);
          }
          await writeAtomicFile(entry.absPath, entry.content);
          committedCount.push(i);
        }
      } catch (writeErr) {
        for (let idx = committedCount.length - 1; idx >= 0; idx--) {
          const snap = snapshots[committedCount[idx]];
          try {
            if (snap.existed && snap.prevBuffer !== null) {
              await fs.promises.writeFile(snap.absPath, snap.prevBuffer);
            } else if (!snap.existed && fs.existsSync(snap.absPath)) {
              await fs.promises.unlink(snap.absPath);
            }
          } catch {
            // Preserve original commit error while attempting complete rollback
          }
        }
        throw writeErr;
      }

      this.qaResolver?.invalidateProject(dir);
      const detail = await this.projectService.getProject(projectId);
      return { detail, validation };
    });
  }

  async saveScenePy(projectId: string, sceneContent: string): Promise<{ sha256: string; revision: number }> {
    return this.withProjectLock(projectId, async () => {
      const dir = this.projectService.getProjectDir(projectId);
      const current = await this.projectService.getProject(projectId);

      // Verify Python syntax before touching disk
      const pyExe = resolvePythonExe();
      const syntaxRes = spawnSync(pyExe, ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: sceneContent,
        encoding: 'utf8',
        shell: false,
        timeout: 8000,
      });
      if (syntaxRes.status !== 0) {
        const err = new Error(
          `Cú pháp Python trong scene.py không hợp lệ: ${(syntaxRes.stderr || syntaxRes.stdout || '').trim()}`,
        ) as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }

      const scenePath = resolveInsideRoot(dir, String(current.projectJson.scene ?? 'scene.py'));
      await writeAtomicFile(scenePath, sceneContent);

      const nextRev = Number(current.meta.revision ?? 1) + 1;
      const updatedMeta = {
        ...current.meta,
        revision: nextRev,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomicJson(path.join(dir, 'studio.meta.json'), updatedMeta);
      this.qaResolver?.invalidateProject(dir);

      const sha256 = crypto.createHash('sha256').update(sceneContent, 'utf8').digest('hex');
      return { sha256, revision: nextRev };
    });
  }

  async synthesizeLocalVoiceWav(
    projectId: string,
    opts?: { voiceHint?: string; rate?: number; filename?: string },
  ): Promise<{ path: string; sha256: string; duration: number; voiceName: string; revision: number }> {
    return this.withProjectLock(projectId, async () => {
      if (process.platform !== 'win32') {
        throw new Error('Hiện chỉ hỗ trợ tạo voice local (System.Speech SAPI) trên Windows.');
      }

      const dir = this.projectService.getProjectDir(projectId);
      const current = await this.projectService.getProject(projectId);
      const narration = String(current.storyJson.narration ?? '').trim();
      if (!narration) {
        throw new Error('Không thể tạo voice local vì story.json.narration đang trống.');
      }

      const safeFile = path.basename(opts?.filename || 'narration.wav').replace(/[^a-zA-Z0-9._-]/g, '_');
      const relPath = `audio/${safeFile.endsWith('.wav') ? safeFile : `${safeFile}.wav`}`;
      const absOut = resolveInsideRoot(dir, relPath, false);
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      const tmpOut = `${absOut}.tmp.${Date.now()}.wav`;

      const psScript = [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        '$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled }',
        '$hint = $env:B6_TTS_HINT',
        'if ($hint) { $match = $voices | Where-Object { $_.VoiceInfo.Name -like "*$hint*" } | Select-Object -First 1; if ($match) { $s.SelectVoice($match.VoiceInfo.Name) } }',
        '$s.Rate = [int]$env:B6_TTS_RATE',
        '$s.SetOutputToWaveFile($env:B6_TTS_OUT)',
        '$s.Speak($env:B6_TTS_TEXT)',
        '$chosen = $s.Voice.Name',
        '$s.Dispose()',
        'Write-Output $chosen',
      ].join('; ');

      const ttsRes = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        env: {
          ...process.env,
          B6_TTS_TEXT: narration,
          B6_TTS_OUT: tmpOut,
          B6_TTS_HINT: opts?.voiceHint ?? 'David',
          B6_TTS_RATE: String(Math.max(-10, Math.min(10, Math.trunc(opts?.rate ?? 0)))),
        },
        encoding: 'utf8',
        shell: false,
        timeout: 25000,
      });

      if (ttsRes.status !== 0 || !fs.existsSync(tmpOut) || fs.statSync(tmpOut).size <= 44) {
        if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
        throw new Error(`Tạo voice SAPI thất bại: ${(ttsRes.stderr || ttsRes.stdout || 'exit ' + ttsRes.status).trim()}`);
      }

      fs.renameSync(tmpOut, absOut);
      const voiceName = (ttsRes.stdout ?? '').trim().split(/\r?\n/).pop() || opts?.voiceHint || 'Windows SAPI';

      const ffprobe = resolveRealFfprobe();
      const probeRes = spawnSync(
        ffprobe,
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absOut],
        { encoding: 'utf8', shell: false, timeout: 10000 },
      );
      if (probeRes.status !== 0) {
        throw new Error(`FFprobe không đọc được file voice vừa tạo: ${probeRes.stderr}`);
      }
      const parsed = JSON.parse(probeRes.stdout) as { format?: { duration?: string } };
      const audioDuration = Number(parsed.format?.duration ?? 0);
      if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
        throw new Error('File voice vừa tạo có duration không hợp lệ.');
      }

      const wavSha = await sha256File(absOut);
      const textSha = crypto.createHash('sha256').update(narration, 'utf8').digest('hex');

      const projPath = path.join(dir, 'project.json');
      const projectJson = await readJsonFile<Record<string, unknown>>(projPath);
      projectJson.voice = {
        name: safeFile,
        path: relPath,
        sha256: wavSha,
        speed: 1,
        voice_name: voiceName,
        source: 'local_sapi_tts',
      };
      const inputs = Array.isArray(projectJson.inputs) ? [...(projectJson.inputs as string[])] : [];
      if (!inputs.includes(relPath)) inputs.push(relPath);
      projectJson.inputs = inputs;
      await writeAtomicJson(projPath, projectJson);

      const nextRev = Number(current.meta.revision ?? 1) + 1;
      const updatedMeta = {
        ...current.meta,
        revision: nextRev,
        voiceTextSha256: textSha,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomicJson(path.join(dir, 'studio.meta.json'), updatedMeta);

      const controlPath = path.join(dir, 'scene-control.json');
      if (fs.existsSync(controlPath)) {
        const control = await readJsonFile<Record<string, unknown>>(controlPath);
        control.revision = nextRev;
        control.voice_sha256 = wavSha;
        control.narration_sha256 = textSha;
        control.voice_stale = false;
        control.updatedAt = new Date().toISOString();
        await writeAtomicJson(controlPath, control);
      }

      this.qaResolver?.invalidateProject(dir);
      return {
        path: relPath,
        sha256: wavSha,
        duration: Number(audioDuration.toFixed(3)),
        voiceName,
        revision: nextRev,
      };
    });
  }
}
