import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, NEST_APPLICATION_OPTIONS } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    NEST_APPLICATION_OPTIONS,
  );
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
