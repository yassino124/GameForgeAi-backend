import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [ConfigModule, CommonModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
