import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import type {
  TiendanubeCategory,
  TiendanubeStoreSummary,
} from './tiendanube-category.types';

@Injectable()
export class TiendanubeCategoriesService {
  constructor(
    private readonly connections: TiendanubeConnectionRepository,
    private readonly api: TiendanubeApiService,
  ) {}

  async listByUserId(userId: string): Promise<readonly TiendanubeCategory[]> {
    const connection = await this.connections.findCredentialsByUserId(userId);
    if (!connection?.accessToken.trim())
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    const result = new Map<number, TiendanubeCategory>();
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.api.get<unknown>(
        connection.storeId,
        `/categories?page=${page}&per_page=200`,
        connection.accessToken,
      );
      const rows = parseRows(response);
      for (const row of rows) result.set(row.id, row);
      if (rows.length < 200) break;
    }
    return [...result.values()];
  }

  async storeSummaryByUserId(userId: string): Promise<TiendanubeStoreSummary> {
    const connection = await this.connections.findCredentialsByUserId(userId);
    if (!connection?.accessToken.trim())
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    const response = await this.api.get<unknown>(
      connection.storeId,
      '/store',
      connection.accessToken,
    );
    if (
      !isObject(response) ||
      typeof response.plan_name !== 'string' ||
      !response.plan_name.trim()
    )
      throw new BadGatewayException('Tiendanube devolvió un resumen inválido');
    return { planName: response.plan_name.trim() };
  }
}

function parseRows(value: unknown): readonly TiendanubeCategory[] {
  if (!Array.isArray(value))
    throw new BadGatewayException('Tiendanube devolvió categorías inválidas');
  return value.map(parseCategory);
}

function parseCategory(value: unknown): TiendanubeCategory {
  if (!isObject(value) || !positiveInt(value.id))
    throw new BadGatewayException('Tiendanube devolvió categorías inválidas');
  const name = localizedName(value.name);
  if (!name)
    throw new BadGatewayException('Tiendanube devolvió categorías inválidas');
  const parent =
    value.parent_id ?? (isObject(value.parent) ? value.parent.id : null);
  return {
    id: value.id,
    name,
    parentId:
      parent === null || parent === undefined
        ? null
        : positiveInt(parent)
          ? parent
          : null,
  };
}

function localizedName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isObject(value)) return null;
  const values = [value.es, ...Object.values(value)];
  const found = values.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  );
  return found?.trim() ?? null;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
