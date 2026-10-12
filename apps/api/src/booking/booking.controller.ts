import {
  Param,
  ParseUUIDPipe,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AssistedBookingBody,
  type BookingDto,
  type CancelBookingBody,
  type CheckInBody,
  type CheckInResultDto,
  type CheckoutResultDto,
  type ProductDto,
  type PublicCheckoutBody,
  type PublicTenantDto,
  type SlotDto,
  type TicketDto,
  assistedBookingBody,
  cancelBookingBody,
  checkInBody,
  publicCheckoutBody,
} from '@ap/contracts';
import {
  type AuthUser,
  AuthGuard,
  CurrentAffiliate,
  CurrentTenant,
  CurrentUser,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { CatalogService } from '../catalog/catalog.service';
import { Clock } from '../common/clock';
import { checkTicketLinkKey } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { parseDateParam } from '../common/period';
import { TenantsService } from '../common/tenants';
import { ZodBody } from '../common/validation';
import { APP_CONFIG, type AppConfig } from '../config';
import { Outbox } from '../outbox/outbox';
import { BookingService } from './booking.service';
import { TicketsService } from './tickets.service';

@Controller('public')
export class PublicBookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly tickets: TicketsService,
    private readonly catalog: CatalogService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('tenants/:slug')
  async tenant(@Param('slug') slug: string): Promise<PublicTenantDto> {
    const tenant = await this.tenants.bySlug(slug);
    return {
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone,
      branding: tenant.branding,
      products: await this.catalog.listProducts(tenant.id),
    };
  }

  @Get('tenants/:slug/products/:productSlug')
  async product(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
  ): Promise<ProductDto> {
    const tenant = await this.tenants.bySlug(slug);
    return this.catalog.productBySlug(tenant.id, productSlug);
  }

  @Get('tenants/:slug/products/:productSlug/slots')
  async slots(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<SlotDto[]> {
    const tenant = await this.tenants.bySlug(slug);
    const product = await this.catalog.productBySlug(tenant.id, productSlug);
    return this.catalog.listSlots(
      tenant.id,
      product.id,
      parseDateParam(from, 'from'),
      parseDateParam(to, 'to'),
      this.clock.now(),
    );
  }

  @Post('tenants/:slug/checkout')
  checkout(
    @Param('slug') slug: string,
    @ZodBody(publicCheckoutBody) body: PublicCheckoutBody,
  ): Promise<CheckoutResultDto> {
    return this.bookingService.publicCheckout(slug, body);
  }

  @Get('tickets/:bookingId')
  ticket(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Query('k') key: unknown,
  ): Promise<TicketDto> {
    return this.tickets.view(bookingId, typeof key === 'string' ? key : '');
  }

  /** Public key that verifies ticket QR codes, for offline scanners. */
  @Get('ticket-key')
  ticketKey(): { algorithm: 'Ed25519'; publicKeyPem: string } {
    return { algorithm: 'Ed25519', publicKeyPem: this.tickets.signer.publicKeyPem() };
  }

  /** Local development only: simulates the payment provider confirming a payment. */
  @Post('dev-payments/:bookingId/succeed')
  @HttpCode(204)
  async devPayment(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Query('k') key: unknown,
  ): Promise<void> {
    if (this.config.PAYMENTS_PROVIDER !== 'fake') throw new NotFound('page');
    if (typeof key !== 'string' || !checkTicketLinkKey(this.config.APP_SECRET, bookingId, key)) {
      throw new DomainError('errors.booking.invalidPaymentLink', HttpStatus.FORBIDDEN);
    }
    await this.bookingService.confirmPayment(bookingId, `fake_pi_${bookingId}`);
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
  }
}

@Controller('affiliate/bookings')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateBookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly outbox: Outbox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  list(@CurrentAffiliate() affiliateId: string): Promise<BookingDto[]> {
    return this.bookingService.listForAffiliate(affiliateId);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
    @CurrentUser() user: AuthUser,
    @ZodBody(assistedBookingBody) body: AssistedBookingBody,
  ): Promise<CheckoutResultDto> {
    const result = await this.bookingService.assistedBooking(
      tenant.tenantId,
      affiliateId,
      user.id,
      body,
    );
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }
}

@Controller('operator')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorBookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly tickets: TicketsService,
    private readonly outbox: Outbox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('bookings')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<BookingDto[]> {
    return this.bookingService.listForTenant(
      tenant.tenantId,
      parseDateParam(from, 'from'),
      parseDateParam(to, 'to'),
    );
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(cancelBookingBody) body: CancelBookingBody,
  ): Promise<BookingDto> {
    const result = await this.bookingService.cancel(tenant.tenantId, id, body.reason, user.id);
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }

  @Post('tickets/check-in')
  @HttpCode(200)
  async checkIn(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(checkInBody) body: CheckInBody,
  ): Promise<CheckInResultDto> {
    const result = await this.tickets.checkIn(tenant.tenantId, body.token, user.id);
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }
}
