import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type CreateProductBody,
  type CreateSlotsBody,
  type DeleteSlotsBody,
  type DeleteSlotsResultDto,
  type OperatorSlotDto,
  type ProductDto,
  type SlotDto,
  type UpdateProductBody,
  type UpdateSlotsBody,
  type UpdateSlotsResultDto,
  createProductBody,
  createSlotsBody,
  deleteSlotsBody,
  updateProductBody,
  updateSlotsBody,
} from '@ap/contracts';
import {
  AuthGuard,
  CurrentAffiliate,
  CurrentTenant,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { Clock } from '../common/clock';
import { parseDateParam } from '../common/period';
import { ZodBody } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { CatalogService } from './catalog.service';

@Controller('operator/products')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<ProductDto[]> {
    return this.catalog.listProducts(tenant.tenantId, false);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(createProductBody) body: CreateProductBody,
  ): Promise<ProductDto> {
    return this.catalog.createProduct(tenant.tenantId, body);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateProductBody) body: UpdateProductBody,
  ): Promise<ProductDto> {
    return this.catalog.updateProduct(tenant.tenantId, id, body);
  }

  @Get(':id/slots')
  slots(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<OperatorSlotDto[]> {
    return this.catalog.listOperatorSlots(
      tenant.tenantId,
      id,
      parseDateParam(from, 'from'),
      parseDateParam(to, 'to'),
      this.clock.now(),
    );
  }

  @Post(':id/slots')
  createSlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(createSlotsBody) body: CreateSlotsBody,
  ): Promise<{ created: number }> {
    return this.catalog.createSlots(tenant.tenantId, id, body);
  }

  @Patch(':id/slots')
  updateSlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateSlotsBody) body: UpdateSlotsBody,
  ): Promise<UpdateSlotsResultDto> {
    return this.catalog.updateSlots(tenant.tenantId, id, body);
  }

  @Post(':id/slots/delete')
  @HttpCode(200)
  deleteSlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(deleteSlotsBody) body: DeleteSlotsBody,
  ): Promise<DeleteSlotsResultDto> {
    return this.catalog.deleteSlots(tenant.tenantId, id, body.slotIds);
  }
}

@Controller('affiliate/products')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly clock: Clock,
    private readonly i18n: I18nService,
  ) {}

  /**
   * The trips in the affiliate's language, where the operator translated them. A trip's own
   * commission rate shows only to affiliates it applies to (not to those with a negotiated rate).
   */
  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
    @Req() request: Request,
  ): Promise<ProductDto[]> {
    const list = await this.catalog.listProducts(tenant.tenantId, true, {
      kind: 'affiliate',
      lang: this.i18n.langOf(request),
    });
    if (!(await this.catalog.hasNegotiatedRate(affiliateId))) return list;
    return list.map((product) => ({ ...product, commissionRateBps: null }));
  }

  @Get(':id/slots')
  slots(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<SlotDto[]> {
    return this.catalog.listSlots(
      tenant.tenantId,
      id,
      parseDateParam(from, 'from'),
      parseDateParam(to, 'to'),
      this.clock.now(),
    );
  }
}
