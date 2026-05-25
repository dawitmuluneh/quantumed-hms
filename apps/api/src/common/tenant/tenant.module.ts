import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RequireTenantGuard } from './require-tenant.guard';
import { TenantContextService } from './tenant-context.service';
import { TenantMiddleware } from './tenant.middleware';

@Global()
@Module({
  providers: [TenantContextService, RequireTenantGuard],
  exports: [TenantContextService, RequireTenantGuard],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
