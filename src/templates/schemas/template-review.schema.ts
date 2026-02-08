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

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ required: true, maxlength: 400 })
  comment: string;
}

export const TemplateReviewSchema = SchemaFactory.createForClass(TemplateReview);

TemplateReviewSchema.index({ templateId: 1, userId: 1 }, { unique: true });
