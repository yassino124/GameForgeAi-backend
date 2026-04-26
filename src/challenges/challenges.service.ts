import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import { Challenge, ChallengeDocument } from './schemas/challenge.schema';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitScoreDto } from './dto/submit-score.dto';

@Injectable()
export class ChallengesService {
  constructor(
    @InjectModel(Challenge.name)
    private readonly challengeModel: Model<ChallengeDocument>,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private generateShareCode(): string {
    return randomBytes(5).toString('hex').toUpperCase(); // e.g. "A3F9B2C1D4"
  }

  private async generateUniqueShareCode(maxAttempts = 8): Promise<string> {
    for (let i = 0; i < maxAttempts; i += 1) {
      const code = this.generateShareCode();
      const exists = await this.challengeModel.exists({ shareCode: code });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not generate a unique challenge code');
  }

  private buildShareUrl(shareCode: string, baseUrl: string): string {
    const trimmedBase = baseUrl.trim();
    let normalizedBase = trimmedBase.replace(/\/+$/, '');

    try {
      normalizedBase = new URL(trimmedBase).origin;
    } catch (_) {}

    return `${normalizedBase}/#/challenge/${shareCode}`;
  }

  private serializeChallenge(doc: any) {
    const obj = (doc && typeof doc.toObject === 'function')
      ? doc.toObject()
      : doc;
    const rawId = obj?._id ?? obj?.id ?? '';
    return {
      id: rawId?.toString?.() ?? '',
      challengerId: obj.challengerId,
      challengerName: obj.challengerName,
      gameId: obj.gameId,
      gameType: obj.gameType,
      gameTitle: obj.gameTitle,
      gameUrl: obj.gameUrl,
      challengerScore: obj.challengerScore,
      friendScore: obj.friendScore,
      friendName: obj.friendName,
      status: obj.status,
      winnerId: obj.winnerId,
      winnerLabel: obj.winnerLabel,
      shareCode: obj.shareCode,
      expiresAt: obj.expiresAt,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }

  // ─── Create Challenge ────────────────────────────────────────────────────────

  async create(
    challengerId: string,
    dto: CreateChallengeDto,
    baseUrl: string,
  ) {
    const shareCode = await this.generateUniqueShareCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const doc = await this.challengeModel.create({
      challengerId,
      challengerName: dto.challengerName,
      gameId: dto.gameId,
      gameType: dto.gameType,
      gameTitle: dto.gameTitle,
      gameUrl: dto.gameUrl ?? '',
      challengerScore: dto.challengerScore,
      friendScore: null,
      friendName: '',
      status: 'pending',
      winnerId: null,
      winnerLabel: null,
      shareCode,
      expiresAt,
    });

    return {
      success: true,
      message: 'Challenge created successfully',
      data: {
        challenge: this.serializeChallenge(doc),
        shareUrl: this.buildShareUrl(shareCode, baseUrl),
        shareCode,
      },
    };
  }

  // ─── Get Challenge by ID or share code ───────────────────────────────────────

  async findByIdOrCode(idOrCode: string) {
    let doc: ChallengeDocument | null = null;

    // Try MongoDB ObjectId first
    if (/^[a-f\d]{24}$/i.test(idOrCode)) {
      doc = await this.challengeModel.findById(idOrCode).lean();
    }

    // Fallback to shareCode
    if (!doc) {
      doc = await this.challengeModel
        .findOne({ shareCode: idOrCode.toUpperCase() })
        .lean();
    }

    if (!doc) {
      throw new NotFoundException('Challenge not found');
    }

    // Mark as expired if past expiry
    if (doc.status === 'pending' && new Date() > doc.expiresAt) {
      await this.challengeModel.findByIdAndUpdate(doc._id, { status: 'expired' });
      (doc as any).status = 'expired';
    }

    return {
      success: true,
      data: { challenge: this.serializeChallenge(doc as any) },
    };
  }

  // ─── Submit Friend Score ─────────────────────────────────────────────────────

  async submitScore(idOrCode: string, dto: SubmitScoreDto) {
    let doc: ChallengeDocument | null = null;

    if (/^[a-f\d]{24}$/i.test(idOrCode)) {
      doc = await this.challengeModel.findById(idOrCode);
    }
    if (!doc) {
      doc = await this.challengeModel.findOne({
        shareCode: idOrCode.toUpperCase(),
      });
    }

    if (!doc) {
      throw new NotFoundException('Challenge not found');
    }

    if (doc.status === 'completed') {
      throw new BadRequestException('Challenge is already completed');
    }

    if (doc.status === 'expired' || new Date() > doc.expiresAt) {
      await doc.updateOne({ status: 'expired' });
      throw new BadRequestException('Challenge has expired');
    }

    // Determine winner
    let winnerId: string | null = null;
    let winnerLabel: string;

    if (dto.friendScore > doc.challengerScore) {
      winnerId = 'friend';
      winnerLabel = 'friend';
    } else if (dto.friendScore < doc.challengerScore) {
      winnerId = doc.challengerId;
      winnerLabel = 'challenger';
    } else {
      winnerId = null;
      winnerLabel = 'tie';
    }

    const updated = await this.challengeModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          friendScore: dto.friendScore,
          friendName: dto.friendName ?? 'Friend',
          status: 'completed',
          winnerId,
          winnerLabel,
        },
      },
      { new: true },
    );

    return {
      success: true,
      message: 'Score submitted successfully',
      data: {
        challenge: this.serializeChallenge(updated!),
        winnerLabel,
      },
    };
  }

  // ─── Get my challenges ────────────────────────────────────────────────────────

  async getMyChallenges(challengerId: string) {
    const docs = await this.challengeModel
      .find({ challengerId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return {
      success: true,
      data: {
        challenges: docs.map((d) => this.serializeChallenge(d as any)),
      },
    };
  }
}
