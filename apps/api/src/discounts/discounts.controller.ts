import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateDiscountCodeBody,
  type DiscountCodeDto,
  type DiscountPreviewDto,
  type UpdateDiscountCodeBody,
  createDiscountCodeBody,
  updateDiscountCodeBody,
} from '@ap/contracts';
import {
  AuthGuard,
  CurrentAffiliate,
  CurrentTenant,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { ZodBody } from '../common/validation';
import { DiscountsService } from './discounts.service';

@Controller('operator/discount-codes')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorDiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<DiscountCodeDto[]> {
    return this.discounts.list(tenant.tenantId);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(createDiscountCodeBody) body: CreateDiscountCodeBody,
  ): Promise<DiscountCodeDto> {
    return this.discounts.create(tenant.tenantId, body);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateDiscountCodeBody) body: UpdateDiscountCodeBody,
  ): Promise<DiscountCodeDto> {
    return this.discounts.update(tenant.tenantId, id, body);
  }
}

/** The affiliate's own codes, to hand to their guests. */
@Controller('affiliate/discount-codes')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateDiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
  ): Promise<DiscountCodeDto[]> {
    const codes = await this.discounts.list(tenant.tenantId, { affiliateId });
    return codes.filter((c) => c.active);
  }
}

@Controller('public/tenants/:slug/discount-codes')
export class PublicDiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get(':code')
  preview(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Query('productId') productId: unknown,
  ): Promise<DiscountPreviewDto> {
    return this.discounts.preview(slug, code, productId);
  }
}
