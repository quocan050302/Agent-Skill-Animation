import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, resolveInsideRoot, sha256File, writeAtomicJson } from '../utils/fs-safe.js';
import type { ProjectService, StudioMeta } from './project-service.js';
import type { QaEvidenceResolver } from './qa-evidence-service.js';

export interface CharacterPackageView {
  viewId: string;
  facing?: string;
  bodyPath: string;
  headPath: string;
  heads: Record<string, string>;
  cuffLeftPath: string;
  cuffRightPath: string;
  inkColor: string;
  headAnchor: [number, number] | null;
  neckAttachment: {
    mount_polygon: number[][];
    min_overlap_fraction: number;
    min_overlap_thickness: number;
  } | null;
  arms: Record<string, {
    socket: [number, number];
    exit_normal: [number, number];
    exit_center: [number, number];
    outlet_segment: [[number, number], [number, number]];
    lengths: [number, number];
    pole: number;
    upper_angle_range_deg: [number, number];
    elbow_bend_range_deg: [number, number];
    max_ik_offset: number;
    ink_width: number;
    hand_radius: number;
    layer: 'front' | 'back';
    poses: Record<string, [number, number]>;
    ink_path?: { mode: string; sag: number };
  }>;
  legs: Record<string, {
    hip: [number, number];
    ankle: [number, number];
    ink_width: number;
    foot_size: [number, number];
  }>;
  rawView: Record<string, unknown>;
}

export interface CharacterSummary {
  id: string;
  characterId: string;
  displayName: string;
  packageDir: string;
  bindingVersion: number;
  registeredViews: string[];
  gaitStatus: 'unsupported_needs_authoring' | 'authored_verified';
  gaitNote: string;
  views: Record<string, CharacterPackageView>;
  rawPackage: Record<string, unknown>;
}

