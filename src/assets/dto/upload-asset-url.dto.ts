import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UploadAssetUrlDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid http(s) url' })
  url: string;

  @IsString()
  @IsIn(['texture', 'model', 'audio', 'shader', 'other'])
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  tags?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  unityPath?: string;
}
