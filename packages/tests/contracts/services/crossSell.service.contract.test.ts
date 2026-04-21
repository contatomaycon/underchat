import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { CrossSellService } from '@core/services/crossSell.service';

describe('CrossSellService', () => {
  it('delegates list and CRUD methods', async () => {
    const listCrossSells = jest.fn(async () => [{ cross_sell_id: 'cs1' }]);
    const listCrossSellsTotal = jest.fn(async () => 8);

    const service = new CrossSellService(
      { listCrossSells, listCrossSellsTotal } as never,
      { createCrossSell: jest.fn(async () => 'cs1') } as never,
      { updateCrossSell: jest.fn(async () => true) } as never,
      { deleteCrossSell: jest.fn(async () => true) } as never,
      { createCrossSellAccount: jest.fn(async () => 'csa1') } as never,
      {
        listCrossSellAccounts: jest.fn(async () => [
          { cross_sell_account_id: 'csa1' },
        ]),
      } as never,
      { deleteCrossSellAccountById: jest.fn(async () => true) } as never
    );

    await expect(service.listCrossSells(10, 1, {} as never)).resolves.toEqual([
      [{ cross_sell_id: 'cs1' }],
      8,
    ]);
    await expect(service.createCrossSell({} as never)).resolves.toBe('cs1');
    await expect(service.updateCrossSell('cs1', {} as never)).resolves.toBe(
      true
    );
    await expect(
      service.deleteCrossSell(((k: string) => k) as never, 'cs1')
    ).resolves.toBe(true);
    await expect(service.createCrossSellAccount({} as never)).resolves.toBe(
      'csa1'
    );
    await expect(service.listCrossSellAccounts('cs1')).resolves.toEqual([
      { cross_sell_account_id: 'csa1' },
    ]);
    await expect(service.deleteCrossSellAccount('csa1')).resolves.toBe(true);
  });
});
