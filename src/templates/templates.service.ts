import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import AdmZip from 'adm-zip';
import Stripe from 'stripe';

import { TemplateStorageService } from './template-storage.service';
import { UnityTemplate, UnityTemplateDocument } from './schemas/unity-template.schema';
import { TemplateReview, TemplateReviewDocument } from './schemas/template-review.schema';
import { TemplatePurchase, TemplatePurchaseDocument } from './schemas/template-purchase.schema';

@Injectable()
export class TemplatesService {
  private stripe: Stripe | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(UnityTemplate.name)
    private readonly templateModel: Model<UnityTemplateDocument>,
    @InjectModel(TemplateReview.name)
    private readonly reviewModel: Model<TemplateReviewDocument>,
    @InjectModel(TemplatePurchase.name)
    private readonly purchaseModel: Model<TemplatePurchaseDocument>,
    private readonly storage: TemplateStorageService,
  ) {}

  private _getStripe(): Stripe {
    if (this.stripe) return this.stripe;

    const secretKey = (this.configService.get<string>('stripe.secretKey') || '').trim();
    if (!secretKey) {
      throw new BadRequestException('Stripe is not configured');
    }

    const rawApiVersion = (this.configService.get<string>('stripe.apiVersion') || '').trim();
    const apiVersionCandidate = rawApiVersion && /^\d{4}-\d{2}-\d{2}$/.test(rawApiVersion) ? rawApiVersion : '';
    const apiVersion = (apiVersionCandidate || '2024-06-20') as any;

    this.stripe = new Stripe(secretKey, { apiVersion });
    return this.stripe;
  }

  private _toStripeAmount(price: number) {
    const p = typeof price === 'number' ? price : 0;
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.round(p * 100);
  }

  async uploadTemplate(params: {
    ownerId: string;
    file: any;
    previewImage?: any;
    screenshots?: any[];
    previewVideo?: any;
    baseUrl: string;
    name: string;
    description?: string;
    category?: string;
    tagsCsv?: string;
    price?: number;
  }) {
    const file = params.file;
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }

    const buf: Buffer = file.buffer;
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new BadRequestException('Invalid zip file. Expected a .zip archive.');
    }

    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries();
      if (!entries || entries.length === 0) {
        throw new Error('empty zip');
      }
    } catch {
      throw new BadRequestException('Invalid or unsupported zip format');
    }

    const tags = params.tagsCsv
      ? String(params.tagsCsv)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const created = await this.templateModel.create({
      ownerId: params.ownerId,
      name: params.name.trim(),
      description: params.description?.trim() || '',
      category: params.category?.trim() || 'General',
      tags,
      isPublic: true,
      price: typeof params.price === 'number' ? params.price : 0,
      rating: 4.7,
      downloads: 0,
      storageKey: 'pending',
    });

    const key = `${created._id.toString()}.zip`;
    await this.storage.putBuffer({ key, buffer: file.buffer });

    created.storageKey = key;

    const base = params.baseUrl.replace(/\/$/, '');

    const previewImage = params.previewImage;
    if (previewImage?.buffer) {
      const imgKey = `${created._id.toString()}/preview_${Date.now()}_${String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      created.previewImageUrl = `${base}/api/templates/files/${encodeURIComponent(imgKey)}`;
    }

    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const shotUrls: string[] = [];
    for (const s of screenshots) {
      if (!s?.buffer) continue;
      const shotKey = `${created._id.toString()}/shot_${Date.now()}_${Math.random().toString(16).slice(2)}_${String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: shotKey, buffer: s.buffer });
      shotUrls.push(`${base}/api/templates/files/${encodeURIComponent(shotKey)}`);
    }
    if (shotUrls.length) {
      created.screenshotUrls = shotUrls;
    }

    const previewVideo = params.previewVideo;
    if (previewVideo?.buffer) {
      const vidKey = `${created._id.toString()}/video_${Date.now()}_${String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      created.previewVideoUrl = `${base}/api/templates/files/${encodeURIComponent(vidKey)}`;
    }

    await created.save();

    return { success: true, data: created };
  }

  async updateTemplateMedia(params: {
    templateId: string;
    ownerId: string;
    allowNonOwner?: boolean;
    baseUrl: string;
    previewImage?: any;
    screenshots?: any[];
    previewVideo?: any;
  }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');

    if (!params.allowNonOwner && t.ownerId !== params.ownerId) {
      throw new ForbiddenException();
    }

    const base = params.baseUrl.replace(/\/$/, '');

    const previewImage = params.previewImage;
    const screenshots = Array.isArray(params.screenshots) ? params.screenshots : [];
    const previewVideo = params.previewVideo;

    if (!previewImage?.buffer && screenshots.length === 0 && !previewVideo?.buffer) {
      throw new BadRequestException('No media files provided');
    }

    if (previewImage?.buffer) {
      const imgKey = `${t._id.toString()}/preview_${Date.now()}_${String(previewImage.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: imgKey, buffer: previewImage.buffer });
      t.previewImageUrl = `${base}/api/templates/files/${encodeURIComponent(imgKey)}`;
    }

    if (screenshots.length) {
      const shotUrls: string[] = [];
      for (const s of screenshots) {
        if (!s?.buffer) continue;
        const shotKey = `${t._id.toString()}/shot_${Date.now()}_${Math.random().toString(16).slice(2)}_${String(s.originalname || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await this.storage.putBuffer({ key: shotKey, buffer: s.buffer });
        shotUrls.push(`${base}/api/templates/files/${encodeURIComponent(shotKey)}`);
      }
      t.screenshotUrls = shotUrls;
    }

    if (previewVideo?.buffer) {
      const vidKey = `${t._id.toString()}/video_${Date.now()}_${String(previewVideo.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await this.storage.putBuffer({ key: vidKey, buffer: previewVideo.buffer });
      t.previewVideoUrl = `${base}/api/templates/files/${encodeURIComponent(vidKey)}`;
    }

    await t.save();
    const updated = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: updated };
  }

  async listPublic(query: any) {
    const filter: any = { isPublic: true };
    if (query.category) filter.category = String(query.category);
    if (query.q) {
      const q = String(query.q);
      const rx = { $regex: q, $options: 'i' };
      filter.$or = [
        { name: rx },
        { description: rx },
        { category: rx },
        { tags: rx },
      ];
    }

    const items = await this.templateModel.find(filter).sort({ createdAt: -1 }).lean();
    return { success: true, data: items };
  }

  async getPublicById(id: string) {
    const t = await this.templateModel.findById(id).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();
    return { success: true, data: t };
  }

  async getAccess(params: { templateId: string; userId: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    if (!price || price <= 0) {
      return { success: true, data: { hasAccess: true } };
    }

    const exists = await this.purchaseModel
      .findOne({ templateId: params.templateId, userId: params.userId })
      .select({ _id: 1 })
      .lean();

    return { success: true, data: { hasAccess: Boolean(exists) } };
  }

  async createPurchasePaymentSheet(params: { templateId: string; userId: string; customerEmail?: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    const amount = this._toStripeAmount(price);
    if (!amount) throw new BadRequestException('Template is free');

    const currency = (this.configService.get<string>('stripe.currency') || 'usd').toLowerCase();

    const stripe = this._getStripe();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      receipt_email: params.customerEmail,
      metadata: {
        kind: 'template_purchase',
        templateId: String(params.templateId),
        userId: String(params.userId),
      },
    });

    if (!intent.client_secret) {
      throw new BadRequestException('Stripe did not return a client secret');
    }

    return {
      success: true,
      data: {
        paymentIntentId: intent.id,
        paymentIntentClientSecret: intent.client_secret,
        currency,
        amount,
      },
    };
  }

  async confirmPurchase(params: { templateId: string; userId: string; paymentIntentId: string }) {
    const t = await this.templateModel.findById(params.templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    const expectedAmount = this._toStripeAmount(price);
    if (!expectedAmount) throw new BadRequestException('Template is free');

    const stripe = this._getStripe();
    const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId);
    if (!intent) throw new NotFoundException('PaymentIntent not found');

    const md: any = (intent as any).metadata || {};
    if (String(md.kind || '') !== 'template_purchase') {
      throw new BadRequestException('Invalid payment intent');
    }
    if (String(md.templateId || '') !== String(params.templateId)) {
      throw new BadRequestException('Payment intent does not match template');
    }
    if (String(md.userId || '') !== String(params.userId)) {
      throw new BadRequestException('Payment intent does not match user');
    }

    if (intent.status !== 'succeeded') {
      throw new BadRequestException(`Payment not completed (status=${intent.status})`);
    }

    const amountReceived = (intent as any).amount_received ?? intent.amount;
    if (amountReceived !== expectedAmount) {
      throw new BadRequestException('Payment amount mismatch');
    }

    await this.purchaseModel.findOneAndUpdate(
      { templateId: params.templateId, userId: params.userId },
      {
        $set: {
          templateId: params.templateId,
          userId: params.userId,
          stripePaymentIntentId: intent.id,
          amount: expectedAmount,
          currency: String(intent.currency || 'usd'),
        },
      },
      { upsert: true, new: true },
    );

    const updatedTemplate = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: { hasAccess: true, template: updatedTemplate } };
  }

  async listPublicReviews(templateId: string) {
    const t = await this.templateModel.findById(templateId).lean();
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const items = await this.reviewModel
      .find({ templateId })
      .sort({ createdAt: -1 })
      .select({ templateId: 1, userId: 1, username: 1, rating: 1, comment: 1, createdAt: 1 })
      .lean();

    return { success: true, data: items };
  }

  async upsertReview(params: {
    templateId: string;
    userId: string;
    username: string;
    rating: number;
    comment: string;
  }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const rating = Math.max(1, Math.min(5, Math.round(params.rating)));
    const comment = String(params.comment || '').trim();
    if (!comment) throw new BadRequestException('comment is required');
    if (comment.length > 400) throw new BadRequestException('comment too long');

    await this.reviewModel.updateOne(
      { templateId: params.templateId, userId: params.userId },
      {
        $set: {
          templateId: params.templateId,
          userId: params.userId,
          username: params.username,
          rating,
          comment,
        },
      },
      { upsert: true },
    );

    const stats = await this.reviewModel.aggregate([
      { $match: { templateId: params.templateId } },
      { $group: { _id: '$templateId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const avg = stats?.[0]?.avg;
    if (typeof avg === 'number' && Number.isFinite(avg)) {
      t.rating = Math.round(avg * 10) / 10;
      await t.save();
    }

    const updatedTemplate = await this.templateModel.findById(params.templateId).lean();
    return { success: true, data: { template: updatedTemplate } };
  }

  async getDownloadUrl(id: string, baseUrl: string) {
    const t = await this.templateModel.findById(id);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    t.downloads = (t.downloads || 0) + 1;
    await t.save();

    const url = `${baseUrl.replace(/\/$/, '')}/api/templates/files/${encodeURIComponent(t.storageKey)}`;
    return { success: true, data: { url } };
  }

  async getDownloadUrlAuthed(params: { templateId: string; baseUrl: string; userId: string }) {
    const t = await this.templateModel.findById(params.templateId);
    if (!t) throw new NotFoundException('Template not found');
    if (!t.isPublic) throw new ForbiddenException();

    const price = typeof (t as any).price === 'number' ? (t as any).price : 0;
    if (price > 0) {
      const has = await this.purchaseModel
        .findOne({ templateId: params.templateId, userId: params.userId })
        .select({ _id: 1 })
        .lean();
      if (!has) {
        throw new ForbiddenException('Purchase required');
      }
    }

    t.downloads = (t.downloads || 0) + 1;
    await t.save();

    const url = `${params.baseUrl.replace(/\/$/, '')}/api/templates/files/${encodeURIComponent(t.storageKey)}`;
    return { success: true, data: { url } };
  }
}
