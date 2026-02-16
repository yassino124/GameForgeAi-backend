import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
 import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GenerateAiDto } from '../ai/dto/generate-ai.dto';
import { CreateProjectFromTemplateDto } from './dto/create-project-from-template.dto';
import { CreateProjectAiDto } from './dto/create-project-ai.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import { ProjectStorageService } from './project-storage.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly storage: ProjectStorageService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private extractBearerToken(req: any): string | undefined {
    const [type, token] = req?.headers?.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List your game projects' })
  async list(@Req() req: any) {
    return this.projectsService.list(req.user.sub);
  }

  @Post('from-template')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a game project from a public Unity template' })
  async fromTemplate(@Req() req: any, @Body() dto: CreateProjectFromTemplateDto) {
    return this.projectsService.createFromTemplate(req.user.sub, dto);
  }

  @Post('ai/create')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a game project from an AI prompt (auto-select template, enqueue build)' })
  async aiCreate(@Req() req: any, @Body() dto: CreateProjectAiDto) {
    const rc = (dto as any)?.runtimeConfig;
    const runtimeConfig = rc && typeof rc === 'object' && !Array.isArray(rc) ? rc : undefined;
    return this.projectsService.createFromAi({
      ownerId: req.user.sub,
      prompt: dto.prompt,
      templateId: dto.templateId,
      buildTarget: dto.buildTarget,
      initialConfig: {
        ...(runtimeConfig || {}),
        timeScale: dto.timeScale,
        difficulty: dto.difficulty,
        theme: dto.theme,
        notes: dto.notes,
        speed: dto.speed,
        genre: dto.genre,
        assetsType: dto.assetsType,
        mechanics: dto.mechanics,
        primaryColor: dto.primaryColor,
        secondaryColor: dto.secondaryColor,
        accentColor: dto.accentColor,
        playerColor: dto.playerColor,
        fogEnabled: dto.fogEnabled,
        fogDensity: dto.fogDensity,
        cameraZoom: dto.cameraZoom,
        gravityY: dto.gravityY,
        jumpForce: dto.jumpForce,
      },
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async get(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.get(req.user.sub, id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a project (owner only)' })
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(req.user.sub, id, dto);
  }

  @Post(':id/rebuild')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rebuild an existing project (owner only)' })
  async rebuild(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.rebuild(req.user.sub, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a running/queued build (owner only)' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.cancelBuild(req.user.sub, id);
  }

  @Get(':id/download-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async downloadUrl(@Req() req: any, @Param('id') id: string, @Query('target') target?: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.projectsService.getDownloadUrl(req.user.sub, id, baseUrl, target);
  }

  @Get(':id/preview-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get playable WebGL preview URL for a project (when ready)' })
  async previewUrl(@Req() req: any, @Param('id') id: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const token = this.extractBearerToken(req);
    return this.projectsService.getPreviewUrl(req.user.sub, id, baseUrl, token);
  }

  @Get(':id/runtime-config')
  @ApiOperation({ summary: 'Get runtime AI config for WebGL (token via query param)' })
  async runtimeConfig(@Req() req: any, @Param('id') id: string, @Query('token') token?: string) {
    const t = (token || '').trim();
    if (!t) throw new UnauthorizedException('Missing token');

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(t, {
        secret: this.configService.get<string>('jwt.secret') || 'default-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Ensure requester owns the project
    const ownerId = payload?.sub;
    if (!ownerId) throw new UnauthorizedException('Invalid token payload');

    return this.projectsService.getRuntimeConfig(ownerId, id);
  }

  @Post(':id/media')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload project media (owner only)' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'previewImage', maxCount: 1 },
        { name: 'screenshots', maxCount: 8 },
        { name: 'previewVideo', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 500 * 1024 * 1024 },
      },
    ),
  )
  async uploadMedia(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFiles() files: any,
  ) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const previewImage = files?.previewImage?.[0];
    const screenshots = Array.isArray(files?.screenshots) ? files.screenshots : [];
    const previewVideo = files?.previewVideo?.[0];
    if (!previewImage && (!screenshots || screenshots.length === 0) && !previewVideo) {
      throw new BadRequestException('No media provided');
    }
    return this.projectsService.attachMedia(req.user.sub, id, { previewImage, screenshots, previewVideo, baseUrl });
  }

  @Post(':id/ai/generate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate project description/tags and media prompts using Gemini' })
  async generateAi(@Req() req: any, @Param('id') id: string, @Body() dto: GenerateAiDto) {
    return this.projectsService.generateAiMetadata({
      ownerId: req.user.sub,
      projectId: id,
      notes: dto.notes,
      overwrite: dto.overwrite,
    });
  }

  @Get('files/*path')
  @ApiOperation({ summary: 'Serve built project files from local disk (internal use)' })
  async serveFile(@Param('path') pathParam: string | string[], @Res() res: Response) {
    const key = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const abs = this.storage.resolveKey(key);

    const headers: Record<string, string> = {};
    const lowerKey = key.toLowerCase();

    const setContentTypeFromExt = (ext: string) => {
      switch (ext) {
        case '.js':
          headers['Content-Type'] = 'application/javascript; charset=utf-8';
          break;
        case '.apk':
          headers['Content-Type'] = 'application/vnd.android.package-archive';
          break;
        case '.wasm':
          headers['Content-Type'] = 'application/wasm';
          break;
        case '.data':
          headers['Content-Type'] = 'application/octet-stream';
          break;
        case '.json':
          headers['Content-Type'] = 'application/json; charset=utf-8';
          break;
        case '.css':
          headers['Content-Type'] = 'text/css; charset=utf-8';
          break;
        case '.html':
          headers['Content-Type'] = 'text/html; charset=utf-8';
          break;
        case '.png':
          headers['Content-Type'] = 'image/png';
          break;
        case '.jpg':
        case '.jpeg':
          headers['Content-Type'] = 'image/jpeg';
          break;
        case '.svg':
          headers['Content-Type'] = 'image/svg+xml; charset=utf-8';
          break;
        default:
          break;
      }
    };

    if (lowerKey.endsWith('.gz')) {
      headers['Content-Encoding'] = 'gzip';
      setContentTypeFromExt(path.extname(lowerKey.slice(0, -3)));
    } else if (lowerKey.endsWith('.br')) {
      headers['Content-Encoding'] = 'br';
      setContentTypeFromExt(path.extname(lowerKey.slice(0, -3)));
    } else if (lowerKey.endsWith('.unityweb')) {
      // Unity may output .unityweb compressed assets; most hosts must serve these with gzip encoding.
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Type'] = 'application/octet-stream';
    } else {
      setContentTypeFromExt(path.extname(lowerKey));
    }

    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
    return res.sendFile(abs);
  }
}
