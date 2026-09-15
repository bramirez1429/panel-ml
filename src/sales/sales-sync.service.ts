import { BadRequestException, Injectable } from '@nestjs/common';
import { MercadolibreSalesBackfillService } from './mercadolibre-sales-backfill.service';
import {
  RECENT_SALES_DEFAULT_HOURS,
  RECENT_SALES_MAX_HOURS,
} from './sales.types';

@Injectable()
export class SalesSyncService {
  constructor(
    private readonly mercadoLibre: MercadolibreSalesBackfillService,
  ) {}

  async sync(userId: string, hoursInput?: string) {
    const hours = parseHours(hoursInput);
    const mercadoLibre = await this.mercadoLibre.sync(userId, hours);

    return {
      hours,
      mercadoLibre,
    };
  }
}

function parseHours(value?: string): number {
  if (!value) return RECENT_SALES_DEFAULT_HOURS;

  const hours = Number(value);

  if (
    !Number.isSafeInteger(hours) ||
    hours < 1 ||
    hours > RECENT_SALES_MAX_HOURS
  ) {
    throw new BadRequestException(
      `hours debe ser un entero entre 1 y ${RECENT_SALES_MAX_HOURS}`,
    );
  }

  return hours;
}

