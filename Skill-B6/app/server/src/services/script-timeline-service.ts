import crypto from 'node:crypto';
import path from 'node:path';
import type { PatchProjectInput, ShotItem, CaptionCue } from '@b6-studio/shared';
import { readJsonFile, resolveInsideRoot, writeAtomicJson, writeAtomicFile } from '../utils/fs-safe.js';
import type { ProjectDetail, ProjectService } from './project-service.js';

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

export class ScriptTimelineService {
  constructor(private readonly projectService: ProjectService) {}

  async patchProject(projectId: string, patch: PatchProjectInput): Promise<{ detail: ProjectDetail; validation: TimelineValidationResult }> {
    const dir = this.projectService.getProjectDir(projectId);
    const current = await this.projectService.getProject(projectId);
    const now = new Date().toISOString();

    const meta = { ...current.meta, updatedAt: now };
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
    let updatedShots: ShotItem[] = [];
    if (formatRel) {
      const planPath = resolveInsideRoot(dir, formatRel, true);
      const plan = await readJsonFile<Record<string, unknown>>(planPath);
      if (patch.shots !== undefined) {
        plan.shots = patch.shots.map((s) => ({
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
          transition: s.transition,
          ...(s.short_cut_reason ? { short_cut_reason: s.short_cut_reason } : {}),
          ...(s.asset_inputs?.length ? { asset_inputs: s.asset_inputs } : {}),
          ...(s.sfx ? { sfx: s.sfx } : {}),
        }));
        updatedShots = patch.shots;
      } else if (Array.isArray(plan.shots)) {
        updatedShots = plan.shots as ShotItem[];
      }
      if (patch.castInventory !== undefined) {
        plan.cast_inventory = patch.castInventory;
      }
      if (patch.nativeLayoutReason !== undefined && plan.caption && typeof plan.caption === 'object') {
        (plan.caption as Record<string, unknown>).native_layout_reason = patch.nativeLayoutReason;
      }
      await writeAtomicJson(planPath, plan);
    }

    const expectedDuration = typeof projectJson.duration === 'number' ? projectJson.duration : null;
    const validation = validateTimelineData(
      updatedShots,
      captionsJson,
      String(storyJson.narration ?? ''),
      expectedDuration,
    );

    await writeAtomicJson(path.join(dir, 'studio.meta.json'), meta);
    await writeAtomicJson(path.join(dir, 'project.json'), projectJson);
    await writeAtomicJson(resolveInsideRoot(dir, String(projectJson.story ?? 'story.json')), storyJson);
    await writeAtomicJson(resolveInsideRoot(dir, String(projectJson.captions ?? 'captions.json')), captionsJson);

    const detail = await this.projectService.getProject(projectId);
    return { detail, validation };
  }

  async saveScenePy(projectId: string, sceneContent: string): Promise<{ sha256: string }> {
    const dir = this.projectService.getProjectDir(projectId);
    const current = await this.projectService.getProject(projectId);
    const scenePath = resolveInsideRoot(dir, String(current.projectJson.scene ?? 'scene.py'));
    await writeAtomicFile(scenePath, sceneContent);
    const sha256 = crypto.createHash('sha256').update(sceneContent, 'utf8').digest('hex');
    return { sha256 };
  }
}
