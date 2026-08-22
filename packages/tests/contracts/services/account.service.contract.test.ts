import 'reflect-metadata';

jest.mock('@core/repositories/account/AccountInfoViewer.repository', () => ({
  AccountInfoViewerRepository: class {},
}));
jest.mock(
  '@core/repositories/account/AccountQuantityProductViewer.repository',
  () => ({
    AccountQuantityProductViewerRepository: class {},
  })
);
jest.mock('@core/repositories/account/AccountViewerExists.repository', () => ({
  AccountViewerExistsRepository: class {},
}));
jest.mock('@core/repositories/account/AccountNameViewer.repository', () => ({
  AccountNameViewerRepository: class {},
}));
jest.mock('@core/repositories/account/AccountLister.repository', () => ({
  AccountListerRepository: class {},
}));
jest.mock('@core/repositories/account/AccountCreator.repository', () => ({
  AccountCreatorRepository: class {},
}));
jest.mock('@core/repositories/account/AccountViewer.repository', () => ({
  AccountViewerRepository: class {},
}));
jest.mock('@core/repositories/account/AccountDeleter.repository', () => ({
  AccountDeleterRepository: class {},
}));
jest.mock('@core/repositories/account/AccountUpdater.repository', () => ({
  AccountUpdaterRepository: class {},
}));
jest.mock(
  '@core/repositories/account/AccountInfoViewerExists.repository',
  () => ({
    AccountInfoViewerExistsRepository: class {},
  })
);
jest.mock('@core/repositories/account/AccountInfoCreator.repository', () => ({
  AccountInfoCreatorRepository: class {},
}));
jest.mock('@core/repositories/account/AccountInfoUpdater.repository', () => ({
  AccountInfoUpdaterRepository: class {},
}));
jest.mock(
  '@core/repositories/account/AccountInfoByIdViewerExists.repository',
  () => ({
    AccountInfoByIdViewerExistsRepository: class {},
  })
);
jest.mock('@core/repositories/account/AccountAllLister.repository', () => ({
  AccountAllListerRepository: class {},
}));
jest.mock(
  '@core/repositories/account/AccountSubscriptionsLister.repository',
  () => ({
    AccountSubscriptionsListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/planAccount/PlanAccountStatusViewer.repository',
  () => ({
    PlanAccountStatusViewerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/account/AccountAllListerWithDetails.repository',
  () => ({
    AccountAllListerWithDetailsRepository: class {},
  })
);
jest.mock(
  '@core/repositories/planAccountExclusive/PlanAccountExclusiveLister.repository',
  () => ({
    PlanAccountExclusiveListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/planAccountExclusive/PlanAccountExclusiveCreator.repository',
  () => ({
    PlanAccountExclusiveCreatorRepository: class {},
  })
);
jest.mock(
  '@core/repositories/planAccountExclusive/PlanAccountExclusiveDeleter.repository',
  () => ({
    PlanAccountExclusiveDeleterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/planAccountExclusive/ExclusivePlansLister.repository',
  () => ({
    ExclusivePlansListerRepository: class {},
  })
);

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { AccountService } from '@core/services/account.service';

describe('AccountService', () => {
  const makeService = () => {
    const accountInfoViewerRepository = {
      viewAccountInfoByAccountId: jest.fn(async () => ({
        account_id: 'acc-1',
      })),
      viewLogoByAccountInfoId: jest.fn(async () => 'logo.png'),
    };
    const accountQuantityProductViewerRepository = {
      viewAccountQuantityProduct: jest.fn(async () => 5),
    };
    const accountPlanProductIdsListerRepository = {
      listActivePlanProductIds: jest.fn(async () => ['prod-1']),
    };
    const accountViewerExistsRepository = {
      existsAccountById: jest.fn(async () => true),
    };
    const accountNameViewerRepository = {
      viewAccountName: jest.fn(async () => ({ name: 'Account 1' })),
    };
    const accountListerRepository = {
      listAccounts: jest.fn(async () => [{ account_id: 'acc-1' }]),
      listAccountsTotal: jest.fn(async () => 1),
    };
    const accountCreatorRepository = {
      createAccount: jest.fn(async () => 'acc-1'),
      createAccountWithPlanAndApiKey: jest.fn(async () => 'acc-2'),
    };
    const accountViewerRepository = {
      viewAccounts: jest.fn(async () => ({ account_id: 'acc-1' })),
    };
    const accountDeleterRepository = {
      deleteAccountById: jest.fn(async () => true),
    };
    const accountUpdaterRepository = {
      updateAccountById: jest.fn(async () => true),
      updateAccountStatusById: jest.fn(async () => true),
    };
    const accountInfoViewerExistsRepository = {
      existsAccountInfoById: jest.fn(async () => true),
      totalAccountInfoByAccountId: jest.fn(async () => 2),
    };
    const accountInfoCreatorRepository = {
      createAccountInfo: jest.fn(async () => 'info-1'),
    };
    const accountInfoUpdaterRepository = {
      updateAccountInfoById: jest.fn(async () => true),
    };
    const accountInfoByIdViewerExistsRepository = {
      accountInfoByIdExists: jest.fn(async () => true),
    };
    const accountAllListerRepository = {
      listAllAccounts: jest.fn(async () => [
        { account_id: 'acc-1', name: 'A' },
      ]),
    };
    const accountSubscriptionsListerRepository = {
      listAccountSubscriptions: jest.fn(async () => ({ results: [] })),
    };
    const planAccountStatusViewerRepository = {
      viewLatestByAccountId: jest.fn<Promise<any | null>, any[]>(async () => ({
        account_status_id: EAccountStatus.active,
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: null,
      })),
    };
    const accountAllListerWithDetailsRepository = {
      listAccounts: jest.fn(async () => [
        { account_id: 'acc-1', details: true },
      ]),
      listAccountsTotal: jest.fn(async () => 1),
    };
    const planAccountExclusiveListerRepository = {
      listPlanAccountExclusives: jest.fn(async () => ({ items: [] })),
    };
    const planAccountExclusiveCreatorRepository = {
      createPlanAccountExclusive: jest.fn(async () => 'pae-1'),
    };
    const planAccountExclusiveDeleterRepository = {
      deletePlanAccountExclusiveById: jest.fn(async () => true),
    };
    const exclusivePlansListerRepository = {
      listExclusivePlans: jest.fn(async () => [{ plan_id: 'p1' }]),
    };

    const redis = {
      scanStream: jest.fn(),
      del: jest.fn(async () => 0),
    };
    const planEntitlementService = {
      resolveAuthoritatively: jest.fn<
        Promise<{ allowed: boolean; source: 'plan' | null }>,
        []
      >(async () => ({ allowed: true, source: 'plan' })),
      installDenyFence: jest.fn(async () => undefined),
      refreshAfterMutation: jest.fn(async () => ({ allowed: false })),
    };

    const service = new AccountService(
      accountInfoViewerRepository as never,
      accountQuantityProductViewerRepository as never,
      accountPlanProductIdsListerRepository as never,
      accountViewerExistsRepository as never,
      accountNameViewerRepository as never,
      accountListerRepository as never,
      accountCreatorRepository as never,
      accountViewerRepository as never,
      accountDeleterRepository as never,
      accountUpdaterRepository as never,
      accountInfoViewerExistsRepository as never,
      accountInfoCreatorRepository as never,
      accountInfoUpdaterRepository as never,
      accountInfoByIdViewerExistsRepository as never,
      accountAllListerRepository as never,
      accountSubscriptionsListerRepository as never,
      planAccountStatusViewerRepository as never,
      accountAllListerWithDetailsRepository as never,
      planAccountExclusiveListerRepository as never,
      planAccountExclusiveCreatorRepository as never,
      planAccountExclusiveDeleterRepository as never,
      exclusivePlansListerRepository as never,
      redis as never,
      planEntitlementService as never
    );

    return {
      service,
      accountInfoViewerRepository,
      accountQuantityProductViewerRepository,
      accountPlanProductIdsListerRepository,
      accountViewerExistsRepository,
      accountNameViewerRepository,
      accountListerRepository,
      accountCreatorRepository,
      accountViewerRepository,
      accountDeleterRepository,
      accountUpdaterRepository,
      accountInfoViewerExistsRepository,
      accountInfoCreatorRepository,
      accountInfoUpdaterRepository,
      accountInfoByIdViewerExistsRepository,
      accountAllListerRepository,
      accountSubscriptionsListerRepository,
      planAccountStatusViewerRepository,
      accountAllListerWithDetailsRepository,
      planAccountExclusiveListerRepository,
      planAccountExclusiveCreatorRepository,
      planAccountExclusiveDeleterRepository,
      exclusivePlansListerRepository,
      planEntitlementService,
      redis,
    };
  };

  it('delegates account and account-info methods', async () => {
    const {
      service,
      accountInfoViewerRepository,
      accountQuantityProductViewerRepository,
      accountPlanProductIdsListerRepository,
      accountViewerExistsRepository,
      accountNameViewerRepository,
      accountListerRepository,
      accountCreatorRepository,
      accountViewerRepository,
      accountDeleterRepository,
      accountUpdaterRepository,
      accountInfoViewerExistsRepository,
      accountInfoCreatorRepository,
      accountInfoUpdaterRepository,
      accountInfoByIdViewerExistsRepository,
      accountAllListerRepository,
      accountSubscriptionsListerRepository,
      accountAllListerWithDetailsRepository,
      planAccountExclusiveListerRepository,
      planAccountExclusiveCreatorRepository,
      planAccountExclusiveDeleterRepository,
      exclusivePlansListerRepository,
      planEntitlementService,
    } = makeService();

    await expect(service.viewAccountInfoByAccountId('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
    });
    await expect(service.viewLogoByAccountInfoId('info-1')).resolves.toBe(
      'logo.png'
    );
    await expect(
      service.viewAccountQuantityProduct('acc-1', 'prod-1')
    ).resolves.toBe(5);
    await expect(service.listActivePlanProductIds('acc-1')).resolves.toEqual([
      'prod-1',
    ]);
    await expect(service.existsAccountById('acc-1')).resolves.toBe(true);
    await expect(service.viewAccountName('acc-1')).resolves.toEqual({
      name: 'Account 1',
    });

    await expect(
      service.listAccounts(10, 1, { search: 'x' } as never)
    ).resolves.toEqual([[{ account_id: 'acc-1' }], 1]);
    await expect(service.listAllAccounts()).resolves.toEqual([
      { account_id: 'acc-1', name: 'A' },
    ]);
    await expect(service.createAccount({ name: 'A' } as never)).resolves.toBe(
      'acc-1'
    );
    await expect(
      service.createAccountWithPlanAndApiKey({ name: 'B' } as never)
    ).resolves.toBe('acc-2');
    await expect(service.viewAccounts('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
    });
    await expect(service.deleteAccountById('acc-1')).resolves.toBe(true);
    await expect(
      service.updateAccountById({ name: 'new' } as never, 'acc-1')
    ).resolves.toBe(true);

    await expect(service.existsAccountInfoById('acc-1')).resolves.toBe(true);
    await expect(service.totalAccountInfoByAccountId('acc-1')).resolves.toBe(2);
    await expect(
      service.createAccountInfo({ account_id: 'acc-1' } as never, 'logo-url')
    ).resolves.toBe('info-1');
    await expect(
      service.updateAccountInfoById(
        'info-1',
        { field: 'x' } as never,
        undefined
      )
    ).resolves.toBe(true);
    await expect(service.accountInfoByIdExists('info-1')).resolves.toBe(true);
    await expect(service.listAccountSubscriptions('acc-1')).resolves.toEqual({
      results: [],
    });

    await expect(
      service.listAllAccountsWithDetails(10, 1, { search: 'x' } as never)
    ).resolves.toEqual([[{ account_id: 'acc-1', details: true }], 1]);
    await expect(service.listPlanAccountExclusives('acc-1')).resolves.toEqual({
      items: [],
    });
    await expect(
      service.createPlanAccountExclusive({ account_id: 'acc-1' } as never)
    ).resolves.toBe('pae-1');
    await expect(service.deletePlanAccountExclusive('pae-1')).resolves.toBe(
      true
    );
    await expect(service.listExclusivePlans('acc-1')).resolves.toEqual([
      { plan_id: 'p1' },
    ]);
    await expect(
      service.updateAccountStatusById('acc-1', EAccountStatus.blocked)
    ).resolves.toBe(true);

    expect(
      accountInfoViewerRepository.viewAccountInfoByAccountId
    ).toHaveBeenCalledWith('acc-1');
    expect(
      accountQuantityProductViewerRepository.viewAccountQuantityProduct
    ).toHaveBeenCalledWith('acc-1', 'prod-1');
    expect(
      accountPlanProductIdsListerRepository.listActivePlanProductIds
    ).toHaveBeenCalledWith('acc-1', {});
    expect(
      accountViewerExistsRepository.existsAccountById
    ).toHaveBeenCalledWith('acc-1');
    expect(accountNameViewerRepository.viewAccountName).toHaveBeenCalledWith(
      'acc-1'
    );
    expect(accountListerRepository.listAccounts).toHaveBeenCalledWith(10, 1, {
      search: 'x',
    });
    expect(accountListerRepository.listAccountsTotal).toHaveBeenCalledWith({
      search: 'x',
    });
    expect(accountCreatorRepository.createAccount).toHaveBeenCalledWith({
      name: 'A',
    });
    expect(
      accountCreatorRepository.createAccountWithPlanAndApiKey
    ).toHaveBeenCalledWith({
      name: 'B',
    });
    expect(accountViewerRepository.viewAccounts).toHaveBeenCalledWith('acc-1');
    expect(accountDeleterRepository.deleteAccountById).toHaveBeenCalledWith(
      'acc-1'
    );
    expect(accountUpdaterRepository.updateAccountById).toHaveBeenCalledWith(
      { name: 'new' },
      'acc-1'
    );
    expect(
      accountInfoViewerExistsRepository.existsAccountInfoById
    ).toHaveBeenCalledWith('acc-1');
    expect(
      accountInfoViewerExistsRepository.totalAccountInfoByAccountId
    ).toHaveBeenCalledWith('acc-1');
    expect(accountInfoCreatorRepository.createAccountInfo).toHaveBeenCalledWith(
      { account_id: 'acc-1' },
      'logo-url'
    );
    expect(
      accountInfoUpdaterRepository.updateAccountInfoById
    ).toHaveBeenCalledWith('info-1', { field: 'x' }, undefined);
    expect(
      accountInfoByIdViewerExistsRepository.accountInfoByIdExists
    ).toHaveBeenCalledWith('info-1');
    expect(
      accountSubscriptionsListerRepository.listAccountSubscriptions
    ).toHaveBeenCalledWith('acc-1');
    expect(accountAllListerRepository.listAllAccounts).toHaveBeenCalled();
    expect(
      accountAllListerWithDetailsRepository.listAccounts
    ).toHaveBeenCalledWith(10, 1, { search: 'x' });
    expect(
      accountAllListerWithDetailsRepository.listAccountsTotal
    ).toHaveBeenCalledWith({ search: 'x' });
    expect(
      planAccountExclusiveListerRepository.listPlanAccountExclusives
    ).toHaveBeenCalledWith('acc-1');
    expect(
      planAccountExclusiveCreatorRepository.createPlanAccountExclusive
    ).toHaveBeenCalledWith({ account_id: 'acc-1' });
    expect(
      planAccountExclusiveDeleterRepository.deletePlanAccountExclusiveById
    ).toHaveBeenCalledWith('pae-1');
    expect(
      exclusivePlansListerRepository.listExclusivePlans
    ).toHaveBeenCalledWith('acc-1');
    expect(
      accountUpdaterRepository.updateAccountStatusById
    ).toHaveBeenCalledWith('acc-1', EAccountStatus.blocked);
    expect(planEntitlementService.installDenyFence).toHaveBeenCalledTimes(2);
    expect(planEntitlementService.installDenyFence).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
  });

  it('does not require a Redis deny fence for already-denied delete and block mutations', async () => {
    const {
      service,
      accountDeleterRepository,
      accountUpdaterRepository,
      planEntitlementService,
    } = makeService();
    planEntitlementService.resolveAuthoritatively.mockResolvedValue({
      allowed: false,
      source: null,
    });
    planEntitlementService.installDenyFence.mockRejectedValue(
      new Error('redis unavailable')
    );

    await expect(service.deleteAccountById('acc-1')).resolves.toBe(true);
    await expect(
      service.updateAccountStatusById('acc-1', EAccountStatus.blocked)
    ).resolves.toBe(true);

    expect(planEntitlementService.resolveAuthoritatively).toHaveBeenCalledTimes(
      2
    );
    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(accountDeleterRepository.deleteAccountById).toHaveBeenCalledWith(
      'acc-1'
    );
    expect(
      accountUpdaterRepository.updateAccountStatusById
    ).toHaveBeenCalledWith('acc-1', EAccountStatus.blocked);
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
  });

  it('evaluates plan activity and blocked status across all branches', async () => {
    const { service, planAccountStatusViewerRepository } = makeService();

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      null
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.blocked,
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
        next_payment_date: null,
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
        next_payment_date: 'invalid-date',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-04-21T00:00:00.000Z').getTime());

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
        next_payment_date: '2020-01-01T00:00:00.000Z',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: '2026-01-01T00:00:00.000Z',
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(true);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(true);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.inactive,
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(true);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: 'some-other-status',
        next_payment_date: '2099-01-01T00:00:00.000Z',
        cancellation_date: null,
      }
    );
    await expect(service.isPlanActive('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.blocked,
      }
    );
    await expect(service.isAccountBlocked('acc-1')).resolves.toBe(true);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      null
    );
    await expect(service.isAccountBlocked('acc-1')).resolves.toBe(false);

    planAccountStatusViewerRepository.viewLatestByAccountId.mockResolvedValueOnce(
      {
        account_status_id: EAccountStatus.active,
      }
    );
    await expect(service.isAccountBlocked('acc-1')).resolves.toBe(false);
  });

  it('reconciles the denied epoch before and after unblocking an account', async () => {
    const { service, accountUpdaterRepository, planEntitlementService } =
      makeService();

    await expect(
      service.updateAccountStatusById('acc-1', EAccountStatus.active)
    ).resolves.toBe(true);

    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenNthCalledWith(
      1,
      'acc-1',
      EPlanProduct.integration
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenNthCalledWith(
      2,
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      accountUpdaterRepository.updateAccountStatusById
    ).toHaveBeenCalledWith('acc-1', EAccountStatus.active);
  });

  it('clears all account sessions by scanning redis keys', async () => {
    const { service, redis } = makeService();

    const streamWithKeys: any = {
      on: jest.fn(),
    };
    streamWithKeys.on.mockImplementation(
      (event: string, callback: (...args: any[]) => void) => {
        if (event === 'data') {
          callback(['jwtSession:acc-1:1', 'jwtSession:acc-1:2']);
        }
        if (event === 'end') {
          callback();
        }
        return streamWithKeys;
      }
    );

    redis.scanStream.mockReturnValueOnce(streamWithKeys);

    await expect(
      service.clearAllAccountSessions('acc-1')
    ).resolves.toBeUndefined();

    expect(redis.scanStream).toHaveBeenCalledWith({
      match: 'jwtSession:acc-1:*',
      count: 100,
    });
    expect(redis.del).toHaveBeenCalledWith(
      'jwtSession:acc-1:1',
      'jwtSession:acc-1:2'
    );

    const streamWithoutKeys: any = {
      on: jest.fn(),
    };
    streamWithoutKeys.on.mockImplementation(
      (event: string, callback: (...args: any[]) => void) => {
        if (event === 'data') {
          callback([]);
        }
        if (event === 'end') {
          callback();
        }
        return streamWithoutKeys;
      }
    );

    redis.scanStream.mockReturnValueOnce(streamWithoutKeys);
    await expect(
      service.clearAllAccountSessions('acc-2')
    ).resolves.toBeUndefined();

    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});
