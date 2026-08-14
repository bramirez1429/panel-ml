import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import type { MercadoLibrePublication } from '../publication.types';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationPublishingPlannerService } from './publication-publishing-planner.service';
import { PublicationValidationService } from './publication-validation.service';
import { PublishingPlan } from './publication-publishing.types';

type CreatedItem = Readonly<{
  id: string;
  publication: MercadoLibrePublication;
}>;

@Injectable()
export class PublicationPublishingService {
  constructor(
    private readonly planner: PublicationPublishingPlannerService,
    private readonly validation: PublicationValidationService,
    private readonly apiService: MercadolibreApiService,
    private readonly syncService: PublicationSyncService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Publica en ML, sincroniza solo el item/familia creado y devuelve el UUID. */
  async publish(body: unknown) {
    const plan = await this.planner.plan(body);
    const validation = await this.validation.validatePlan(plan);
    if (!validation.valid) {
      throw new ConflictException({
        message: 'Mercado Libre rechazo la validacion de la publicacion',
        issues: validation.issues,
        preview: validation.preview,
      });
    }

    const created: CreatedItem[] = [];
    let externalKey: string;
    let productId: string;
    try {
      for (const item of plan.items) {
        const response = await this.apiService.post<unknown>(
          '/items',
          item.payload,
          plan.context.accessToken,
          'publishingMutation',
        );
        created.push(parseCreatedItem(response, plan.context.sellerId));
      }
      await this.createDescriptions(plan, created);
      externalKey = await this.syncService.syncKnownItems(
        created.map(({ publication }) => publication),
        {
          sellerId: plan.context.sellerId,
          accessToken: plan.context.accessToken,
        },
      );
      productId = await this.findInternalProductId(
        plan,
        created[0].id,
        externalKey,
      );
    } catch (error) {
      if (created.length === 0) throw error;
      throw incompletePublishing(created, plan.items.length);
    }

    await this.activity.recordBestEffort({
      sellerId: plan.context.sellerId,
      productId,
      itemId: created[0].id,
      action: 'PUBLISHED',
      status: 'SUCCESS',
      newValue: {
        publishingModel: plan.model,
        itemIds: created.map(({ id }) => id),
      },
    });
    return {
      ok: true,
      productId,
      publishingModel: plan.model,
      itemIds: created.map(({ id }) => id),
    };
  }

  /** La descripcion se crea luego del item, segun el flujo oficial de ML. */
  private async createDescriptions(
    plan: PublishingPlan,
    created: CreatedItem[],
  ): Promise<void> {
    for (let index = 0; index < created.length; index += 1) {
      const description = plan.items[index].description;
      if (!description) continue;
      await this.apiService.post<unknown>(
        `/items/${encodeURIComponent(created[index].id)}/description`,
        { plain_text: description },
        plan.context.accessToken,
        'publishingMutation',
      );
    }
  }

  private async findInternalProductId(
    plan: PublishingPlan,
    itemId: string,
    verifiedExternalKey?: string,
  ): Promise<string> {
    const externalKey = verifiedExternalKey ?? `item:${itemId}`;
    const product = await this.productsRepository.findByExternalKey(
      plan.context.sellerId,
      externalKey,
    );
    if (!product) {
      throw new BadGatewayException(
        'La publicacion fue creada en Mercado Libre pero no pudo localizarse en Supabase',
      );
    }
    return product.id;
  }

}

function parseCreatedItem(
  value: unknown,
  expectedSellerId: number,
): CreatedItem {
  if (!isJsonObject(value) || typeof value.id !== 'string') {
    throw invalidCreationResponse();
  }
  const sellerId =
    typeof value.seller_id === 'number'
      ? value.seller_id
      : isJsonObject(value.seller) && typeof value.seller.id === 'number'
        ? value.seller.id
        : null;
  if (!/^MLA\d+$/.test(value.id) || sellerId !== expectedSellerId) {
    throw invalidCreationResponse();
  }
  return {
    id: value.id,
    publication: { ...value, id: value.id, seller_id: sellerId },
  };
}

function invalidCreationResponse(): BadGatewayException {
  return new BadGatewayException(
    'Mercado Libre devolvio una respuesta de creacion invalida',
  );
}

function incompletePublishing(
  created: readonly CreatedItem[],
  expectedCount: number,
): ConflictException {
  const complete = created.length === expectedCount;
  return new ConflictException({
    message: complete
      ? 'Mercado Libre creo los items, pero no pudo completarse la descripcion, verificacion o sincronizacion; no reintente sin revisar los IDs'
      : 'Mercado Libre creo solo una parte de la familia; no reintente sin revisar los IDs',
    createdItemIds: created.map(({ id }) => id),
  });
}
