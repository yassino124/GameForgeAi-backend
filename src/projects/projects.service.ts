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
import os from 'os';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

import { GameProject, GameProjectDocument } from './schemas/game-project.schema';
import { UnityTemplate, UnityTemplateDocument } from '../templates/schemas/unity-template.schema';
import { TemplateStorageService } from '../templates/template-storage.service';
import { ProjectStorageService } from './project-storage.service';
import { Asset, AssetDocument } from '../assets/schemas/asset.schema';
import { LocalStorageService } from '../assets/local-storage.service';

@Injectable()
export class ProjectsService {
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
  ) {}

  async createFromTemplate(ownerId: string, dto: { templateId: string; name: string; description?: string; assetsCollectionId?: string }) {
    const template = await this.templateModel.findById(dto.templateId).lean();
    if (!template) throw new NotFoundException('Template not found');
    if (!template.isPublic) throw new ForbiddenException();

    const created = await this.projectModel.create({
      ownerId,
      templateId: dto.templateId,
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      assetsCollectionId: dto.assetsCollectionId,
      status: 'queued',
    });

    this.runBuild(created._id.toString()).catch(() => null);

    return { success: true, data: created };
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

  async update(ownerId: string, id: string, dto: { name?: string; description?: string }) {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId) throw new ForbiddenException();

    if (typeof dto.name === 'string') {
      const v = dto.name.trim();
      if (!v) throw new BadRequestException('Name is required');
      project.name = v;
    }
    if (typeof dto.description === 'string') {
      project.description = dto.description.trim();
    }

    await project.save();
    return { success: true, data: project.toObject() };
  }

  async getDownloadUrl(ownerId: string, id: string, baseUrl: string) {
    const p = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== ownerId) throw new ForbiddenException();
    if (p.status !== 'ready' || !p.resultStorageKey) {
      throw new BadRequestException('Project not ready');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/api/projects/files/${encodeURIComponent(p.resultStorageKey)}`;
    return { success: true, data: { url } };
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
      const imgKey = `${project._id.toString()}/preview_${Date.now()}_${String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.projectStorage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      project.previewImageUrl = `${base}/api/projects/files/${encodeURIComponent(imgKey)}`;
    }

    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const shotUrls: string[] = [];
    for (const s of screenshots) {
      if (!s?.buffer) continue;
      const shotKey = `${project._id.toString()}/shot_${Date.now()}_${Math.random().toString(16).slice(2)}_${String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.projectStorage.putBuffer({ key: shotKey, buffer: s.buffer });
      shotUrls.push(`${base}/api/projects/files/${encodeURIComponent(shotKey)}`);
    }
    if (shotUrls.length) {
      project.screenshotUrls = shotUrls;
    }

    const previewVideo = params.previewVideo;
    if (previewVideo?.buffer) {
      const vidKey = `${project._id.toString()}/video_${Date.now()}_${String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.projectStorage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      project.previewVideoUrl = `${base}/api/projects/files/${encodeURIComponent(vidKey)}`;
    }

    await project.save();
    return { success: true, data: project.toObject() };
  }

  private async runBuild(projectId: string) {
    const project = await this.projectModel.findById(projectId);
    if (!project) return;

    project.status = 'running';
    project.error = undefined;
    await project.save();

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gameforge-project-'));

    try {
      const template = await this.templateModel.findById(project.templateId).lean();
      if (!template) throw new Error('Template not found');

      // 1) Copy template zip to workdir and extract
      const templateZipAbs = path.join(workDir, 'template.zip');
      await this.templateStorage.copyTo({ fromKey: template.storageKey, toAbsPath: templateZipAbs });

      const extractedRoot = path.join(workDir, 'unity');
      await fs.promises.mkdir(extractedRoot, { recursive: true });

      const zip = new AdmZip(templateZipAbs);
      zip.extractAllTo(extractedRoot, true);

      // 2) Validate expected folders
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

      if (!fs.existsSync(assetsDir) || !fs.existsSync(packagesDir) || !fs.existsSync(projectSettingsDir)) {
        throw new Error('Invalid template zip. Root must contain Assets/, Packages/, ProjectSettings/.');
      }

      // 3) Inject assets (optional)
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

      // 4) Zip final project
      const outZipKey = `${project._id.toString()}.zip`;

      const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks: Buffer[] = [];

        archive.on('error', reject);
        archive.on('data', (d) => chunks.push(Buffer.from(d)));
        archive.on('end', () => resolve(Buffer.concat(chunks)));

        archive.directory(unityRoot, false);
        archive.finalize();
      });

      await this.projectStorage.putBuffer({ key: outZipKey, buffer: zipBuffer });

      project.status = 'ready';
      project.resultStorageKey = outZipKey;
      await project.save();
    } catch (e: any) {
      project.status = 'failed';
      project.error = e?.message ? String(e.message) : 'Build failed';
      await project.save();
    } finally {
      try {
        await fs.promises.rm(workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
