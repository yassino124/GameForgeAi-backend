import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AssetDocument = Asset & Document;

export type AssetType = 'texture' | 'model' | 'audio' | 'shader' | 'other';
export type AssetStatus = 'ready' | 'processing' | 'failed';

@Schema({ timestamps: true })
export class Asset {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ index: true })
  collectionId?: string;

  @Prop({ required: true })
  type: AssetType;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  unityPath?: string;

  @Prop()
  mimeType?: string;

  @Prop()
  size?: number;

  @Prop({ required: true })
  storageKey: string;

  @Prop()
  publicUrl?: string;

  @Prop({ default: 'ready' })
  status: AssetStatus;
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
