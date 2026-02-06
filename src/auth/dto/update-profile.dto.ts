import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, IsUrl } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'johndoe', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_\.\-]{3,24}$/, {
    message: 'Username must be 3-24 characters and contain only letters, numbers, underscore, dot and dash',
  })
  username?: string;

  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fullName?: string;

  @ApiProperty({ example: 'Indie dev. Building with GameForge AI.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @ApiProperty({ example: 'Paris, FR', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  location?: string;

  @ApiProperty({ example: 'https://example.com', required: false })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'Website must be a valid URL (include https://)' })
  @MaxLength(200)
  website?: string;
}
