import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  type AssistedBookingBody,
  type BookingDto,
  type CancelBookingBody,
  type CancelDeparturesBody,
  type CancelDeparturesResultDto,
  type CheckInBody,
  type CheckInResultDto,
  type CheckoutResultDto,
  type DepartureDayDto,
  type DeparturePassengersDto,
  type ProductDto,
  type PublicCheckoutBody,
  type PublicTenantDto,
  type SlotDto,
  type TicketDto,
  assistedBookingBody,
  cancelBookingBody,
  cancelDeparturesBody,
  checkInBody,
  publicCheckoutBody,
} from '@ap/contracts';
import type { Request } from 'express';
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
import { CatalogService, type ProductView } from '../catalog/catalog.service';
import { Clock } from '../common/clock';
import { checkTicketLinkKey } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { parseDateParam } from '../common/period';
import { TenantsService } from '../common/tenants';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { ZodBody } from '../common/validation';
import { APP_CONFIG, type AppConfig } from '../config';
import { I18nService } from '../i18n/i18n.service';
import { Outbox } from '../outbox/outbox';
import { BookingService } from './booking.service';
import { DeparturesService } from './departures.service';
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
    private readonly i18n: I18nService,
  ) {}

  /** Trips are in the request's language (Accept-Language) where the operator translated them. */
  @Get('tenants/:slug')
  async tenant(@Param('slug') slug: string, @Req() request: Request): Promise<PublicTenantDto> {
    const tenant = await this.tenants.bySlug(slug);
    return {
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone,
      branding: tenant.branding,
      products: await this.catalog.listProducts(tenant.id, true, this.view(request)),
      cancellationPolicy: tenant.cancellationPolicy,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
    };
  }

  @Get('tenants/:slug/products/:productSlug')
  async product(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
    @Req() request: Request,
  ): Promise<ProductDto> {
    const tenant = await this.tenants.bySlug(slug);
    return this.catalog.productBySlug(tenant.id, productSlug, this.view(request));
  }

  private view(request: Request): ProductView {
    return { kind: 'public', lang: this.i18n.langOf(request) };
  }

  @Get('tenants/:slug/products/:productSlug/slots')
  async slots(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<SlotDto[]> {
    const tenant = await this.tenants.bySlug(slug);
    const product = await this.catalog.productBySlug(tenant.id, productSlug, {
      kind: 'public',
      lang: 'en',
    });
    return this.catalog.listSlots(
      tenant.id,
      product.id,
      parseDateParam(from, 'from'),
      parseDateParam(to, 'to'),
      this.clock.now(),
    );
  }

  /** Each checkout holds seats until it expires: capped per IP so nobody can block a trip. */
  @Post('tenants/:slug/checkout')
  @UseGuards(RateLimitGuard)
  @RateLimit('checkout', { limit: 20, windowMs: 10 * 60_000 })
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
    @Query('lang') lang: unknown,
  ): Promise<TicketDto> {
    return this.tickets.view(
      bookingId,
      typeof key === 'string' ? key : '',
      typeof lang === 'string' ? lang : null,
    );
  }

  /** The ticket as a PDF the customer can save on the phone. */
  @Get('tickets/:bookingId/pdf')
  async ticketPdf(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Query('k') key: unknown,
    @Query('lang') lang: unknown,
    @Query('download') download: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.tickets.pdf(
      bookingId,
      typeof key === 'string' ? key : '',
      typeof lang === 'string' ? lang : null,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(pdf.content, {
      type: 'application/pdf',
      disposition: `${download === '1' ? 'attachment' : 'inline'}; filename="${pdf.filename}"`,
      length: pdf.content.length,
    });
  }

  /** The trip as a calendar event: Apple Calendar, Outlook and phones open it to add it. */
  @Get('tickets/:bookingId/calendar.ics')
  async ticketCalendar(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Query('k') key: unknown,
    @Query('lang') lang: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.tickets.calendar(
      bookingId,
      typeof key === 'string' ? key : '',
      typeof lang === 'string' ? lang : null,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.content;
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
    private readonly i18n: I18nService,
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

  /**
   * Cancels departures of the operator's own calendar (bad weather...): they close to new sales,
   * and every booking on them is cancelled, refunded and its customer told why.
   */
  @Post('products/:id/slots/cancel')
  @HttpCode(200)
  async cancelDepartures(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(cancelDeparturesBody) body: CancelDeparturesBody,
  ): Promise<CancelDeparturesResultDto> {
    const result = await this.bookingService.cancelDepartures(tenant.tenantId, id, body, user.id);
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }

  /** Boarding from the passenger list, for a customer who cannot show their ticket. */
  @Post('bookings/:id/board')
  @HttpCode(200)
  async board(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<CheckInResultDto> {
    const result = await this.tickets.boardBooking(
      tenant.tenantId,
      id,
      user.id,
      this.i18n.langOf(request),
    );
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }

  /** Boarding scan. Scanner accounts reach only this route of the operator API. */
  @Post('tickets/check-in')
  @HttpCode(200)
  @Roles('owner', 'staff', 'scanner')
  async checkIn(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(checkInBody) body: CheckInBody,
    @Req() request: Request,
  ): Promise<CheckInResultDto> {
    const result = await this.tickets.checkIn(
      tenant.tenantId,
      body.token,
      user.id,
      this.i18n.langOf(request),
      body.allowOtherDay ?? false,
    );
    if (this.config.WORKER_ENABLED) void this.outbox.drain();
    return result;
  }
}

/** The boarding list: a day's departures and the passengers of each. */
@Controller('operator/departures')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorDeparturesController {
  constructor(private readonly departures: DeparturesService) {}

  @Get()
  day(
    @CurrentTenant() tenant: TenantContext,
    @Query('date') date: unknown,
  ): Promise<DepartureDayDto> {
    return this.departures.day(tenant.tenantId, parseDateParam(date, 'date'));
  }

  @Get(':slotId/passengers')
  passengers(
    @CurrentTenant() tenant: TenantContext,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ): Promise<DeparturePassengersDto> {
    return this.departures.passengers(tenant.tenantId, slotId);
  }
}
