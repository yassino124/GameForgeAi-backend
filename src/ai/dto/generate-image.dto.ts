import { IsString, MaxLength } from 'class-validator';

export class GenerateImageDto {
  @IsString()
  @MaxLength(4000)
  prompt: string;
}
