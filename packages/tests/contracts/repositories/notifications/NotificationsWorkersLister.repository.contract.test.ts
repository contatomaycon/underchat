import 'reflect-metadata';
import { NotificationsWorkersListerRepository } from '@core/repositories/notifications/NotificationsWorkersLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    where,
  };
}

describe('NotificationsWorkersListerRepository', () => {
  it('returns workers list for account', async () => {
    const rows = [{ id: 'w-1', name: 'Atendimento', number: '5511999999999' }];
    const { dbRo, where } = createSelectChain(rows);

    const repository = new NotificationsWorkersListerRepository(dbRo as never);

    await expect(repository.listWorkersByAccount('acc-1')).resolves.toEqual(
      rows
    );
    expect(where).toHaveBeenCalledTimes(1);
  });
});
