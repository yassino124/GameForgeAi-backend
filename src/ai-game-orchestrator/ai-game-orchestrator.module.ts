import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ProjectsModule } from '../projects/projects.module';
import { TemplatesModule } from '../templates/templates.module';
import { AssetsModule } from '../assets/assets.module';
import { AiModule } from '../ai/ai.module';
import { CommonModule } from '../common/common.module';

import { UnityTemplate, UnityTemplateSchema } from '../templates/schemas/unity-template.schema';
import { Asset, AssetSchema } from '../assets/schemas/asset.schema';

import { AiGameOrchestratorController } from './ai-game-orchestrator.controller';
import { AiGameOrchestratorService } from './ai-game-orchestrator.service';

@Module({
  imports: [
    CommonModule,
    ProjectsModule,
    TemplatesModule,
    AssetsModule,
    AiModule,
    MongooseModule.forFeature([
      { name: UnityTemplate.name, schema: UnityTemplateSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
  ],
  controllers: [AiGameOrchestratorController],
  providers: [AiGameOrchestratorService],
})
export class AiGameOrchestratorModule {}
