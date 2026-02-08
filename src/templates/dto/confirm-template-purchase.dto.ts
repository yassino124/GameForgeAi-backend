import { IsString, MaxLength } from 'class-validator';

export class ConfirmTemplatePurchaseDto {
  @IsString()
  @MaxLength(120)
  paymentIntentId: string;
}
