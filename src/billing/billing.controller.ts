import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { PortalDto } from './dto/portal.dto';
import { SetupIntentDto } from './dto/setup-intent.dto';
import { SubscribeDto } from './dto/subscribe.dto';
import { PaymentSheetDto } from './dto/payment-sheet.dto';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('config')
  @ApiOperation({ summary: 'Get public Stripe config (publishable key)' })
  async getConfig() {
    return this.billingService.getStripeConfig();
  }

  @Get('plans')
  @ApiOperation({ summary: 'List billing plans' })
  @ApiResponse({ status: 200, description: 'Plans list' })
  async getPlans() {
    return this.billingService.getPlans();
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user subscription' })
  async getSubscription(@Req() req: any) {
    return this.billingService.getUserSubscription(req.user.sub);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  async checkout(@Req() req: any, @Body() dto: CheckoutDto) {
    return this.billingService.createCheckoutSession(
      req.user.sub,
      { priceId: dto.priceId, planId: dto.planId },
      dto.customerEmail,
    );
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe customer portal session' })
  async portal(@Req() req: any, @Body() dto: PortalDto) {
    return this.billingService.createPortalSession(req.user.sub, dto.returnUrl);
  }

  @Post('setup-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe SetupIntent for in-app card collection (PaymentSheet)' })
  async setupIntent(@Req() req: any, @Body() dto: SetupIntentDto) {
    return this.billingService.createSetupIntent(req.user.sub, dto.customerEmail);
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe subscription using a completed SetupIntent (PaymentSheet)' })
  async subscribe(@Req() req: any, @Body() dto: SubscribeDto) {
    return this.billingService.createSubscriptionFromSetupIntent(req.user.sub, dto.priceId, dto.setupIntentId);
  }

  @Post('payment-sheet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe PaymentSheet params for subscription (in-app card payment)' })
  async paymentSheet(@Req() req: any, @Body() dto: PaymentSheetDto) {
    return this.billingService.createPaymentSheet(req.user.sub, dto.priceId);
  }

  @Post('cancel-subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel current subscription at period end (in-app alternative to portal)' })
  async cancelSubscription(@Req() req: any) {
    return this.billingService.cancelSubscription(req.user.sub);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook (signature required)' })
  async webhook(@Req() req: any, @Headers('stripe-signature') signature: string) {
    const rawBody: Buffer = req.rawBody ?? req.body;
    return this.billingService.handleWebhook(rawBody, signature);
  }
}
