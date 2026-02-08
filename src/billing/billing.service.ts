import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import Stripe from 'stripe';
import { Model } from 'mongoose';
import { Plan, PlanDocument } from './schemas/plan.schema';
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema';
import { User, UserDocument } from '../users/entities/user.entity';

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    if (!secretKey) {
      throw new Error('Missing STRIPE_SECRET_KEY');
    }

    const rawApiVersion = (this.configService.get<string>('stripe.apiVersion') || '').trim();
    const apiVersionCandidate = rawApiVersion && /^\d{4}-\d{2}-\d{2}$/.test(rawApiVersion) ? rawApiVersion : '';
    const apiVersion = (apiVersionCandidate || '2024-06-20') as any;

    this.stripe = new Stripe(secretKey, {
      apiVersion,
    });
  }

  async cancelSubscription(userId: string) {
    const sub = await this.subscriptionModel.findOne({ userId }).lean();
    if (!sub?.stripeSubscriptionId) {
      return { success: true, data: { status: 'inactive' } };
    }

    const updated = await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: { userId: String(userId) },
    });

    const currentPeriodEndUnix: number | null = (updated as any)['current_period_end'] ?? null;
    const currentPeriodEnd = currentPeriodEndUnix ? new Date(currentPeriodEndUnix * 1000) : null;

    await this.subscriptionModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          stripeCustomerId:
            typeof updated.customer === 'string' ? updated.customer : (updated.customer as any)?.id,
          stripeSubscriptionId: updated.id,
          status: updated.status,
          priceId: updated.items.data[0]?.price?.id || sub.priceId || null,
          currentPeriodEnd,
        },
      },
      { upsert: true, new: true },
    );

    await this.applySubscriptionToUser(
      userId,
      updated.items.data[0]?.price?.id || sub.priceId || null,
      updated.status,
    );

    return {
      success: true,
      data: {
        subscriptionId: updated.id,
        status: updated.status,
        cancelAtPeriodEnd: Boolean((updated as any).cancel_at_period_end),
        currentPeriodEnd,
      },
    };
  }

  async getPlans() {
    const plans = await this.planModel.find().sort({ priceMonthly: 1 }).lean();

    const proPriceId = (process.env.STRIPE_PRICE_PRO || '').trim();
    const enterprisePriceId = (process.env.STRIPE_PRICE_ENTERPRISE || '').trim();

    const source = plans.length
      ? plans
      : ([
          {
            name: 'Free',
            description: 'Get started with core features',
            features: ['Basic generation', 'Community templates', 'Standard support'],
            stripePriceId: '',
            priceMonthly: 0,
            isPopular: false,
          },
          {
            name: 'Pro',
            description: 'More credits and advanced templates',
            features: ['More generations', 'Pro templates', 'Priority support'],
            stripePriceId: proPriceId,
            priceMonthly: 19,
            isPopular: true,
          },
          {
            name: 'Enterprise',
            description: 'Teams, collaboration, and unlimited workflows',
            features: ['Team workspace', 'Enterprise templates', 'SLA support'],
            stripePriceId: enterprisePriceId,
            priceMonthly: 49,
            isPopular: false,
          },
        ] as any[]);

    const normalized = source.map((p: any) => ({
      ...p,
      priceId: p.stripePriceId,
    }));
    return { success: true, data: normalized };
  }

  getStripeConfig() {
    const publishableKey = (this.configService.get<string>('stripe.publishableKey') || '').trim();
    return {
      success: true,
      data: {
        publishableKey,
      },
    };
  }

  async getUserSubscription(userId: string) {
    const sub = await this.subscriptionModel.findOne({ userId }).lean();

    if (!sub) {
      return { success: true, data: { status: 'inactive' } };
    }

    let plan: any = null;
    if (sub.priceId) {
      plan = await this.planModel.findOne({ stripePriceId: sub.priceId }).lean();
      if (plan) {
        plan = {
          ...plan,
          priceId: plan.stripePriceId,
        };
      } else {
        const proPriceId = (process.env.STRIPE_PRICE_PRO || '').trim();
        const enterprisePriceId = (process.env.STRIPE_PRICE_ENTERPRISE || '').trim();

        const normalizedPriceId = String(sub.priceId || '').trim();
        if (normalizedPriceId && normalizedPriceId === proPriceId) {
          plan = {
            name: 'Pro',
            description: 'More credits and advanced templates',
            features: ['More generations', 'Pro templates', 'Priority support'],
            stripePriceId: proPriceId,
            priceId: proPriceId,
            priceMonthly: 19,
            isPopular: true,
          };
        } else if (normalizedPriceId && normalizedPriceId === enterprisePriceId) {
          plan = {
            name: 'Enterprise',
            description: 'Teams, collaboration, and unlimited workflows',
            features: ['Team workspace', 'Enterprise templates', 'SLA support'],
            stripePriceId: enterprisePriceId,
            priceId: enterprisePriceId,
            priceMonthly: 49,
            isPopular: false,
          };
        }
      }
    }

    const amount = plan?.priceMonthly ?? null;

    return {
      success: true,
      data: {
        ...sub,
        plan,
        amount,
      },
    };
  }

  private async getOrCreateCustomer(userId: string, email?: string) {
    const existing = await this.subscriptionModel.findOne({ userId });
    if (existing?.stripeCustomerId) {
      return { customerId: existing.stripeCustomerId, subDoc: existing };
    }

    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');

    const customer = await this.stripe.customers.create({
      email: email || user.email,
      metadata: {
        userId: String(userId),
      },
    });

    const subDoc = await this.subscriptionModel.findOneAndUpdate(
      { userId },
      { $set: { userId, stripeCustomerId: customer.id } },
      { upsert: true, new: true },
    );

    return { customerId: customer.id, subDoc };
  }

  async createCheckoutSession(userId: string, priceIdOrPlanId: { priceId?: string; planId?: string }, email?: string) {
    let priceId = priceIdOrPlanId.priceId;

    if (!priceId && priceIdOrPlanId.planId) {
      const plan = await this.planModel.findById(priceIdOrPlanId.planId).lean();
      if (!plan) throw new NotFoundException('Plan not found');
      priceId = plan.stripePriceId;
    }

    if (!priceId) {
      throw new BadRequestException('priceId or planId is required');
    }

    const { customerId } = await this.getOrCreateCustomer(userId, email);

    const successUrl = this.configService.get<string>('stripe.successUrl');
    const cancelUrl = this.configService.get<string>('stripe.cancelUrl');

    if (!successUrl || !cancelUrl) {
      throw new Error('Missing STRIPE_SUCCESS_URL or STRIPE_CANCEL_URL');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { userId: String(userId) },
      },
      metadata: {
        userId: String(userId),
      },
    });

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    return { success: true, data: { url: session.url } };
  }

  async createPortalSession(userId: string, returnUrl?: string) {
    const { customerId } = await this.getOrCreateCustomer(userId);
    const defaultReturnUrl = this.configService.get<string>('stripe.portalReturnUrl');
    const portal = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || defaultReturnUrl,
    });

    if (!portal.url) {
      throw new BadRequestException('Stripe did not return a portal URL');
    }

    return { success: true, data: { url: portal.url } };
  }

  async createSetupIntent(userId: string, email?: string) {
    const { customerId } = await this.getOrCreateCustomer(userId, email);

    const ephemeralKey = await this.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (this.stripe as any)._api?.version },
    );

    const setupIntent = await this.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      metadata: { userId: String(userId) },
    });

    return {
      success: true,
      data: {
        customerId,
        ephemeralKeySecret: ephemeralKey.secret,
        setupIntentClientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      },
    };
  }

  async createSubscriptionFromSetupIntent(userId: string, priceId: string, setupIntentId: string) {
    if (!priceId?.trim()) throw new BadRequestException('priceId is required');
    if (!setupIntentId?.trim()) throw new BadRequestException('setupIntentId is required');

    const { customerId } = await this.getOrCreateCustomer(userId);

    const setupIntent = await this.stripe.setupIntents.retrieve(setupIntentId);
    if (!setupIntent) throw new NotFoundException('SetupIntent not found');

    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;

    if (!paymentMethodId) {
      throw new BadRequestException('SetupIntent has no payment method');
    }

    await this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { userId: String(userId) },
      expand: ['latest_invoice.payment_intent'],
    });

    const currentPeriodEndUnix: number | null = (subscription as any)['current_period_end'] ?? null;
    const currentPeriodEnd = currentPeriodEndUnix ? new Date(currentPeriodEndUnix * 1000) : null;

    await this.subscriptionModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          priceId,
          currentPeriodEnd,
        },
      },
      { upsert: true, new: true },
    );

    await this.applySubscriptionToUser(userId, priceId, subscription.status);

    return {
      success: true,
      data: {
        subscriptionId: subscription.id,
        status: subscription.status,
      },
    };
  }

  async createPaymentSheet(userId: string, priceId: string) {
    if (!priceId?.trim()) throw new BadRequestException('priceId is required');

    const { customerId } = await this.getOrCreateCustomer(userId);

    const ephemeralKey = await this.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (this.stripe as any)._api?.version },
    );

    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { userId: String(userId) },
      expand: ['latest_invoice.payment_intent'],
    });

    const paymentIntent = (subscription.latest_invoice as any)?.payment_intent as Stripe.PaymentIntent | undefined;
    const clientSecret = paymentIntent?.client_secret;
    if (!clientSecret) {
      throw new BadRequestException('Stripe did not return a payment intent client secret');
    }

    const currentPeriodEndUnix: number | null = (subscription as any)['current_period_end'] ?? null;
    const currentPeriodEnd = currentPeriodEndUnix ? new Date(currentPeriodEndUnix * 1000) : null;

    await this.subscriptionModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          priceId,
          currentPeriodEnd,
        },
      },
      { upsert: true, new: true },
    );

    return {
      success: true,
      data: {
        customerId,
        ephemeralKeySecret: ephemeralKey.secret,
        paymentIntentClientSecret: clientSecret,
        subscriptionId: subscription.id,
      },
    };
  }

  private async applySubscriptionToUser(userId: string, priceId: string | null, status: string) {
    void userId;
    void priceId;
    void status;
    return;
  }

  async handleWebhook(rawBody: Buffer, signature: string | string[] | undefined) {
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    if (!webhookSecret) {
      throw new Error('Missing STRIPE_WEBHOOK_SECRET');
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    const event = this.stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = String(session.metadata?.userId || '');
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

        if (userId && customerId) {
          await this.subscriptionModel.findOneAndUpdate(
            { userId },
            { $set: { userId, stripeCustomerId: customerId } },
            { upsert: true, new: true },
          );
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const subscriptionId = sub.id;
        const status = sub.status;
        const priceId = sub.items.data[0]?.price?.id || null;
        const currentPeriodEndUnix: number | null =
          (sub as any)['current_period_end'] ?? (sub as any)['currentPeriodEnd'] ?? null;
        const currentPeriodEnd = currentPeriodEndUnix
          ? new Date(currentPeriodEndUnix * 1000)
          : null;

        let userId = String(sub.metadata?.userId || '');
        if (!userId) {
          const existing = await this.subscriptionModel.findOne({ stripeCustomerId: customerId }).lean();
          userId = existing?.userId || '';
        }

        if (userId) {
          await this.subscriptionModel.findOneAndUpdate(
            { userId },
            {
              $set: {
                userId,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                status,
                priceId,
                currentPeriodEnd,
              },
            },
            { upsert: true, new: true },
          );

          await this.applySubscriptionToUser(userId, priceId, status);
        }
        break;
      }

      default:
        break;
    }

    return { received: true };
  }
}
