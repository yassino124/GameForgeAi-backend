import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @ApiProperty({
    example: 'price_123',
    description: 'Stripe price ID (use this OR planId)',
    required: false,
  })
  @IsOptional()
  @IsString()
  priceId?: string;

  @ApiProperty({
    example: '64f8a1b2c3d4e5f6a7b8c9d0',
    description: 'Mongo Plan ID (use this OR priceId)',
    required: false,
  })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiProperty({ example: 'user@example.com', required: false })
  @IsOptional()
  @IsString()
  customerEmail?: string;
}
