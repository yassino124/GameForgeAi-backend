import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AssetsService } from './assets.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CreateExportDto } from './dto/create-export.dto';
import { UploadAssetUrlDto } from './dto/upload-asset-url.dto';
import { LocalStorageService } from './local-storage.service';

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly storage: LocalStorageService,
  ) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an asset to local disk and register it' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(@Req() req: any, @UploadedFile() file: any, @Body() body: any) {
    const type = (body.type || 'other').toString();
    const tags = body.tags
      ? String(body.tags)
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [];

    return this.assetsService.uploadAsset({
      ownerId: req.user.sub,
      file,
      type,
      name: body.name,
      tags,
      collectionId: body.collectionId,
      unityPath: body.unityPath,
    } as any);
  }

  @Post('upload-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload an asset by providing a remote URL' })
  async uploadUrl(@Req() req: any, @Body() dto: UploadAssetUrlDto) {
    const tags = dto.tags
      ? String(dto.tags)
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [];

    return this.assetsService.uploadAssetFromUrl({
      ownerId: req.user.sub,
      url: dto.url,
      type: dto.type as any,
      name: dto.name,
      tags,
      collectionId: dto.collectionId,
      unityPath: dto.unityPath,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List assets' })
  async list(@Req() req: any, @Query() query: any) {
    return this.assetsService.listAssets(req.user.sub, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get asset details' })
  async get(@Req() req: any, @Param('id') id: string) {
    return this.assetsService.getAsset(req.user.sub, id);
  }

  @Get(':id/download-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get download url (local)' })
  async downloadUrl(@Req() req: any, @Param('id') id: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.assetsService.getAssetDownloadUrl(req.user.sub, id, baseUrl);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete asset' })
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.assetsService.deleteAsset(req.user.sub, id);
  }

  @Get('files/*key')
  @ApiOperation({ summary: 'Serve stored files from local disk (internal use)' })
  async serveFile(@Param('key') key: string, @Res() res: Response) {
    const abs = this.storage.resolveKey(key);
    return res.sendFile(abs);
  }

  // Collections
  @Post('collections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async createCollection(@Req() req: any, @Body() dto: CreateCollectionDto) {
    return this.assetsService.createCollection(req.user.sub, dto);
  }

  @Get('collections/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async listCollections(@Req() req: any) {
    return this.assetsService.listCollections(req.user.sub);
  }

  @Patch('collections/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async updateCollection(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.assetsService.updateCollection(req.user.sub, id, dto);
  }

  @Delete('collections/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async deleteCollection(@Req() req: any, @Param('id') id: string) {
    return this.assetsService.deleteCollection(req.user.sub, id);
  }

  // Exports
  @Post('exports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async createExport(@Req() req: any, @Body() dto: CreateExportDto) {
    return this.assetsService.createExport(req.user.sub, dto);
  }

  @Get('exports/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async getExport(@Req() req: any, @Param('id') id: string) {
    return this.assetsService.getExport(req.user.sub, id);
  }

  @Get('exports/:id/download-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl', 'user')
  @ApiBearerAuth()
  async getExportDownloadUrl(@Req() req: any, @Param('id') id: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.assetsService.getExportDownloadUrl(req.user.sub, id, baseUrl);
  }
}
