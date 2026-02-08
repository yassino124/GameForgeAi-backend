import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true, index: true, unique: true })
  userId: string;

  @Prop({ default: null })
  stripeCustomerId: string;

  @Prop({ default: null })
  stripeSubscriptionId: string;

  @Prop({ default: 'inactive' })
  status: string;

  @Prop({ default: null })
  priceId: string;

  @Prop({ default: null })
  currentPeriodEnd: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
