import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';

const API_BASE = 'https://developers.tiendanegocio.com/v1';
const USER_AGENT = 'SAEL Sync (https://saeltendencia.com.ar)';

type Product = Record<string, unknown>;
type ListResponse = {
  results: Product[];
  pagination: { next_page: string | null };
};

/**
 * Low-level Tienda Negocio adapter. Auth tokens must come from a store-scoped,
 * server-side OAuth connection; never accept them from browser input.
 * The preview controller intentionally does not invoke mutation methods.
 */
@Injectable()
export class TiendaNegocioApiClient {
  async listProducts(accessToken: string, page = 1): Promise<ListResponse> {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Página inválida');
    return this.request<ListResponse>('GET', `/products?page=${page}&per_page=100`, accessToken);
  }

  async createProduct(accessToken: string, product: Product): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', '/products', accessToken, product);
  }

  async updateProduct(accessToken: string, id: number, product: Product): Promise<unknown> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID de producto inválido');
    return this.request('PUT', `/products/${id}`, accessToken, product);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    accessToken: string,
    body?: Product,
  ): Promise<T> {
    if (!accessToken?.trim()) throw new Error('Falta token OAuth de Tienda Negocio');
    // Never follow arbitrary next_page URLs or send credentials to third-party hosts.
    const url = new URL(path, API_BASE + '/');
    if (url.origin !== 'https://developers.tiendanegocio.com' ||
      !url.pathname.startsWith('/v1/'))
      throw new Error('Destino API inválido');

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: accessToken,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo conectar con Tienda Negocio');
    }
    if (response.status === 402)
      throw new HttpException('La tienda requiere renovar la suscripción', 402);
    if (response.status === 429)
      throw new HttpException('Límite de API: reintentar más tarde', 429);
    if (!response.ok)
      throw new HttpException('Tienda Negocio rechazó la operación', response.status);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('Respuesta API inválida');
    }
  }
}
