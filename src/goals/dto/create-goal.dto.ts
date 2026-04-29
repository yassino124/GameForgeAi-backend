import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export type GoalType = 'projects' | 'challenges' | 'earnings' | 'games';

export class CreateGoalDto {
  @ApiProperty({ example: 'Create 5 projects this month' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({ enum: ['projects', 'challenges', 'earnings', 'games'] })
  @IsEnum(['projects', 'challenges', 'earnings', 'games'])
  type: GoalType;

  @ApiProperty({ example: 5, description: 'Target count/amount to reach' })
  @IsInt()
  @Min(1)
  @Max(100000)
  target: number;

  @ApiPropertyOptional({ example: 100, description: 'Reward points on completion' })
  @IsOptional()
  @IsInt()
  @Min(1)
  rewardPoints?: number;
}
