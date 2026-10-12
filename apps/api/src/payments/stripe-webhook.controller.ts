import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { type Database, processedWebhookEvents } from '@ap/db';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { BookingService } from '../booking/booking.service';
import { Outbox } from '../outbox/outbox';
import { PaymentsGateway } from './gateway';
import { StripeGateway } from './stripe.gateway';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger('StripeWebhook');

  constructor(
    private readonly gateway: PaymentsGateway,
    private readonly bookingService: BookingService,
    private readonly outbox: Outbox,
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!(this.gateway instanceof StripeGateway)) throw new NotFound('page');
    let event: Stripe.Event;
    try {
      event = this.gateway.stripe.webhooks.constructEvent(
        request.rawBody ?? Buffer.alloc(0),
        signature ?? '',
        this.config.STRIPE_WEBHOOK_SECRET ?? '',
      );
    } catch {
      throw new BadRequestException('invalid Stripe signature');
    }

    const [seen] = await this.db
      .select({ id: processedWebhookEvents.id })
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.id, event.id));
    if (seen) return { received: true };

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const bookingId = session.client_reference_id ?? session.metadata?.bookingId;
        if (session.payment_status === 'paid' && bookingId) {
          const intent =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : (session.payment_intent?.id ?? null);
          await this.bookingService.confirmPayment(bookingId, intent);
          if (this.config.WORKER_ENABLED) void this.outbox.drain();
        }
        break;
      }
      default:
        this.logger.debug(`ignored Stripe event ${event.type}`);
    }

    // Recorded only after successful handling: if handling throws, Stripe retries the event.
    await this.db
      .insert(processedWebhookEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing();
    return { received: true };
  }
}
