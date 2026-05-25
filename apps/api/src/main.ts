import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { RbacGuard } from './common/rbac/rbac.guard';
import { AuthGuard } from './modules/identity/guards/auth.guard';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const port = Number(config.get('PORT_API') ?? 4000);

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(app.get(AuthGuard), new RbacGuard(reflector));
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('QuantuMed HMS API')
    .setDescription('Multi-tenant hospital management platform — Phase A foundation')
    .setVersion('0.0.1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://0.0.0.0:${port} (docs at /api/docs)`);
}

void bootstrap();
