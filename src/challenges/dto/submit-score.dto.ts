import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitScoreDto {
  @ApiProperty({ example: 3800, description: "Friend's final score from game telemetry" })
  @IsNumber()
  @Min(0)
  friendScore: number;

  @ApiPropertyOptional({ example: 'Player2' })
  @IsString()
  @IsOptional()
  friendName?: string;
}
