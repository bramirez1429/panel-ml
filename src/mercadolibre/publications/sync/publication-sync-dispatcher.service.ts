import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { waitUntil } from '@vercel/functions';
import { createHash, timingSafeEqual } from 'node:crypto';

export const PUBLICATION_SYNC_INTERNAL_SECRET_HEADER = 'x-sync-internal-secret';
const INTERNAL_NEXT_PATH = '/mercadolibre/publicaciones/sync';
const VERCEL_PROTECTION_HEADER = 'x-vercel-protection-bypass';
const MAX_DISPATCH_ATTEMPTS = 3;
const RETRYABLE_DISPATCH_STATUSES = new Set([429, 500, 502, 503, 504]);

@Injectable()
export class PublicationSyncDispatcherService {
  private readonly logger = new Logger(PublicationSyncDispatcherService.name);

  /** Recibe la configuración del despacho interno. */
  constructor(private readonly configService: ConfigService) {}

  /** Conserva una tarea activa después de responder la solicitud actual. */
  defer(syncId: string, task: Promise<unknown>): void {
    const safeTask = task.catch((error: unknown) => {
      this.logDispatchError(syncId, error);
    });

    if (this.isVercelRuntime()) {
      waitUntil(safeTask);
      return;
    }

    void safeTask;
  }

  /** Dispara el siguiente batch mediante una nueva solicitud HTTP. */
  async dispatchNext(syncId: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_DISPATCH_ATTEMPTS; attempt += 1) {
      try {
        await this.requestNext(syncId);
        return;
      } catch (error) {
        if (!shouldRetryDispatch(error, attempt)) {
          throw error;
        }
      }
    }
  }

  /** Verifica el secreto recibido por la ruta interna. */
  assertInternalSecret(receivedSecret: string | undefined): void {
    const expectedSecret = this.internalSecret();

    if (!receivedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
      throw new UnauthorizedException('Solicitud interna no autorizada');
    }
  }

  /** Ejecuta el POST interno sin leer ni registrar su respuesta. */
  private async requestNext(syncId: string): Promise<void> {
    const response = await fetch(this.internalUrl(syncId), {
      method: 'POST',
      redirect: 'error',
      headers: this.internalHeaders(),
    });

    if (!response.ok) {
      throw new DispatchHttpError(response.status);
    }
  }

  /** Construye una URL del deployment actual o del servidor local. */
  private internalUrl(syncId: string): string {
    const host = this.vercelHost();
    if (!host && this.isVercelRuntime()) {
      throw new ServiceUnavailableException(
        'La URL interna de Vercel no está disponible',
      );
    }

    const baseUrl = host
      ? `https://${host}`
      : `http://127.0.0.1:${this.localPort()}`;

    return new URL(
      `${INTERNAL_NEXT_PATH}/${encodeURIComponent(syncId)}/internal-next`,
      baseUrl,
    ).toString();
  }

  /** Obtiene el host confiable asignado por Vercel. */
private vercelHost(): string | undefined {
  return (
    this.configService.get<string>('VERCEL_PROJECT_PRODUCTION_URL') ??
    this.configService.get<string>('VERCEL_URL')
  );
}

  /** Indica si la solicitud corre dentro de una Function de Vercel. */
  private isVercelRuntime(): boolean {
    return Boolean(
      this.vercelHost() || this.configService.get<string>('VERCEL') === '1',
    );
  }

  /** Obtiene el puerto usado por Nest durante desarrollo local. */
  private localPort(): string {
    return this.configService.get<string>('PORT') ?? '3000';
  }

  /** Exige que el secreto interno exista y no esté vacío. */
  private internalSecret(): string {
    const secret = this.configService.get<string>('SYNC_INTERNAL_SECRET');

    if (!secret) {
      throw new ServiceUnavailableException(
        'El despacho interno no está configurado',
      );
    }

    return secret;
  }

  /** Agrega autenticación interna y el bypass opcional de Vercel. */
  private internalHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [PUBLICATION_SYNC_INTERNAL_SECRET_HEADER]: this.internalSecret(),
    };
    const protectionSecret = this.configService.get<string>(
      'VERCEL_AUTOMATION_BYPASS_SECRET',
    );

    if (protectionSecret) {
      headers[VERCEL_PROTECTION_HEADER] = protectionSecret;
    }

    return headers;
  }

  /** Registra solamente el job y el estado HTTP seguro. */
  private logDispatchError(syncId: string, error: unknown): void {
    const status =
      error instanceof DispatchHttpError ? ` HTTP ${error.status}` : '';

    this.logger.error(
      `No se pudo despachar la sincronización ${syncId}.${status}`,
    );
  }
}

/** Conserva solamente el status de una respuesta interna fallida. */
class DispatchHttpError extends Error {
  constructor(readonly status: number) {
    super('Falló el despacho HTTP interno');
  }
}

/** Compara secretos con buffers de longitud constante. */
function secretsMatch(received: string, expected: string): boolean {
  const receivedHash = hashSecret(received);
  const expectedHash = hashSecret(expected);

  return timingSafeEqual(receivedHash, expectedHash);
}

/** Genera un hash fijo para la comparación segura. */
function hashSecret(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Limita los reintentos del self-request a errores temporales. */
function shouldRetryDispatch(error: unknown, attempt: number): boolean {
  if (attempt >= MAX_DISPATCH_ATTEMPTS) {
    return false;
  }

  return error instanceof DispatchHttpError
    ? RETRYABLE_DISPATCH_STATUSES.has(error.status)
    : error instanceof TypeError;
}
