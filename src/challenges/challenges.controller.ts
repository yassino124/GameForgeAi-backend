import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { SubmitScoreDto } from './dto/submit-score.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Challenges')
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  private resolveFrontendBaseUrl(req: any): string {
    const configuredBaseUrl = (process.env.FRONTEND_URL ?? '').trim();
    if (
      configuredBaseUrl.length > 0 &&
      !configuredBaseUrl.includes('localhost:3000') &&
      !configuredBaseUrl.includes('127.0.0.1:3000')
    ) {
      return configuredBaseUrl;
    }

    const originHeader = (req.get('origin') ?? '').trim();
    if (originHeader.length > 0) {
      return originHeader;
    }

    const refererHeader = (req.get('referer') ?? '').trim();
    if (refererHeader.length > 0) {
      try {
        const refererOrigin = new URL(refererHeader).origin;
        if (
          !refererOrigin.includes('localhost:3000') &&
          !refererOrigin.includes('127.0.0.1:3000')
        ) {
          return refererOrigin;
        }
      } catch (_) {}
    }

    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    if (
      requestOrigin.includes('localhost:3000') ||
      requestOrigin.includes('127.0.0.1:3000')
    ) {
      return 'http://localhost:8091';
    }

    return requestOrigin;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/challenges — Create a challenge (JWT required)
  // ─────────────────────────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new friend challenge after finishing a game' })
  @ApiResponse({ status: 201, description: 'Challenge created with shareable link' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Req() req: any, @Body() dto: CreateChallengeDto) {
    const frontendBaseUrl = this.resolveFrontendBaseUrl(req);
    return this.challengesService.create(req.user.sub, dto, frontendBaseUrl);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/challenges/my — Get my challenges (JWT required)
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all challenges created by the current user' })
  @ApiResponse({ status: 200, description: 'List of challenges' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyChallenges(@Req() req: any) {
    return this.challengesService.getMyChallenges(req.user.sub);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/challenges/:id — Get challenge by ID or shareCode (public)
  // ─────────────────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get a challenge by ID or shareCode (public — friend can view)' })
  @ApiResponse({ status: 200, description: 'Challenge data' })
  @ApiResponse({ status: 404, description: 'Challenge not found' })
  async findOne(@Param('id') id: string) {
    return this.challengesService.findByIdOrCode(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/challenges/:id/submit — Submit friend score (public)
  // ─────────────────────────────────────────────────────────────────────────────

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit the friend's game score (public — no auth required)" })
  @ApiResponse({ status: 200, description: 'Score submitted, winner determined' })
  @ApiResponse({ status: 400, description: 'Challenge already completed or expired' })
  @ApiResponse({ status: 404, description: 'Challenge not found' })
  async submitScore(@Param('id') id: string, @Body() dto: SubmitScoreDto) {
    return this.challengesService.submitScore(id, dto);
  }
}
