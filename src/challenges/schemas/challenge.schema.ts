import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChallengeDocument = Challenge & Document;

export type ChallengeStatus = 'pending' | 'completed' | 'expired';
export type GameType = 'webgl' | 'quiz' | 'phaser' | 'scratch' | 'claude' | 'threejs' | 'other';

@Schema({ timestamps: true })
export class Challenge {

  @Prop({ type: String, required: true, index: true })
  challengerId: string;

  @Prop({ type: String, required: true })
  challengerName: string;

  @Prop({ type: String, required: true, index: true })
  gameId: string;

  @Prop({
    type: String,
    required: true,
    enum: ['webgl', 'quiz', 'phaser', 'scratch', 'claude', 'threejs', 'other'],
  })
  gameType: GameType;

  @Prop({ type: String, required: true })
  gameTitle: string;

  @Prop({ type: String, default: '' })
  gameUrl: string;

  @Prop({ type: Number, required: true })
  challengerScore: number;

  @Prop({ type: Number, default: null })
  friendScore: number | null;

  @Prop({ type: String, default: '' })
  friendName: string;

  @Prop({
    type: String,
    default: 'pending',
    enum: ['pending', 'completed', 'expired'],
  })
  status: ChallengeStatus;

  @Prop({ type: String, default: null })
  winnerId: string | null;

  // 'challenger' | 'friend' | 'tie'
  @Prop({ type: String, default: null })
  winnerLabel: string | null;

  @Prop({ type: String, required: true, unique: true })
  shareCode: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const ChallengeSchema = SchemaFactory.createForClass(Challenge);

// TTL index
ChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// Useful query index
ChallengeSchema.index({ challengerId: 1, createdAt: -1 });