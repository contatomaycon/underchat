import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { NotificationsService } from '@core/services/notifications.service';

describe('NotificationsService', () => {
  it('delegates all methods to repositories', async () => {
    const viewNotifications = jest.fn(async () => ({ enabled: true }));
    const upsertNotifications = jest.fn(async () => ({ ok: true }));
    const listWorkersByAccount = jest.fn(async () => [{ user_id: 'u1' }]);

    const service = new NotificationsService(
      { viewNotifications } as never,
      { upsertNotifications } as never,
      { listWorkersByAccount } as never
    );

    await expect(service.viewNotifications()).resolves.toEqual({
      enabled: true,
    });
    await expect(
      service.upsertNotifications({ sms: true } as never)
    ).resolves.toEqual({
      ok: true,
    });
    await expect(service.listWorkersByAccount('a1')).resolves.toEqual([
      { user_id: 'u1' },
    ]);
  });
});
