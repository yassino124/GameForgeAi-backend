import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module';
import { UnityTemplate, UnityTemplateSchema } from './schemas/unity-template.schema';
import { TemplateReview, TemplateReviewSchema } from './schemas/template-review.schema';
import { TemplatePurchase, TemplatePurchaseSchema } from './schemas/template-purchase.schema';
import { TemplateStorageService } from './template-storage.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UnityTemplate.name, schema: UnityTemplateSchema },
      { name: TemplateReview.name, schema: TemplateReviewSchema },
      { name: TemplatePurchase.name, schema: TemplatePurchaseSchema },
    ]),
    CommonModule,
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplateStorageService],
  exports: [TemplatesService, TemplateStorageService],
})
export class TemplatesModule {}
