import { Injectable, NotFoundException } from '@nestjs/common';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { SalesCurveService } from './sales-curve.service';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { normalizeColor, normalizeSize } from './variant-normalization';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';
import type { CreateVariantLinkDto } from './dto/create-variant-link.dto';

@Injectable()
export class VariantLinkService {
  constructor(
    private readonly mlCurve: MercadolibreCurveService,
    private readonly tnCurve: TiendanubeCurveService,
    private readonly links: VariantChannelLinksRepository,
    private readonly curve: SalesCurveService,
  ) {}

  async create(userId: string, input: CreateVariantLinkDto) {
    const [mlVariants, tnVariants] = await Promise.all([
      this.mlCurve.getForSale(userId, input.mlItemId, null),
      this.tnCurve.getForUser(userId, input.tnProductId),
    ]);
    const ml = mlVariants.find(
      (variant) =>
        variant.ml?.itemId === input.mlItemId &&
        variant.ml.variationId === (input.mlVariationId ?? null),
    );
    const tn = tnVariants.find(
      (variant) => variant.tiendaNube?.variantId === input.tnVariantId,
    );
    if (!ml?.ml || !tn?.tiendaNube) {
      throw new NotFoundException(
        'No se encontró alguna de las variantes en las cuentas conectadas',
      );
    }

    const link = await this.links.save({
      userId,
      mlItemId: ml.ml.itemId,
      mlVariationId: ml.ml.variationId,
      userProductId: ml.ml.userProductId,
      familyId: ml.ml.familyId,
      tnProductId: tn.tiendaNube.productId,
      tnVariantId: tn.tiendaNube.variantId,
      sku: ml.sku ?? tn.sku,
      normalizedColor: normalizeColor(ml.color ?? tn.color),
      normalizedSize: normalizeSize(ml.size ?? tn.size),
      matchSource: 'MANUAL',
    });
    this.curve.invalidate(userId);
    return link;
  }
}
