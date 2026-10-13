import { Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import {
  type BrandingDto,
  type OperatorSettingsDto,
  type UpdateSettingsBody,
  updateSettingsBody,
} from '@ap/contracts';
import { type Database, tenants } from '@ap/db';
import { eq } from 'drizzle-orm';
import { AuthGuard, CurrentTenant, Roles, type TenantContext, TenantGuard } from '../common/auth';
import { type Tenant, TenantsService } from '../common/tenants';
import { ZodBody } from '../common/validation';
import { DB } from '../database/database.module';

/**
 * The operator's own settings: name, logo and color on customer pages, booking options, the
 * cancellation policy and contact details customers see before paying and on their ticket.
 */
@Controller('operator/settings')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class SettingsController {
  constructor(
    private readonly tenants: TenantsService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  async get(@CurrentTenant() context: TenantContext): Promise<OperatorSettingsDto> {
    return toSettingsDto(await this.tenants.get(context.tenantId), context);
  }

  @Patch()
  @Roles('owner')
  async update(
    @CurrentTenant() context: TenantContext,
    @ZodBody(updateSettingsBody) body: UpdateSettingsBody,
  ): Promise<OperatorSettingsDto> {
    const tenant = await this.tenants.get(context.tenantId);
    const branding: BrandingDto = { ...tenant.branding };
    if (body.logoUrl !== undefined) {
      if (body.logoUrl) branding.logoUrl = body.logoUrl;
      else delete branding.logoUrl;
    }
    if (body.primaryColor !== undefined) {
      if (body.primaryColor) branding.primaryColor = body.primaryColor;
      else delete branding.primaryColor;
    }
    const [updated] = await this.db
      .update(tenants)
      .set({
        branding,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.allowPayOnSite !== undefined ? { allowPayOnSite: body.allowPayOnSite } : {}),
        ...(body.attributionWindowDays !== undefined
          ? { attributionWindowDays: body.attributionWindowDays }
          : {}),
        ...(body.cancellationPolicy !== undefined
          ? { cancellationPolicy: body.cancellationPolicy }
          : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
      })
      .where(eq(tenants.id, tenant.id))
      .returning();
    return toSettingsDto(updated!, context);
  }
}

function toSettingsDto(tenant: Tenant, context: TenantContext): OperatorSettingsDto {
  return {
    slug: tenant.slug,
    name: tenant.name,
    currency: tenant.currency,
    timezone: tenant.timezone,
    branding: tenant.branding,
    allowPayOnSite: tenant.allowPayOnSite,
    attributionWindowDays: tenant.attributionWindowDays,
    cancellationPolicy: tenant.cancellationPolicy,
    contactEmail: tenant.contactEmail,
    contactPhone: tenant.contactPhone,
    canEdit: context.roles.includes('owner'),
  };
}
