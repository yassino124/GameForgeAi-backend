import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UnityTemplateDocument = UnityTemplate & Document;

@Schema({ timestamps: true })
export class UnityTemplate {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, index: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: 'General', index: true })
  category: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: true, index: true })
  isPublic: boolean;

  @Prop({ default: 0 })
  price: number;

  @Prop({ default: 4.7 })
  rating: number;

  @Prop({ default: 0 })
  downloads: number;

  @Prop({ required: true })
  storageKey: string;

  @Prop()
  previewImageUrl?: string;

  @Prop({ type: [String], default: [] })
  screenshotUrls: string[];

  @Prop()
  previewVideoUrl?: string;
}

export const UnityTemplateSchema = SchemaFactory.createForClass(UnityTemplate);
