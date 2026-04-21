import 'reflect-metadata';
import { NotificationMessageViewerRepository } from '@core/repositories/notifications/NotificationMessageViewer.repository';

describe('NotificationMessageViewerRepository', () => {
  it('findNotificationById delegates to query.findFirst and returns payload', async () => {
    const row = {
      notification_id: 'n-1',
      worker_id: 'w-1',
      notification_type_id: 'type-1',
    };

    const findFirst = jest.fn(async () => row);
    const dbRo = {
      query: {
        notifications: {
          findFirst,
        },
      },
    };

    const repository = new NotificationMessageViewerRepository(dbRo as never);

    await expect(repository.findNotificationById('n-1')).resolves.toEqual(row);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('findNotificationByTypeId delegates to query.findFirst and returns null when not found', async () => {
    const findFirst = jest.fn(async () => null);
    const dbRo = {
      query: {
        notifications: {
          findFirst,
        },
      },
    };

    const repository = new NotificationMessageViewerRepository(dbRo as never);

    await expect(
      repository.findNotificationByTypeId('type-1')
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
