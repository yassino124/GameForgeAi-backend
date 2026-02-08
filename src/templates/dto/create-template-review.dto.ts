import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateTemplateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MaxLength(400)
  comment: string;
}
