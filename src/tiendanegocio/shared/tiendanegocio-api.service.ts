import {
  BadGatewayException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const API_BASE_URL = 'https://developers.tiendanegocio.com/v1';
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = 'SAEL Panel (https://saeltendencia.online)';

/** Cliente oficial de Tienda Negocio: token siempre privado, sin rutas externas. */
@Injectable()
export class TiendaNegocioApiService {
  async get<T>(path: string, accessToken: string): Promise<T> {
    return this.request<T>('GET', path, accessToken);
  }

  async post<T>(path: string, body: unknown, accessToken: string): Promise<T> {
    return this.request<T>('POST', path, accessToken, body);
  }

  async put<T>(path: string, body: unknown, accessToken: string): Promise<T> {
    return this.request<T>('PUT', path, accessToken, body);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    accessToken: string,
    body?: unknown,
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') ||
      path.includes('..') || !accessToken.trim()) {
      throw new ServiceUnavailableException('Solicitud Tienda Negocio inválida');
    }
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: accessToken,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 402) {
          throw new HttpException('La tienda requiere renovar su suscripción', 402);
        }
        if (response.status === 429) {
          throw new HttpException('Tienda Negocio limitó las solicitudes. Reintentá luego.', 429);
        }
        throw new BadGatewayException(
          `Tienda Negocio rechazó la solicitud (HTTP ${response.status})`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException('No se pudo contactar a Tienda Negocio');
    }
  }
}
