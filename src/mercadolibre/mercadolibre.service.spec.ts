import { Test, TestingModule } from '@nestjs/testing';
import { MercadolibreService } from './mercadolibre.service';

describe('MercadolibreService', () => {
  let service: MercadolibreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MercadolibreService],
    }).compile();

    service = module.get<MercadolibreService>(MercadolibreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
