import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GameProjectDocument = GameProject & Document;

export type ProjectStatus = 'queued' | 'running' | 'ready' | 'failed';

@Schema({ timestamps: true })
export class GameProject {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, index: true })
  templateId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: 'queued' })
  status: ProjectStatus;

  @Prop()
  assetsCollectionId?: string;

  @Prop()
  resultStorageKey?: string;

  @Prop()
  error?: string;

  @Prop()
  previewImageUrl?: string;

  @Prop({ type: [String], default: [] })
  screenshotUrls: string[];

  @Prop()
  previewVideoUrl?: string;
}

export const GameProjectSchema = SchemaFactory.createForClass(GameProject);
