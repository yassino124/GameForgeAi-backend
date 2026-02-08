import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCollectionDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
