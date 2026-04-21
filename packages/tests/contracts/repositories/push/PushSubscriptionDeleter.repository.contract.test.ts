import 'reflect-metadata';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';

function createDbRw(options?: {
  returningResult?: unknown[];
  rowCount?: number;
}) {
  const returning = jest.fn(
    async () => options?.returningResult ?? [{ push_subscription_id: 'id-1' }]
  );
  const whereForUpdate = jest.fn(() => ({ returning }));
  const set = jest.fn(() => ({ where: whereForUpdate }));
  const update = jest.fn(() => ({ set }));

  const execute = jest.fn(async () => ({ rowCount: options?.rowCount ?? 1 }));
  const whereForDelete = jest.fn(() => ({ execute }));
  const del = jest.fn(() => ({ where: whereForDelete }));

  return {
    dbRw: {
      update,
      delete: del,
    },
    whereForUpdate,
    whereForDelete,
  };
}

describe('PushSubscriptionDeleterRepository', () => {
  it('deleteByEndpoint returns true when records are updated', async () => {
    const { dbRw, whereForUpdate } = createDbRw({
      returningResult: [{ push_subscription_id: 'id-1' }],
    });
    const repository = new PushSubscriptionDeleterRepository(dbRw as never);

    await expect(repository.deleteByEndpoint('endpoint-1')).resolves.toBe(true);
    expect(whereForUpdate).toHaveBeenCalledTimes(1);
  });

  it('deleteByEndpoint returns false when no records are updated', async () => {
    const { dbRw } = createDbRw({ returningResult: [] });
    const repository = new PushSubscriptionDeleterRepository(dbRw as never);

    await expect(
      repository.deleteByEndpoint('endpoint-1', 'webpush')
    ).resolves.toBe(false);
  });

  it('deleteByUserId returns true when at least one row is returned', async () => {
    const { dbRw } = createDbRw({
      returningResult: [{ push_subscription_id: 'id-1' }],
    });
    const repository = new PushSubscriptionDeleterRepository(dbRw as never);

    await expect(repository.deleteByUserId('user-1')).resolves.toBe(true);
  });

  it('deleteByUserAndEndpoint applies optional provider filter', async () => {
    const { dbRw, whereForUpdate } = createDbRw({
      returningResult: [{ push_subscription_id: 'id-1' }],
    });
    const repository = new PushSubscriptionDeleterRepository(dbRw as never);

    await expect(
      repository.deleteByUserAndEndpoint('user-1', 'endpoint-1', 'webpush')
    ).resolves.toBe(true);
    expect(whereForUpdate).toHaveBeenCalledTimes(1);
  });

  it('hardDeleteByEndpoint returns false when delete rowCount is zero', async () => {
    const { dbRw } = createDbRw({ rowCount: 0 });
    const repository = new PushSubscriptionDeleterRepository(dbRw as never);

    await expect(
      repository.hardDeleteByEndpoint('endpoint-1', 'webpush')
    ).resolves.toBe(false);
  });
});
