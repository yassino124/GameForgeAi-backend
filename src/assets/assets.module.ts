import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { AssetCollection, AssetCollectionSchema } from './schemas/asset-collection.schema';
import { AssetExportJob, AssetExportJobSchema } from './schemas/asset-export-job.schema';
import { LocalStorageService } from './local-storage.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: AssetCollection.name, schema: AssetCollectionSchema },
      { name: AssetExportJob.name, schema: AssetExportJobSchema },
    ]),
    CommonModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsService, LocalStorageService],
  exports: [AssetsService, LocalStorageService],
})
export class AssetsModule {}
