import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class PortalDto {
  @ApiProperty({ example: 'http://localhost:3000/settings/billing', required: false })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
