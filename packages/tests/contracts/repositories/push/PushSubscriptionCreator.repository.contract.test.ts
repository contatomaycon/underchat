import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { PushSubscriptionCreatorRepository } from '@core/repositories/push/PushSubscriptionCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createUpdateChain() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return { update };
}

function createSelectChain(
  existing: Array<{ push_subscription_id: string | null }>
) {
  const execute = jest.fn(async () => existing);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createInsertChain() {
  const values = jest.fn(async () => ({ rowCount: 1 }));
  const insert = jest.fn(() => ({ values }));

  return { insert, values };
}

function createRepository(
  existing: Array<{ push_subscription_id: string | null }>
) {
  const updateChain = createUpdateChain();
  const selectChain = createSelectChain(existing);
  const insertChain = createInsertChain();

  const tx = {
    update: updateChain.update,
    select: selectChain.select,
    insert: insertChain.insert,
  };

  const dbRw = {
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(tx)
    ),
  };

  return {
    repository: new PushSubscriptionCreatorRepository(dbRw as never),
    dbRw,
    update: updateChain.update,
    values: insertChain.values,
  };
}

describe('PushSubscriptionCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('push-subscription-id');
  });

  it('returns canonical id when a subscription already exists', async () => {
    const { repository, update, values } = createRepository([
      { push_subscription_id: 'canonical-id' },
      { push_subscription_id: 'duplicate-id' },
    ]);

    await expect(
      repository.createOrUpdate({
        user_id: 'user-1',
        provider: 'webpush',
        platform: 'chrome',
        endpoint: 'endpoint-1',
        p256dh: 'p256',
        auth: 'auth',
        user_agent: 'agent',
      } as never)
    ).resolves.toEqual({ push_subscription_id: 'canonical-id' });

    expect(update).toHaveBeenCalledTimes(3);
    expect(values).not.toHaveBeenCalled();
  });

  it('reuses canonical id without duplicate cleanup when there is only one existing row', async () => {
    const { repository, update } = createRepository([
      { push_subscription_id: 'canonical-id' },
    ]);

    await expect(
      repository.createOrUpdate({
        user_id: 'user-1',
        provider: 'webpush',
        platform: 'chrome',
        endpoint: 'endpoint-1',
        user_agent: 'agent',
      } as never)
    ).resolves.toEqual({ push_subscription_id: 'canonical-id' });

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('creates a new subscription when none exists', async () => {
    const { repository, update, values } = createRepository([]);

    await expect(
      repository.createOrUpdate({
        user_id: 'user-1',
        provider: 'webpush',
        platform: 'chrome',
        endpoint: 'endpoint-1',
        p256dh: null,
        auth: null,
        user_agent: 'agent',
      } as never)
    ).resolves.toEqual({ push_subscription_id: 'push-subscription-id' });

    expect(update).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        push_subscription_id: 'push-subscription-id',
        user_id: 'user-1',
        endpoint: 'endpoint-1',
        p256dh: null,
        auth: null,
      })
    );
  });
});
