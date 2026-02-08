import { IsIn, IsString } from 'class-validator';

export class CreateExportDto {
  @IsString()
  collectionId: string;

  @IsIn(['zip', 'unitypackage'])
  format: 'zip' | 'unitypackage';
}
