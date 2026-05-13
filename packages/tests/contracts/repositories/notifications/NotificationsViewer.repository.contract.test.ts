import 'reflect-metadata';
import { NotificationsViewerRepository } from '@core/repositories/notifications/NotificationsViewer.repository';

describe('NotificationsViewerRepository', () => {
  it('maps all notification groups when records exist', async () => {
    const repository = new NotificationsViewerRepository({} as never);

    (repository as any).findNotificationTypeIdByName = jest
      .fn()
      .mockResolvedValueOnce('two')
      .mockResolvedValueOnce('new')
      .mockResolvedValueOnce('renew')
      .mockResolvedValueOnce('exp')
      .mockResolvedValueOnce('cancel')
      .mockResolvedValueOnce('failure')
      .mockResolvedValueOnce('test-new')
      .mockResolvedValueOnce('test-exp');

    (repository as any).findNotificationByType = jest
      .fn()
      .mockResolvedValueOnce({
        notification_id: 'n-two',
        message_whatsapp: 'msg-two',
        message_email: 'mail-two',
        email_subject: 'subject-two',
        whatsapp_enabled: true,
        email_enabled: false,
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T01:00:00.000Z',
        nwr: { worker_id: 'w-1', name: 'Worker' },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        notification_id: 'n-renew',
        message_whatsapp: 'msg-renew',
        message_email: 'mail-renew',
        email_subject: 'subject-renew',
        whatsapp_enabled: false,
        email_enabled: true,
        created_at: null,
        updated_at: '2026-04-21T02:00:00.000Z',
        nwr: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await repository.viewNotifications();

    expect(result.notification_id).toBe('n-two');
    expect(result.two_factor_notification).toEqual({
      whatsapp: {
        enabled: true,
        worker_id: 'w-1',
        name: 'Worker',
        message: 'msg-two',
      },
      email: {
        enabled: false,
        subject: 'subject-two',
        message: 'mail-two',
      },
    });
    expect(result.plan_renewal_notification).toEqual({
      whatsapp: {
        enabled: false,
        worker_id: null,
        name: null,
        message: 'msg-renew',
      },
      email: {
        enabled: true,
        subject: 'subject-renew',
        message: 'mail-renew',
      },
    });
    expect(result.plan_new_notification).toBeNull();
    expect(result.created_at).toBe('2026-04-21T00:00:00.000Z');
    expect(result.updated_at).toBe('2026-04-21T01:00:00.000Z');
  });

  it('returns null payloads when no notifications exist', async () => {
    const repository = new NotificationsViewerRepository({} as never);

    (repository as any).findNotificationTypeIdByName = jest
      .fn()
      .mockResolvedValue('type-id');
    (repository as any).findNotificationByType = jest.fn(async () => null);

    await expect(repository.viewNotifications()).resolves.toEqual({
      notification_id: null,
      two_factor_notification: null,
      plan_new_notification: null,
      plan_renewal_notification: null,
      plan_expiration_reminder: null,
      plan_cancellation_notification: null,
      recurring_payment_failure_notification: null,
      test_plan_new_notification: null,
      test_plan_expiration_reminder: null,
      created_at: null,
      updated_at: null,
    });
  });
});
