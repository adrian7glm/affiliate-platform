import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { AuthGuard, CurrentTenant, Roles, type TenantContext, TenantGuard } from '../common/auth';
import { Clock } from '../common/clock';
import { parseDateParam } from '../common/period';
import { ZodBody } from '../common/validation';
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
  ) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<ProductDto[]> {
    return this.catalog.listProducts(tenant.tenantId);
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
