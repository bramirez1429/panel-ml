import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { MercadoLibrePublication } from '../publication.types';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../publication.constants';
import { mapWithConcurrency } from '../sync/publication-sync.helpers';
import {
  normalizePricesResponse,
  normalizeSalePrice,
  selectPrice,
} from './publication-prices.helpers';

export type OfficialPublicationPrice = Readonly<{
  publication: MercadoLibrePublication;
  standardPrice: number;
  salePrice: number;
}>;

@Injectable()
export class PublicationOfficialPriceService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Incorpora el precio standard oficial de marketplace a un MLA vivo. */
  async hydrate(
    publication: MercadoLibrePublication,
    accessToken: string,
  ): Promise<MercadoLibrePublication> {
    return (await this.read(publication, accessToken)).publication;
  }

  /** Lee precios standard y de venta actuales para un MLA vivo. */
  async read(
    publication: MercadoLibrePublication,
    accessToken: string,
  ): Promise<OfficialPublicationPrice> {
    const itemId = publicationItemId(publication);
    const encoded = encodeURIComponent(itemId);
    const [pricesResponse, saleResponse] = await Promise.all([
      this.apiService.getOptional<unknown>(
        `/items/${encoded}/prices`,
        accessToken,
      ),
      this.apiService.getOptional<unknown>(
        `/items/${encoded}/sale_price?context=channel_marketplace`,
        accessToken,
      ),
    ]);
    if (pricesResponse === null || saleResponse === null) {
      throw new NotFoundException('Mercado Libre no encontró el precio del item');
    }
    const standard = selectPrice(
      normalizePricesResponse(pricesResponse, itemId),
      'standard',
    );
    const sale = normalizeSalePrice(saleResponse);
    if (!standard) {
      throw new BadGatewayException(
        'Mercado Libre no informó el precio standard del item',
      );
    }
    return {
      publication: {
        ...publication,
        price: sale.amount,
        currency_id:
          sale.currencyId ?? standard.currencyId ?? publication.currency_id,
      },
      standardPrice: standard.amount,
      salePrice: sale.amount,
    };
  }

  /** Incorpora precios oficiales con concurrencia acotada. */
  async hydrateMany(
    publications: MercadoLibrePublication[],
    accessToken: string,
  ): Promise<MercadoLibrePublication[]> {
    return mapWithConcurrency(
      publications,
      PUBLICATION_REQUEST_CONCURRENCY,
      (publication) => this.hydrate(publication, accessToken),
    );
  }
}

function publicationItemId(publication: MercadoLibrePublication): string {
  if (typeof publication.id !== 'string' || !/^MLA\d+$/.test(publication.id)) {
    throw new BadGatewayException('La publicacion no tiene un MLA valido');
  }
  return publication.id;
}