export class CharacterBindingService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly qaResolver?: QaEvidenceResolver,
  ) {}

  async getCharacters(projectId: string): Promise<{
    schema: string;
    actors: CharacterSummary[];
    rigidCast: unknown[];
    latestPreflight: Record<string, unknown> | null;
  }> {
    const dir = this.projectService.getProjectDir(projectId);
    const project = await this.projectService.getProject(projectId);
    const reg = project.charactersJson;
    const actors: CharacterSummary[] = [];

    for (const entry of reg.actors) {
      const pkgDirRel = entry.package.replace(/\/+$/, '');
      const pkgPath = resolveInsideRoot(dir, `${pkgDirRel}/package.json`, false);
      if (!fs.existsSync(pkgPath)) {
        actors.push({
          id: entry.id,
          characterId: entry.id,
          displayName: entry.id,
          packageDir: pkgDirRel,
          bindingVersion: 2,
          registeredViews: entry.views,
          gaitStatus: 'unsupported_needs_authoring',
          gaitNote: 'Chưa hỗ trợ — thiếu package.json cho nhân vật này.',
          views: {},
          rawPackage: {},
        });
        continue;
      }

      const rawPkg = await readJsonFile<Record<string, unknown>>(pkgPath);
      const rawViews = (rawPkg.views as Record<string, Record<string, unknown>>) ?? {};
      const views: Record<string, CharacterPackageView> = {};

      for (const [vid, rv] of Object.entries(rawViews)) {
        const sprites = (rv.sprites as Record<string, unknown>) ?? {};
        const bodySprite = sprites.body as { path: string };
        const headSprite = sprites.head as { path: string };
        const headsMap = (sprites.heads as Record<string, { path: string }>) ?? {};
        const arms = (rv.arms as Record<string, Record<string, unknown>>) ?? {};
        const cuffLeft = (arms.left?.cuff as { path: string }) ?? { path: '' };
        const cuffRight = (arms.right?.cuff as { path: string }) ?? { path: '' };

        const heads: Record<string, string> = {};
        for (const [k, v] of Object.entries(headsMap)) {
          heads[k] = `/api/media/${projectId}/${pkgDirRel}/${v.path}`;
        }

        views[vid] = {
          viewId: vid,
          facing: typeof rv.facing === 'string' ? rv.facing : undefined,
          bodyPath: `/api/media/${projectId}/${pkgDirRel}/${bodySprite?.path ?? ''}`,
          headPath: `/api/media/${projectId}/${pkgDirRel}/${headSprite?.path ?? ''}`,
          heads,
          cuffLeftPath: `/api/media/${projectId}/${pkgDirRel}/${cuffLeft.path}`,
          cuffRightPath: `/api/media/${projectId}/${pkgDirRel}/${cuffRight.path}`,
          inkColor: String(rv.ink_color ?? '#171319'),
          headAnchor: Array.isArray(rv.head_anchor) ? (rv.head_anchor as [number, number]) : null,
          neckAttachment: (rv.neck_attachment as CharacterPackageView['neckAttachment']) ?? null,
          arms: rv.arms as CharacterPackageView['arms'],
          legs: rv.legs as CharacterPackageView['legs'],
          rawView: rv,
        };
      }

      actors.push({
        id: entry.id,
        characterId: String(rawPkg.character_id ?? entry.id),
        displayName: String(rawPkg.display_name ?? entry.id),
        packageDir: pkgDirRel,
        bindingVersion: Number(rawPkg.binding_version ?? 1),
        registeredViews: entry.views,
        gaitStatus: 'unsupported_needs_authoring',
        gaitNote: 'Chưa hỗ trợ — b6_puppet.py chỉ cấp chân đứng tĩnh + ankle_targets giới hạn; walk/run cần author gait riêng & kiểm tra drift.',
        views,
        rawPackage: rawPkg,
      });
    }

    const preflightPath = path.join(dir, 'character-preflight.json');
    const latestPreflight = fs.existsSync(preflightPath)
      ? await readJsonFile<Record<string, unknown>>(preflightPath)
      : null;

    return {
      schema: reg.schema,
      actors,
      rigidCast: reg.rigid_cast ?? [],
      latestPreflight,
    };
  }

  async updateViewRig(
    projectId: string,
    actorId: string,
    viewId: string,
    patch: {
      head_anchor?: [number, number];
      ink_color?: string;
      arms?: Record<string, Partial<{
        socket: [number, number];
        exit_normal: [number, number];
        exit_center: [number, number];
        outlet_segment: [[number, number], [number, number]];
        lengths: [number, number];
        ink_width: number;
        hand_radius: number;
        max_ik_offset: number;
      }>>;
      legs?: Record<string, Partial<{
        hip: [number, number];
        ankle: [number, number];
        ink_width: number;
      }>>;
    },
  ): Promise<Record<string, unknown>> {
    const dir = this.projectService.getProjectDir(projectId);
    const reg = await readJsonFile<{ actors: Array<{ id: string; package: string; views: string[] }> }>(
      path.join(dir, 'characters.json'),
    );
    const entry = reg.actors.find((a) => a.id === actorId);
    if (!entry) throw new Error(`Không tìm thấy nhân vật "${actorId}" trong characters.json.`);

    const pkgDirRel = entry.package.replace(/\/+$/, '');
    const pkgPath = resolveInsideRoot(dir, `${pkgDirRel}/package.json`, true);
    const rawPkg = await readJsonFile<Record<string, unknown>>(pkgPath);
    const views = rawPkg.views as Record<string, Record<string, unknown>>;
    const view = views?.[viewId];
    if (!view) throw new Error(`Không tìm thấy view "${viewId}" trong package của "${actorId}".`);

    if (patch.head_anchor) view.head_anchor = patch.head_anchor;
    if (patch.ink_color) view.ink_color = patch.ink_color;
    if (patch.arms) {
      const arms = view.arms as Record<string, Record<string, unknown>>;
      for (const side of ['left', 'right'] as const) {
        if (patch.arms[side] && arms[side]) {
          Object.assign(arms[side], patch.arms[side]);
        }
      }
    }
    if (patch.legs) {
      const legs = view.legs as Record<string, Record<string, unknown>>;
      for (const side of ['left', 'right'] as const) {
        if (patch.legs[side] && legs[side]) {
          Object.assign(legs[side], patch.legs[side]);
        }
      }
    }

    // Recompute asset SHA-256 hashes inside package so package stays self-consistent
    const pkgBase = path.dirname(pkgPath);
    const refreshAssetHash = async (assetCfg: unknown) => {
      if (assetCfg && typeof assetCfg === 'object' && 'path' in assetCfg) {
        const cfg = assetCfg as { path: string; sha256?: string };
        const abs = resolveInsideRoot(pkgBase, cfg.path, true);
        cfg.sha256 = await sha256File(abs);
      }
    };
    const sprites = view.sprites as Record<string, unknown>;
    await refreshAssetHash(sprites.body);
    await refreshAssetHash(sprites.head);
    if (sprites.heads && typeof sprites.heads === 'object') {
      for (const h of Object.values(sprites.heads as Record<string, unknown>)) {
        await refreshAssetHash(h);
      }
    }
    for (const arm of Object.values(view.arms as Record<string, Record<string, unknown>>)) {
      await refreshAssetHash(arm.cuff);
      await refreshAssetHash(arm.hand_asset);
    }

    await writeAtomicJson(pkgPath, rawPkg);
    const metaPath = path.join(dir, 'studio.meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = await readJsonFile<StudioMeta>(metaPath);
        meta.revision = Number(meta.revision ?? 1) + 1;
        meta.updatedAt = new Date().toISOString();
        await writeAtomicJson(metaPath, meta);
      } catch {
        // non-fatal
      }
    }
    this.qaResolver?.invalidateProject(dir);
    return rawPkg;
  }
}
