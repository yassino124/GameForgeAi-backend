import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateProjectFromTemplateDto } from './dto/create-project-from-template.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import { ProjectStorageService } from './project-storage.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly storage: ProjectStorageService,
  ) {}

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

  @Get(':id/download-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async downloadUrl(@Req() req: any, @Param('id') id: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.projectsService.getDownloadUrl(req.user.sub, id, baseUrl);
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

  @Get('files/*key')
  @ApiOperation({ summary: 'Serve built project zips from local disk (internal use)' })
  async serveFile(@Param('key') key: string, @Res() res: Response) {
    const abs = this.storage.resolveKey(key);
    return res.sendFile(abs);
  }
}
