import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
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
import { DomainError, NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { BookingService } from '../booking/booking.service';
import { Outbox } from '../outbox/outbox';
import { PaymentsGateway } from './gateway';
import { StripeGateway } from './stripe.gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intentId(intent: string | { id: string } | null): string | null {
  return typeof intent === 'string' ? intent : (intent?.id ?? null);
}

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
      throw new DomainError('errors.webhooks.invalidSignature', HttpStatus.BAD_REQUEST);
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
        if (session.payment_status !== 'paid' || !bookingId) break;
        // Another product sold through the same Stripe account (a payment link, an invoice...):
        // not ours. Answering an error would make Stripe retry it for days.
        if (!UUID.test(bookingId) || !(await this.bookingService.exists(bookingId))) {
          this.logger.warn(`${event.type} ${event.id} is not for a booking of this platform`);
          break;
        }
        await this.bookingService.confirmPayment(bookingId, intentId(session.payment_intent));
        if (this.config.WORKER_ENABLED) void this.outbox.drain();
        break;
      }
      case 'charge.refunded': {
        // A refund made in the Stripe dashboard: the ticket stops being valid and the commission
        // is reversed, as if the operator had cancelled the booking here.
        const charge = event.data.object;
        const intent = intentId(charge.payment_intent);
        if (intent) {
          await this.bookingService.refundedByProvider(intent, charge.amount_refunded);
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
