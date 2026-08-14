import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';

@Injectable()
export class PublicationsService {
  /** Recibe la conexión y los repositories de lectura. */
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
  ) {}

  /** Lista resúmenes paginados desde Supabase. */
  async list(page = 1, limit = 20) {
    this.validatePaging(page, limit);
    const connection = await this.tokenService.getStoredConnection();
    const result = await this.productsRepository.findPage(
      connection.seller_id,
      page,
      limit,
    );

    return {
      paging: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      count: result.products.length,
      publications: result.products,
    };
  }

  /** Devuelve un producto guardado y sus hijos cuando corresponde. */
  async findOne(productId: string) {
    this.validateProductId(productId);
    const connection = await this.tokenService.getStoredConnection();
    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }
    if (product.model === 'SHARED') return { product };

    const children = await this.childrenRepository.findByProductId(product.id);
    return { product, children };
  }

  /** Valida la paginación solicitada. */
  private validatePaging(page: number, limit: number): void {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor que cero');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
  }

  /** Valida la PK UUID interna del producto. */
  private validateProductId(productId: string): void {
    if (!UUID_PATTERN.test(productId)) {
      throw new BadRequestException('productId debe ser un UUID válido');
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
