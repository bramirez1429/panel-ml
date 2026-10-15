import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { TiendanubeMigrationQueue } from './tiendanube-migration.queue';
import { TiendanubeMigrationService } from './tiendanube-migration.service';
import type { TiendanubeMigrationItemStatus } from './tiendanube-migration.types';

@Controller('tiendanube/migration')
@UseGuards(AccessTokenGuard)
export class TiendanubeMigrationController {
  constructor(
    private readonly migrationService: TiendanubeMigrationService,
    private readonly queue: TiendanubeMigrationQueue,
  ) {}

  @Post('start')
  @Header('Cache-Control', 'no-store')
  async start(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    const started = await this.migrationService.start(
      user.id,
      parseTestLimit(body),
    );
    await this.queue.enqueue({
      jobId: started.job.id,
      executionToken: started.executionToken,
    });
    return started.job;
  }

  @Get('active')
  @Header('Cache-Control', 'no-store')
  active(@CurrentUser() user: SafeUser) {
    return this.migrationService.getActive(user.id);
  }

  @Get(':id/items')
  @Header('Cache-Control', 'no-store')
  items(
    @CurrentUser() user: SafeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.migrationService.getItems(
      user.id,
      id,
      parseStatus(status),
      parsePositiveInt(page, 1, 1, 1_000_000),
      parsePositiveInt(limit, 20, 1, 100),
    );
  }

  @Post(':id/resume')
  @Header('Cache-Control', 'no-store')
  async resume(
    @CurrentUser() user: SafeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const mode = parseResumeMode(body);
    const resumed = await this.migrationService.resume(user.id, id);
    await this.queue.enqueue({
      jobId: id,
      mode,
      executionToken: resumed.executionToken,
    });
    return resumed.job;
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: SafeUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.migrationService.getJob(user.id, id);
  }
}

function parseStatus(value: string): TiendanubeMigrationItemStatus {
  if (value === 'APPROVED' || value === 'REJECTED') return value;
  throw new BadRequestException('status debe ser APPROVED o REJECTED');
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value))
    throw new BadRequestException('Parámetro de paginación inválido');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException('Parámetro de paginación fuera de rango');
  }
  return parsed;
}

function parseTestLimit(value: unknown): 1 | 5 | 10 | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Body de inicio inválido');
  }
  const limit = (value as { testLimit?: unknown }).testLimit;
  if (limit === undefined) return null;
  if (limit === 1 || limit === 5 || limit === 10) return limit;
  throw new BadRequestException('testLimit debe ser 1, 5 o 10');
}

function parseResumeMode(value: unknown): 'CONTINUE' | 'SINGLE_ITEM' {
  if (value === undefined || value === null || value === '') return 'CONTINUE';
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Body de reanudación inválido');
  }
  const singleProduct = (value as { singleProduct?: unknown }).singleProduct;
  if (singleProduct === undefined || singleProduct === false) return 'CONTINUE';
  if (singleProduct === true) return 'SINGLE_ITEM';
  throw new BadRequestException('singleProduct debe ser booleano');
}
