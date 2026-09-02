import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './configure-app';

describe('configureApp CORS', () => {
  it('habilita credenciales solo para los origenes exactos configurados', () => {
    const enableCors = jest.fn();
    const useBodyParser = jest.fn();
    const configService = {
      get: jest.fn((key: string) =>
        key === 'CORS_ORIGINS'
          ? 'https://panel.example.com,http://localhost:3001'
          : undefined,
      ),
    } as unknown as ConfigService;
    const app = {
      use: jest.fn(),
      useBodyParser,
      useGlobalPipes: jest.fn(),
      get: jest.fn().mockReturnValue(configService),
      enableCors,
      set: jest.fn(),
    } as unknown as NestExpressApplication;

    configureApp(app);

    expect(useBodyParser).toHaveBeenCalledWith('json', { limit: '5mb' });
    expect(enableCors).toHaveBeenCalledWith({
      origin: ['https://panel.example.com', 'http://localhost:3001'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: true,
    });
  });
});
