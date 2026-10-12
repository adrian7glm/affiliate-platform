import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { FakeGateway } from './fake.gateway';
import { PaymentsGateway } from './gateway';
import { StripeGateway } from './stripe.gateway';

@Module({
  providers: [
    {
      provide: PaymentsGateway,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentsGateway =>
        config.PAYMENTS_PROVIDER === 'stripe' ? new StripeGateway(config) : new FakeGateway(config),
    },
  ],
  exports: [PaymentsGateway],
})
export class PaymentsModule {}
