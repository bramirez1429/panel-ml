import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const SCAN_PAGE_SIZE = 100;
const MULTIGET_BATCH_SIZE = 20;
const MULTIGET_CONCURRENCY = 4;

type RequiredConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';

type MercadoLibreOperation =
  | 'tokenExchange'
  | 'currentUser'
  | 'publicationScanInitial'
  | 'publicationScanScroll';

export interface MercadoLibreRecord {
  [key: string]: unknown;
}

export interface MercadoLibreSeller {
  id: number;
  nickname: string;
}

export interface MercadoLibreItemError {
  id: string;
  code: number;
  body: unknown;
}

export interface MercadoLibreAllPublicationsResult {
  totalReported: number;
  idsRetrieved: number;
  publicationsRetrieved: number;
  failed: number;
  publications: MercadoLibreRecord[];
  errors: MercadoLibreItemError[];
}

interface MercadoLibreScanResult {
  ids: string[];
  totalReported: number;
}

interface MercadoLibreScanPage {
  results: string[];
  scrollId?: string;
  totalReported?: number;
}

interface MercadoLibreMultigetBatchResult {
  publications: MercadoLibreRecord[];
  errors: MercadoLibreItemError[];
}

@Injectable()
export class MercadolibreService {
  constructor(private readonly configService: ConfigService) {}

  createAuthorizationUrl(): string {
    const authorizationUrl = new URL(AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      redirect_uri: this.getRedirectUri(),
      state: this.createState(),
    }).toString();

