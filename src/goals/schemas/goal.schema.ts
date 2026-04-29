import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GoalDocument = Goal & Document;
export type GoalStatus = 'in-progress' | 'completed';
export type GoalType = 'projects' | 'challenges' | 'earnings' | 'games';

@Schema({ timestamps: true })
export class Goal {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({
    type: String,
    required: true,
    enum: ['projects', 'challenges', 'earnings', 'games'],
  })
  type: GoalType;

  @Prop({ type: Number, required: true, min: 1 })
  target: number;

  @Prop({ type: Number, default: 0, min: 0 })
  progress: number;

  @Prop({
    type: String,
    default: 'in-progress',
    enum: ['in-progress', 'completed'],
  })
  status: GoalStatus;

  @Prop({ type: Number, default: null })
  rewardPoints: number | null;
}

export const GoalSchema = SchemaFactory.createForClass(Goal);

// Useful query index
GoalSchema.index({ userId: 1, createdAt: -1 });
