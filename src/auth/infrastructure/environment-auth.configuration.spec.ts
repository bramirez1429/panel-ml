import { ConfigService } from '@nestjs/config';
import { EnvironmentAuthConfiguration } from './environment-auth.configuration';

const VALID_VALUES: Record<string, string> = {
  JWT_ACCESS_SECRET: 'a-secure-test-secret-with-32-bytes',
  JWT_ISSUER: 'panel-ml-api',
  JWT_AUDIENCE: 'panel-ml',
  JWT_ACCESS_TTL: '15m',
  AUTH_SESSION_TTL: '24h',
};

function createConfiguration(
  overrides: Record<string, string | undefined> = {},
): EnvironmentAuthConfiguration {
  const values: Record<string, string | undefined> = {
    ...VALID_VALUES,
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return new EnvironmentAuthConfiguration(configService);
}

describe('EnvironmentAuthConfiguration', () => {
  it('expone una configuracion Auth validada y normalizada', () => {
    const configuration = createConfiguration({
      JWT_ISSUER: '  panel-ml-api  ',
      JWT_AUDIENCE: '  panel-ml  ',
    });

    expect(configuration).toMatchObject({
      jwtAccessSecret: VALID_VALUES.JWT_ACCESS_SECRET,
      jwtIssuer: 'panel-ml-api',
      jwtAudience: 'panel-ml',
      accessTokenTtlSeconds: 900,
      refreshSessionTtlMs: 86_400_000,
    });
  });

  it.each([
    ['ausente', undefined],
    ['vacio', '   '],
    ['menor a 32 bytes', 'a'.repeat(31)],
  ])('rechaza un JWT_ACCESS_SECRET %s', (_case, jwtAccessSecret) => {
    expect(() =>
      createConfiguration({ JWT_ACCESS_SECRET: jwtAccessSecret }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it.each(['JWT_ISSUER', 'JWT_AUDIENCE'])(
    'rechaza %s cuando no tiene contenido',
    (key) => {
      expect(() => createConfiguration({ [key]: '   ' })).toThrow(key);
    },
  );

  it.each(['14m', '16m', '899s', '901s', 'invalid'])(
    'rechaza JWT_ACCESS_TTL=%s porque no equivale a 15 minutos',
    (jwtAccessTtl) => {
      expect(() =>
        createConfiguration({ JWT_ACCESS_TTL: jwtAccessTtl }),
      ).toThrow(/JWT_ACCESS_TTL/);
    },
  );

  it('acepta duraciones equivalentes a 15 minutos', () => {
    expect(
      createConfiguration({ JWT_ACCESS_TTL: '900s' }).accessTokenTtlSeconds,
    ).toBe(900);
  });

  it.each(['0s', '25h', '86400001ms', 'invalid'])(
    'rechaza AUTH_SESSION_TTL=%s fuera del rango permitido',
    (authSessionTtl) => {
      expect(() =>
        createConfiguration({ AUTH_SESSION_TTL: authSessionTtl }),
      ).toThrow(/AUTH_SESSION_TTL/);
    },
  );

  it('permite una sesion menor a 24 horas', () => {
    expect(
      createConfiguration({ AUTH_SESSION_TTL: '12h' }).refreshSessionTtlMs,
    ).toBe(43_200_000);
  });
});
