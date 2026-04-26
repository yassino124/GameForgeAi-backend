import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChallengeDto {
  @ApiProperty({ example: '64f8a1b2c3d4e5f6a7b8c9d0', description: 'The game / project ID' })
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @ApiProperty({ example: 'webgl', enum: ['webgl', 'quiz', 'phaser', 'scratch', 'claude', 'threejs', 'other'] })
  @IsString()
  @IsNotEmpty()
  gameType: string;

  @ApiProperty({ example: 'My Awesome Platformer' })
  @IsString()
  @IsNotEmpty()
  gameTitle: string;

  @ApiPropertyOptional({ example: 'https://api.gameforgeai.com/api/projects/files/...' })
  @IsString()
  @IsOptional()
  gameUrl?: string;

  @ApiProperty({ example: 4200, description: 'Challenger score (from game telemetry)' })
  @IsNumber()
  @Min(0)
  challengerScore: number;

  @ApiProperty({ example: 'xXGamerXx' })
  @IsString()
  @IsNotEmpty()
  challengerName: string;
}
