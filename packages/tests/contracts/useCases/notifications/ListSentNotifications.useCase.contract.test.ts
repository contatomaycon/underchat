import 'reflect-metadata';

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class {},
}));

import { ListSentNotificationsUseCase } from '@core/useCases/notifications/ListSentNotifications.useCase';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

describe('ListSentNotificationsUseCase', () => {
  it('returns empty paged response when elastic returns null', async () => {
    const service = {
      select: jest.fn(async () => null),
    };
    const useCase = new ListSentNotificationsUseCase(service as never);

    await expect(useCase.execute({} as never)).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });

    expect(service.select).toHaveBeenCalledWith(
      EElasticIndex.notification,
      expect.objectContaining({
        from: 0,
        size: 10,
      })
    );
  });

  it('maps notifications and pagings from elastic result', async () => {
    const source = {
      id: 'id-1',
      notification_id: 'ntf-1',
      notification_type: 'email',
      account: { id: 'acc-1' },
      worker: { id: 'wk-1' },
      name: 'John',
      phone: '5511999999999',
      email: 'john@example.com',
      message_whatsapp: 'hello',
      message_email: 'hello email',
      email_subject: 'subject',
      date: '2026-01-01T00:00:00.000Z',
    };

    const service = {
      select: jest.fn(async () => ({
        hits: {
          total: { value: 2, relation: 'eq' },
          hits: [{ _source: source }],
        },
      })),
    };

    const useCase = new ListSentNotificationsUseCase(service as never);

    await expect(
      useCase.execute({ per_page: 5, current_page: 2 } as never)
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 1,
        per_page: 5,
        count: 1,
        total: 2,
      },
      results: [source],
    });

    expect(service.select).toHaveBeenCalledWith(
      EElasticIndex.notification,
      expect.objectContaining({
        from: 5,
        size: 5,
      })
    );
  });
});
