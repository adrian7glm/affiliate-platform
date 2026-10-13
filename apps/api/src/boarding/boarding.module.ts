import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OperatorScannersController, ScannerController } from './scanners.controller';
import { ScannersService } from './scanners.service';

/** Boarding staff: scanner accounts and their screen. The scan itself lives in BookingModule. */
@Module({
  imports: [IdentityModule],
  providers: [ScannersService],
  controllers: [OperatorScannersController, ScannerController],
})
export class BoardingModule {}