    return authorizationUrl.toString();
  }

  verifyState(state: string): boolean {
    if (typeof state !== 'string') {
      return false;
    }

    const parts = state.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const [nonce, timestampValue, receivedSignature] = parts;
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
      !/^\d{13}$/.test(timestampValue) ||
      !/^[A-Za-z0-9_-]{43}$/.test(receivedSignature)
    ) {
      return false;
    }

    const timestamp = Number(timestampValue);
    const age = Date.now() - timestamp;
    if (!Number.isSafeInteger(timestamp) || age < 0 || age > STATE_TTL_MS) {
      return false;
    }

    const payload = `${nonce}.${timestampValue}`;
    const expectedSignature = this.signState(payload);
    const receivedBuffer = Buffer.from(receivedSignature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  }

  async exchangeCode(code: string): Promise<string> {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      client_secret: this.getRequiredConfig('ML_CLIENT_SECRET'),
      code,
      redirect_uri: this.getRedirectUri(),
    });

    const response = await this.requestJson(
      `${API_URL}/oauth/token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      'tokenExchange',
    );

    if (!isRecord(response) || !isNonEmptyString(response.access_token)) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una respuesta de autorización inválida',
      );
    }

    // Discard every other response field, including refresh_token.
    return response.access_token;
  }

  async getCurrentUser(accessToken: string): Promise<MercadoLibreSeller> {
    this.validateAccessToken(accessToken);

    const response = await this.requestJson(
      `${API_URL}/users/me`,
      { headers: this.createAuthorizationHeaders(accessToken) },
      'currentUser',
    );

    if (
      !isRecord(response) ||
      !isPositiveInteger(response.id) ||
      !isNonEmptyString(response.nickname)
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvió datos de vendedor inválidos',
      );
    }

    return { id: response.id, nickname: response.nickname };
  }

  async getAllPublications(
    userId: number,
    accessToken: string,
  ): Promise<MercadoLibreAllPublicationsResult> {
    if (!isPositiveInteger(userId)) {
      throw new BadRequestException(
        'El identificador del vendedor es inválido',
      );
    }
    this.validateAccessToken(accessToken);

    const scanResult = await this.scanAllPublicationIds(userId, accessToken);
    const batches = this.createMultigetBatches(scanResult.ids);
    const batchResults = await this.fetchMultigetBatches(batches, accessToken);
    const publications = batchResults.flatMap((result) => result.publications);
    const errors = batchResults.flatMap((result) => result.errors);

    return {
      totalReported: scanResult.totalReported,
      idsRetrieved: scanResult.ids.length,
      publicationsRetrieved: publications.length,
      failed: errors.length,
      publications,
      errors,
    };
  }

  private async scanAllPublicationIds(
    userId: number,
    accessToken: string,
  ): Promise<MercadoLibreScanResult> {
    const uniqueIds = new Set<string>();
    const seenPages = new Set<string>();
    let totalReported: number | undefined;
    let scrollId: string | undefined;
    let isInitialRequest = true;

    while (true) {
      const searchUrl = new URL(`${API_URL}/users/${userId}/items/search`);
      searchUrl.searchParams.set('search_type', 'scan');
      searchUrl.searchParams.set('limit', String(SCAN_PAGE_SIZE));
      if (!isInitialRequest && scrollId) {
        searchUrl.searchParams.set('scroll_id', scrollId);
      }

      const response = await this.requestJson(
        searchUrl.toString(),
        { headers: this.createAuthorizationHeaders(accessToken) },
        isInitialRequest ? 'publicationScanInitial' : 'publicationScanScroll',
      );
      const page = this.parsePublicationScanPage(response);

      if (totalReported === undefined && page.totalReported !== undefined) {
        totalReported = page.totalReported;
      }

      if (page.results.length === 0) {
        break;
      }

      if (!page.scrollId) {
        if (isInitialRequest) {
          throw new BadGatewayException(
            'Mercado Libre no devolvió un scroll_id para continuar la búsqueda',
          );
        }
      } else if (isInitialRequest) {
        scrollId = page.scrollId;
      }

      const pageSignature = [...page.results].sort().join('\u0000');
      if (seenPages.has(pageSignature)) {
        throw new BadGatewayException(
          'Mercado Libre repitió una página del scroll sin avanzar',
        );
      }
      seenPages.add(pageSignature);

      for (const id of page.results) {
        uniqueIds.add(id);
      }

      isInitialRequest = false;
    }

    const ids = Array.from(uniqueIds);
    return {
      ids,
      totalReported: totalReported ?? ids.length,
    };
  }

  private parsePublicationScanPage(response: unknown): MercadoLibreScanPage {
    if (!isRecord(response) || !('results' in response)) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una página de publicaciones inválida',
      );
    }

    let results: string[];
    if (response.results === null) {
      results = [];
    } else if (
      Array.isArray(response.results) &&
      response.results.every(isNonEmptyString)
    ) {
      results = response.results;
    } else {
      throw new BadGatewayException(
        'Mercado Libre devolvió IDs de publicaciones inválidos',
      );
    }

    const page: MercadoLibreScanPage = { results };
    if (isNonEmptyString(response.scroll_id)) {
      page.scrollId = response.scroll_id;
    }
    if (
      isRecord(response.paging) &&
      isNonNegativeInteger(response.paging.total)
    ) {
      page.totalReported = response.paging.total;
    }

    return page;
  }

  private createMultigetBatches(ids: string[]): string[][] {
    const batches: string[][] = [];
    let currentBatch: string[] = [];

    for (const id of ids) {
      currentBatch.push(id);
      if (currentBatch.length === MULTIGET_BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  private async fetchMultigetBatches(
    batches: string[][],
    accessToken: string,
  ): Promise<MercadoLibreMultigetBatchResult[]> {
    if (batches.length === 0) {
      return [];
    }

    const results = new Array<MercadoLibreMultigetBatchResult>(batches.length);
    let nextBatchIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        results[batchIndex] = await this.fetchMultigetBatch(
          batches[batchIndex],
          accessToken,
        );
      }
    };

    const workerCount = Math.min(MULTIGET_CONCURRENCY, batches.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
  }

  private async fetchMultigetBatch(
    ids: string[],
    accessToken: string,
  ): Promise<MercadoLibreMultigetBatchResult> {
    const detailsUrl = new URL(`${API_URL}/items`);
    detailsUrl.searchParams.set('ids', ids.join(','));

    let response: Response;
    try {
      response = await fetch(detailsUrl.toString(), {
        headers: this.createAuthorizationHeaders(accessToken),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      return {
        publications: [],
        errors: this.createBatchErrors(ids, timedOut ? 504 : 502, {
          message: timedOut
            ? 'La solicitud de detalles a Mercado Libre venció'
            : 'No se pudo conectar con Mercado Libre',
        }),
      };
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      return {
        publications: [],
        errors: this.createBatchErrors(
          ids,
          response.ok ? 502 : response.status,
          { message: 'Mercado Libre devolvió JSON inválido' },
        ),
      };
    }

    if (!response.ok) {
      return {
        publications: [],
        errors: this.createBatchErrors(
          ids,
          response.status,
          sanitizeSensitiveFields(body),
        ),
      };
    }

    return this.parseMultigetBody(body, ids);
  }

  private parseMultigetBody(
    response: unknown,
    requestedIds: string[],
  ): MercadoLibreMultigetBatchResult {
    if (!Array.isArray(response)) {
      return {
        publications: [],
        errors: this.createBatchErrors(requestedIds, 502, {
          message: 'Mercado Libre devolvió un multiget inválido',
        }),
      };
    }

    const publications: MercadoLibreRecord[] = [];
    const errors: MercadoLibreItemError[] = [];
    const requestedIdSet = new Set(requestedIds);
    const entryIndexById = new Map<string, number>();
    const reservedEntryIndexes = new Set<number>();
    const usedEntryIndexes = new Set<number>();

    for (let index = 0; index < response.length; index += 1) {
      const entry: unknown = response[index];
      if (!isRecord(entry) || !isRecord(entry.body)) {
        continue;
      }

      const responseId = entry.body.id;
      if (
        isNonEmptyString(responseId) &&
        requestedIdSet.has(responseId) &&
        !entryIndexById.has(responseId)
      ) {
        entryIndexById.set(responseId, index);
        reservedEntryIndexes.add(index);
      }
    }

    for (const id of requestedIds) {
      let entryIndex = entryIndexById.get(id);
      if (entryIndex === undefined) {
        entryIndex = response.findIndex(
          (_, candidateIndex) =>
            !reservedEntryIndexes.has(candidateIndex) &&
            !usedEntryIndexes.has(candidateIndex),
        );
      }

      if (entryIndex !== undefined && entryIndex < 0) {
        entryIndex = undefined;
      }

      const entry: unknown =
        entryIndex === undefined ? undefined : response[entryIndex];
      if (entryIndex !== undefined) {
        usedEntryIndexes.add(entryIndex);
      }

      if (!isRecord(entry)) {
        errors.push({
          id,
          code: 502,
          body: { message: 'Mercado Libre omitió este resultado del multiget' },
        });
        continue;
      }

      const code = isHttpStatus(entry.code) ? entry.code : 502;
      const body = 'body' in entry ? entry.body : null;

      if (
        code === 200 &&
        isRecord(body) &&
        isNonEmptyString(body.id) &&
        body.id === id
      ) {
        const sanitizedBody = sanitizeSensitiveFields(body);
        if (isRecord(sanitizedBody)) {
          publications.push(sanitizedBody);
          continue;
        }
      }

      if (code === 200) {
        errors.push({
          id,
          code: 502,
          body: sanitizeSensitiveFields(body),
        });
        continue;
      }

      errors.push({
        id,
        code,
        body: sanitizeSensitiveFields(body),
      });
    }

    return { publications, errors };
  }

  private createBatchErrors(
    ids: string[],
    code: number,
    body: unknown,
  ): MercadoLibreItemError[] {
    return ids.map((id) => ({ id, code, body }));
  }

  private createState(): string {
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now().toString();
    const payload = `${nonce}.${timestamp}`;

    return `${payload}.${this.signState(payload)}`;
  }

  private signState(payload: string): string {
    return createHmac('sha256', this.getStateSecret())
      .update(payload)
      .digest('base64url');
  }

  private getStateSecret(): string {
    const stateSecret = this.getRequiredConfig('ML_STATE_SECRET');
    if (Buffer.byteLength(stateSecret, 'utf8') < 32) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return stateSecret;
  }

  private getRedirectUri(): string {
    const redirectUri = this.getRequiredConfig('ML_REDIRECT_URI');

    try {
      const parsedUrl = new URL(redirectUri);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Unsupported redirect protocol');
      }
    } catch {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return redirectUri;
  }

  private getRequiredConfig(key: RequiredConfigKey): string {
    const value = this.configService.get<string>(key);
    if (!isNonEmptyString(value)) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return value.trim();
  }

  private validateAccessToken(accessToken: string): void {
    if (!isNonEmptyString(accessToken)) {
      throw new BadRequestException('El token de acceso es inválido');
    }
  }

  private createAuthorizationHeaders(accessToken: string): HeadersInit {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    operation: MercadoLibreOperation,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
    }

    if (!response.ok) {
      this.throwMercadoLibreError(operation, response.status);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new BadGatewayException(
        'Mercado Libre devolvió una respuesta inválida',
      );
    }
  }

  private throwMercadoLibreError(
    operation: MercadoLibreOperation,
    status: number,
  ): never {
    if (operation === 'tokenExchange' && (status === 400 || status === 401)) {
      throw new BadRequestException(
        'El código de autorización fue rechazado o venció',
      );
    }

    if (status === 401) {
      throw new UnauthorizedException(
        'El acceso a Mercado Libre es inválido o venció',
      );
    }

    if (status === 403) {
      throw new ForbiddenException(
        'Mercado Libre rechazó los permisos de la aplicación o del vendedor',
      );
    }

    if (status === 429) {
      throw new ServiceUnavailableException(
        'Mercado Libre limitó temporalmente las solicitudes',
      );
    }

    if (
      operation === 'publicationScanScroll' &&
      (status === 400 || status === 404)
    ) {
      throw new BadGatewayException(
        'El scroll_id de Mercado Libre está ausente o venció',
      );
    }

    if (status >= 500) {
      throw new BadGatewayException(
        'Mercado Libre tuvo un error interno al procesar la solicitud',
      );
    }

    throw new BadGatewayException(
      'Mercado Libre no pudo completar la solicitud',
    );
  }
}

function isRecord(value: unknown): value is MercadoLibreRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isTimeoutError(error: unknown): boolean {
  return isRecord(error) && error.name === 'TimeoutError';
}

function sanitizeSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSensitiveFields);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: MercadoLibreRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key
      .toLowerCase()
      .replaceAll('_', '')
      .replaceAll('-', '');
    if (
      normalizedKey === 'accesstoken' ||
      normalizedKey === 'refreshtoken' ||
      normalizedKey === 'clientsecret' ||
      normalizedKey === 'authorization'
    ) {
      continue;
    }

    sanitized[key] = sanitizeSensitiveFields(nestedValue);
  }

  return sanitized;
}
