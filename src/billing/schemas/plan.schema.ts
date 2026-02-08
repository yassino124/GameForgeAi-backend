import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlanDocument = Plan & Document;

@Schema({ timestamps: true })
export class Plan {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ required: true, unique: true })
  stripePriceId: string;

  @Prop({ required: true })
  priceMonthly: number;

  @Prop({ default: false })
  isPopular: boolean;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
