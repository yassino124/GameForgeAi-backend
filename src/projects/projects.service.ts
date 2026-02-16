import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

import { GameProject, GameProjectDocument } from './schemas/game-project.schema';
import { UnityTemplate, UnityTemplateDocument } from '../templates/schemas/unity-template.schema';
import { TemplateStorageService } from '../templates/template-storage.service';
import { ProjectStorageService } from './project-storage.service';
import { Asset, AssetDocument } from '../assets/schemas/asset.schema';
import { LocalStorageService } from '../assets/local-storage.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ProjectsService {
  private readonly activeBuildProcesses = new Map<string, ChildProcess>();

  constructor(
    @InjectModel(GameProject.name)
    private readonly projectModel: Model<GameProjectDocument>,
    @InjectModel(UnityTemplate.name)
    private readonly templateModel: Model<UnityTemplateDocument>,
    @InjectModel(Asset.name)
    private readonly assetModel: Model<AssetDocument>,
    private readonly templateStorage: TemplateStorageService,
    private readonly assetStorage: LocalStorageService,
    private readonly projectStorage: ProjectStorageService,
    private readonly aiService: AiService,
  ) {}

  async getRuntimeConfig(ownerId: string, projectId: string) {
    const p: any = await this.projectModel.findById(projectId).lean();
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== ownerId) throw new ForbiddenException();

    const cfg: any = p.aiUnityConfig && typeof p.aiUnityConfig === 'object' ? p.aiUnityConfig : {};
    return {
      success: true,
      data: {
        timeScale: typeof cfg.timeScale === 'number' ? cfg.timeScale : 1.0,
        difficulty: typeof cfg.difficulty === 'number' ? cfg.difficulty : 0.5,
        theme: typeof cfg.theme === 'string' ? cfg.theme : 'default',
        notes: typeof cfg.notes === 'string' ? cfg.notes : '',
        speed: typeof cfg.speed === 'number' ? cfg.speed : 5.0,
        genre: typeof cfg.genre === 'string' ? cfg.genre : 'platformer',
        assetsType: typeof cfg.assetsType === 'string' ? cfg.assetsType : 'lowpoly',
        mechanics: Array.isArray(cfg.mechanics) ? cfg.mechanics : [],
        primaryColor: typeof cfg.primaryColor === 'string' ? cfg.primaryColor : '#22C55E',
        secondaryColor: typeof cfg.secondaryColor === 'string' ? cfg.secondaryColor : '#3B82F6',
        accentColor: typeof cfg.accentColor === 'string' ? cfg.accentColor : '#F59E0B',
        playerColor: typeof cfg.playerColor === 'string' ? cfg.playerColor : undefined,
        fogEnabled: typeof cfg.fogEnabled === 'boolean' ? cfg.fogEnabled : undefined,
        fogDensity: typeof cfg.fogDensity === 'number' ? cfg.fogDensity : undefined,
        cameraZoom: typeof cfg.cameraZoom === 'number' ? cfg.cameraZoom : undefined,
        gravityY: typeof cfg.gravityY === 'number' ? cfg.gravityY : undefined,
        jumpForce: typeof cfg.jumpForce === 'number' ? cfg.jumpForce : undefined,
        updatedAt: (p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined) as any,
      },
    };
  }

  async generateAiMetadata(params: {
    ownerId: string;
    projectId: string;
    notes?: string;
    overwrite?: boolean;
  }) {
    const p = await this.projectModel.findById(params.projectId);
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== params.ownerId) throw new ForbiddenException();

    if (!params.overwrite && p.aiMetadata) {
      return { success: true, data: p.toObject() };
    }

    const template = await this.templateModel.findById(p.templateId).lean();
    const templateName = template?.name?.toString() ?? '';

    const result = await this.aiService.generateProjectMetadata({
      name: p.name,
      description: p.description,
      templateName,
      notes: params.notes,
    } as any);

    p.aiMetadata = {
      description: result.description,
      type: result.type,
      tags: result.tags,
      mediaPrompts: result.mediaPrompts,
    };
    p.aiGeneratedAt = new Date();

    if (params.overwrite) {
      if (typeof result.description === 'string' && result.description.trim()) {
        p.description = result.description.trim();
      }
    }

    await p.save();
    return { success: true, data: p.toObject() };
  }

  async createFromTemplate(ownerId: string, dto: { templateId: string; name: string; description?: string; assetsCollectionId?: string }) {
    const template = await this.templateModel.findById(dto.templateId).lean();
    if (!template) throw new NotFoundException('Template not found');
    if (!template.isPublic) throw new ForbiddenException();

    const created: any = await this.projectModel.create({
      ownerId,
      templateId: dto.templateId,
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      assetsCollectionId: dto.assetsCollectionId,
      status: 'queued',
      buildTarget: 'webgl',
    } as any);

    this.runBuild(String(created?._id || '')).catch(() => null);

    return { success: true, data: created };
  }

  async createFromAi(params: {
    ownerId: string;
    prompt: string;
    templateId?: string;
    buildTarget?: string;
    initialConfig?: any;
  }) {
    const prompt = (params.prompt || '').trim();
    if (!prompt) throw new BadRequestException('Prompt is required');

    const isQuotaExceeded = (e: any) => {
      const statusCode = Number(e?.getStatus?.() ?? e?.status ?? e?.statusCode);
      const resp = (typeof e?.getResponse === 'function' ? e.getResponse() : undefined) as any;
      const msg = (resp?.message ?? e?.message ?? '').toString().toLowerCase();
      return statusCode === 429 && msg.includes('quota');
    };

    let aiData: any = {};
    try {
      const ai = await this.aiService.generateProjectDraft({ description: prompt, notes: undefined });
      aiData = (ai as any)?.data || {};
    } catch (e: any) {
      if (!isQuotaExceeded(e)) throw e;
      aiData = {};
    }

    const name = typeof aiData.name === 'string' && aiData.name.trim().length ? aiData.name.trim() : 'AI Game';
    const description = typeof aiData.description === 'string' ? aiData.description.trim() : prompt;

    let templateId = (params.templateId || '').trim();
    if (!templateId) {
      const chosen = await this.templateModel
        .findOne({ isPublic: true })
        .sort({ downloads: -1 })
        .lean();
      if (!chosen?._id) throw new NotFoundException('No public templates available');
      templateId = chosen._id.toString();
    }

    const template = await this.templateModel.findById(templateId).lean();
    const templateName = template?.name?.toString() ?? '';

    let unityCfg: any = {};
    try {
      const unityCfgRes = await this.aiService.generateUnityConfig({ prompt, templateName });
      unityCfg = (unityCfgRes as any)?.data || {};
    } catch (e: any) {
      if (!isQuotaExceeded(e)) throw e;
      unityCfg = {};
    }

    const init: any = params.initialConfig && typeof params.initialConfig === 'object' ? params.initialConfig : {};
    const mergedCfg: any = {
      timeScale: typeof init.timeScale === 'number' ? init.timeScale : (typeof unityCfg.timeScale === 'number' ? unityCfg.timeScale : 1.0),
      difficulty: typeof init.difficulty === 'number' ? init.difficulty : (typeof unityCfg.difficulty === 'number' ? unityCfg.difficulty : 0.5),
      theme: typeof init.theme === 'string' ? init.theme : (typeof unityCfg.theme === 'string' ? unityCfg.theme : 'default'),
      notes: typeof init.notes === 'string' ? init.notes : (typeof unityCfg.notes === 'string' ? unityCfg.notes : ''),
      speed: typeof init.speed === 'number' ? init.speed : (typeof unityCfg.speed === 'number' ? unityCfg.speed : 5.0),
      genre: typeof init.genre === 'string' ? init.genre : (typeof unityCfg.genre === 'string' ? unityCfg.genre : 'platformer'),
      assetsType: typeof init.assetsType === 'string' ? init.assetsType : (typeof unityCfg.assetsType === 'string' ? unityCfg.assetsType : 'lowpoly'),
      mechanics: Array.isArray(init.mechanics)
        ? init.mechanics
        : (Array.isArray(unityCfg.mechanics) ? unityCfg.mechanics : undefined),
      primaryColor: typeof init.primaryColor === 'string' ? init.primaryColor : (typeof unityCfg.primaryColor === 'string' ? unityCfg.primaryColor : '#22C55E'),
      secondaryColor: typeof init.secondaryColor === 'string' ? init.secondaryColor : (typeof unityCfg.secondaryColor === 'string' ? unityCfg.secondaryColor : '#3B82F6'),
      accentColor: typeof init.accentColor === 'string' ? init.accentColor : (typeof unityCfg.accentColor === 'string' ? unityCfg.accentColor : '#F59E0B'),

      playerColor: typeof init.playerColor === 'string'
        ? init.playerColor
        : (typeof unityCfg.playerColor === 'string' ? unityCfg.playerColor : undefined),

      fogEnabled: typeof init.fogEnabled === 'boolean' ? init.fogEnabled : (typeof unityCfg.fogEnabled === 'boolean' ? unityCfg.fogEnabled : undefined),
      fogDensity: typeof init.fogDensity === 'number' ? init.fogDensity : (typeof unityCfg.fogDensity === 'number' ? unityCfg.fogDensity : undefined),
      cameraZoom: typeof init.cameraZoom === 'number' ? init.cameraZoom : (typeof unityCfg.cameraZoom === 'number' ? unityCfg.cameraZoom : undefined),
      gravityY: typeof init.gravityY === 'number' ? init.gravityY : (typeof unityCfg.gravityY === 'number' ? unityCfg.gravityY : undefined),
      jumpForce: typeof init.jumpForce === 'number' ? init.jumpForce : (typeof unityCfg.jumpForce === 'number' ? unityCfg.jumpForce : undefined),
    };

    const created: any = await this.projectModel.create({
      ownerId: params.ownerId,
      templateId,
      name,
      description,
      status: 'queued',
      buildTarget: (params.buildTarget || '').trim() || 'webgl',
      aiMetadata: {
        description: typeof aiData.description === 'string' ? aiData.description : undefined,
        type: typeof aiData.type === 'string' ? aiData.type : undefined,
        tags: Array.isArray(aiData.tags) ? aiData.tags : undefined,
        mediaPrompts: aiData.mediaPrompts,
      },
      aiUnityConfig: {
        timeScale: mergedCfg.timeScale,
        difficulty: mergedCfg.difficulty,
        theme: mergedCfg.theme,
        notes: mergedCfg.notes,
        speed: mergedCfg.speed,
        genre: mergedCfg.genre,
        assetsType: mergedCfg.assetsType,
        mechanics: Array.isArray(mergedCfg.mechanics) ? mergedCfg.mechanics : undefined,
        primaryColor: mergedCfg.primaryColor,
        secondaryColor: mergedCfg.secondaryColor,
        accentColor: mergedCfg.accentColor,
        playerColor: mergedCfg.playerColor,
        fogEnabled: mergedCfg.fogEnabled,
        fogDensity: mergedCfg.fogDensity,
        cameraZoom: mergedCfg.cameraZoom,
        gravityY: mergedCfg.gravityY,
        jumpForce: mergedCfg.jumpForce,
      },
      aiGeneratedAt: new Date(),
    });

    const projectId = String(created?._id || '');
    this.runBuild(projectId).catch(() => null);
    return { success: true, data: { projectId } };
  }

  async list(ownerId: string) {
    const items = await this.projectModel
      .find({ ownerId })
      .sort({ createdAt: -1 })
      .lean();
    return { success: true, data: items };
  }

  async get(ownerId: string, id: string) {
    const p = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== ownerId) throw new ForbiddenException();
    return { success: true, data: p };
  }

  async cancelBuild(ownerId: string, id: string) {
    const project: any = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId) throw new ForbiddenException();

    const st = String(project.status || '').toLowerCase();
    if (!['queued', 'running'].includes(st)) {
      return { success: true, data: { projectId: String(project._id), status: project.status } };
    }

    project.status = 'failed';
    project.error = 'Cancelled by user';
    (project as any).buildTimings = {
      ...((project as any).buildTimings || {}),
      finishedAt: new Date().toISOString(),
    };
    await project.save();

    const child = this.activeBuildProcesses.get(String(project._id));
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }

    return { success: true, data: { projectId: String(project._id), status: project.status } };
  }

  async update(ownerId: string, id: string, dto: { name?: string; description?: string }) {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId) throw new ForbiddenException();

    const anyDto: any = dto as any;
    if (typeof anyDto.buildTarget === 'string') {
      const bt = anyDto.buildTarget.trim().toLowerCase();
      if (bt === 'webgl' || bt === 'android_apk' || bt === 'android') {
        (project as any).buildTarget = bt === 'android' ? 'android_apk' : bt;
      }
    }

    if (typeof dto.name === 'string') {
      const v = dto.name.trim();
      if (!v) throw new BadRequestException('Name is required');
      project.name = v;
    }
    if (typeof dto.description === 'string') {
      project.description = dto.description.trim();
    }

    const hasAiUpdate =
      typeof anyDto.timeScale === 'number' ||
      typeof anyDto.difficulty === 'number' ||
      typeof anyDto.theme === 'string' ||
      typeof anyDto.notes === 'string' ||
      typeof anyDto.speed === 'number' ||
      typeof anyDto.genre === 'string' ||
      typeof anyDto.assetsType === 'string' ||
      Array.isArray(anyDto.mechanics) ||
      typeof anyDto.primaryColor === 'string' ||
      typeof anyDto.secondaryColor === 'string' ||
      typeof anyDto.accentColor === 'string' ||
      typeof anyDto.fogEnabled === 'boolean' ||
      typeof anyDto.fogDensity === 'number' ||
      typeof anyDto.cameraZoom === 'number' ||
      typeof anyDto.gravityY === 'number' ||
      typeof anyDto.jumpForce === 'number';

    if (hasAiUpdate) {
      const cur: any = (project as any).aiUnityConfig && typeof (project as any).aiUnityConfig === 'object'
        ? { ...(project as any).aiUnityConfig }
        : {};

      const normHex = (v: any) => {
        if (typeof v !== 'string') return undefined;
        let s = v.trim();
        if (!s) return undefined;
        if (!s.startsWith('#') && s.length === 6) s = '#' + s;
        if (!/^#[0-9a-fA-F]{6}$/.test(s)) return undefined;
        return s.toUpperCase();
      };

      if (typeof anyDto.timeScale === 'number') cur.timeScale = anyDto.timeScale;
      if (typeof anyDto.difficulty === 'number') cur.difficulty = anyDto.difficulty;
      if (typeof anyDto.theme === 'string') cur.theme = anyDto.theme.trim();
      if (typeof anyDto.notes === 'string') cur.notes = anyDto.notes.trim();
      if (typeof anyDto.speed === 'number') cur.speed = anyDto.speed;
      if (typeof anyDto.genre === 'string') cur.genre = anyDto.genre.trim();
      if (typeof anyDto.assetsType === 'string') cur.assetsType = anyDto.assetsType.trim();
      if (Array.isArray(anyDto.mechanics)) {
        cur.mechanics = anyDto.mechanics
          .map((m: any) => (m == null ? '' : String(m)).trim())
          .filter((m: string) => m.length > 0)
          .slice(0, 12);
      }
      const pc = normHex(anyDto.primaryColor);
      const sc = normHex(anyDto.secondaryColor);
      const ac = normHex(anyDto.accentColor);
      const plc = normHex(anyDto.playerColor);
      if (pc) cur.primaryColor = pc;
      if (sc) cur.secondaryColor = sc;
      if (ac) cur.accentColor = ac;
      if (plc) cur.playerColor = plc;

      if (typeof anyDto.fogEnabled === 'boolean') cur.fogEnabled = anyDto.fogEnabled;
      if (typeof anyDto.fogDensity === 'number') cur.fogDensity = anyDto.fogDensity;
      if (typeof anyDto.cameraZoom === 'number') cur.cameraZoom = anyDto.cameraZoom;
      if (typeof anyDto.gravityY === 'number') cur.gravityY = anyDto.gravityY;
      if (typeof anyDto.jumpForce === 'number') cur.jumpForce = anyDto.jumpForce;

      (project as any).aiUnityConfig = cur;
    }

    await project.save();
    return { success: true, data: project.toObject() };
  }

  async getDownloadUrl(ownerId: string, id: string, baseUrl: string, target?: string) {
    const p = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== ownerId) throw new ForbiddenException();
    if (p.status !== 'ready') {
      throw new BadRequestException('Project not ready');
    }

    const t = (target || '').toString().trim().toLowerCase();
    const desired =
      t === 'android_apk' || t === 'android'
        ? ((p as any).androidApkStorageKey || p.resultStorageKey)
        : t === 'webgl'
          ? ((p as any).webglZipStorageKey || p.resultStorageKey)
          : p.resultStorageKey;

    if (!desired) {
      throw new BadRequestException('Artifact not available');
    }

    const url = baseUrl.replace(/\/$/, '') + '/api/projects/files/' + encodeURIComponent(String(desired));
    return { success: true, data: { url } };
  }

  async getPreviewUrl(ownerId: string, id: string, baseUrl: string, token?: string) {
    const p: any = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== ownerId) throw new ForbiddenException();
    if (!p.webglIndexStorageKey) throw new BadRequestException('Missing web build');
    const base = baseUrl.replace(/\/$/, '');
    let url = base + '/api/projects/files/' + p.webglIndexStorageKey;
    if (token && token.trim()) {
      url +=
        '?projectId=' +
        encodeURIComponent(id) +
        '&token=' +
        encodeURIComponent(token) +
        '&apiBaseUrl=' +
        encodeURIComponent(base);
    }
    return { success: true, data: { url } };
  }

  async rebuild(ownerId: string, id: string) {
    const project: any = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId) throw new ForbiddenException();

    // Reset status + error. Keep previously built artifacts for other platforms.
    project.status = 'queued';
    project.error = undefined;
    const target = ((project as any).buildTarget || 'webgl').toString().trim().toLowerCase();
    const isAndroidApk = target === 'android_apk' || target === 'android';
    if (isAndroidApk) {
      project.resultStorageKey = undefined;
      project.androidApkStorageKey = undefined;
    } else {
      project.resultStorageKey = undefined;
      project.webglIndexStorageKey = undefined;
      project.webglZipStorageKey = undefined;
    }
    (project as any).buildTimings = undefined;
    await project.save();

    this.runBuild(String(project._id)).catch(() => null);
    return { success: true, data: { projectId: String(project._id) } };
  }

  async attachMedia(
    ownerId: string,
    projectId: string,
    params: { previewImage?: any; screenshots?: any[]; previewVideo?: any; baseUrl: string },
  ) {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId) throw new ForbiddenException();

    const base = params.baseUrl.replace(/\/$/, '');

    const previewImage = params.previewImage;
    if (previewImage?.buffer) {
      const imgKey =
        project._id.toString() +
        '/preview_' +
        String(Date.now()) +
        '_' +
        String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
      await this.projectStorage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      project.previewImageUrl = base + '/api/projects/files/' + encodeURIComponent(imgKey);
    }

    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const shotUrls: string[] = [];
    for (const s of screenshots) {
      if (!s?.buffer) continue;
      const shotKey =
        project._id.toString() +
        '/shot_' +
        String(Date.now()) +
        '_' +
        Math.random().toString(16).slice(2) +
        '_' +
        String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_');
      await this.projectStorage.putBuffer({ key: shotKey, buffer: s.buffer });
      shotUrls.push(base + '/api/projects/files/' + encodeURIComponent(shotKey));
    }
    if (shotUrls.length) {
      project.screenshotUrls = shotUrls;
    }

    const previewVideo = params.previewVideo;
    if (previewVideo?.buffer) {
      const vidKey =
        project._id.toString() +
        '/video_' +
        String(Date.now()) +
        '_' +
        String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_');
      await this.projectStorage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      project.previewVideoUrl = base + '/api/projects/files/' + encodeURIComponent(vidKey);
    }

    await project.save();
    return { success: true, data: project.toObject() };
  }

  private async runBuild(projectId: string) {
    const project = await this.projectModel.findById(projectId);
    if (!project) return;

    const buildStartedAt = Date.now();
    const stepStartedAt: Record<string, number> = {};
    const stepDurations: Record<string, number> = {};
    const startStep = (name: string) => {
      stepStartedAt[name] = Date.now();
    };
    const endStep = (name: string) => {
      const t0 = stepStartedAt[name];
      if (typeof t0 === 'number') stepDurations[name] = Date.now() - t0;
    };

    project.status = 'running';
    project.error = undefined;
    (project as any).buildTimings = {
      startedAt: new Date(buildStartedAt).toISOString(),
      steps: {},
    };
    await project.save();

    startStep('workdir');
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gameforge-project-'));
    endStep('workdir');

    try {
      startStep('load_template');
      const template = await this.templateModel.findById(project.templateId).lean();
      if (!template) throw new Error('Template not found');
      endStep('load_template');

      // 1) Copy template zip to workdir and extract
      startStep('extract_template');
      const zipAbs = this.templateStorage.resolveKey(template.storageKey);
      const zipCopyAbs = path.join(workDir, 'template.zip');
      await fs.promises.copyFile(zipAbs, zipCopyAbs);

      const extractedRoot = path.join(workDir, 'unity');
      await fs.promises.mkdir(extractedRoot, { recursive: true });

      const zip = new AdmZip(zipCopyAbs);
      zip.extractAllTo(extractedRoot, true);
      endStep('extract_template');

      // 2) Find the Unity project root
      startStep('find_unity_root');
      let unityRoot = extractedRoot;
      let assetsDir = path.join(unityRoot, 'Assets');
      let packagesDir = path.join(unityRoot, 'Packages');
      let projectSettingsDir = path.join(unityRoot, 'ProjectSettings');

      if (!fs.existsSync(assetsDir) || !fs.existsSync(packagesDir) || !fs.existsSync(projectSettingsDir)) {
        // Some zips wrap the Unity project inside one (or more) directory levels.
        // Search up to a small depth for a folder that contains the expected Unity structure.
        const maxDepth = 3;
        const queue: Array<{ dir: string; depth: number }> = [{ dir: extractedRoot, depth: 0 }];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (visited.has(cur.dir)) continue;
          visited.add(cur.dir);

          const a = path.join(cur.dir, 'Assets');
          const p = path.join(cur.dir, 'Packages');
          const s = path.join(cur.dir, 'ProjectSettings');
          if (fs.existsSync(a) && fs.existsSync(p) && fs.existsSync(s)) {
            unityRoot = cur.dir;
            assetsDir = a;
            packagesDir = p;
            projectSettingsDir = s;
            break;
          }

          if (cur.depth >= maxDepth) continue;
          let children: fs.Dirent[] = [];
          try {
            children = await fs.promises.readdir(cur.dir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const d of children) {
            if (!d.isDirectory()) continue;
            if (d.name === '__MACOSX') continue;
            queue.push({ dir: path.join(cur.dir, d.name), depth: cur.depth + 1 });
          }
        }
      }
      endStep('find_unity_root');

      // 2c) Ensure Burst package exists (many Unity packages expect it; missing causes CS0246 BurstCompile/SharedStatic errors)
      startStep('ensure_burst');
      try {
        let changedBurst = false;

        let unityMajor: number | null = null;
        try {
          const pvAbs = path.join(projectSettingsDir, 'ProjectVersion.txt');
          if (fs.existsSync(pvAbs)) {
            const pv = await fs.promises.readFile(pvAbs, 'utf8');
            const m = (pv || '').match(/m_EditorVersion\s*:\s*(\d+)\./);
            if (m?.[1]) {
              const v = Number(m[1]);
              if (Number.isFinite(v) && v > 2018 && v < 10000) unityMajor = v;
            }
          }
        } catch {
          // ignore
        }

        const desiredBurstVersion =
          unityMajor && unityMajor >= 6000
            ? '1.8.16'
            : unityMajor && unityMajor < 2022
              ? '1.6.6'
              : unityMajor === 2022
                ? '1.8.7'
                : '1.8.12';
        const manifestAbs = path.join(packagesDir, 'manifest.json');
        if (fs.existsSync(manifestAbs)) {
          const raw = await fs.promises.readFile(manifestAbs, 'utf8');
          const parsed = JSON.parse(raw || '{}') as any;
          if (!parsed.dependencies || typeof parsed.dependencies !== 'object') {
            parsed.dependencies = {};
          }

          const deps = parsed.dependencies as Record<string, string>;
          const current = (deps['com.unity.burst'] || '').toString().trim();
          if (!current || current !== desiredBurstVersion) {
            deps['com.unity.burst'] = desiredBurstVersion;
            changedBurst = true;
          }

          await fs.promises.writeFile(manifestAbs, JSON.stringify(parsed, null, 2));
        }

        if (changedBurst) {
          try {
            const lockAbs = path.join(packagesDir, 'packages-lock.json');
            if (fs.existsSync(lockAbs)) {
              await fs.promises.unlink(lockAbs);
            }
          } catch {
            // ignore
          }

          try {
            const pcAbs = path.join(unityRoot, 'Library', 'PackageCache');
            if (fs.existsSync(pcAbs)) {
              await fs.promises.rm(pcAbs, { recursive: true, force: true });
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
      endStep('ensure_burst');

      // 2b) Unity Library cache (big build speedup)
      // Cache key: per-template. This is safe for MVP; later we can include Unity version hash.
      startStep('library_cache_restore');
      const cacheBase = process.env.UNITY_LIBRARY_CACHE_DIR
        ? path.resolve(process.env.UNITY_LIBRARY_CACHE_DIR)
        : path.resolve(process.cwd(), 'uploads', 'unity-library-cache');
      const cacheKey = String(project.templateId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const cachedLibraryAbs = path.join(cacheBase, cacheKey, 'Library');
      const unityLibraryAbs = path.join(unityRoot, 'Library');
      try {
        if (fs.existsSync(cachedLibraryAbs) && !fs.existsSync(unityLibraryAbs)) {
          await fs.promises.mkdir(path.dirname(unityLibraryAbs), { recursive: true });
          // Node 18+: fs.cp is available (your deps use Node 22 types)
          await fs.promises.cp(cachedLibraryAbs, unityLibraryAbs, { recursive: true });
        }
      } catch {
        // ignore cache restore failures; build can still proceed
      }
      endStep('library_cache_restore');

      // 3b) Ensure we have build scripts
      startStep('inject_build_script');
      const editorDir = path.join(assetsDir, 'Editor');
      await fs.promises.mkdir(editorDir, { recursive: true });

      const buildWebglAbs = path.join(editorDir, 'GameForgeBuildWebGL.cs');
      {
        const cs = `using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace GameForge {
  public static class BuildWebGL {
    public static void PerformBuild() {
      // Faster iteration + easier hosting: disable Unity WebGL compression by default.
      // If you later want compression, enable it and ensure your server sends Content-Encoding correctly.
      try {
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
      } catch {}

      string outDir = null;
      var args = Environment.GetCommandLineArgs();
      for (int i = 0; i < args.Length; i++) {
        if (args[i] == "-gameforgeOutput" && i + 1 < args.Length) {
          outDir = args[i + 1];
        }
      }
      if (string.IsNullOrEmpty(outDir)) {
        outDir = Path.Combine(Directory.GetCurrentDirectory(), "GameForgeWebGL");
      }
      Directory.CreateDirectory(outDir);

      var scenes = EditorBuildSettings.scenes;
      var enabledScenes = scenes
        .Where(s => s != null && s.enabled && !string.IsNullOrEmpty(s.path))
        .Select(s => s.path)
        .ToArray();

      if (enabledScenes.Length == 0) {
        // Fallback: pick first scene asset in the project
        var guids = AssetDatabase.FindAssets("t:Scene");
        if (guids == null || guids.Length == 0) {
          throw new Exception("No scenes found in project (no enabled scenes in Build Settings, and no .unity assets)");
        }
        var firstScenePath = AssetDatabase.GUIDToAssetPath(guids[0]);
        if (string.IsNullOrEmpty(firstScenePath)) {
          throw new Exception("Could not resolve first scene path");
        }
        enabledScenes = new string[] { firstScenePath };
      }

      var opts = new BuildPlayerOptions {
        scenes = enabledScenes,
        locationPathName = outDir,
        target = BuildTarget.WebGL,
        options = BuildOptions.None
      };
      var report = BuildPipeline.BuildPlayer(opts);
      if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) {
        throw new Exception("WebGL build failed: " + report.summary.result);
      }
      Debug.Log("GAMEFORGE_WEBGL_BUILD_OK");
    }
  }
}`;
        await fs.promises.writeFile(buildWebglAbs, cs, 'utf8');
      }

      const buildAndroidAbs = path.join(editorDir, 'GameForgeBuildAndroid.cs');
      {
        const cs = `using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace GameForge {
  public static class BuildAndroid {
    public static void PerformBuild() {
      string outPath = null;
      var args = Environment.GetCommandLineArgs();
      for (int i = 0; i < args.Length; i++) {
        if (args[i] == "-gameforgeOutput" && i + 1 < args.Length) {
          outPath = args[i + 1];
        }
      }

      if (string.IsNullOrEmpty(outPath)) {
        outPath = Path.Combine(Directory.GetCurrentDirectory(), "GameForgeAndroid.apk");
      }
      var outDir = Path.GetDirectoryName(outPath);
      if (!string.IsNullOrEmpty(outDir)) Directory.CreateDirectory(outDir);

      var scenes = EditorBuildSettings.scenes;
      var enabledScenes = scenes
        .Where(s => s != null && s.enabled && !string.IsNullOrEmpty(s.path))
        .Select(s => s.path)
        .ToArray();

      if (enabledScenes.Length == 0) {
        var guids = AssetDatabase.FindAssets("t:Scene");
        if (guids == null || guids.Length == 0) {
          throw new Exception("No scenes found in project (no enabled scenes in Build Settings, and no .unity assets)");
        }
        var firstScenePath = AssetDatabase.GUIDToAssetPath(guids[0]);
        if (string.IsNullOrEmpty(firstScenePath)) {
          throw new Exception("Could not resolve first scene path");
        }
        enabledScenes = new string[] { firstScenePath };
      }

      var opts = new BuildPlayerOptions {
        scenes = enabledScenes,
        locationPathName = outPath,
        target = BuildTarget.Android,
        options = BuildOptions.None
      };
      var report = BuildPipeline.BuildPlayer(opts);
      if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) {
        throw new Exception("Android build failed: " + report.summary.result);
      }
      Debug.Log("GAMEFORGE_ANDROID_BUILD_OK");
    }
  }
}`;
        await fs.promises.writeFile(buildAndroidAbs, cs, 'utf8');
      }

      const captureMediaAbs = path.join(editorDir, 'GameForgeCaptureMedia.cs');
      {
        const cs = `using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GameForge {
  public static class CaptureMedia {
    private static string GetArg(string name) {
      try {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++) {
          if (args[i] == name && i + 1 < args.Length) return args[i + 1];
        }
      } catch {}
      return null;
    }

    private static string[] GetEnabledScenesOrFallback() {
      var scenes = EditorBuildSettings.scenes;
      var enabledScenes = scenes
        .Where(s => s != null && s.enabled && !string.IsNullOrEmpty(s.path))
        .Select(s => s.path)
        .ToArray();

      if (enabledScenes.Length == 0) {
        var guids = AssetDatabase.FindAssets("t:Scene");
        if (guids == null || guids.Length == 0) {
          throw new Exception("No scenes found for capture");
        }
        var firstScenePath = AssetDatabase.GUIDToAssetPath(guids[0]);
        if (string.IsNullOrEmpty(firstScenePath)) {
          throw new Exception("Could not resolve first scene path");
        }
        enabledScenes = new string[] { firstScenePath };
      }
      return enabledScenes;
    }

    private static Camera FindCamera() {
      try {
        var cam = Camera.main;
        if (cam != null) return cam;
      } catch {}
      try {
        #if UNITY_2023_1_OR_NEWER
          var cams = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
          if (cams != null && cams.Length > 0) return cams[0];
        #else
          var cams = UnityEngine.Object.FindObjectsOfType<Camera>();
          if (cams != null && cams.Length > 0) return cams[0];
        #endif
      } catch {}
      return null;
    }

    private static void RenderToPng(Camera cam, int w, int h, string outAbs) {
      var rt = new RenderTexture(w, h, 24);
      var prev = cam.targetTexture;
      var prevActive = RenderTexture.active;
      cam.targetTexture = rt;
      RenderTexture.active = rt;
      cam.Render();
      var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
      tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
      tex.Apply();
      var bytes = tex.EncodeToPNG();
      File.WriteAllBytes(outAbs, bytes);
      cam.targetTexture = prev;
      RenderTexture.active = prevActive;
      UnityEngine.Object.DestroyImmediate(tex);
      rt.Release();
      UnityEngine.Object.DestroyImmediate(rt);
    }

    public static void PerformCapture() {
      var outDir = GetArg("-gameforgeMediaOut");
      if (string.IsNullOrEmpty(outDir)) {
        outDir = Path.Combine(Directory.GetCurrentDirectory(), "gameforge_media_out");
      }
      Directory.CreateDirectory(outDir);
      var framesDir = Path.Combine(outDir, "frames");
      Directory.CreateDirectory(framesDir);

      var scenes = GetEnabledScenesOrFallback();
      EditorSceneManager.OpenScene(scenes[0]);

      // Let the editor settle a little.
      try { UnityEditorInternal.InternalEditorUtility.RepaintAllViews(); } catch {}

      var cam = FindCamera();
      if (cam == null) throw new Exception("No camera found for capture");

      int w = 1280;
      int h = 720;
      RenderToPng(cam, w, h, Path.Combine(outDir, "cover.png"));
      RenderToPng(cam, w, h, Path.Combine(outDir, "shot_1.png"));

      // Slight camera offsets for variety.
      var p0 = cam.transform.position;
      var r0 = cam.transform.rotation;
      try {
        cam.transform.position = p0 + new Vector3(0.4f, 0.0f, 0.0f);
        RenderToPng(cam, w, h, Path.Combine(outDir, "shot_2.png"));
        cam.transform.position = p0 + new Vector3(-0.35f, 0.15f, 0.0f);
        RenderToPng(cam, w, h, Path.Combine(outDir, "shot_3.png"));
      } catch {}
      cam.transform.position = p0;
      cam.transform.rotation = r0;

      // Frames for a short video (about 6s @ 15fps = 90 frames)
      int fps = 15;
      int seconds = 6;
      int total = fps * seconds;
      for (int i = 0; i < total; i++) {
        float t = (total <= 1) ? 0f : (float)i / (float)(total - 1);
        float dx = Mathf.Sin(t * 6.2831f) * 0.25f;
        float dy = Mathf.Cos(t * 6.2831f) * 0.10f;
        try {
          cam.transform.position = p0 + new Vector3(dx, dy, 0f);
        } catch {}
        var fp = Path.Combine(framesDir, string.Format("frame_{0:0000}.png", i + 1));
        RenderToPng(cam, w, h, fp);
      }

      cam.transform.position = p0;
      cam.transform.rotation = r0;

      Debug.Log("GAMEFORGE_MEDIA_CAPTURE_OK");
    }
  }
}`;
        await fs.promises.writeFile(captureMediaAbs, cs, 'utf8');
      }

      endStep('inject_build_script');

      // 3c) Inject AI Unity config + bootstrap (Option A safe patch)
      startStep('inject_ai_patch');
      const aiCfg: any = (project as any).aiUnityConfig;
      if (aiCfg && typeof aiCfg === 'object') {
        const gfRoot = path.join(assetsDir, 'GameForgeAI');
        const gfGen = path.join(gfRoot, 'Generated');
        const gfRuntime = path.join(gfRoot, 'Runtime');
        const gfResources = path.join(assetsDir, 'Resources', 'GameForgeAI');
        await fs.promises.mkdir(gfGen, { recursive: true });
        await fs.promises.mkdir(gfRuntime, { recursive: true });
        await fs.promises.mkdir(gfResources, { recursive: true });

        const cfgAbs = path.join(gfGen, 'GameForgeAiConfig.json');
        const cfgResAbs = path.join(gfResources, 'GameForgeAiConfig.json');
        const cfgJson = JSON.stringify(
          {
            timeScale: aiCfg.timeScale,
            difficulty: aiCfg.difficulty,
            theme: aiCfg.theme,
            notes: aiCfg.notes,
            speed: aiCfg.speed,
            genre: aiCfg.genre,
            assetsType: aiCfg.assetsType,
            mechanics: aiCfg.mechanics,
            primaryColor: aiCfg.primaryColor,
            secondaryColor: aiCfg.secondaryColor,
            accentColor: aiCfg.accentColor,
            playerColor: aiCfg.playerColor,
            fogEnabled: aiCfg.fogEnabled,
            fogDensity: aiCfg.fogDensity,
            cameraZoom: aiCfg.cameraZoom,
            gravityY: aiCfg.gravityY,
            jumpForce: aiCfg.jumpForce,
          },
          null,
          0,
        );
        await fs.promises.writeFile(cfgAbs, cfgJson, 'utf8');
        await fs.promises.writeFile(cfgResAbs, cfgJson, 'utf8');

        const kbAbs = path.join(gfRuntime, 'GameForgeKeyboardController.cs');
        {
          const cs = `using UnityEngine;

namespace GameForgeAI {
  public class GameForgeKeyboardController : MonoBehaviour {
    private GameObject _player;
    private Rigidbody2D _rb2d;

    private void TryFindPlayer() {
      if (_player != null) return;
      try {
        var byTag = GameObject.FindGameObjectsWithTag("Player");
        if (byTag != null && byTag.Length > 0) _player = byTag[0];
      } catch {}

      if (_player == null) {
        try {
          var gos = GameObject.FindObjectsOfType<GameObject>();
          for (int i = 0; i < gos.Length; i++) {
            var go = gos[i];
            if (go == null) continue;
            var n = go.name;
            if (string.IsNullOrEmpty(n)) continue;
            var ln = n.ToLowerInvariant();
            if (ln == "player" || ln.Contains("player") || ln.Contains("character") || ln.Contains("hero")) {
              _player = go;
              break;
            }
          }
        } catch {}
      }

      try {
        if (_player != null) _rb2d = _player.GetComponent<Rigidbody2D>();
      } catch {}
    }

    private void Update() {
      TryFindPlayer();
      if (_player == null) return;

      float x = 0f;
      float y = 0f;
      try {
        x = Input.GetAxisRaw("Horizontal");
        y = Input.GetAxisRaw("Vertical");
      } catch {}

      var v = new Vector3(x, y, 0f);
      if (v.sqrMagnitude <= 0.001f) return;
      v = v.normalized;

      float speed = 4.5f;
      try { speed = PlayerPrefs.GetFloat("GF_AI_SPEED", speed); } catch {}
      speed = Mathf.Clamp(speed, 1f, 12f);

      try {
        if (_rb2d != null) {
          _rb2d.velocity = new Vector2(v.x * speed, _rb2d.velocity.y);
          return;
        }
      } catch {}

      try {
        _player.transform.position += v * speed * Time.deltaTime;
      } catch {}
    }
  }
}`;
          await fs.promises.writeFile(kbAbs, cs, 'utf8');
        }

        const bootstrapAbs = path.join(gfRuntime, 'GameForgeAiBootstrap.cs');
        {
          const cs = `using System;
using UnityEngine;
using System.Reflection;
using System.Collections;
using UnityEngine.Networking;

namespace GameForgeAI {
  [Serializable]
  public class GameForgeAiConfig {
    public float timeScale = 1f;
    public float difficulty = 0.5f;
    public string theme = "default";
    public string notes = "";

    // Runtime metadata (optional)
    public string updatedAt = null;

    // Extended runtime parameters (optional)
    public float speed = 5f;
    public string genre = "platformer";
    public string assetsType = "lowpoly";
    public string[] mechanics = null;
    public string primaryColor = "#22C55E";
    public string secondaryColor = "#3B82F6";
    public string accentColor = "#F59E0B";
    public string playerColor = null;

    // Environment / camera (optional)
    public bool fogEnabled = false;
    public float fogDensity = 0.0f;
    public float cameraZoom = 0.0f;

    // Physics / feel (optional)
    public float gravityY = 0.0f;
    public float jumpForce = 0.0f;
  }

  public class GameForgeAiRuntime : MonoBehaviour {
    internal static GameForgeAiConfig Current;
    internal static string RuntimeFetchStatus;
    internal static string RuntimeAbsUrl;

    void OnGUI() {
      // Lightweight debug overlay: shows that AI patch was applied.
      // Safe for most templates (no UI package required).
      try {
        var cfg = Current;
        if (cfg == null) return;
        GUI.color = new Color(1f, 1f, 1f, 0.9f);
        var rect = new Rect(12, 12, 520, 156);
        GUI.Box(rect, "AI Patch Loaded");
        var theme = (cfg.theme ?? "default");
        GUI.Label(new Rect(24, 36, 500, 22), "Theme: " + theme + " | Difficulty: " + cfg.difficulty.ToString("0.00") + " | TimeScale: " + cfg.timeScale.ToString("0.00"));
        if (!string.IsNullOrEmpty(cfg.genre) || !string.IsNullOrEmpty(cfg.assetsType)) {
          GUI.Label(new Rect(24, 58, 500, 22), "Genre: " + (cfg.genre ?? "") + " | Assets: " + (cfg.assetsType ?? "") + " | Speed: " + cfg.speed.ToString("0.0"));
        }
        if (!string.IsNullOrEmpty(cfg.notes)) {
          GUI.Label(new Rect(24, 80, 500, 22), "Notes: " + cfg.notes);
        }

        // Runtime fetch debug
        var st = RuntimeFetchStatus;
        if (!string.IsNullOrEmpty(st)) {
          GUI.Label(new Rect(24, 102, 500, 22), "Runtime: " + st);
        }
        var abs = RuntimeAbsUrl;
        if (!string.IsNullOrEmpty(abs)) {
          var shortAbs = abs.Length > 72 ? abs.Substring(0, 72) + "…" : abs;
          GUI.Label(new Rect(24, 124, 500, 22), "URL: " + shortAbs);
        }
      } catch {}
    }

    private static T[] FindAll<T>() where T : UnityEngine.Object {
      try {
        #if UNITY_2023_1_OR_NEWER
          return UnityEngine.Object.FindObjectsByType<T>(FindObjectsSortMode.None);
        #else
          return UnityEngine.Object.FindObjectsOfType<T>();
        #endif
      } catch { return new T[0]; }
    }
  }

  public static class GameForgeAiBootstrap {
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    public static void Init() {
      try {
        // Create runtime host (for overlay + coroutines)
        var go = new GameObject("GameForgeAI_Runtime");
        UnityEngine.Object.DontDestroyOnLoad(go);
        var runtime = go.AddComponent<GameForgeAiRuntime>();

        try {
          EnsureKeyboardController();
        } catch {}

        // Apply bundled config immediately (fast startup), then try runtime fetch in WebGL.
        var bundled = LoadBundledConfig();
        if (bundled != null) {
          ApplyConfig(bundled);
        }

        // WebGL: attempt to fetch latest config using token+projectId from URL query params.
        #if UNITY_WEBGL && !UNITY_EDITOR
        runtime.StartCoroutine(FetchAndApplyRuntimeConfigLoop());
        #endif

        Debug.Log("GAMEFORGE_AI_CONFIG_OK");
      } catch (Exception e) {
        Debug.LogError("GAMEFORGE_AI_CONFIG_ERR: " + e);
      }
    }

    private static T[] FindAll<T>() where T : UnityEngine.Object {
      try {
        #if UNITY_2023_1_OR_NEWER
          return UnityEngine.Object.FindObjectsByType<T>(FindObjectsSortMode.None);
        #else
          return UnityEngine.Object.FindObjectsOfType<T>();
        #endif
      } catch { return new T[0]; }
    }

    private static void EnsureKeyboardController() {
      try {
        // Add controller component if missing.
        // It will try to find the Player object by tag/name at runtime.
        var existing = GameObject.FindObjectOfType<GameForgeKeyboardController>();
        if (existing != null) return;

        var go = new GameObject("GameForgeKeyboardController");
        UnityEngine.Object.DontDestroyOnLoad(go);
        go.AddComponent<GameForgeKeyboardController>();
      } catch {}
    }

    private static GameForgeAiConfig LoadBundledConfig() {
      try {
        // WebGL-safe: load from Resources (Assets/Resources/GameForgeAI/GameForgeAiConfig.json)
        var ta = Resources.Load<TextAsset>("GameForgeAI/GameForgeAiConfig");
        if (ta == null || string.IsNullOrEmpty(ta.text)) return null;
        return JsonUtility.FromJson<GameForgeAiConfig>(ta.text);
      } catch { return null; }
    }

    private static void ApplyConfig(GameForgeAiConfig cfg) {
      if (cfg == null) return;
      GameForgeAiRuntime.Current = cfg;
      Time.timeScale = Mathf.Clamp(cfg.timeScale, 0.5f, 2.0f);
      PlayerPrefs.SetFloat("GF_AI_DIFFICULTY", Mathf.Clamp01(cfg.difficulty));
      PlayerPrefs.SetString("GF_AI_THEME", cfg.theme ?? "default");

      // Extended runtime parameters (optional)
      try {
        if (cfg.speed > 0f) PlayerPrefs.SetFloat("GF_AI_SPEED", cfg.speed);
        if (Mathf.Abs(cfg.gravityY) > 0.001f) PlayerPrefs.SetFloat("GF_AI_GRAVITY_Y", cfg.gravityY);
        if (cfg.jumpForce > 0.001f) PlayerPrefs.SetFloat("GF_AI_JUMP_FORCE", cfg.jumpForce);
        if (cfg.cameraZoom > 0.001f) PlayerPrefs.SetFloat("GF_AI_CAMERA_ZOOM", cfg.cameraZoom);
        if (!string.IsNullOrEmpty(cfg.genre)) PlayerPrefs.SetString("GF_AI_GENRE", cfg.genre);
        if (!string.IsNullOrEmpty(cfg.assetsType)) PlayerPrefs.SetString("GF_AI_ASSETS_TYPE", cfg.assetsType);
        if (cfg.mechanics != null && cfg.mechanics.Length > 0) {
          PlayerPrefs.SetString("GF_AI_MECHANICS", string.Join(",", cfg.mechanics));
        }
        if (!string.IsNullOrEmpty(cfg.primaryColor)) PlayerPrefs.SetString("GF_AI_COLOR_PRIMARY", cfg.primaryColor);
        if (!string.IsNullOrEmpty(cfg.secondaryColor)) PlayerPrefs.SetString("GF_AI_COLOR_SECONDARY", cfg.secondaryColor);
        if (!string.IsNullOrEmpty(cfg.accentColor)) PlayerPrefs.SetString("GF_AI_COLOR_ACCENT", cfg.accentColor);
        if (!string.IsNullOrEmpty(cfg.playerColor)) PlayerPrefs.SetString("GF_AI_COLOR_PLAYER", cfg.playerColor);
      } catch {}

      try {
        Shader.SetGlobalFloat("GF_AI_DIFFICULTY", Mathf.Clamp01(cfg.difficulty));
        Shader.SetGlobalFloat("GF_AI_SPEED", Mathf.Max(0f, cfg.speed));
        Shader.SetGlobalFloat("GF_AI_TIME_SCALE", Mathf.Clamp(cfg.timeScale, 0.5f, 2.0f));

        Color c;
        if (!string.IsNullOrEmpty(cfg.primaryColor) && ColorUtility.TryParseHtmlString(cfg.primaryColor, out c)) {
          Shader.SetGlobalColor("GF_AI_COLOR_PRIMARY", c);
        }
        if (!string.IsNullOrEmpty(cfg.secondaryColor) && ColorUtility.TryParseHtmlString(cfg.secondaryColor, out c)) {
          Shader.SetGlobalColor("GF_AI_COLOR_SECONDARY", c);
        }
        if (!string.IsNullOrEmpty(cfg.accentColor) && ColorUtility.TryParseHtmlString(cfg.accentColor, out c)) {
          Shader.SetGlobalColor("GF_AI_COLOR_ACCENT", c);
        }
      } catch {}

      try {
        var json = JsonUtility.ToJson(cfg);
        var mbs = FindAll<MonoBehaviour>();
        for (int i = 0; i < mbs.Length; i++) {
          try { mbs[i].SendMessage("OnGameForgeAiConfigUpdated", json, SendMessageOptions.DontRequireReceiver); } catch {}
        }
      } catch {}

      try {
        ApplyToScene(cfg);
      } catch {}

      PlayerPrefs.Save();
      Debug.Log("GAMEFORGE_AI_CONFIG_APPLIED");
    }

    private static void ApplyToScene(GameForgeAiConfig cfg) {
      if (cfg == null) return;

      // Environment: Fog
      try {
        if (cfg.fogEnabled) {
          RenderSettings.fog = true;
          if (cfg.fogDensity > 0f) RenderSettings.fogDensity = Mathf.Clamp(cfg.fogDensity, 0.0001f, 0.1f);
        } else {
          // only disable if explicitly requested (avoid changing template defaults unexpectedly)
          if (cfg.fogDensity > 0f) {
            RenderSettings.fog = true;
            RenderSettings.fogDensity = Mathf.Clamp(cfg.fogDensity, 0.0001f, 0.1f);
          }
        }
      } catch {}

      // Camera zoom: apply to orthographic cameras. If cfg.cameraZoom <= 0, ignore.
      try {
        if (cfg.cameraZoom > 0f) {
          var cams0 = FindAll<Camera>();
          for (int i = 0; i < cams0.Length; i++) {
            var c0 = cams0[i];
            if (c0 == null) continue;
            if (!c0.orthographic) continue;
            try { c0.orthographicSize = Mathf.Clamp(cfg.cameraZoom, 1f, 30f); } catch {}
          }
        }
      } catch {}

      // Physics gravity (2D): if gravityY is set (non-zero), apply.
      try {
        if (Mathf.Abs(cfg.gravityY) > 0.001f) {
          Physics2D.gravity = new Vector2(0f, Mathf.Clamp(cfg.gravityY, -50f, 0f));
        }
      } catch {}

      // Physics gravity (3D): if gravityY is set (non-zero), apply.
      try {
        if (Mathf.Abs(cfg.gravityY) > 0.001f) {
          Physics.gravity = new Vector3(0f, Mathf.Clamp(cfg.gravityY, -50f, 0f), 0f);
        }
      } catch {}

      GameObject player = null;
      try {
        var byTag = GameObject.FindGameObjectsWithTag("Player");
        if (byTag != null && byTag.Length > 0) player = byTag[0];
      } catch {}

      if (player == null) {
        try {
          var gos = FindAll<GameObject>();
          for (int i = 0; i < gos.Length; i++) {
            var n = gos[i] != null ? gos[i].name : null;
            if (string.IsNullOrEmpty(n)) continue;
            var ln = n.ToLowerInvariant();
            if (ln == "player" || ln.Contains("player")) { player = gos[i]; break; }
          }
        } catch {}
      }

      // Gameplay speed: apply to common movement fields/properties across templates.
      // This intentionally does NOT change Time.timeScale; it's per-character speed.
      try {
        if (cfg.speed > 0.001f) {
          ApplySpeedToScene(cfg.speed);
        }
      } catch {}

      // Parse optional colors once
      bool hasPrimary = false;
      bool hasSecondary = false;
      bool hasAccent = false;
      bool hasPlayer = false;
      Color primary = Color.white;
      Color secondary = Color.white;
      Color accent = Color.white;
      Color playerC = Color.white;
      try {
        if (!string.IsNullOrEmpty(cfg.primaryColor)) {
          hasPrimary = ColorUtility.TryParseHtmlString(cfg.primaryColor, out primary);
        }
      } catch { hasPrimary = false; }
      try {
        if (!string.IsNullOrEmpty(cfg.secondaryColor)) {
          hasSecondary = ColorUtility.TryParseHtmlString(cfg.secondaryColor, out secondary);
        }
      } catch { hasSecondary = false; }
      try {
        if (!string.IsNullOrEmpty(cfg.accentColor)) {
          hasAccent = ColorUtility.TryParseHtmlString(cfg.accentColor, out accent);
        }
      } catch { hasAccent = false; }

      try {
        if (!string.IsNullOrEmpty(cfg.playerColor)) {
          hasPlayer = ColorUtility.TryParseHtmlString(cfg.playerColor, out playerC);
        }
      } catch { hasPlayer = false; }

      // Player-only color override (if provided): apply to player and return early for player pass.
      // We still keep global colors for environment if set.
      if (hasPlayer && player != null) {
        try {
          Shader hueShader = null;
          try { hueShader = Shader.Find("Sprites/Default-Hue"); } catch {}
          var srsP = player.GetComponentsInChildren<SpriteRenderer>(true);
          for (int i = 0; i < srsP.Length; i++) {
            var sr = srsP[i];
            if (sr == null) continue;
            try {
              if (hueShader != null) {
                // Use an instance material so we don't mutate shared materials for other sprites.
                var m = sr.material;
                if (m != null) m.shader = hueShader;
              }
            } catch {}
            try { sr.color = playerC; } catch {}
          }
          var rendsP = player.GetComponentsInChildren<Renderer>(true);
          for (int i = 0; i < rendsP.Length; i++) {
            var r = rendsP[i];
            if (r == null) continue;
            try { ApplyColorToRenderer(r, playerC); } catch {}
          }
        } catch {}
      }

      // Very visible fallbacks: background/fog/ambient/skybox
      try {
        var cams = FindAll<Camera>();
        for (int i = 0; i < cams.Length; i++) {
          if (cams[i] == null) continue;
          try {
            if (hasSecondary) cams[i].backgroundColor = secondary;
            else if (hasPrimary) cams[i].backgroundColor = primary;
          } catch {}
        }
      } catch {}

      try {
        if (hasSecondary) RenderSettings.fogColor = secondary;
        else if (hasPrimary) RenderSettings.fogColor = primary;
      } catch {}
      try {
        if (hasPrimary) RenderSettings.ambientLight = primary;
      } catch {}
      try {
        if (RenderSettings.skybox != null) {
          if (hasSecondary && RenderSettings.skybox.HasProperty("_Tint")) RenderSettings.skybox.SetColor("_Tint", secondary);
          else if (hasPrimary && RenderSettings.skybox.HasProperty("_Tint")) RenderSettings.skybox.SetColor("_Tint", primary);
          if (hasSecondary && RenderSettings.skybox.HasProperty("_SkyTint")) RenderSettings.skybox.SetColor("_SkyTint", secondary);
          else if (hasPrimary && RenderSettings.skybox.HasProperty("_SkyTint")) RenderSettings.skybox.SetColor("_SkyTint", primary);
        }
      } catch {}

      // Apply colors: player/UI/background heuristics, with full-scene fallback
      if (hasPrimary || hasSecondary || hasAccent) {
        try {
          var gosAll = FindAll<GameObject>();
          for (int gi = 0; gi < gosAll.Length; gi++) {
            var go = gosAll[gi];
            if (go == null) continue;

            string n = null;
            try { n = go.name; } catch { n = null; }
            var ln = string.IsNullOrEmpty(n) ? "" : n.ToLowerInvariant();

            // Choose a target color based on object name/category.
            Color target = hasPrimary ? primary : (hasSecondary ? secondary : accent);
            if (hasSecondary && (ln.Contains("bg") || ln.Contains("background") || ln.Contains("sky") || ln.Contains("level"))) {
              target = secondary;
            }
            if (hasAccent && (ln.Contains("ui") || ln.Contains("hud") || ln.Contains("canvas") || ln.Contains("button") || ln.Contains("panel"))) {
              target = accent;
            }

            // Prefer accent for player if available
            if (hasAccent && player != null && (go == player || go.transform.IsChildOf(player.transform))) {
              target = accent;
            }

            try {
              var srsGo = go.GetComponentsInChildren<SpriteRenderer>(true);
              for (int si = 0; si < srsGo.Length; si++) { if (srsGo[si] != null) srsGo[si].color = target; }
            } catch {}

            try {
              var rendsGo = go.GetComponentsInChildren<Renderer>(true);
              for (int ri = 0; ri < rendsGo.Length; ri++) {
                var r = rendsGo[ri];
                if (r == null) continue;
                try { ApplyColorToRenderer(r, target); } catch {}
              }
            } catch {}
          }
        } catch {}

        try {
          if (player != null) {
            // Keep an explicit player pass for maximum visibility
            var targetP = hasAccent ? accent : (hasPrimary ? primary : secondary);
            var srs = player.GetComponentsInChildren<SpriteRenderer>(true);
            for (int i = 0; i < srs.Length; i++) { if (srs[i] != null) srs[i].color = targetP; }
            var rends = player.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < rends.Length; i++) {
              var r = rends[i];
              if (r == null) continue;
              try { ApplyColorToRenderer(r, targetP); } catch {}
            }
          } else {
            // Full scene fallback
            var targetAll = hasPrimary ? primary : (hasSecondary ? secondary : accent);
            var srs = FindAll<SpriteRenderer>();
            for (int i = 0; i < srs.Length; i++) { if (srs[i] != null) srs[i].color = targetAll; }
            var rends = FindAll<Renderer>();
            for (int i = 0; i < rends.Length; i++) {
              var r = rends[i];
              if (r == null) continue;
              try { ApplyColorToRenderer(r, targetAll); } catch {}
            }
          }
        } catch {}

        try {
          var lights = FindAll<Light>();
          for (int i = 0; i < lights.Length; i++) {
            if (lights[i] == null) continue;
            try {
              if (hasSecondary) lights[i].color = secondary;
              else if (hasPrimary) lights[i].color = primary;
            } catch {}
          }
        } catch {}

        try {
          var trails = FindAll<TrailRenderer>();
          for (int i = 0; i < trails.Length; i++) {
            var t = trails[i];
            if (t == null) continue;
            try {
              var tc = hasAccent ? accent : (hasPrimary ? primary : secondary);
              t.startColor = tc; t.endColor = tc;
            } catch {}
          }
        } catch {}

      }
    }

    private static void ApplyColorToRenderer(Renderer r, Color c) {
      if (r == null) return;
      try {
        var block = new MaterialPropertyBlock();
        r.GetPropertyBlock(block);
        try { block.SetColor("_Color", c); } catch {}
        try { block.SetColor("_MainColor", c); } catch {}
        try { block.SetColor("_BaseColor", c); } catch {}
        try { block.SetColor("_TintColor", c); } catch {}
        try { block.SetColor("_EmissionColor", c); } catch {}
        r.SetPropertyBlock(block);
      } catch {}

      try {
        var mats = r.materials;
        if (mats == null) return;
        for (int i = 0; i < mats.Length; i++) {
          var m = mats[i];
          if (m == null) continue;
          try {
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            if (m.HasProperty("_MainColor")) m.SetColor("_MainColor", c);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_TintColor")) m.SetColor("_TintColor", c);
            if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", c);
          } catch {}
        }
      } catch {}
    }

    private static void TrySetSpeedOnBehaviour(MonoBehaviour b, float sp) {
      if (b == null) return;
      var t = b.GetType();
      if (t == null) return;

      try {
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
        var fields = t.GetFields(flags);
        for (int i = 0; i < fields.Length; i++) {
          var f = fields[i];
          if (f == null) continue;
          var n = f.Name != null ? f.Name.ToLowerInvariant() : "";
          if (n == "speed" || n.Contains("movespeed") || n.Contains("movementspeed") || n.Contains("run") || n.Contains("walk") || n.Contains("maxspeed") || n.Contains("playerspeed")) {
            try {
              if (f.FieldType == typeof(float)) f.SetValue(b, sp);
              else if (f.FieldType == typeof(int)) f.SetValue(b, (int)Mathf.Round(sp));
              else if (f.FieldType == typeof(double)) f.SetValue(b, (double)sp);
            } catch {}
          }
        }

        var props = t.GetProperties(flags);
        for (int i = 0; i < props.Length; i++) {
          var p = props[i];
          if (p == null || !p.CanWrite) continue;
          var n = p.Name != null ? p.Name.ToLowerInvariant() : "";
          if (n == "speed" || n.Contains("movespeed") || n.Contains("movementspeed") || n.Contains("run") || n.Contains("walk") || n.Contains("maxspeed") || n.Contains("playerspeed")) {
            try {
              if (p.PropertyType == typeof(float)) p.SetValue(b, sp, null);
              else if (p.PropertyType == typeof(int)) p.SetValue(b, (int)Mathf.Round(sp), null);
              else if (p.PropertyType == typeof(double)) p.SetValue(b, (double)sp, null);
            } catch {}
          }
        }
      } catch {}
    }

    private static void ApplySpeedToScene(float sp) {
      try {
        sp = Mathf.Clamp(sp, 0f, 50f);
      } catch {}

      // 1) Most templates store speed-like values on scripts. Apply to common names.
      try {
        var mbs = FindAll<MonoBehaviour>();
        for (int i = 0; i < mbs.Length; i++) {
          try { TrySetSpeedOnBehaviour(mbs[i], sp); } catch {}
        }
      } catch {}

      // 2) Animations: scale animator playback speed.
      try {
        var anims = FindAll<Animator>();
        for (int i = 0; i < anims.Length; i++) {
          var a = anims[i];
          if (a == null) continue;
          try { a.speed = Mathf.Clamp(sp / 7f, 0.1f, 4.0f); } catch {}
        }
      } catch {}

      // 3) NavMeshAgent (3D AI): set agent.speed if the type exists in this project.
      try {
        var agentType = Type.GetType("UnityEngine.AI.NavMeshAgent, UnityEngine.AIModule");
        if (agentType != null) {
          var agents = FindAll<Component>();
          for (int i = 0; i < agents.Length; i++) {
            var c = agents[i];
            if (c == null) continue;
            try {
              if (!agentType.IsAssignableFrom(c.GetType())) continue;
              var p = c.GetType().GetProperty("speed");
              if (p != null && p.CanWrite && p.PropertyType == typeof(float)) {
                p.SetValue(c, sp, null);
              }
            } catch {}
          }
        }
      } catch {}
    }

    #if UNITY_WEBGL && !UNITY_EDITOR
    private static string _lastRuntimeFingerprint = null;

    private static IEnumerator FetchAndApplyRuntimeConfigLoop() {
      // Fetch once quickly, then poll.
      for (int i = 0; i < 1; i++) {
        yield return FetchAndApplyRuntimeConfigOnce();
      }

      while (true) {
        yield return new WaitForSeconds(2.0f);
        yield return FetchAndApplyRuntimeConfigOnce();
      }
    }

    private static IEnumerator FetchAndApplyRuntimeConfigOnce() {
      string absUrl = Application.absoluteURL;
      GameForgeAiRuntime.RuntimeAbsUrl = absUrl;
      if (string.IsNullOrEmpty(absUrl)) yield break;

      string projectId = GetQueryParam(absUrl, "projectId");
      string token = GetQueryParam(absUrl, "token");
      string apiBaseUrl = GetQueryParam(absUrl, "apiBaseUrl");
      if (string.IsNullOrEmpty(projectId) || string.IsNullOrEmpty(token)) {
        GameForgeAiRuntime.RuntimeFetchStatus = "missing projectId/token";
        yield break;
      }

      string baseUrl = !string.IsNullOrEmpty(apiBaseUrl) ? apiBaseUrl : GetOrigin(absUrl);
      if (string.IsNullOrEmpty(baseUrl)) {
        GameForgeAiRuntime.RuntimeFetchStatus = "origin parse failed";
        yield break;
      }

      string cfgUrl = baseUrl + "/api/projects/" + UnityWebRequest.EscapeURL(projectId) + "/runtime-config?token=" + UnityWebRequest.EscapeURL(token);
      GameForgeAiRuntime.RuntimeFetchStatus = "fetching";

      using (var req = UnityWebRequest.Get(cfgUrl)) {
        req.timeout = 10;
        yield return req.SendWebRequest();
        if (req.result != UnityWebRequest.Result.Success) {
          GameForgeAiRuntime.RuntimeFetchStatus = "fetch fail: " + req.error;
          Debug.LogWarning("GAMEFORGE_AI_RUNTIME_FETCH_FAIL: " + req.error);
          yield break;
        }

        var text = req.downloadHandler != null ? req.downloadHandler.text : null;
        if (string.IsNullOrEmpty(text)) yield break;

        // Expected: { success: true, data: {...} }
        var wrapped = JsonUtility.FromJson<RuntimeCfgWrapper>(text);
        if (wrapped == null || wrapped.data == null) yield break;

        // Only re-apply when config fingerprint changes.
        try {
          var cfg = wrapped.data;
          var mechCount = (cfg.mechanics != null) ? cfg.mechanics.Length : 0;
          var fp = (cfg.updatedAt ?? "") + "|" +
            cfg.timeScale.ToString("0.###") + "|" +
            cfg.difficulty.ToString("0.###") + "|" +
            cfg.speed.ToString("0.###") + "|" +
            (cfg.theme ?? "") + "|" +
            (cfg.genre ?? "") + "|" +
            (cfg.assetsType ?? "") + "|" +
            (cfg.primaryColor ?? "") + "|" +
            (cfg.secondaryColor ?? "") + "|" +
            (cfg.accentColor ?? "") + "|" +
            (cfg.playerColor ?? "") + "|" +
            (cfg.fogEnabled ? "1" : "0") + "|" +
            cfg.fogDensity.ToString("0.###") + "|" +
            cfg.cameraZoom.ToString("0.###") + "|" +
            cfg.gravityY.ToString("0.###") + "|" +
            cfg.jumpForce.ToString("0.###") + "|" +
            mechCount.ToString();

          if (_lastRuntimeFingerprint != null && _lastRuntimeFingerprint == fp) {
            GameForgeAiRuntime.RuntimeFetchStatus = "fetch ok (no change)";
            yield break;
          }

          _lastRuntimeFingerprint = fp;
        } catch {}

        ApplyConfig(wrapped.data);
        GameForgeAiRuntime.RuntimeFetchStatus = "fetch ok";
        Debug.Log("GAMEFORGE_AI_RUNTIME_FETCH_OK");
      }
    }

    [Serializable]
    private class RuntimeCfgWrapper {
      public bool success;
      public GameForgeAiConfig data;
    }

    private static string GetOrigin(string url) {
      try {
        var u = new Uri(url);
        return u.Scheme + "://" + u.Host + (u.IsDefaultPort ? "" : (":" + u.Port));
      } catch {
        try {
          // Fallback parser for cases where Application.absoluteURL is not a full absolute URL
          // (some WebViews / proxies / redirects can produce unexpected strings).
          int schemeIdx = url.IndexOf("://");
          if (schemeIdx < 0) return null;
          int start = schemeIdx + 3;
          int slash = url.IndexOf('/', start);
          if (slash < 0) return url;
          return url.Substring(0, slash);
        } catch { return null; }
      }
    }

    private static string ExtractQueryString(string url) {
      try {
        int q = url.IndexOf('?');
        if (q >= 0) {
          int end = url.IndexOf('#', q + 1);
          if (end < 0) end = url.Length;
          return url.Substring(q + 1, end - (q + 1));
        }

        // Sometimes the router / webview keeps params after the fragment (#...?...)
        int h = url.IndexOf('#');
        if (h >= 0 && h + 1 < url.Length) {
          string frag = url.Substring(h + 1);
          int q2 = frag.IndexOf('?');
          if (q2 >= 0 && q2 + 1 < frag.Length) {
            return frag.Substring(q2 + 1);
          }
        }

        return null;
      } catch { return null; }
    }

    private static string GetQueryParam(string url, string key) {
      try {
        var q = ExtractQueryString(url);
        if (string.IsNullOrEmpty(q)) return null;
        var parts = q.Split('&');
        for (int i = 0; i < parts.Length; i++) {
          var kv = parts[i].Split('=');
          if (kv.Length < 2) continue;
          if (kv[0] == key) return Uri.UnescapeDataString(kv[1]);
        }
        return null;
      } catch { return null; }
    }
    #endif
  }
}
`;
          await fs.promises.writeFile(bootstrapAbs, cs, 'utf8');
        }

        endStep('inject_ai_patch');
      }

      // 4) Inject assets (optional)
      startStep('inject_assets');
      if (project.assetsCollectionId) {
        const assets = await this.assetModel
          .find({ ownerId: project.ownerId, collectionId: project.assetsCollectionId, status: 'ready' })
          .lean();

        for (const asset of assets) {
          const unityPath = (asset.unityPath || asset.name || 'asset').toString().replace(/\\/g, '/');
          if (!unityPath.startsWith('Assets/')) {
            // enforce unity path inside Assets
            continue;
          }
          const rel = unityPath.replace(/^Assets\//, '');
          const destAbs = path.join(assetsDir, rel);
          await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });

          const srcAbs = this.assetStorage.resolveKey(asset.storageKey);
          await fs.promises.copyFile(srcAbs, destAbs);
        }
      }
      endStep('inject_assets');

      // 5) Run Unity build
      startStep('unity_build');
      const unityEditorPath = process.env.UNITY_EDITOR_PATH || '';
      if (!unityEditorPath.trim()) {
        throw new Error('UNITY_EDITOR_PATH env var is required to run Unity builds');
      }

      const extractUnityErrorSummary = (out: string) => {
        try {
          const s = (out || '').toString();
          const lines = s.split(/\r?\n/);
          const tailLines = lines.slice(Math.max(0, lines.length - 400));

          const interesting = tailLines.filter((l) => {
            const t = (l || '').trim();
            if (!t) return false;
            return (
              /\berror\s+CS\d{4,5}\b/i.test(t) ||
              /\bexception\b/i.test(t) ||
              /debugger-agent:\s*unable to listen on/i.test(t) ||
              /android\s+sdk/i.test(t) ||
              /android\s+ndk/i.test(t) ||
              /java\s+home/i.test(t) ||
              /jre\s+not\s+found/i.test(t) ||
              /unable to find.*java/i.test(t) ||
              /gradle\b/i.test(t) ||
              /failed to run command.*gradle/i.test(t) ||
              /build tools.*not found/i.test(t) ||
              /sdk.*not.*found/i.test(t) ||
              /ndk.*not.*found/i.test(t) ||
              /license.*not accepted/i.test(t) ||
              /keystore/i.test(t) ||
              /scripts have compiler errors/i.test(t) ||
              /compilation failed/i.test(t) ||
              /aborting batchmode/i.test(t) ||
              /\bBuild failed\b/i.test(t) ||
              /\bFatal\b/i.test(t)
            );
          });

          const summary = (interesting.length ? interesting : tailLines)
            .slice(Math.max(0, (interesting.length ? interesting.length : tailLines.length) - 60))
            .join('\n');
          const clipped = summary.length > 6000 ? summary.slice(summary.length - 6000) : summary;
          return clipped.trim();
        } catch {
          return '';
        }
      };

      const runUnity = async (params: {
        buildTarget: 'WebGL' | 'Android';
        executeMethod: string;
        outputPath: string;
        extraArgs?: string[];
        stepName: string;
      }) => {
        startStep(params.stepName);
        const maxMs = Number(process.env.UNITY_BUILD_TIMEOUT_MS || '') || 20 * 60 * 1000;

        const unityEnv: Record<string, string | undefined> = { ...process.env };
        // Some environments inject Mono debugger options globally (e.g. via MONO_ENV_OPTIONS),
        // which can crash Unity batchmode with: "debugger-agent: Unable to listen on <port>".
        // Ensure Unity runs without inheriting those.
        for (const k of Object.keys(unityEnv)) {
          const key = k.toUpperCase();
          if (key.startsWith('MONO_')) delete unityEnv[k];
          if (key.startsWith('UNITY_DEBUG')) delete unityEnv[k];
          if (key === 'DEBUGGER_AGENT') delete unityEnv[k];
          try {
            const v = unityEnv[k];
            if (typeof v === 'string' && v.toLowerCase().includes('debugger-agent')) {
              delete unityEnv[k];
            }
          } catch {
            // ignore
          }
        }
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            unityEditorPath,
            [
              '-batchmode',
              '-quit',
              '-projectPath',
              unityRoot,
              '-buildTarget',
              params.buildTarget,
              '-executeMethod',
              params.executeMethod,
              ...(params.extraArgs || []),
              '-gameforgeOutput',
              params.outputPath,
              '-logFile',
              '-',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'], env: unityEnv },
          );

          this.activeBuildProcesses.set(projectId, child);

          let lastLogLine = '';
          let persistTimer: NodeJS.Timeout | null = null;
          let lastPersistAt = 0;
          const persist = (force: boolean) => {
            const line = (lastLogLine || '').trim();
            if (!line) return;
            const now = Date.now();
            if (!force && now - lastPersistAt < 1000) {
              if (!persistTimer) {
                persistTimer = setTimeout(() => {
                  persistTimer = null;
                  persist(true);
                }, 1000);
              }
              return;
            }
            lastPersistAt = now;
            this.projectModel
              .updateOne({ _id: projectId }, { $set: { buildLogLastLine: line } })
              .catch(() => null);
          };
          const takeLastLine = (text: string) => {
            const lines = text
              .split(/\r?\n/)
              .map((s) => s.trimEnd())
              .filter((s) => s.trim().length > 0);
            if (lines.length) {
              lastLogLine = lines[lines.length - 1];
              persist(false);
            }
          };

          let stdout = '';
          let stderr = '';
          const timer = setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, maxMs);

          child.stdout.on('data', (d) => {
            const s = d.toString();
            stdout += s;
            takeLastLine(s);
          });
          child.stderr.on('data', (d) => {
            const s = d.toString();
            stderr += s;
            takeLastLine(s);
          });
          child.on('error', reject);
          child.on('close', (code) => {
            clearTimeout(timer);
            try {
              const cur = this.activeBuildProcesses.get(projectId);
              if (cur === child) this.activeBuildProcesses.delete(projectId);
            } catch {
              // ignore
            }
            try {
              if (persistTimer) {
                clearTimeout(persistTimer);
                persistTimer = null;
              }
              persist(true);
            } catch {
              // ignore
            }
            if (code === 0) return resolve();
            const out = (stderr || stdout || '').toString();
            const summary = extractUnityErrorSummary(out);
            const tail = out.length > 4000 ? out.slice(out.length - 4000) : out;
            return reject(
              new Error(
                'Unity exited with code ' +
                  String(code) +
                  '. ' +
                  (summary ? 'Error summary:\n' + String(summary) : 'Output tail: ' + String(tail)),
              ),
            );
          });
        });
        endStep(params.stepName);
      };

      const target = ((project as any).buildTarget || 'webgl').toString().trim().toLowerCase();
      const isAndroidApk = target === 'android_apk' || target === 'android';

      if (isAndroidApk) {
        try {
          const sdk = (process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '').trim();
          const jh = (process.env.JAVA_HOME || '').trim();
          if (!sdk) {
            // eslint-disable-next-line no-console
            console.warn('[Projects] Android build: ANDROID_SDK_ROOT/ANDROID_HOME not set (may still be configured inside Unity Preferences)');
          }
          if (!jh) {
            // eslint-disable-next-line no-console
            console.warn('[Projects] Android build: JAVA_HOME not set (may still be configured inside Unity / bundled OpenJDK)');
          }
        } catch {
          // ignore
        }
      }

      const webglOutAbs = path.join(workDir, 'webgl_out');
      const androidApkAbs = path.join(workDir, 'android_out', 'GameForgeAndroid.apk');
      if (isAndroidApk) {
        await fs.promises.mkdir(path.dirname(androidApkAbs), { recursive: true });
      } else {
        await fs.promises.mkdir(webglOutAbs, { recursive: true });
      }

      await runUnity({
        buildTarget: isAndroidApk ? 'Android' : 'WebGL',
        executeMethod: isAndroidApk ? 'GameForge.BuildAndroid.PerformBuild' : 'GameForge.BuildWebGL.PerformBuild',
        outputPath: isAndroidApk ? androidApkAbs : webglOutAbs,
        stepName: 'unity_build',
      });

      // 5a) Capture media (cover + screenshots + frames)
      const mediaOutAbs = path.join(workDir, 'media_out');
      await fs.promises.mkdir(mediaOutAbs, { recursive: true });
      await runUnity({
        buildTarget: isAndroidApk ? 'Android' : 'WebGL',
        executeMethod: 'GameForge.CaptureMedia.PerformCapture',
        outputPath: isAndroidApk ? androidApkAbs : webglOutAbs,
        extraArgs: ['-gameforgeMediaOut', mediaOutAbs],
        stepName: 'capture_media',
      });

      // 5b) Save Library cache after a successful build
      startStep('library_cache_save');
      try {
        if (fs.existsSync(unityLibraryAbs)) {
          const cacheDest = cachedLibraryAbs;
          await fs.promises.mkdir(path.dirname(cacheDest), { recursive: true });
          await fs.promises.rm(cacheDest, { recursive: true, force: true });
          await fs.promises.cp(unityLibraryAbs, cacheDest, { recursive: true });
        }
      } catch {
        // ignore cache save failures
      }
      endStep('library_cache_save');

      // 5c) Convert frames to MP4 and upload media
      startStep('upload_media');
      try {
        const publicBase = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
        const base = publicBase || 'http://localhost:3000';

        const coverAbs = path.join(mediaOutAbs, 'cover.png');
        const shots = [
          path.join(mediaOutAbs, 'shot_1.png'),
          path.join(mediaOutAbs, 'shot_2.png'),
          path.join(mediaOutAbs, 'shot_3.png'),
        ].filter((p) => fs.existsSync(p));

        if (fs.existsSync(coverAbs)) {
          const key = project._id.toString() + '/media/cover_' + String(Date.now()) + '.png';
          const buf = await fs.promises.readFile(coverAbs);
          await this.projectStorage.putBuffer({ key, buffer: buf });
          project.previewImageUrl = base + '/api/projects/files/' + encodeURIComponent(key);
        }

        const shotUrls: string[] = [];
        for (const sAbs of shots) {
          const key =
            project._id.toString() +
            '/media/shot_' +
            String(Date.now()) +
            '_' +
            Math.random().toString(16).slice(2) +
            '.png';
          const buf = await fs.promises.readFile(sAbs);
          await this.projectStorage.putBuffer({ key, buffer: buf });
          shotUrls.push(base + '/api/projects/files/' + encodeURIComponent(key));
        }
        if (shotUrls.length) project.screenshotUrls = shotUrls;

        const framesDir = path.join(mediaOutAbs, 'frames');
        const mp4Abs = path.join(mediaOutAbs, 'preview.mp4');
        const ffmpeg = (process.env.FFMPEG_PATH || 'ffmpeg').trim();
        if (fs.existsSync(framesDir)) {
          const first = path.join(framesDir, 'frame_0001.png');
          if (fs.existsSync(first)) {
            await new Promise<void>((resolve, reject) => {
              const child = spawn(
                ffmpeg,
                [
                  '-y',
                  '-framerate',
                  '15',
                  '-i',
                  path.join(framesDir, 'frame_%04d.png'),
                  '-c:v',
                  'libx264',
                  '-pix_fmt',
                  'yuv420p',
                  '-movflags',
                  '+faststart',
                  mp4Abs,
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
              );
              let out = '';
              child.stdout.on('data', (d) => (out += d.toString()));
              child.stderr.on('data', (d) => (out += d.toString()));
              child.on('error', reject);
              child.on('close', (code) => {
                if (code === 0) return resolve();
                const tail = out.length > 3000 ? out.slice(out.length - 3000) : out;
                return reject(new Error('ffmpeg exited with code ' + String(code) + '. Output tail: ' + String(tail)));
              });
            });

            if (fs.existsSync(mp4Abs)) {
              const key = project._id.toString() + '/media/video_' + String(Date.now()) + '.mp4';
              const buf = await fs.promises.readFile(mp4Abs);
              await this.projectStorage.putBuffer({ key, buffer: buf });
              project.previewVideoUrl = base + '/api/projects/files/' + encodeURIComponent(key);
            }
          }
        }
      } catch {
        // media capture/upload is best-effort; do not fail the build
      }
      endStep('upload_media');

      if (isAndroidApk) {
        startStep('verify_output');
        if (!fs.existsSync(androidApkAbs)) {
          throw new Error('Android build did not produce an APK');
        }
        endStep('verify_output');

        startStep('upload_android_apk');
        const outApkKey = project._id.toString() + '.apk';
        const apkBuf = await fs.promises.readFile(androidApkAbs);
        await this.projectStorage.putBuffer({ key: outApkKey, buffer: apkBuf });
        endStep('upload_android_apk');

        project.resultStorageKey = outApkKey;
        project.androidApkStorageKey = outApkKey;
        project.status = 'ready';
      } else {
        startStep('verify_output');
        const indexAbs = path.join(webglOutAbs, 'index.html');
        if (!fs.existsSync(indexAbs)) {
          throw new Error('WebGL build did not produce index.html');
        }
        endStep('verify_output');

        startStep('upload_webgl_files');
        const webglPrefix = project._id.toString() + '/webgl';
        const walk = async (dirAbs: string) => {
          const entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
          for (const e of entries) {
            const abs = path.join(dirAbs, e.name);
            if (e.isDirectory()) {
              await walk(abs);
              continue;
            }
            const rel = path.relative(webglOutAbs, abs).replace(/\\/g, '/');
            const key = webglPrefix + '/' + rel;
            const buf = await fs.promises.readFile(abs);
            await this.projectStorage.putBuffer({ key, buffer: buf });
          }
        };
        await walk(webglOutAbs);
        endStep('upload_webgl_files');

        // Zip WebGL output for download
        startStep('zip_webgl');
        const outZipKey = project._id.toString() + '.zip';
        const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
          const archive = archiver('zip', { zlib: { level: 9 } });
          const chunks: Buffer[] = [];
          archive.on('error', reject);
          archive.on('data', (d) => chunks.push(Buffer.from(d)));
          archive.on('end', () => resolve(Buffer.concat(chunks)));
          archive.directory(webglOutAbs, false);
          archive.finalize();
        });
        await this.projectStorage.putBuffer({ key: outZipKey, buffer: zipBuffer });
        endStep('zip_webgl');

        project.resultStorageKey = outZipKey;
        project.webglZipStorageKey = outZipKey;
        project.webglIndexStorageKey = webglPrefix + '/index.html';
        project.status = 'ready';
      }

      const buildFinishedAt = Date.now();
      (project as any).buildTimings = {
        startedAt: new Date(buildStartedAt).toISOString(),
        finishedAt: new Date(buildFinishedAt).toISOString(),
        durationMs: buildFinishedAt - buildStartedAt,
        steps: stepDurations,
      };
      await project.save();
    } catch (e: any) {
      try {
        project.status = 'failed';
        project.error = e?.message ? String(e.message) : String(e);

        const buildFinishedAt = Date.now();
        (project as any).buildTimings = {
          startedAt: new Date(buildStartedAt).toISOString(),
          finishedAt: new Date(buildFinishedAt).toISOString(),
          durationMs: buildFinishedAt - buildStartedAt,
          steps: stepDurations,
        };
        await project.save();
      } catch {
        // ignore
      }
    } finally {
      try {
        await fs.promises.rm(workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

