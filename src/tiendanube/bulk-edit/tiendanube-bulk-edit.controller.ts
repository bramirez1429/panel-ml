import { BadRequestException, Body, Controller, Get, NotImplementedException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { BulkEditChanges } from './tiendanube-bulk-edit.types';
import { TiendanubeBulkEditService } from './tiendanube-bulk-edit.service';

@Controller(['tiendanube/bulk-edit', 'tiendanube/bulk-edition'])
@UseGuards(AccessTokenGuard)
export class TiendanubeBulkEditController {
  constructor(private readonly service: TiendanubeBulkEditService) {}
  @Get('categories') categories(@CurrentUser() user: SafeUser) { return this.service.categoriesByUser(user.id); }
  @Get('categories/:categoryId/summary') summary(@CurrentUser() user: SafeUser, @Param('categoryId') categoryId: string) { return this.service.summary(user.id, categoryId); }
  @Post('preview') preview(@CurrentUser() user: SafeUser, @Body() body: { categoryId?: unknown; changes?: unknown }) { return this.service.preview(user.id, { categoryId: categoryId(body.categoryId), changes: changes(body.changes) }); }
  @Post('jobs') async create(@CurrentUser() user: SafeUser, @Body() body: { snapshotId?: unknown }) { return { id: await this.service.createJob(user.id, uuid(body.snapshotId)) }; }
  @Get('jobs/active') active(@CurrentUser() user: SafeUser) { return this.service.activeJob(user.id); }
  @Get('jobs/:jobId') job(@Param('jobId', ParseUUIDPipe) _jobId: string): never { throw new NotImplementedException('El worker de edición masiva aún no está implementado'); }
  @Get('jobs/:jobId/failures') failures(@Param('jobId', ParseUUIDPipe) _jobId: string): never { throw new NotImplementedException('El worker de edición masiva aún no está implementado'); }
  @Post('jobs/:jobId/retry-failures') retry(@Param('jobId', ParseUUIDPipe) _jobId: string): never { throw new NotImplementedException('El worker de edición masiva aún no está implementado'); }
}
function categoryId(value: unknown): string { if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw new BadRequestException('categoryId inválido'); return value; }
function uuid(value: unknown): string { if (typeof value !== 'string') throw new BadRequestException('snapshotId inválido'); return value; }
function changes(value: unknown): BulkEditChanges { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('changes inválidos'); const v = value as Record<string, unknown>; return { ...(decimal(v.price, 'price')), ...(decimal(v.promotionalPrice, 'promotionalPrice')), ...(typeof v.stock === 'number' ? { stock: v.stock } : {}), ...(typeof v.locationId === 'string' ? { locationId: v.locationId } : {}) }; }
function decimal(value: unknown, field: 'price' | 'promotionalPrice'): Partial<BulkEditChanges> { if (value === undefined || value === null || value === '') return {}; if (typeof value !== 'string' && typeof value !== 'number') throw new BadRequestException(`${field} inválido`); const normalized = String(value).trim().replace(',', '.'); return field === 'price' ? { price: normalized } : { promotionalPrice: normalized }; }
