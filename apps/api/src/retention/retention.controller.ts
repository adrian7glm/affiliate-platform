import { Controller, HttpCode, Inject, Put, UseGuards } from '@nestjs/common';
import {
  type AffiliateNotificationsBody,
  type AffiliateNotificationsDto,
  affiliateNotificationsBody,
} from '@ap/contracts';
import { type Database, affiliates } from '@ap/db';
import { eq } from 'drizzle-orm';
import { AuthGuard, CurrentAffiliate, Roles, TenantGuard } from '../common/auth';
import { ZodBody } from '../common/validation';
import { DB } from '../database/database.module';

/** The affiliate's own choice of messages about their sales and payouts. */
@Controller('affiliate/notifications')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateNotificationsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Put()
  @HttpCode(200)
  async update(
    @CurrentAffiliate() affiliateId: string,
    @ZodBody(affiliateNotificationsBody) body: AffiliateNotificationsBody,
  ): Promise<AffiliateNotificationsDto> {
    const [row] = await this.db
      .update(affiliates)
      .set({ notifySales: body.sales })
      .where(eq(affiliates.id, affiliateId))
      .returning({ notifySales: affiliates.notifySales });
    return { sales: row!.notifySales };
  }
}
