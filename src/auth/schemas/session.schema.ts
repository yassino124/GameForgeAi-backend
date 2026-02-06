import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type SessionDocument = Session & Document;

@Schema()
export class Session {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'User ID' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @ApiProperty({ example: 'sess_1234567890abcdef', description: 'Session token' })
  @Prop({ required: true, unique: true })
  sessionToken: string;

  @ApiProperty({ example: 'refresh_1234567890abcdef', description: 'Refresh token' })
  @Prop({ required: true, unique: true })
  refreshToken: string;

  @ApiProperty({ example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', description: 'User agent' })
  @Prop({ required: true })
  userAgent: string;

  @ApiProperty({ example: '192.168.1.1', description: 'IP address' })
  @Prop({ required: true })
  ipAddress: string;

  @ApiProperty({ example: 'Chrome 120.0.0.0', description: 'Browser' })
  @Prop()
  browser: string;

  @ApiProperty({ example: 'Windows 10', description: 'Operating system' })
  @Prop()
  os: string;

  @ApiProperty({ example: 'New York, USA', description: 'Location' })
  @Prop()
  location: string;

  @ApiProperty({ example: true, description: 'Is active session' })
  @Prop({ default: true })
  isActive: boolean;

  @ApiProperty({ example: true, description: 'Is persistent session (remember me)' })
  @Prop({ default: false })
  isPersistent: boolean;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z', description: 'Last activity' })
  @Prop({ default: Date.now })
  lastActivity: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z', description: 'Expires at' })
  @Prop({ required: true })
  expiresAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z', description: 'Session creation date' })
  @Prop({ default: Date.now })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z', description: 'Last update date' })
  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

SessionSchema.virtual('isRecentlyActive').get(function() {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  return this.lastActivity > thirtyMinutesAgo;
});

SessionSchema.pre('save', function(next: any) {
  this.updatedAt = new Date();
  if (next && typeof next === 'function') {
    next();
  }
});