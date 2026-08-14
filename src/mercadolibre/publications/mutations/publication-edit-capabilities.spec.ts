import {
  editCapabilities,
  stockLocationTypes,
} from './publication-edit-capabilities';

describe('publication-edit-capabilities', () => {
  it('bloquea el precio cuando ML administra el precio dinamico', () => {
    const capabilities = editCapabilities(
      {
        status: 'active',
        tags: ['dynamic_standard_price'],
        sub_status: [],
      },
      [],
      [],
      false,
    );

    expect(capabilities.canEditPrice).toBe(false);
    expect(capabilities.canEditSku).toBe(true);
    expect(capabilities.canEditPictures).toBe(true);
  });

  it.each([
    [['warehouse_management'], []],
    [[], ['seller_warehouse']],
    [[], ['meli_facility']],
  ])(
    'bloquea stock administrado por warehouse o exclusivamente por Full',
    (sellerTags, locations) => {
      const capabilities = editCapabilities(
        { status: 'active', tags: [], sub_status: [] },
        sellerTags,
        locations,
        false,
      );

      expect(capabilities.canEditStock).toBe(false);
    },
  );

  it('permite pausar solamente una publicacion activa no agregada', () => {
    expect(
      editCapabilities(
        { status: 'active', tags: [], sub_status: [] },
        [],
        [],
        false,
      ),
    ).toMatchObject({ canPause: true, canActivate: false });

    expect(
      editCapabilities(
        { status: 'active', tags: [], sub_status: [] },
        [],
        [],
        true,
      ),
    ).toMatchObject({ canPause: false, canActivate: false });
  });

  it.each([
    [[], true],
    [['out_of_stock'], false],
    [['picture_download_pending'], false],
    [['picture_downloading_pending'], false],
  ])(
    'calcula activacion segun el subestado de una publicacion pausada',
    (subStatus, expected) => {
      const capabilities = editCapabilities(
        { status: 'paused', tags: [], sub_status: subStatus },
        [],
        [],
        false,
      );

      expect(capabilities.canActivate).toBe(expected);
      expect(capabilities.canPause).toBe(false);
    },
  );

  it('extrae solamente tipos de ubicacion validos', () => {
    expect(
      stockLocationTypes({
        locations: [
          { type: 'meli_facility' },
          { type: 'selling_address' },
          { type: 3 },
          null,
        ],
      }),
    ).toEqual(['meli_facility', 'selling_address']);
    expect(stockLocationTypes({ locations: null })).toEqual([]);
  });
});
