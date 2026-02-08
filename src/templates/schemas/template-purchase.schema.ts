import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TemplatePurchaseDocument = TemplatePurchase & Document;

@Schema({ timestamps: true })
export class TemplatePurchase {
  @Prop({ required: true, index: true })
  templateId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  stripePaymentIntentId: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: 'usd' })
  currency: string;
}

export const TemplatePurchaseSchema = SchemaFactory.createForClass(TemplatePurchase);

TemplatePurchaseSchema.index({ templateId: 1, userId: 1 }, { unique: true });
TemplatePurchaseSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
