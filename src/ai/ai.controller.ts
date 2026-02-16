import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AiService } from './ai.service';
import { GenerateDraftDto } from './dto/generate-draft.dto';
import { GenerateImageDto } from './dto/generate-image.dto';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('trends')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List AI game dev news/trends (RSS aggregated, cached ~30s)' })
  async listAiGameTrends() {
    return this.aiService.listAiGameTrends({ limit: 12 });
  }

  @Get('models')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List available Gemini models for the configured API key (diagnostic)' })
  async listModels() {
    return this.aiService.listModels();
  }

  @Post('draft/template')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate template draft fields (name/description/category/tags/type/mediaPrompts) from description' })
  async generateTemplateDraft(@Body() dto: GenerateDraftDto) {
    return this.aiService.generateTemplateDraft({ description: dto.description, notes: dto.notes });
  }

  @Post('draft/project')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate project draft fields (name/description/tags/type/mediaPrompts) from description' })
  async generateProjectDraft(@Body() dto: GenerateDraftDto) {
    return this.aiService.generateProjectDraft({ description: dto.description, notes: dto.notes });
  }

  @Post('image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate an image from a prompt using Gemini (base64)' })
  async generateImage(@Body() dto: GenerateImageDto) {
    return this.aiService.generateImageBase64({ prompt: dto.prompt });
  }
}
