import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123!', description: 'Current password' })
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'NewPassword123!', description: 'New password (min 8 chars)' })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  newPassword: string;
}
