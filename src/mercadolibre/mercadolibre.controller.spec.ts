import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MercadolibreController } from './mercadolibre.controller';
import {
  MercadoLibreSeller,
  MercadolibreService,
} from './mercadolibre.service';

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let service: jest.Mocked<
    Pick<
      MercadolibreService,
      | 'createAuthorizationUrl'
      | 'verifyState'
      | 'exchangeCode'
      | 'getCurrentUser'
      | 'getAllPublications'
    >
  >;

  const seller: MercadoLibreSeller = {
    id: 123456,
    nickname: 'TEST_SELLER',
  };
  const publicationResult = {
    totalReported: 2,
    idsRetrieved: 2,
    publicationsRetrieved: 1,
    failed: 1,
    publications: [
      {
        id: 'MLA100',
        title: 'Test publication',
        price: 1200,
        seller_id: 123456,
        attributes: [{ id: 'BRAND', value_name: 'Test brand' }],
      },
    ],
    errors: [
      {
        id: 'MLA200',
        code: 404,
        body: { error: 'not_found', message: 'Item was not found' },
      },
    ],
  };

  beforeEach(async () => {
    service = {
      createAuthorizationUrl: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      getAllPublications: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MercadolibreController],
      providers: [{ provide: MercadolibreService, useValue: service }],
    }).compile();

    controller = module.get<MercadolibreController>(MercadolibreController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('connect', () => {
    it('returns the generated authorization URL for Nest to redirect', () => {
      const authorizationUrl =
        'https://auth.mercadolibre.com.ar/authorization?state=signed-state';
      service.createAuthorizationUrl.mockReturnValue(authorizationUrl);

      expect(controller.connect()).toEqual({ url: authorizationUrl });
      expect(service.createAuthorizationUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('callback', () => {
    it('validates state, completes OAuth and returns no token fields', async () => {
      service.verifyState.mockReturnValue(true);
      service.exchangeCode.mockResolvedValue('private-access-token');
      service.getCurrentUser.mockResolvedValue(seller);
      service.getAllPublications.mockResolvedValue(publicationResult);

      const result = await controller.callback(
        'authorization-code',
        'valid-state',
      );

      expect(service.verifyState).toHaveBeenCalledWith('valid-state');
      expect(service.exchangeCode).toHaveBeenCalledWith('authorization-code');
      expect(service.getCurrentUser).toHaveBeenCalledWith(
        'private-access-token',
      );
      expect(service.getAllPublications).toHaveBeenCalledWith(
        seller.id,
        'private-access-token',
      );
      expect(result).toEqual({
        seller,
        ...publicationResult,
      });
      expect(JSON.stringify(result)).not.toContain('private-access-token');
      expect(JSON.stringify(result)).not.toContain('refresh_token');
    });

    it('rejects invalid state before handling an OAuth provider error', async () => {
      service.verifyState.mockReturnValue(false);

      await expect(
        controller.callback(
          undefined,
          'invalid-state',
          'access_denied',
          'The resource owner denied the request',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(service.verifyState).toHaveBeenCalledWith('invalid-state');
      expect(service.exchangeCode).not.toHaveBeenCalled();
    });

    it('handles an OAuth provider error after validating state', async () => {
      service.verifyState.mockReturnValue(true);

      await expect(
        controller.callback(
          undefined,
          'valid-state',
          'access_denied',
          'The resource owner denied the request',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.verifyState).toHaveBeenCalledWith('valid-state');
      expect(service.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects a callback without an authorization code', async () => {
      service.verifyState.mockReturnValue(true);

      await expect(
        controller.callback(undefined, 'valid-state'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.exchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('webhook', () => {
    it('acknowledges the notification immediately', () => {
      expect(controller.webhook()).toEqual({ ok: true });
    });
  });
});
