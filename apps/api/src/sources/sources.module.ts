import { Module, type OnModuleInit } from '@nestjs/common';
import { Outbox } from '../outbox/outbox';
import { OperatorSourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  providers: [SourcesService],
  controllers: [OperatorSourcesController],
  exports: [SourcesService],
})
export class SourcesModule implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly sources: SourcesService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('booking.seats_confirmed', 'sources.confirm', (event, tx) =>
      this.sources.confirm(event, tx),
    );
  }
}
