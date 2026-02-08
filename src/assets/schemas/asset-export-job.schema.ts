import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AssetExportJobDocument = AssetExportJob & Document;

export type ExportFormat = 'zip' | 'unitypackage';
export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed';

@Schema({ timestamps: true })
export class AssetExportJob {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, index: true })
  collectionId: string;

  @Prop({ required: true, default: 'zip' })
  format: ExportFormat;

  @Prop({ required: true, default: 'queued' })
  status: ExportStatus;

  @Prop()
  resultStorageKey?: string;

  @Prop()
  error?: string;
}

export const AssetExportJobSchema = SchemaFactory.createForClass(AssetExportJob);
