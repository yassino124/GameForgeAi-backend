import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AiGameOrchestratorService } from './ai-game-orchestrator.service';
import { GenerateFullGameDto } from './dto/generate-full-game.dto';

@ApiTags('AI')
@Controller('ai')
export class AiGameOrchestratorController {
  constructor(private readonly svc: AiGameOrchestratorService) {}

  @Post('generate-full-game')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a full game from a prompt (auto template + assets + config + enqueue build)' })
  async generateFullGame(@Req() req: any, @Body() dto: GenerateFullGameDto) {
    return this.svc.generateFullGame({ ownerId: req.user.sub, prompt: dto.prompt });
  }
}
