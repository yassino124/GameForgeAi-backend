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

  @Prop({ default: 'webgl' })
  buildTarget: string;

  @Prop()
  assetsCollectionId?: string;

  @Prop()
  resultStorageKey?: string;

  @Prop()
  webglZipStorageKey?: string;

  @Prop()
  androidApkStorageKey?: string;

  @Prop()
  webglIndexStorageKey?: string;

  @Prop()
  error?: string;

  @Prop()
  buildLogLastLine?: string;

  @Prop()
  previewImageUrl?: string;

  @Prop({ type: [String], default: [] })
  screenshotUrls: string[];

  @Prop()
  previewVideoUrl?: string;

  @Prop({ type: Object })
  aiMetadata?: {
    description?: string;
    type?: string;
    tags?: string[];
    mediaPrompts?: {
      cover?: string;
      screenshots?: string[];
      video?: string;
    };
  };

  @Prop({ type: Object })
  aiUnityConfig?: {
    timeScale?: number;
    difficulty?: number;
    theme?: string;
    notes?: string;

    speed?: number;
    genre?: string;
    assetsType?: string;
    mechanics?: string[];
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    playerColor?: string;

    fogEnabled?: boolean;
    fogDensity?: number;
    cameraZoom?: number;
    gravityY?: number;
    jumpForce?: number;
  };

  @Prop()
  aiGeneratedAt?: Date;

  @Prop({ type: Object })
  buildTimings?: {
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    steps?: Record<string, number>;
  };
}

export const GameProjectSchema = SchemaFactory.createForClass(GameProject);
