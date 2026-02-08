import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import archiver from 'archiver';
import { URL } from 'url';

import { LocalStorageService } from './local-storage.service';
import { Asset, AssetDocument, AssetType } from './schemas/asset.schema';
import { AssetCollection, AssetCollectionDocument } from './schemas/asset-collection.schema';
import { AssetExportJob, AssetExportJobDocument } from './schemas/asset-export-job.schema';

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
    @InjectModel(AssetCollection.name)
    private readonly collectionModel: Model<AssetCollectionDocument>,
    @InjectModel(AssetExportJob.name)
    private readonly exportJobModel: Model<AssetExportJobDocument>,
    private readonly storage: LocalStorageService,
  ) {}

  private sanitizeUnityPath(path?: string) {
    if (!path) return undefined;
    const normalized = String(path).replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {
      throw new BadRequestException('Invalid unityPath');
    }
    return normalized;
  }

  private defaultUnityPath(opts: { collectionName?: string; filename: string; type: AssetType }) {
    const base = `Assets/GameForge/${(opts.collectionName || 'Library').trim()}`.replace(/\s+/g, ' ');
    const folder =
      opts.type === 'texture'
        ? 'Textures'
        : opts.type === 'model'
          ? 'Models'
          : opts.type === 'audio'
            ? 'Audio'
            : opts.type === 'shader'
              ? 'Shaders'
              : 'Other';

    return `${base}/${folder}/${opts.filename}`;
  }

  async createCollection(ownerId: string, dto: { name: string; description?: string }) {
    const created = await this.collectionModel.create({
      ownerId,
      name: dto.name,
      description: dto.description || '',
    });
    return { success: true, data: created };
  }

  async uploadAssetFromUrl(params: {
    ownerId: string;
    url: string;
    type: AssetType;
    name?: string;
    tags?: string[];
    collectionId?: string;
    unityPath?: string;
  }) {
    const rawUrl = String(params.url || '').trim();
    if (!rawUrl) throw new BadRequestException('url is required');

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) urls are allowed');
    }

    const res = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'GameForgeBackend/1.0',
      },
    } as any);

    if (!res.ok) {
      throw new BadRequestException(`Failed to download url (status=${res.status})`);
    }

    const contentLength = res.headers.get('content-length');
    const maxBytes = 50 * 1024 * 1024;
    if (contentLength) {
      const n = parseInt(contentLength, 10);
      if (Number.isFinite(n) && n > maxBytes) {
        throw new BadRequestException('File too large');
      }
    }

    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!buf.length) throw new BadRequestException('Empty file');
    if (buf.length > maxBytes) throw new BadRequestException('File too large');

    const path = parsed.pathname || '/asset';
    const last = path.split('/').filter(Boolean).pop() || 'asset';
    const safeName = last.replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = res.headers.get('content-type') || 'application/octet-stream';

    const fileLike = {
      originalname: safeName,
      mimetype: mimeType,
      size: buf.length,
      buffer: buf,
    };

    return this.uploadAsset({
      ownerId: params.ownerId,
      file: fileLike,
      type: params.type,
      name: params.name,
      tags: params.tags,
      collectionId: params.collectionId,
      unityPath: params.unityPath,
    });
  }

  async listCollections(ownerId: string) {
    const list = await this.collectionModel.find({ ownerId }).sort({ createdAt: -1 }).lean();
    return { success: true, data: list };
  }

  async updateCollection(ownerId: string, id: string, dto: any) {
    const col = await this.collectionModel.findById(id);
    if (!col) throw new NotFoundException('Collection not found');
    if (col.ownerId !== ownerId) throw new ForbiddenException();

    if (dto.name != null) col.name = dto.name;
    if (dto.description != null) col.description = dto.description;
    if (dto.coverAssetId != null) col.coverAssetId = dto.coverAssetId;

    await col.save();
    return { success: true, data: col };
  }

  async deleteCollection(ownerId: string, id: string) {
    const col = await this.collectionModel.findById(id);
    if (!col) throw new NotFoundException('Collection not found');
    if (col.ownerId !== ownerId) throw new ForbiddenException();

    await this.assetModel.updateMany({ ownerId, collectionId: id }, { $unset: { collectionId: 1 } });
    await col.deleteOne();
    return { success: true };
  }

  async uploadAsset(params: {
    ownerId: string;
    file: any;
    type: AssetType;
    name?: string;
    tags?: string[];
    collectionId?: string;
    unityPath?: string;
  }) {
    const file = params.file;
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }

    const originalName = String(file.originalname || 'asset').trim();
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

    let collectionName: string | undefined;
    if (params.collectionId) {
      const col = await this.collectionModel.findById(params.collectionId).lean();
      if (!col) throw new NotFoundException('Collection not found');
      if (col.ownerId !== params.ownerId) throw new ForbiddenException();
      collectionName = col.name;
    }

    const unityPath =
      this.sanitizeUnityPath(params.unityPath) ||
      this.defaultUnityPath({
        collectionName,
        filename: safeName,
        type: params.type,
      });

    const created = await this.assetModel.create({
      ownerId: params.ownerId,
      collectionId: params.collectionId,
      type: params.type,
      name: (params.name || originalName).trim(),
      tags: params.tags || [],
      unityPath,
      mimeType: file.mimetype,
      size: file.size,
      storageKey: 'pending',
      status: 'processing',
    });

    const key = `${params.ownerId}/${created._id.toString()}/${safeName}`;
    await this.storage.putBuffer({ key, buffer: file.buffer });

    created.storageKey = key;
    created.publicUrl = undefined;
    created.status = 'ready';
    await created.save();

    return { success: true, data: created };
  }

  async listAssets(ownerId: string, query: any) {
    const filter: any = { ownerId };
    if (query.collectionId) filter.collectionId = String(query.collectionId);
    if (query.type) filter.type = String(query.type);
    if (query.q) {
      filter.name = { $regex: String(query.q), $options: 'i' };
    }
    if (query.tag) {
      filter.tags = String(query.tag);
    }

    const page = Math.max(1, parseInt(String(query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || '20'), 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.assetModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.assetModel.countDocuments(filter),
    ]);

    return { success: true, data: { items, page, limit, total } };
  }

  async getAsset(ownerId: string, id: string) {
    const asset = await this.assetModel.findById(id).lean();
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException();
    return { success: true, data: asset };
  }

  async getAssetDownloadUrl(ownerId: string, id: string, baseUrl: string) {
    const asset = await this.assetModel.findById(id).lean();
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException();

    const url = `${baseUrl.replace(/\/$/, '')}/assets/files/${encodeURIComponent(asset.storageKey)}`;
    return { success: true, data: { url } };
  }

  async deleteAsset(ownerId: string, id: string) {
    const asset = await this.assetModel.findById(id);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.ownerId !== ownerId) throw new ForbiddenException();

    await asset.deleteOne();
    return { success: true };
  }

  async createExport(ownerId: string, dto: { collectionId: string; format: 'zip' | 'unitypackage' }) {
    if (dto.format !== 'zip') {
      throw new BadRequestException('Only zip export is supported for now');
    }

    const col = await this.collectionModel.findById(dto.collectionId).lean();
    if (!col) throw new NotFoundException('Collection not found');
    if (col.ownerId !== ownerId) throw new ForbiddenException();

    const job = await this.exportJobModel.create({
      ownerId,
      collectionId: dto.collectionId,
      format: 'zip',
      status: 'queued',
    });

    this.runZipExport(job._id.toString()).catch(() => null);

    return { success: true, data: job };
  }

  async getExport(ownerId: string, id: string) {
    const job = await this.exportJobModel.findById(id).lean();
    if (!job) throw new NotFoundException('Export not found');
    if (job.ownerId !== ownerId) throw new ForbiddenException();
    return { success: true, data: job };
  }

  async getExportDownloadUrl(ownerId: string, id: string, baseUrl: string) {
    const job = await this.exportJobModel.findById(id).lean();
    if (!job) throw new NotFoundException('Export not found');
    if (job.ownerId !== ownerId) throw new ForbiddenException();
    if (job.status !== 'ready' || !job.resultStorageKey) {
      throw new BadRequestException('Export not ready');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/assets/files/${encodeURIComponent(job.resultStorageKey)}`;
    return { success: true, data: { url } };
  }

  private async runZipExport(jobId: string) {
    const job = await this.exportJobModel.findById(jobId);
    if (!job) return;

    job.status = 'running';
    job.error = undefined;
    await job.save();

    try {
      const assets = await this.assetModel
        .find({ ownerId: job.ownerId, collectionId: job.collectionId, status: 'ready' })
        .lean();

      const zipKey = `exports/${job.ownerId}/${job._id.toString()}.zip`;

      const archive = archiver('zip', { zlib: { level: 9 } });

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        archive.on('error', reject);
        archive.on('data', (d) => chunks.push(Buffer.from(d)));
        archive.on('end', () => resolve());

        for (const asset of assets) {
          const unityPath = (asset.unityPath || asset.name || 'asset').toString();
          const stream = this.storage.createReadStream(asset.storageKey);
          archive.append(stream, { name: unityPath });
        }

        archive.finalize();
      });

      const zipBuffer = Buffer.concat(chunks);
      await this.storage.putBuffer({ key: zipKey, buffer: zipBuffer });

      job.status = 'ready';
      job.resultStorageKey = zipKey;
      await job.save();
    } catch (e: any) {
      job.status = 'failed';
      job.error = e?.message ? String(e.message) : 'Export failed';
      await job.save();
    }
  }
}
