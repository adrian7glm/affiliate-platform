import { Global, Module } from '@nestjs/common';
import { Outbox } from './outbox';

@Global()
@Module({ providers: [Outbox], exports: [Outbox] })
export class OutboxModule {}
