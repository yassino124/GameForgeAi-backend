import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateDraftDto {
  @IsString()
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
