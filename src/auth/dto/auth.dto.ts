import { IsEmail, IsNotEmpty, IsString, MinLength, Matches, IsOptional, IsBoolean, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'johndoe', description: 'Username (3-20 chars, alphanumeric)' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,20}$/, {
    message: 'Username must be 3-20 characters long and contain only letters, numbers and underscores'
  })
  username: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!', description: 'Password (min 8 chars, uppercase, lowercase, number, special char)' })
  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
  })
  password: string;

  @ApiProperty({ enum: ['user'], example: 'user', description: 'User role', required: false })
  @IsOptional()
  @IsIn(['user'])
  role?: string;

  @ApiProperty({ example: true, description: 'Remember me for persistent session', required: false })
  @IsOptional()
  rememberMe?: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!', description: 'Password' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty({ example: true, description: 'Remember me for persistent session', required: false })
  rememberMe?: boolean;
}

export class GoogleLoginDto {
  @ApiProperty({ example: 'google-id-token', description: 'Google ID token' })
  @IsNotEmpty()
  @IsString()
  idToken: string;

  @ApiProperty({ example: true, description: 'Remember me for persistent session', required: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @ApiProperty({
    example: 'user',
    description: 'Optional role to assign when creating a new user via Google sign-in',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['user', 'dev', 'devl', 'admin'])
  role?: string;
}
