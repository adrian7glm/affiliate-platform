import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import type { AdminSystemDto } from '@ap/contracts';
import { AuthGuard } from '../common/auth';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SystemService } from './system.service';

@Controller('admin/system')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminSystemController {
  constructor(private readonly system: SystemService) {}

  @Get()
  overview(): Promise<AdminSystemDto> {
    return this.system.overview();
  }

  @Post('events/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseIntPipe) id: number): Promise<AdminSystemDto> {
    return this.system.retry(id);
  }
}
