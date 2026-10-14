import { Module } from '@nestjs/common';
import {
  AffiliateDiscountsController,
  OperatorDiscountsController,
  PublicDiscountsController,
} from './discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
  providers: [DiscountsService],
  controllers: [
    OperatorDiscountsController,
    AffiliateDiscountsController,
    PublicDiscountsController,
  ],
  exports: [DiscountsService],
})
export class DiscountsModule {}
