import 'reflect-metadata';
import { CrossSellDeleterTransactionRepository } from '@core/repositories/planCrossSell/CrossSellDeleterTransaction.repository';

describe('CrossSellDeleterTransactionRepository', () => {
  it('deletes only cross sell when there are no account relations', async () => {
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback('tx-object')
      ),
    };
    const crossSellAccountDeleterRepository = {
      deleteCrossSellAccountsByCrossSellId: jest.fn(async () => true),
    };
    const crossSellDeleterRepository = {
      deleteCrossSellById: jest.fn(async () => true),
    };
    const crossSellAccountViewerExistsRepository = {
      existsCrossSellAccountsByCrossSellId: jest.fn(async () => false),
    };

    const repository = new CrossSellDeleterTransactionRepository(
      dbRw as never,
      crossSellAccountDeleterRepository as never,
      crossSellDeleterRepository as never,
      crossSellAccountViewerExistsRepository as never
    );
    const t = ((k: string) => k) as never;

    await expect(repository.deleteCrossSell(t, 'cs-1')).resolves.toBe(true);

    expect(
      crossSellAccountDeleterRepository.deleteCrossSellAccountsByCrossSellId
    ).not.toHaveBeenCalled();
    expect(crossSellDeleterRepository.deleteCrossSellById).toHaveBeenCalledWith(
      'tx-object',
      'cs-1'
    );
  });

  it('throws translated error when account relation deletion fails', async () => {
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback('tx-object')
      ),
    };
    const crossSellAccountDeleterRepository = {
      deleteCrossSellAccountsByCrossSellId: jest.fn(async () => false),
    };
    const crossSellDeleterRepository = {
      deleteCrossSellById: jest.fn(async () => true),
    };
    const crossSellAccountViewerExistsRepository = {
      existsCrossSellAccountsByCrossSellId: jest.fn(async () => true),
    };

    const repository = new CrossSellDeleterTransactionRepository(
      dbRw as never,
      crossSellAccountDeleterRepository as never,
      crossSellDeleterRepository as never,
      crossSellAccountViewerExistsRepository as never
    );
    const t = ((k: string) => `translated:${k}`) as never;

    await expect(repository.deleteCrossSell(t, 'cs-1')).rejects.toThrow(
      'translated:cross_sell_accounts_deleter_error'
    );
  });

  it('throws translated error when cross sell deletion fails', async () => {
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback('tx-object')
      ),
    };
    const crossSellAccountDeleterRepository = {
      deleteCrossSellAccountsByCrossSellId: jest.fn(async () => true),
    };
    const crossSellDeleterRepository = {
      deleteCrossSellById: jest.fn(async () => false),
    };
    const crossSellAccountViewerExistsRepository = {
      existsCrossSellAccountsByCrossSellId: jest.fn(async () => true),
    };

    const repository = new CrossSellDeleterTransactionRepository(
      dbRw as never,
      crossSellAccountDeleterRepository as never,
      crossSellDeleterRepository as never,
      crossSellAccountViewerExistsRepository as never
    );
    const t = ((k: string) => `translated:${k}`) as never;

    await expect(repository.deleteCrossSell(t, 'cs-1')).rejects.toThrow(
      'translated:cross_sell_deleter_error'
    );
  });
});
