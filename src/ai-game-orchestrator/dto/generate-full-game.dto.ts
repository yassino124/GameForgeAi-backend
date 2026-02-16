import { IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateFullGameDto {
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  prompt: string;
}
