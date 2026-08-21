import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

export function configureApp(app: NestExpressApplication): void {
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: true,
    }),
  );

  const configService = app.get(ConfigService);
  const allowedOrigins = parseAllowedOrigins(
    configService.get<string>('CORS_ORIGINS'),
  );
  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
    });
  }

  const trustProxyHops = parseTrustProxyHops(
    configService.get<string>('TRUST_PROXY_HOPS'),
  );
  if (trustProxyHops !== null) app.set('trust proxy', trustProxyHops);
}

function parseAllowedOrigins(value?: string): string[] {
  if (!value?.trim()) return [];

  return value.split(',').map((candidate) => {
    const trimmed = candidate.trim();
    const url = new URL(trimmed);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== trimmed.replace(/\/$/, '')
    ) {
      throw new Error(
        'CORS_ORIGINS debe contener or\u00edgenes HTTP(S) exactos',
      );
    }
    return url.origin;
  });
}

function parseTrustProxyHops(value?: string): number | null {
  if (!value?.trim()) return null;

  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 1 y 10');
  }
  return hops;
}
