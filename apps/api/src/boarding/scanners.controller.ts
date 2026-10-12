import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AddScannerBody,
  type ScannerAccountDto,
  type ScannerContextDto,
  addScannerBody,
} from '@ap/contracts';
import {
  type AuthUser,
  AuthGuard,
  CurrentTenant,
  CurrentUser,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { ZodBody } from '../common/validation';
import { ScannersService } from './scanners.service';

/** The operator manages who can scan tickets at boarding. */
@Controller('operator/scanners')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorScannersController {
  constructor(private readonly scanners: ScannersService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<ScannerAccountDto[]> {
    return this.scanners.list(tenant.tenantId);
  }

  @Post()
  add(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(addScannerBody) body: AddScannerBody,
  ): Promise<ScannerAccountDto> {
    return this.scanners.add(tenant.tenantId, body);
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.scanners.remove(tenant.tenantId, userId);
  }
}

/** The scanner app: everything a boarding scanner can see besides the scan itself. */
@Controller('scanner')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff', 'scanner')
export class ScannerController {
  constructor(private readonly scanners: ScannersService) {}

  @Get('context')
  context(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
  ): Promise<ScannerContextDto> {
    return this.scanners.context(tenant.tenantId, user.id);
  }
}
