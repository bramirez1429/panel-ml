import {
  financingCampaignTagOf,
  promotionCampaignItemCommerceOf,
} from './promotion-campaign-item-commerce';

describe(
  'promotionCampaignItemCommerceOf',
  () => {
    it(
      'extrae SKU, stock, envío gratis y 3 cuotas',
      () => {
        const result =
          promotionCampaignItemCommerceOf({
            id: 'MLA1',
            seller_custom_field:
              'BM-LOV-NEG-42',
            available_quantity: 2,
            listing_type_id: 'gold_pro',
            tags: [
              'immediate_payment',
              '3x_campaign',
            ],
            shipping: {
              free_shipping: true,
            },
          });

        expect(result).toEqual({
          sku: 'BM-LOV-NEG-42',
          stock: 2,
          freeShipping: true,
          installmentLabel: '3 cuotas',
        });
      },
    );

    it(
      'usa SELLER_SKU si seller_custom_field no existe',
      () => {
        const result =
          promotionCampaignItemCommerceOf({
            id: 'MLA2',
            attributes: [
              {
                id: 'SELLER_SKU',
                value_name: 'SKU-42',
              },
            ],
          });

        expect(result.sku)
          .toBe('SKU-42');
      },
    );

    it(
      'no inventa cantidad de cuotas para gold_pro sin tag',
      () => {
        const result =
          promotionCampaignItemCommerceOf({
            id: 'MLA3',
            listing_type_id: 'gold_pro',
          });

        expect(
          result.installmentLabel,
        ).toBe('Cuotas agregadas');
      },
    );

    it(
      'detecta el tag financiero para listing_prices',
      () => {
        expect(
          financingCampaignTagOf({
            id: 'MLA4',
            tags: [
              'immediate_payment',
              '3x_campaign',
            ],
          }),
        ).toBe('3x_campaign');
      },
    );
  },
);
