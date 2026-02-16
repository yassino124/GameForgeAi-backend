import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { CoachGateway } from './coach.gateway';
import { CoachService } from './coach.service';

@Module({
  imports: [ConfigModule, CommonModule],
  providers: [CoachGateway, CoachService],
  exports: [CoachService],
})
export class CoachModule {}
