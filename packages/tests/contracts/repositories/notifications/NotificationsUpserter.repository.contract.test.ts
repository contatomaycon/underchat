import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { NotificationsUpserterRepository } from '@core/repositories/notifications/NotificationsUpserter.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository() {
  const tx = {
    query: {
      notifications: {
        findFirst: jest.fn(),
      },
    },
    update: jest.fn(),
    insert: jest.fn(),
    select: jest.fn(),
  };

  const dbRw = {
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(tx)
    ),
  };

  return {
    repository: new NotificationsUpserterRepository(dbRw as never),
    dbRw,
    tx,
  };
}

function createUpdateChain() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    update,
    set,
  };
}

function createInsertChain() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const values = jest.fn(() => ({ execute }));
  const insert = jest.fn(() => ({ values }));

  return {
    insert,
    values,
  };
}

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    select,
  };
}

describe('NotificationsUpserterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue(
      'generated-notification-id'
    );
  });

  it('uses findNotificationByType when no input fields are provided', async () => {
    const { repository } = createRepository();

    (repository as any).findAllNotificationTypeIds = jest.fn(async () => ({
      twoFactor: 'two',
      planNew: 'new',
      planRenewal: 'renew',
      planExpiration: 'exp',
      planCancellation: 'cancel',
      recurringPaymentFailure: 'failure',
      testPlanNew: 'test-new',
      testPlanExpiration: 'test-exp',
    }));

    (repository as any).upsertNotificationByType = jest.fn();
    (repository as any).findNotificationByType = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        notification_id: 'n-new',
        nwr: { worker_id: 'w-1', name: 'Worker' },
        message_whatsapp: 'wpp',
        email_subject: 'sub',
        message_email: 'mail',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T01:00:00.000Z',
      })
      .mockResolvedValue(null);

    const result = await repository.upsertNotifications({} as never);

    expect((repository as any).findNotificationByType).toHaveBeenCalledTimes(8);
    expect((repository as any).upsertNotificationByType).not.toHaveBeenCalled();
    expect(result.notification_id).toBe('n-new');
    expect(result.plan_new_notification).toEqual({
      whatsapp: {
        enabled: false,
        worker_id: 'w-1',
        name: 'Worker',
        message: 'wpp',
      },
      email: {
        enabled: false,
        subject: 'sub',
        message: 'mail',
      },
    });
  });

  it('uses uuid fallback when all notifications are null', async () => {
    const { repository } = createRepository();

    (repository as any).findAllNotificationTypeIds = jest.fn(async () => ({
      twoFactor: 'two',
      planNew: 'new',
      planRenewal: 'renew',
      planExpiration: 'exp',
      planCancellation: 'cancel',
      recurringPaymentFailure: 'failure',
      testPlanNew: 'test-new',
      testPlanExpiration: 'test-exp',
    }));

    (repository as any).upsertNotificationByType = jest.fn(async () => null);
    (repository as any).findNotificationByType = jest.fn(async () => null);

    await expect(
      repository.upsertNotifications({
        two_factor_notification: 'w-1',
      } as never)
    ).resolves.toEqual(
      expect.objectContaining({
        notification_id: 'generated-notification-id',
        created_at: null,
        updated_at: null,
      })
    );
  });

  it('clears two-factor email and message fields during update', async () => {
    const { repository } = createRepository();

    (repository as any).findAllNotificationTypeIds = jest.fn(async () => ({
      twoFactor: 'two',
      planNew: 'new',
      planRenewal: 'renew',
      planExpiration: 'exp',
      planCancellation: 'cancel',
      recurringPaymentFailure: 'failure',
      testPlanNew: 'test-new',
      testPlanExpiration: 'test-exp',
    }));

    (repository as any).upsertNotificationByType = jest.fn(async () => null);
    (repository as any).findNotificationByType = jest.fn(async () => null);

    await repository.upsertNotifications({
      two_factor_notification: 'w-1',
      two_factor_message_whatsapp: 'ignored',
      two_factor_message_email: '<p>ignored</p>',
      two_factor_email_subject: 'ignored',
      two_factor_whatsapp_enabled: true,
      two_factor_email_enabled: true,
    } as never);

    expect((repository as any).upsertNotificationByType).toHaveBeenCalledWith(
      expect.anything(),
      'two',
      'w-1',
      null,
      null,
      null,
      true,
      false
    );
  });

  it('findAllNotificationTypeIds resolves all expected keys in order', async () => {
    const { repository } = createRepository();

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

    await expect(
      (repository as any).findAllNotificationTypeIds({})
    ).resolves.toEqual({
      twoFactor: 'two',
      planNew: 'new',
      planRenewal: 'renew',
      planExpiration: 'exp',
      planCancellation: 'cancel',
      recurringPaymentFailure: 'failure',
      testPlanNew: 'test-new',
      testPlanExpiration: 'test-exp',
    });
  });

  it('findNotificationTypeIdByName returns id when row exists', async () => {
    const { repository } = createRepository();
    const { select } = createSelectChain([{ notification_type_id: 'type-1' }]);

    await expect(
      (repository as any).findNotificationTypeIdByName(
        { select } as never,
        'two_factor'
      )
    ).resolves.toBe('type-1');
  });

  it('findNotificationTypeIdByName throws when type is missing', async () => {
    const { repository } = createRepository();
    const { select } = createSelectChain([]);

    await expect(
      (repository as any).findNotificationTypeIdByName(
        { select } as never,
        'missing_type'
      )
    ).rejects.toThrow('Notification type not found: missing_type');
  });

  it('upsertNotificationByType soft deletes existing notification when workerId is null', async () => {
    const { repository } = createRepository();
    const { update } = createUpdateChain();

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ notification_id: 'n-1' });

    const tx = {
      query: {
        notifications: {
          findFirst,
        },
      },
      update,
      insert: jest.fn(),
    };

    await expect(
      (repository as any).upsertNotificationByType(
        tx,
        'type-1',
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    ).resolves.toBeNull();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('upsertNotificationByType returns null when no existing row and workerId is undefined', async () => {
    const { repository } = createRepository();
    const tx = {
      query: {
        notifications: {
          findFirst: jest.fn(async () => null),
        },
      },
      update: jest.fn(),
      insert: jest.fn(),
    };

    await expect(
      (repository as any).upsertNotificationByType(
        tx,
        'type-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    ).resolves.toBeNull();
  });

  it('upsertNotificationByType inserts and returns notification when creating new row', async () => {
    const { repository } = createRepository();
    const { insert, values } = createInsertChain();

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        notification_id: 'generated-notification-id',
        nwr: { worker_id: 'w-1', name: 'Worker' },
      });

    const tx = {
      query: {
        notifications: {
          findFirst,
        },
      },
      update: jest.fn(),
      insert,
    };

    await expect(
      (repository as any).upsertNotificationByType(
        tx,
        'type-1',
        'w-1',
        'wpp',
        'mail',
        'subject',
        true,
        false
      )
    ).resolves.toEqual({
      notification_id: 'generated-notification-id',
      nwr: { worker_id: 'w-1', name: 'Worker' },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_id: 'generated-notification-id',
        notification_type_id: 'type-1',
        worker_id: 'w-1',
        message_whatsapp: 'wpp',
        message_email: 'mail',
        email_subject: 'subject',
        whatsapp_enabled: true,
        email_enabled: false,
      })
    );
  });

  it('upsertNotificationByType inserts email-only notification with null worker', async () => {
    const { repository } = createRepository();
    const { insert, values } = createInsertChain();

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        notification_id: 'generated-notification-id',
        nwr: null,
      });

    const tx = {
      query: {
        notifications: {
          findFirst,
        },
      },
      update: jest.fn(),
      insert,
    };

    await expect(
      (repository as any).upsertNotificationByType(
        tx,
        'type-1',
        null,
        null,
        'mail',
        'subject',
        false,
        true
      )
    ).resolves.toEqual({
      notification_id: 'generated-notification-id',
      nwr: null,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: null,
        message_whatsapp: null,
        message_email: 'mail',
        email_subject: 'subject',
        whatsapp_enabled: false,
        email_enabled: true,
      })
    );
  });

  it('upsertNotificationByType keeps row when worker is null with channel status input', async () => {
    const { repository } = createRepository();
    const { update, set } = createUpdateChain();

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ notification_id: 'n-1' })
      .mockResolvedValueOnce({ notification_id: 'n-1', nwr: null });

    const tx = {
      query: {
        notifications: {
          findFirst,
        },
      },
      update,
      insert: jest.fn(),
    };

    await expect(
      (repository as any).upsertNotificationByType(
        tx,
        'type-1',
        null,
        undefined,
        undefined,
        undefined,
        false,
        true
      )
    ).resolves.toEqual({ notification_id: 'n-1', nwr: null });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: null,
        whatsapp_enabled: false,
        email_enabled: true,
      })
    );
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String),
      })
    );
  });
});
