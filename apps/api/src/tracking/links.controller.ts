import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  type ClickResultDto,
  type CreateLinkBody,
  type LinkDto,
  type RecordClickBody,
  createLinkBody,
  recordClickBody,
} from '@ap/contracts';
import type { Database } from '@ap/db';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentAffiliate,
  CurrentTenant,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { ZodBody } from '../common/validation';
import { DB } from '../database/database.module';
import { LinksService } from './links.service';

@Controller('affiliate/links')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateLinksController {
  constructor(
    private readonly links: LinksService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
  ): Promise<LinkDto[]> {
    await this.links.primaryLinkId(this.db, tenant.tenantId, affiliateId);
    return this.links.list(affiliateId);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
    @ZodBody(createLinkBody) body: CreateLinkBody,
  ): Promise<LinkDto> {
    const id = await this.links.create(this.db, tenant.tenantId, affiliateId, body);
    const [link] = await this.links.list(affiliateId, [id]);
    return link!;
  }
}

@Controller('public/links')
export class PublicLinksController {
  constructor(private readonly links: LinksService) {}

  @Post(':code/click')
  @HttpCode(200)
  click(
    @Param('code') code: string,
    @ZodBody(recordClickBody) body: RecordClickBody,
    @Req() request: Request,
  ): Promise<ClickResultDto> {
    return this.links.recordClick(code, body, request.ip);
  }
}
