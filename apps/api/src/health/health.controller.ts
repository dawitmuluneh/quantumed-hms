import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { SkipTenant } from '../common/tenant/skip-tenant.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipTenant()
  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @SkipTenant()
  @Get('health/ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, 'ok' | 'fail'> }> {
    const checks: Record<string, 'ok' | 'fail'> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    const allOk = Object.values(checks).every((v) => v === 'ok');
    return { status: allOk ? 'ok' : 'degraded', checks };
  }
}
