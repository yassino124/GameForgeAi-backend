import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateTemplateReviewDto } from './dto/create-template-review.dto';
import { ConfirmTemplatePurchaseDto } from './dto/confirm-template-purchase.dto';
import { UploadTemplateDto } from './dto/upload-template.dto';
import { TemplatesService } from './templates.service';
import { TemplateStorageService } from './template-storage.service';

@ApiTags('Templates')
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly storage: TemplateStorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List public Unity templates' })
  async list(@Query() query: any) {
    return this.templatesService.listPublic(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get public template details' })
  async get(@Param('id') id: string) {
    return this.templatesService.getPublicById(id);
  }

  @Get(':id/access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if current user has access to this template (free or purchased)' })
  async access(@Req() req: any, @Param('id') id: string) {
    return this.templatesService.getAccess({ templateId: id, userId: req.user.sub });
  }

  @Post(':id/purchase/payment-sheet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe PaymentIntent client secret for purchasing a paid template (PaymentSheet)' })
  async purchasePaymentSheet(@Req() req: any, @Param('id') id: string) {
    return this.templatesService.createPurchasePaymentSheet({
      templateId: id,
      userId: req.user.sub,
      customerEmail: req.user.email,
    });
  }

  @Post(':id/media')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update template media (preview image, screenshots, preview video)' })
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
  async updateMedia(@Req() req: any, @Param('id') id: string, @UploadedFiles() files: any) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const previewImage = files?.previewImage?.[0];
    const screenshots = Array.isArray(files?.screenshots) ? files.screenshots : [];
    const previewVideo = files?.previewVideo?.[0];
    return this.templatesService.updateTemplateMedia({
      templateId: id,
      ownerId: req.user.sub,
      allowNonOwner: true,
      baseUrl,
      previewImage,
      screenshots,
      previewVideo,
    });
  }

  @Post(':id/purchase/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm template purchase after Stripe PaymentSheet succeeds' })
  async confirmPurchase(@Req() req: any, @Param('id') id: string, @Body() dto: ConfirmTemplatePurchaseDto) {
    return this.templatesService.confirmPurchase({
      templateId: id,
      userId: req.user.sub,
      paymentIntentId: dto.paymentIntentId,
    });
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'List public reviews for a template' })
  async listReviews(@Param('id') id: string) {
    return this.templatesService.listPublicReviews(id);
  }

  @Post(':id/reviews')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update your review for a template' })
  async submitReview(@Req() req: any, @Param('id') id: string, @Body() dto: CreateTemplateReviewDto) {
    return this.templatesService.upsertReview({
      templateId: id,
      userId: req.user.sub,
      username: req.user.username,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  @Get(':id/download-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get download url for template zip (local disk)' })
  async downloadUrl(@Req() req: any, @Param('id') id: string) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.templatesService.getDownloadUrlAuthed({
      templateId: id,
      baseUrl,
      userId: req.user.sub,
    });
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'dev', 'devl')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a Unity template zip and publish it' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
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
  async upload(
    @Req() req: any,
    @UploadedFiles() files: any,
    @Body() dto: UploadTemplateDto,
  ) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const file = files?.file?.[0];
    const previewImage = files?.previewImage?.[0];
    const screenshots = Array.isArray(files?.screenshots) ? files.screenshots : [];
    const previewVideo = files?.previewVideo?.[0];
    return this.templatesService.uploadTemplate({
      ownerId: req.user.sub,
      file,
      previewImage,
      screenshots,
      previewVideo,
      baseUrl,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      tagsCsv: dto.tags,
      price: dto.price,
    });
  }

  @Get('files/*key')
  @ApiOperation({ summary: 'Serve template files from local disk (internal use)' })
  async serveFile(@Param('key') key: string, @Res() res: Response) {
    const abs = this.storage.resolveKey(key);
    return res.sendFile(abs);
  }
}
