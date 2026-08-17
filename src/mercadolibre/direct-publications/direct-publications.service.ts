import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';

type SearchResponse = {
  seller_id: string;
  results: string[];
  paging: {
    limit: number;
    offset: number;
    total: number;
  };
};

type ItemResponse = {
  code: number;
  body: {
    id: string;
    title?: string;
    family_name?: string | null;
    family_id?: number | null;
    user_product_id?: string | null;
    variations?: unknown[];
    price?: number;
    available_quantity?: number;
    status?: string;
  };
};

@Injectable()
export class DirectPublicationsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Trae hasta 20 publicaciones directamente desde Mercado Libre. */
  async getPublications(limit = 20, offset = 0) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException(
        'limit debe ser un entero entre 1 y 20',
      );
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException(
        'offset debe ser un entero mayor o igual a cero',
      );
    }

    const connection = await this.tokenService.getStoredConnection();

    const search = await this.apiService.get<SearchResponse>(
      `/users/${connection.seller_id}/items/search?limit=${limit}&offset=${offset}`,
      connection.access_token,
    );

    if (search.results.length === 0) {
      return {
        paging: search.paging,
        publications: [],
      };
    }

    const ids = search.results.join(',');

    const items = await this.apiService.get<ItemResponse[]>(
      `/items?ids=${ids}`,
      connection.access_token,
    );

    const publications = items
      .filter(({ code }) => code === 200)
      .map(({ body }) => ({
        ...body,
        model: body.family_name
          ? 'VARIANT_PRICING'
          : 'SHARED',
      }));

    return {
      paging: search.paging,
      count: publications.length,
      publications,
    };
  }
}