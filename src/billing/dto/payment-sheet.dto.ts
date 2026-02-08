import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class PaymentSheetDto {
  @ApiProperty({ example: 'price_123' })
  @IsString()
  priceId: string;
}
