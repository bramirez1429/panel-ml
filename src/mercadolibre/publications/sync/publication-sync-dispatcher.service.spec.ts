import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { waitUntil } from '@vercel/functions';
import {
  PUBLICATION_SYNC_INTERNAL_SECRET_HEADER,
  PublicationSyncDispatcherService,
} from './publication-sync-dispatcher.service';

jest.mock('@vercel/functions', () => ({
  waitUntil: jest.fn(),
}));

const SYNC_ID = '11111111-1111-4111-8111-111111111111';
const INTERNAL_SECRET = 'private-internal-secret';
const PROTECTION_SECRET = 'private-vercel-protection-secret';
const waitUntilMock = jest.mocked(waitUntil);

/** Crea el servicio con variables de entorno controladas. */
function setup(values: Record<string, string | undefined>) {
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return new PublicationSyncDispatcherService(configService);
}

describe('PublicationSyncDispatcherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usa waitUntil y el deployment actual en Vercel', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const service = setup({
      SYNC_INTERNAL_SECRET: INTERNAL_SECRET,
      VERCEL_AUTOMATION_BYPASS_SECRET: PROTECTION_SECRET,
      VERCEL_URL: 'api-preview.vercel.app',
    });

    service.defer(SYNC_ID, service.dispatchNext(SYNC_ID));

    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    await waitUntilMock.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api-preview.vercel.app/mercadolibre/publicaciones/sync/${SYNC_ID}/internal-next`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          [PUBLICATION_SYNC_INTERNAL_SECRET_HEADER]: INTERNAL_SECRET,
          'x-vercel-protection-bypass': PROTECTION_SECRET,
        },
      },
    );
  });

  it('usa fire-and-forget contra Nest local', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const service = setup({
      PORT: '3100',
      SYNC_INTERNAL_SECRET: INTERNAL_SECRET,
    });

    service.defer(SYNC_ID, service.dispatchNext(SYNC_ID));
    await new Promise((resolve) => setImmediate(resolve));

    expect(waitUntilMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:3100/mercadolibre/publicaciones/sync/${SYNC_ID}/internal-next`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('valida el secreto sin aceptar valores parciales', () => {
    const service = setup({
      SYNC_INTERNAL_SECRET: INTERNAL_SECRET,
    });

    expect(() => service.assertInternalSecret(INTERNAL_SECRET)).not.toThrow();
    expect(() =>
      service.assertInternalSecret(`${INTERNAL_SECRET}-invalid`),
    ).toThrow(UnauthorizedException);
    expect(() => service.assertInternalSecret(undefined)).toThrow(
      UnauthorizedException,
    );
  });

  it('exige configurar el secreto interno', () => {
    const service = setup({});

    expect(() => service.assertInternalSecret(undefined)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('no registra el secreto ni el body de una falla', async () => {
    const privateBody = 'body-with-private-information';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(privateBody, { status: 503 }));
    const logMock = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const service = setup({
      SYNC_INTERNAL_SECRET: INTERNAL_SECRET,
      VERCEL_URL: 'api.vercel.app',
    });

    service.defer(SYNC_ID, service.dispatchNext(SYNC_ID));
    await waitUntilMock.mock.calls[0][0];

    const logs = JSON.stringify(logMock.mock.calls);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(logs).toContain(SYNC_ID);
    expect(logs).toContain('HTTP 503');
    expect(logs).not.toContain(INTERNAL_SECRET);
    expect(logs).not.toContain(PROTECTION_SECRET);
    expect(logs).not.toContain(privateBody);
  });
});
