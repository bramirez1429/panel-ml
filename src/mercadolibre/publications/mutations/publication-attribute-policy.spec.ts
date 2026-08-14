import { ConflictException } from '@nestjs/common';
import {
  categoryAttributeDefinitions,
  mergeEditableAttributes,
} from './publication-attribute-policy';
import type { CategoryAttributeDefinition } from './publication-attribute-policy';

function editableDefinition(
  overrides: Partial<CategoryAttributeDefinition> = {},
): CategoryAttributeDefinition {
  return {
    id: 'BRAND',
    name: 'Marca',
    required: false,
    valueType: null,
    allowCustomValue: true,
    editable: true,
    reason: null,
    values: [],
    ...overrides,
  };
}

describe('publication attribute policy', () => {
  it('limpia con nulls sin quitar el nodo ni tocar otros atributos', () => {
    const live = [
      {
        id: 'BRAND',
        value_id: '123',
        value_name: 'Acme',
        source: 'catalog',
      },
      { id: 'MODEL', value_name: 'M1', value_struct: { number: 1 } },
    ];
    const before = structuredClone(live);

    const result = mergeEditableAttributes(
      live,
      [editableDefinition()],
      [{ id: 'BRAND', valueId: null, valueName: null, clear: true }],
    );

    expect(result).toEqual([
      {
        id: 'BRAND',
        value_id: null,
        value_name: null,
        source: 'catalog',
      },
      { id: 'MODEL', value_name: 'M1', value_struct: { number: 1 } },
    ]);
    expect(live).toEqual(before);
  });

  it.each(['required', 'new_required'])(
    '%s impide limpiar el atributo',
    (tag) => {
      const [definition] = categoryAttributeDefinitions(
        [{ id: 'BRAND', name: 'Marca', tags: { [tag]: true } }],
        { variations: [] },
      );

      expect(definition.required).toBe(true);
      expect(() =>
        mergeEditableAttributes(
          [{ id: 'BRAND', value_name: 'Acme' }],
          [definition],
          [{ id: 'BRAND', valueId: null, valueName: null, clear: true }],
        ),
      ).toThrow(ConflictException);
    },
  );

  it('detecta child PK de variacion sin modificar variaciones ni atributos', () => {
    const liveItem = {
      variations: [
        {
          id: 42,
          available_quantity: 3,
          attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }],
        },
      ],
      attributes: [{ id: 'BRAND', value_name: 'Acme' }],
    };
    const before = structuredClone(liveItem);

    const definitions = categoryAttributeDefinitions(
      [
        { id: 'COLOR', name: 'Color', tags: {} },
        { id: 'BRAND', name: 'Marca', tags: {} },
      ],
      liveItem,
    );

    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'COLOR', editable: false }),
        expect.objectContaining({ id: 'BRAND', editable: true }),
      ]),
    );
    expect(liveItem).toEqual(before);
  });

  it('permite valores sugeridos custom salvo en atributos cerrados', () => {
    expect(
      mergeEditableAttributes(
        [],
        [
          editableDefinition({
            valueType: 'string',
            allowCustomValue: true,
            values: [{ id: '1', name: 'Sugerido' }],
          }),
        ],
        [
          {
            id: 'BRAND',
            valueId: null,
            valueName: 'Marca nueva',
            clear: false,
          },
        ],
      ),
    ).toEqual([{ id: 'BRAND', value_name: 'Marca nueva' }]);

    expect(() =>
      mergeEditableAttributes(
        [],
        [
          editableDefinition({
            valueType: 'list',
            allowCustomValue: false,
            values: [{ id: '1', name: 'Sugerido' }],
          }),
        ],
        [
          {
            id: 'BRAND',
            valueId: null,
            valueName: 'No permitido',
            clear: false,
          },
        ],
      ),
    ).toThrow();
  });
});
