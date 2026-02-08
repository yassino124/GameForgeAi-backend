import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({ example: 'price_123' })
  @IsString()
  priceId: string;

  @ApiProperty({
    example: 'seti_123',
    description: 'Stripe SetupIntent ID used to collect the payment method in-app',
  })
  @IsString()
  setupIntentId: string;
}
