import 'reflect-metadata';
import { CrossSellAccountListerRepository } from '@core/repositories/planCrossSell/CrossSellAccountLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const leftJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ leftJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('CrossSellAccountListerRepository', () => {
  it('returns empty array when no accounts exist', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new CrossSellAccountListerRepository(dbRo as never);

    await expect(repository.listCrossSellAccounts('cs-1')).resolves.toEqual([]);
  });

  it('maps cross sell accounts with optional account payload', async () => {
    const rows = [
      {
        plan_cross_sell_account_id: 'csa-1',
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        account: {
          account_id: 'acc-1',
          name: 'Conta 1',
        },
      },
      {
        plan_cross_sell_account_id: 'csa-2',
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-2',
        created_at: '2026-04-21T00:00:00.000Z',
        account: {
          account_id: null,
          name: null,
        },
      },
    ];

    const { dbRo } = createSelectChain(rows);
    const repository = new CrossSellAccountListerRepository(dbRo as never);

    await expect(repository.listCrossSellAccounts('cs-1')).resolves.toEqual([
      {
        plan_cross_sell_account_id: 'csa-1',
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        account: {
          account_id: 'acc-1',
          name: 'Conta 1',
        },
      },
      {
        plan_cross_sell_account_id: 'csa-2',
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-2',
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ]);
  });
});
