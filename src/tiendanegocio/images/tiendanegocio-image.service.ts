import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { TiendaNegocioApiService } from '../shared/tiendanegocio-api.service';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 9;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ImageResult = Readonly<{ id: number; src: string; position: number }>;

@Injectable()
export class TiendaNegocioImageService {
  constructor(private readonly api: TiendaNegocioApiService) {}

  /** Imágenes se cargan luego del POST /products; nunca aceptar URLs arbitrarias. */
  async uploadAll(
    productId: number,
    images: readonly string[],
    token: string,
  ): Promise<readonly ImageResult[]> {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new BadRequestException('ID de producto inválido');
    }
    const uploaded: ImageResult[] = [];
    for (const [position, src] of [...new Set(images)].slice(0, MAX_IMAGES).entries()) {
      const file = await this.toDataUri(src);
      const response = await this.api.post<unknown>(
        `/products/${productId}/images`,
        { position, file },
        token,
      );
      if (!isRecord(response) || !Number.isSafeInteger(response.id) ||
        typeof response.src !== 'string') {
        throw new BadGatewayException('Tienda Negocio no confirmó la imagen cargada');
      }
      uploaded.push({ id: response.id as number, src: response.src, position });
    }
    return uploaded;
  }

  private async toDataUri(src: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      throw new BadRequestException('URL de imagen inválida');
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' ||
      (host !== 'mlstatic.com' && !host.endsWith('.mlstatic.com'))) {
      throw new BadRequestException('Solo se permiten imágenes de Mercado Libre');
    }
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
    } catch {
      throw new BadGatewayException('No se pudo descargar la imagen de Mercado Libre');
    }
    if (!response.ok) throw new BadGatewayException('Imagen de origen no disponible');
    const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
    const length = Number(response.headers.get('content-length') ?? '0');
    if (!ALLOWED_TYPES.has(contentType) || length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Formato o tamaño de imagen no admitido');
    }
    const bytes = await this.readLimited(response);
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  private async readLimited(response: Response): Promise<Buffer> {
    if (!response.body) throw new BadGatewayException('Imagen vacía');
    const reader = response.body.getReader();
    const parts: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          throw new BadRequestException('Imagen demasiado grande');
        }
        parts.push(Buffer.from(value));
      }
      if (total === 0) throw new BadRequestException('Imagen vacía');
      return Buffer.concat(parts);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
