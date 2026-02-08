import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AssetCollectionDocument = AssetCollection & Document;

@Schema({ timestamps: true })
export class AssetCollection {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  coverAssetId?: string;
}

export const AssetCollectionSchema = SchemaFactory.createForClass(AssetCollection);
