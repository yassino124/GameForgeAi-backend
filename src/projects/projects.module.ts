import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module';
import { TemplatesModule } from '../templates/templates.module';
import { AssetsModule } from '../assets/assets.module';
import { GameProject, GameProjectSchema } from './schemas/game-project.schema';
import { UnityTemplate, UnityTemplateSchema } from '../templates/schemas/unity-template.schema';
import { Asset, AssetSchema } from '../assets/schemas/asset.schema';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectStorageService } from './project-storage.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GameProject.name, schema: GameProjectSchema },
      { name: UnityTemplate.name, schema: UnityTemplateSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    CommonModule,
    TemplatesModule,
    AssetsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectStorageService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
