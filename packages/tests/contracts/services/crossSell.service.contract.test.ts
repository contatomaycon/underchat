import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
jest.mock(
  '@core/repositories/planEntitlement/PlanEntitlement.repository',
  () => ({ PlanEntitlementRepository: class {} })
);
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));
import { CrossSellService } from '@core/services/crossSell.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

describe('CrossSellService', () => {
  const makeService = () => {
    const listCrossSells = jest.fn(async () => [{ cross_sell_id: 'cs1' }]);
    const listCrossSellsTotal = jest.fn(async () => 8);
    const crossSellUpdaterRepository = {
      updateCrossSell: jest.fn(async () => true),
    };
    const crossSellDeleterTransactionRepository = {
      deleteCrossSell: jest.fn(async () => true),
    };
    const crossSellAccountCreatorRepository = {
      createCrossSellAccount: jest.fn(async () => 'csa1'),
    };
    const crossSellAccountSingleDeleterRepository = {
      deleteCrossSellAccountById: jest.fn(async () => true),
    };
    const planEntitlementRepository = {
      findCrossSellContext: jest.fn(async () => ({
        planProductId: 'non-integration-product',
        accountIds: ['acc-1'],
      })),
      findCrossSellAccountContext: jest.fn(async () => ({
        accountId: 'acc-1',
        planProductId: 'non-integration-product',
      })),
    };
    const planEntitlementService = {
      installDenyFencesForCrossSell: jest.fn(async () => undefined),
      installDenyFenceForCrossSellAccount: jest.fn(async () => undefined),
      refreshAccounts: jest.fn(async () => []),
      refreshAfterMutation: jest.fn(async () => ({ allowed: false })),
      refreshAccountsForCrossSell: jest.fn(async () => []),
      refreshCrossSellAccount: jest.fn(async () => null),
    };

    const service = new CrossSellService(
      { listCrossSells, listCrossSellsTotal } as never,
      { createCrossSell: jest.fn(async () => 'cs1') } as never,
      crossSellUpdaterRepository as never,
      crossSellDeleterTransactionRepository as never,
      crossSellAccountCreatorRepository as never,
      {
        listCrossSellAccounts: jest.fn(async () => [
          { cross_sell_account_id: 'csa1' },
        ]),
      } as never,
      crossSellAccountSingleDeleterRepository as never,
      planEntitlementRepository as never,
      planEntitlementService as never
    );

    return {
      service,
      planEntitlementRepository,
      planEntitlementService,
      crossSellUpdaterRepository,
      crossSellDeleterTransactionRepository,
      crossSellAccountCreatorRepository,
      crossSellAccountSingleDeleterRepository,
    };
  };

  it('delegates list and CRUD methods', async () => {
    const { service } = makeService();

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

  it('refreshes a confirmed manual Integration add-on grant', async () => {
    const {
      service,
      planEntitlementRepository,
      planEntitlementService,
      crossSellAccountCreatorRepository,
    } = makeService();
    planEntitlementRepository.findCrossSellContext.mockResolvedValueOnce({
      planProductId: EPlanProduct.integration,
      accountIds: ['acc-1'],
    });

    await expect(
      service.createCrossSellAccount({
        plan_cross_sell_id: 'cs1',
        account_id: 'acc-1',
      })
    ).resolves.toBe('csa1');

    expect(planEntitlementService.refreshCrossSellAccount).toHaveBeenCalledWith(
      'csa1'
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.refreshAfterMutation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      crossSellAccountCreatorRepository.createCrossSellAccount.mock
        .invocationCallOrder[0]
    );
  });

  it('reconciles the denied epoch before switching an add-on to Integration', async () => {
    const { service, planEntitlementService, crossSellUpdaterRepository } =
      makeService();

    await expect(
      service.updateCrossSell('cs1', {
        plan_product_id: EPlanProduct.integration,
      })
    ).resolves.toBe(true);

    expect(planEntitlementService.refreshAccounts).toHaveBeenCalledWith(
      ['acc-1'],
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.installDenyFencesForCrossSell
    ).not.toHaveBeenCalled();
    expect(
      planEntitlementService.refreshAccounts.mock.invocationCallOrder[0]
    ).toBeLessThan(
      crossSellUpdaterRepository.updateCrossSell.mock.invocationCallOrder[0]
    );
    expect(
      planEntitlementService.refreshAccountsForCrossSell
    ).toHaveBeenCalledWith('cs1', 'non-integration-product');
  });

  it('does not create an entitlement epoch for positive boolean quantity changes', async () => {
    const {
      service,
      planEntitlementRepository,
      planEntitlementService,
      crossSellUpdaterRepository,
    } = makeService();
    planEntitlementRepository.findCrossSellContext.mockResolvedValueOnce({
      planProductId: EPlanProduct.integration,
      accountIds: ['acc-1'],
    });

    await expect(service.updateCrossSell('cs1', { quantity: 2 })).resolves.toBe(
      true
    );

    expect(
      planEntitlementService.installDenyFencesForCrossSell
    ).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAccounts).toHaveBeenCalledWith(
      ['acc-1'],
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.refreshAccountsForCrossSell
    ).toHaveBeenCalledWith('cs1', EPlanProduct.integration);
    expect(
      planEntitlementService.refreshAccounts.mock.invocationCallOrder[0]
    ).toBeLessThan(
      crossSellUpdaterRepository.updateCrossSell.mock.invocationCallOrder[0]
    );
  });

  it('fences an Integration add-on account before revoking it', async () => {
    const { service, planEntitlementRepository, planEntitlementService } =
      makeService();
    planEntitlementRepository.findCrossSellAccountContext.mockResolvedValueOnce(
      {
        accountId: 'acc-1',
        planProductId: EPlanProduct.integration,
      }
    );

    await expect(service.deleteCrossSellAccount('csa1')).resolves.toBe(true);

    expect(
      planEntitlementService.installDenyFenceForCrossSellAccount
    ).toHaveBeenCalledWith('csa1');
    expect(planEntitlementService.refreshCrossSellAccount).toHaveBeenCalledWith(
      'csa1'
    );
  });
});
