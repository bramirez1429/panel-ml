import { Test, TestingModule } from '@nestjs/testing';
import { MercadolibreController } from './mercadolibre.controller';

describe('MercadolibreController', () => {
  let controller: MercadolibreController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MercadolibreController],
    }).compile();

    controller = module.get<MercadolibreController>(MercadolibreController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
