import {
  MercadolibreIntegrationEventsRepository,
  type RecordIntegrationEventInput,
} from '../../../database/repositories/mercadolibre-integration-events.repository';
import { PublicationIntegrationEventService } from './publication-integration-event.service';

describe('PublicationIntegrationEventService', () => {
  it('genera un fingerprint estable y elimina metadata sensible', async () => {
    const record = jest
      .fn<Promise<string>, [RecordIntegrationEventInput]>()
      .mockResolvedValue('event-id');
    const service = new PublicationIntegrationEventService({
      record,
    } as unknown as MercadolibreIntegrationEventsRepository);
    const error = {
      type: 'POSSIBLE_API_CHANGE' as const,
      code: 'unknown',
      message: 'Respuesta inesperada',
      httpStatus: 502,
    };

    await service.recordPossibleChange(123, '/items/MLA1', error, {
      itemId: 'MLA1',
      accessToken: 'private',
      detail: 'Bearer another-private-value',
    });
    await service.recordPossibleChange(123, '/items/MLA1', error, {
      itemId: 'MLA2',
    });

    expect(record).toHaveBeenCalledTimes(2);
    const first = record.mock.calls[0][0];
    const second = record.mock.calls[1][0];
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.metadata).toEqual({
      itemId: 'MLA1',
      detail: 'Bearer [REDACTED]',
    });
    expect(JSON.stringify(first.metadata)).not.toContain('private');
  });
});
