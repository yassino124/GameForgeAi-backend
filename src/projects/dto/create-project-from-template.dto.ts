import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectFromTemplateDto {
  @IsString()
  templateId: string;

  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  assetsCollectionId?: string;
}
