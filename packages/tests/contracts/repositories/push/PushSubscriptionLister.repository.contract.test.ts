import 'reflect-metadata';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    where,
  };
}

describe('PushSubscriptionListerRepository', () => {
  it('returns subscriptions by user id', async () => {
    const rows = [
      {
        push_subscription_id: 'push-1',
        user_id: 'user-1',
        provider: 'webpush',
        platform: 'chrome',
        endpoint: 'endpoint-1',
        p256dh: 'p256',
        auth: 'auth',
      },
    ];

    const { dbRo, where } = createSelectChain(rows);
    const repository = new PushSubscriptionListerRepository(dbRo as never);

    await expect(repository.listByUserId('user-1')).resolves.toEqual(rows);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
