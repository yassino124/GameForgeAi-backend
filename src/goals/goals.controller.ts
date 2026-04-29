import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/goals — Create a new goal
  // ─────────────────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new SMART goal' })
  @ApiResponse({ status: 201, description: 'Goal created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Req() req: any, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(req.user.sub, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/goals/my — Get all my goals
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('my')
  @ApiOperation({ summary: 'Get all goals for the current user' })
  @ApiResponse({ status: 200, description: 'List of goals' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyGoals(@Req() req: any) {
    return this.goalsService.getMyGoals(req.user.sub);
  }
}
