import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateAiDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}
