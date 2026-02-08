import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SetupIntentDto {
  @ApiProperty({ example: 'user@example.com', required: false })
  @IsOptional()
  @IsString()
  customerEmail?: string;
}
