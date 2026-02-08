import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @ApiProperty({ example: 'johndoe', description: 'Username' })
  @Prop({ required: true, unique: true })
  username: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name', required: false })
  @Prop({ default: '' })
  fullName?: string;

  @ApiProperty({ example: 'Indie dev. Building with GameForge AI.', description: 'Bio', required: false })
  @Prop({ default: '' })
  bio?: string;

  @ApiProperty({ example: 'Paris, FR', description: 'Location', required: false })
  @Prop({ default: '' })
  location?: string;

  @ApiProperty({ example: 'https://example.com', description: 'Website', required: false })
  @Prop({ default: '' })
  website?: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @Prop({ required: true, unique: true })
  email: string;

  @ApiProperty({ example: 'google-oauth-id', description: 'Google OAuth ID', required: false })
  @Prop({ default: null })
  googleId?: string;

  @ApiProperty({ example: 'hashedPassword', description: 'Hashed password', required: false })
  @Prop({ required: false })
  password?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', description: 'Avatar URL' })
  @Prop({ default: '' })
  avatar: string;

  @ApiProperty({ enum: ['free', 'pro', 'enterprise'], example: 'free', description: 'Subscription plan' })
  @Prop({ enum: ['free', 'pro', 'enterprise'], default: 'free' })
  subscription: string;

  @ApiProperty({ enum: ['user', 'dev', 'devl', 'admin'], example: 'user', description: 'User role' })
  @Prop({ enum: ['user', 'dev', 'devl', 'admin'], default: 'user' })
  role: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Subscription expiration date' })
  @Prop({ default: null })
  subscriptionExpires: Date;

  @ApiProperty({ example: ['project1', 'project2'], description: 'User projects' })
  @Prop({ default: [] })
  projects: string[];

  @ApiProperty({ example: true, description: 'Account active status' })
  @Prop({ default: true })
  isActive: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Last login date' })
  @Prop({ default: Date.now })
  lastLogin: Date;

  @ApiProperty({ example: false, description: 'Email verification status' })
  @Prop({ default: false })
  isEmailVerified: boolean;

  @ApiProperty({ example: 'abc123token', description: 'Email verification token' })
  @Prop()
  emailVerificationToken: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Email verification expires at' })
  @Prop()
  emailVerificationExpires: Date;

  @ApiProperty({ example: 'def456token', description: 'Password reset token' })
  @Prop()
  passwordResetToken: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'Password reset expires at' })
  @Prop()
  passwordResetExpires: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
