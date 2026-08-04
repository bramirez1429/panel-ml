import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MercadolibreController } from './mercadolibre.controller';
import { MercadolibreService } from './mercadolibre.service';
import {
  CreatePriceDiscountDto,
  ReplaceDealDto,
  UpdatePriceDto,
  UpdatePricingDto,
} from './update-price.dto';

type ServiceMock = jest.Mocked<
  Pick<
    MercadolibreService,
    | 'createAuthorizationUrl'
    | 'verifyState'
    | 'exchangeCode'
    | 'getCurrentUser'
    | 'saveTokens'
    | 'getPublicationsPage'
    | 'getPublication'
    | 'updatePublicationPrice'
    | 'getItemPromotions'
    | 'getUserProductPrices'
    | 'updatePublicationPricing'
    | 'createPublicationPriceDiscount'
    | 'replaceDealWithPriceDiscount'
  >
>;

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      createAuthorizationUrl: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      saveTokens: jest.fn(),
      getPublicationsPage: jest.fn(),
      getPublication: jest.fn(),
      updatePublicationPrice: jest.fn(),
      getItemPromotions: jest.fn(),
      getUserProductPrices: jest.fn(),
      updatePublicationPricing: jest.fn(),
      createPublicationPriceDiscount: jest.fn(),
      replaceDealWithPriceDiscount: jest.fn(),
    };
    controller = new MercadolibreController(
      service as unknown as MercadolibreService,
    );
  });

  it('returns the authorization URL from connect', () => {
    const url =
      'https://auth.mercadolibre.com.ar/authorization?state=signed-state';
    service.createAuthorizationUrl.mockReturnValue(url);

    expect(controller.connect()).toEqual({ url });
    expect(service.createAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it('completes OAuth without loading publications or returning the token', async () => {
    const seller = { id: 123456, nickname: 'TEST_SELLER' };
    const tokens = {
      access_token: 'private-access-token',
      refresh_token: 'private-refresh-token',
      expires_in: 21_600,
      user_id: seller.id,
    };
    service.verifyState.mockReturnValue(true);
    service.exchangeCode.mockResolvedValue(tokens);
    service.getCurrentUser.mockResolvedValue(seller);
    service.saveTokens.mockResolvedValue(undefined);

    const result = await controller.callback(
      'authorization-code',
      'valid-state',
    );

    expect(service.verifyState).toHaveBeenCalledWith('valid-state');
    expect(service.exchangeCode).toHaveBeenCalledWith('authorization-code');
    expect(service.getCurrentUser).toHaveBeenCalledWith('private-access-token');
    expect(service.saveTokens).toHaveBeenCalledWith(seller, tokens);
    expect(result).toEqual({
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    });
    expect(JSON.stringify(result)).not.toContain('private-access-token');
    expect(JSON.stringify(result)).not.toContain('private-refresh-token');
  });

  it('delegates publication page requests', async () => {
    const page = {
      total: 1,
      count: 1,
      nextScrollId: 'next-scroll',
      finished: false,
      publications: [{ id: 'MLA100' }],
      errors: [],
    };
    service.getPublicationsPage.mockResolvedValue(page);

    await expect(
      controller.getPublications('25', ' current-scroll '),
    ).resolves.toBe(page);
    expect(service.getPublicationsPage).toHaveBeenCalledWith(
      25,
      'current-scroll',
    );
  });

  it('delegates publication detail requests', async () => {
    const publication = { id: 'MLA100', title: 'Test publication' };
    service.getPublication.mockResolvedValue(publication);

    await expect(controller.getPublication('MLA100')).resolves.toBe(
      publication,
    );
    expect(service.getPublication).toHaveBeenCalledWith('MLA100');
  });

  it('delegates publication price updates', async () => {
    const updated = { id: 'MLA100', price: 1500 };
    service.updatePublicationPrice.mockResolvedValue(updated);

    await expect(
      controller.updatePrice('MLA100', { price: 1500 }),
    ).resolves.toBe(updated);
    expect(service.updatePublicationPrice).toHaveBeenCalledWith('MLA100', 1500);
  });

  it('delegates item promotion requests', async () => {
    const promotions = {
      itemId: 'MLA3042295334',
      promotions: [
        {
          id: 'PROMO-1',
          type: 'PRICE_DISCOUNT',
          status: 'started',
          price: 24_750,
          originalPrice: 27_000,
          minDiscountedPrice: null,
          maxDiscountedPrice: null,
          suggestedDiscountedPrice: null,
          subType: null,
          currency: null,
        },
      ],
      activePromotion: {
        id: 'PROMO-1',
        type: 'PRICE_DISCOUNT',
        status: 'started',
        price: 24_750,
        originalPrice: 27_000,
        minDiscountedPrice: null,
        maxDiscountedPrice: null,
        suggestedDiscountedPrice: null,
        subType: null,
        currency: null,
      },
    };
    service.getItemPromotions.mockResolvedValue(promotions);

    await expect(controller.getItemPromotions('MLA3042295334')).resolves.toBe(
      promotions,
    );
    expect(service.getItemPromotions).toHaveBeenCalledWith('MLA3042295334');
  });

  it('keeps delegating User Product price requests', async () => {
    const result = {
      userProduct: {
        id: 'MLAU3837253957',
        name: 'Producto',
        familyId: null,
        attributes: [],
        pictures: [],
      },
      conditions: [],
    };
    service.getUserProductPrices.mockResolvedValue(result);

    await expect(
      controller.getUserProductPrices('MLAU3837253957'),
    ).resolves.toBe(result);
    expect(service.getUserProductPrices).toHaveBeenCalledWith('MLAU3837253957');
  });

  it('delegates list and promotional price updates', async () => {
    const body = {
      listPrice: 40_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
      confirmPromotionReplace: true,
    };
    const updated = {
      ok: true as const,
      itemId: 'MLA3042295334',
      requested: { listPrice: 40_000, salePrice: 30_000 },
      discountPercentage: 25,
      pricing: {
        listPrice: 40_000,
        salePrice: 30_000,
        promotionRegularPrice: 40_000,
        currencyId: 'ARS',
        hasPromotion: true,
      },
      promotion: {
        id: 'PROMO-2',
        type: 'PRICE_DISCOUNT',
        status: 'started',
        startDate: body.startDate,
        finishDate: body.finishDate,
      },
    };
    service.updatePublicationPricing.mockResolvedValue(updated);

    await expect(controller.updatePricing('MLA3042295334', body)).resolves.toBe(
      updated,
    );
    expect(service.updatePublicationPricing).toHaveBeenCalledWith(
      'MLA3042295334',
      body,
    );
  });

  it('delegates PRICE_DISCOUNT creation without a list price', async () => {
    const body = {
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00',
      finishDate: '2026-08-17T23:59:59',
    };
    const created = {
      ok: true as const,
      itemId: 'MLA3042295334',
      pricing: {
        listPrice: 100_000,
        salePrice: 30_000,
        promotionRegularPrice: 100_000,
        currencyId: 'ARS',
        hasPromotion: true,
      },
      promotion: {
        type: 'PRICE_DISCOUNT',
        status: 'started',
      },
    };
    service.createPublicationPriceDiscount.mockResolvedValue(created);

    await expect(
      controller.createPriceDiscount('MLA3042295334', body),
    ).resolves.toBe(created);
    expect(service.createPublicationPriceDiscount).toHaveBeenCalledWith(
      'MLA3042295334',
      body,
    );
    expect(service.updatePublicationPricing).not.toHaveBeenCalled();
  });

  it('delegates DEAL preview with confirmReplaceDeal false', async () => {
    const body = {
      listPrice: 40_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
      confirmReplaceDeal: false,
    };
    const updated = {
      ok: true as const,
      preview: true as const,
      itemId: 'MLA3042295334',
    };
    service.replaceDealWithPriceDiscount.mockResolvedValue(updated);

    await expect(controller.replaceDeal('MLA3042295334', body)).resolves.toBe(
      updated,
    );
    expect(service.replaceDealWithPriceDiscount).toHaveBeenCalledWith(
      'MLA3042295334',
      body,
    );
    expect(service.updatePublicationPricing).not.toHaveBeenCalled();
  });

  it('validates that the price is a positive number', async () => {
    const valid = plainToInstance(UpdatePriceDto, { price: 1500 });
    const zero = plainToInstance(UpdatePriceDto, { price: 0 });
    const missing = plainToInstance(UpdatePriceDto, {});

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(zero)).resolves.not.toHaveLength(0);
    await expect(validate(missing)).resolves.not.toHaveLength(0);
  });

  it('validates the PRICE_DISCOUNT price and required ISO dates', async () => {
    const valid = plainToInstance(CreatePriceDiscountDto, {
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00',
      finishDate: '2026-08-17T23:59:59',
    });
    const invalidPrice = plainToInstance(CreatePriceDiscountDto, {
      ...valid,
      salePrice: 0,
    });
    const invalidDates = plainToInstance(CreatePriceDiscountDto, {
      ...valid,
      startDate: 'not-a-date',
      finishDate: '2026-99-99',
    });
    const missingDates = plainToInstance(CreatePriceDiscountDto, {
      salePrice: 30_000,
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalidPrice)).resolves.not.toHaveLength(0);
    await expect(validate(invalidDates)).resolves.not.toHaveLength(0);
    await expect(validate(missingDates)).resolves.not.toHaveLength(0);
  });

  it('validates pricing numbers and ISO dates', async () => {
    const dealWithoutDates = plainToInstance(UpdatePricingDto, {
      listPrice: 40_000,
      salePrice: 30_000,
    });
    const valid = plainToInstance(UpdatePricingDto, {
      listPrice: 40_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
    });
    const invalidListPrice = plainToInstance(UpdatePricingDto, {
      ...valid,
      listPrice: 0,
    });
    const invalidSalePrice = plainToInstance(UpdatePricingDto, {
      ...valid,
      salePrice: -1,
    });
    const invalidDates = plainToInstance(UpdatePricingDto, {
      ...valid,
      startDate: 'not-a-date',
      finishDate: '2026-99-99',
    });

    await expect(validate(dealWithoutDates)).resolves.toHaveLength(0);
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalidListPrice)).resolves.not.toHaveLength(0);
    await expect(validate(invalidSalePrice)).resolves.not.toHaveLength(0);
    await expect(validate(invalidDates)).resolves.not.toHaveLength(0);
  });

  it('keeps topDealPrice optional and validates a positive number', async () => {
    const values = {
      listPrice: 40_000,
      salePrice: 30_000,
    };
    const omitted = plainToInstance(UpdatePricingDto, values);
    const valid = plainToInstance(UpdatePricingDto, {
      ...values,
      topDealPrice: 25_000,
    });
    const zero = plainToInstance(UpdatePricingDto, {
      ...values,
      topDealPrice: 0,
    });
    const negative = plainToInstance(UpdatePricingDto, {
      ...values,
      topDealPrice: -1,
    });
    const notNumeric = plainToInstance(UpdatePricingDto, {
      ...values,
      topDealPrice: '25000',
    });

    await expect(validate(omitted)).resolves.toHaveLength(0);
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(zero)).resolves.not.toHaveLength(0);
    await expect(validate(negative)).resolves.not.toHaveLength(0);
    await expect(validate(notNumeric)).resolves.not.toHaveLength(0);
  });

  it('keeps confirmation optional but only accepts a boolean', async () => {
    const values = {
      listPrice: 40_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
    };
    const omitted = plainToInstance(UpdatePricingDto, values);
    const confirmed = plainToInstance(UpdatePricingDto, {
      ...values,
      confirmPromotionReplace: true,
    });
    const invalid = plainToInstance(UpdatePricingDto, {
      ...values,
      confirmPromotionReplace: 'true',
    });

    await expect(validate(omitted)).resolves.toHaveLength(0);
    await expect(validate(confirmed)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it('accepts false and true for confirmReplaceDeal', async () => {
    const values = {
      listPrice: 40_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
    };
    const confirmed = plainToInstance(ReplaceDealDto, {
      ...values,
      confirmReplaceDeal: true,
    });
    const missing = plainToInstance(ReplaceDealDto, values);
    const preview = plainToInstance(ReplaceDealDto, {
      ...values,
      confirmReplaceDeal: false,
    });
    const text = plainToInstance(ReplaceDealDto, {
      ...values,
      confirmReplaceDeal: 'true',
    });

    await expect(validate(confirmed)).resolves.toHaveLength(0);
    await expect(validate(preview)).resolves.toHaveLength(0);
    await expect(validate(missing)).resolves.not.toHaveLength(0);
    await expect(validate(text)).resolves.not.toHaveLength(0);
  });

  it('rejects promotionRegularPrice as an unsupported body field', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        {
          listPrice: 40_000,
          salePrice: 30_000,
          startDate: '2026-08-04T00:00:00Z',
          finishDate: '2026-08-17T23:59:59Z',
          promotionRegularPrice: 40_000,
        },
        { type: 'body', metatype: UpdatePricingDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the sale and list price relation to the service', async () => {
    const equalPrices = plainToInstance(UpdatePricingDto, {
      listPrice: 30_000,
      salePrice: 30_000,
      startDate: '2026-08-04T00:00:00Z',
      finishDate: '2026-08-17T23:59:59Z',
    });

    await expect(validate(equalPrices)).resolves.toHaveLength(0);
  });

  it('rejects invalid state, provider errors and a missing code before exchange', async () => {
    service.verifyState.mockReturnValueOnce(false);
    await expect(
      controller.callback(
        undefined,
        'invalid-state',
        'access_denied',
        'Denied',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    service.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state', 'access_denied', 'Denied'),
    ).rejects.toBeInstanceOf(BadRequestException);

    service.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.exchangeCode).not.toHaveBeenCalled();
  });

  it('acknowledges webhooks immediately', () => {
    expect(controller.webhook()).toEqual({ ok: true });
  });
});
