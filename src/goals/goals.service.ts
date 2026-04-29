import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Goal, GoalDocument, GoalType } from './schemas/goal.schema';
import { CreateGoalDto } from './dto/create-goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    @InjectModel(Goal.name)
    private readonly goalModel: Model<GoalDocument>,
  ) {}

  // ─── Serializer ───────────────────────────────────────────────────────────────

  private serialize(doc: any) {
    const obj =
      doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return {
      _id: obj?._id?.toString() ?? '',
      userId: obj.userId,
      title: obj.title,
      type: obj.type,
      target: obj.target,
      progress: obj.progress,
      status: obj.status,
      rewardPoints: obj.rewardPoints ?? null,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }

  // ─── Create Goal ──────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateGoalDto) {
    const doc = await this.goalModel.create({
      userId,
      title: dto.title.trim(),
      type: dto.type,
      target: dto.target,
      progress: 0,
      status: 'in-progress',
      rewardPoints: dto.rewardPoints ?? null,
    });

    return {
      success: true,
      message: 'Goal created successfully',
      data: { goal: this.serialize(doc) },
    };
  }

  // ─── Get My Goals ─────────────────────────────────────────────────────────────

  async getMyGoals(userId: string) {
    const docs = await this.goalModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return {
      success: true,
      data: { goals: docs.map((d) => this.serialize(d)) },
    };
  }

  // ─── Increment Goal Progress (internal — called by other services) ────────────

  async incrementProgress(
    userId: string,
    type: GoalType,
    amount = 1,
  ): Promise<void> {
    // Find all active goals of this type for the user
    const goals = await this.goalModel.find({
      userId,
      type,
      status: 'in-progress',
    });

    for (const goal of goals) {
      const newProgress = Math.min(goal.progress + amount, goal.target);
      const isCompleted = newProgress >= goal.target;

      await this.goalModel.findByIdAndUpdate(goal._id, {
        $set: {
          progress: newProgress,
          status: isCompleted ? 'completed' : 'in-progress',
        },
      });
    }
  }
}
