import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsNumber,
  IsObject,
  IsOptional,
  IsBoolean,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class CreateProjectAiDto {
  @IsString()
  @MaxLength(4000)
  prompt: string;

  @IsOptional()
  @IsObject()
  runtimeConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  buildTarget?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  timeScale?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  difficulty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  theme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  speed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  assetsType?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  mechanics?: string[];

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsHexColor()
  playerColor?: string;

  @IsOptional()
  @IsBoolean()
  fogEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.1)
  fogDensity?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  cameraZoom?: number;

  @IsOptional()
  @IsNumber()
  @Min(-50)
  @Max(0)
  gravityY?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  jumpForce?: number;
}
