import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TemplateReviewDocument = TemplateReview & Document;

@Schema({ timestamps: true })
export class TemplateReview {
  @Prop({ required: true, index: true })
  templateId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true, enum: ['pending', 'approved'], default: 'approved', index: true })
  status: 'pending' | 'approved';

  @Prop({ type: Date, default: null })
  approvedAt?: Date;

  @Prop({ type: String, default: null })
  approvedBy?: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ required: true, maxlength: 400 })
  comment: string;
}

export const TemplateReviewSchema = SchemaFactory.createForClass(TemplateReview);

TemplateReviewSchema.index({ templateId: 1, userId: 1 }, { unique: true });

TemplateReviewSchema.index({ templateId: 1, status: 1, createdAt: -1 });
