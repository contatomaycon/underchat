import 'reflect-metadata';

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(),
}));
jest.mock(
  '@core/repositories/planAccount/PlanAccountUpdater.repository',
  () => ({
    PlanAccountUpdaterRepository: class {},
  })
);
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/repositories/dashboard/DashboardStats.repository', () => ({
  DashboardStatsRepository: class {},
}));
jest.mock('@core/repositories/dashboard/DashboardSchedules.repository', () => ({
  DashboardSchedulesRepository: class {},
}));
jest.mock('@core/services/aiAgent.service', () => ({
  AiAgentService: class {},
}));
jest.mock('@core/services/planLimitEnforcement.service', () => ({
  PlanLimitEnforcementService: class {},
}));
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));

import { withLock } from '@core/common/functions/withLock';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanAccountService } from '@core/services/planAccount.service';

describe('PlanAccountService', () => {
  const t = ((key: string) => key) as never;

  const makeService = () => {
    const planAccountUpdaterRepository = {
      findPlanAccountByAccountId: jest.fn(async () => ({
        account_id: 'acc-1',
      })),
      projectPlanAccountCycle: jest.fn(async () => ({
        lastPaymentDate: '2098-12-01T00:00:00.000Z',
        nextPaymentDate: '2099-01-01T00:00:00.000Z',
      })),
      updatePlanAccountByAccountId: jest.fn(async () => true),
    };

    const accountService = {
      viewAccountQuantityProduct: jest.fn(async () => 1),
    };

    const dashboardStatsRepository = {
      getContactsTotal: jest.fn(async () => 0),
    };

    const dashboardSchedulesRepository = {
      getSchedulesSentMonthly: jest.fn(async () => 0),
    };

    const aiAgentService = {
      totalAiAgentByAccountId: jest.fn(async () => 0),
    };

    const planLimitEnforcementService = {
      ensureCanActivate: jest.fn(async () => undefined),
    };
    const planEntitlementService = {
      installDenyFence: jest.fn(async (): Promise<string | null> => null),
      refreshAfterMutation: jest.fn(async () => ({ allowed: true })),
      willGrantAfterPlanAssignment: jest.fn(async () => false),
    };

    const redis = {};

    const service = new PlanAccountService(
      planAccountUpdaterRepository as never,
      accountService as never,
      dashboardStatsRepository as never,
      dashboardSchedulesRepository as never,
      aiAgentService as never,
      planLimitEnforcementService as never,
      redis as never,
      planEntitlementService as never
    );

    return {
      service,
      planAccountUpdaterRepository,
      accountService,
      dashboardStatsRepository,
      dashboardSchedulesRepository,
      aiAgentService,
      planLimitEnforcementService,
      planEntitlementService,
      redis,
    };
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates findPlanAccountByAccountId', async () => {
    const { service, planAccountUpdaterRepository } = makeService();

    await expect(service.findPlanAccountByAccountId('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
    });

    expect(
      planAccountUpdaterRepository.findPlanAccountByAccountId
    ).toHaveBeenCalledWith('acc-1');
  });

  it('uses withLock to update plan account and falls back to false for null result', async () => {
    const {
      service,
      planAccountUpdaterRepository,
      planEntitlementService,
      redis,
    } = makeService();
    planEntitlementService.installDenyFence
      .mockResolvedValueOnce('11111111-1111-4111-8111-111111111111')
      .mockResolvedValueOnce('22222222-2222-4222-8222-222222222222');

    (withLock as unknown as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(null);

    await expect(
      service.updatePlanAccountByAccountId('acc-1', { any: 'value' } as never)
    ).resolves.toBe(true);

    await expect(
      service.updatePlanAccountByAccountId('acc-1', { any: 'value' } as never)
    ).resolves.toBe(false);

    expect(withLock).toHaveBeenNthCalledWith(
      1,
      redis,
      'plan-account:acc-1',
      expect.any(Function),
      { ttlMs: 20000 }
    );

    const callFactory = (withLock as unknown as jest.Mock).mock.calls[0][2];
    await callFactory();
    expect(
      planAccountUpdaterRepository.updatePlanAccountByAccountId
    ).toHaveBeenCalledWith('acc-1', { any: 'value' });
    expect(planEntitlementService.installDenyFence).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenNthCalledWith(
      1,
      'acc-1',
      EPlanProduct.integration,
      '11111111-1111-4111-8111-111111111111'
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenNthCalledWith(
      2,
      'acc-1',
      EPlanProduct.integration,
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('does not fence an Integration plan to Integration plan assignment', async () => {
    const { service, planEntitlementService } = makeService();
    planEntitlementService.willGrantAfterPlanAssignment.mockResolvedValue(true);
    (withLock as unknown as jest.Mock).mockResolvedValueOnce(true);

    await expect(
      service.updatePlanAccountByAccountId('acc-1', {
        plan_id: 'plan-with-integration',
      } as never)
    ).resolves.toBe(true);

    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
    expect(
      planEntitlementService.willGrantAfterPlanAssignment
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        planId: 'plan-with-integration',
        includeExistingAddons: true,
      })
    );
  });

  it('does not fence a plan-to-add-on grant projected for the destination cycle', async () => {
    const { service, planEntitlementService } = makeService();
    planEntitlementService.willGrantAfterPlanAssignment.mockResolvedValue(true);
    (withLock as unknown as jest.Mock).mockResolvedValueOnce(true);

    await service.updatePlanAccountByAccountId('acc-1', {
      plan_id: 'plan-without-integration',
    } as never);

    expect(
      planEntitlementService.willGrantAfterPlanAssignment
    ).toHaveBeenCalledWith(
      expect.objectContaining({ includeExistingAddons: true })
    );
    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
  });

  it('computes total user limit as quantity + 1', async () => {
    const { service, accountService } = makeService();
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(4);

    await expect(service.totalUserLimitByAccountId('acc-1')).resolves.toBe(5);
    expect(accountService.viewAccountQuantityProduct).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.user
    );
  });

  it('delegates blocked-resource creation limits to the enforcement service', async () => {
    const { service, planLimitEnforcementService } = makeService();

    await expect(
      service.validateCanCreateUser(t, 'acc-1')
    ).resolves.toBeUndefined();
    await expect(
      service.validateCanCreateWorker(t, 'acc-1')
    ).resolves.toBeUndefined();
    await expect(
      service.validateCanCreateRole(t, 'acc-1')
    ).resolves.toBeUndefined();
    await expect(
      service.validateCanCreateChatbot(t, 'acc-1')
    ).resolves.toBeUndefined();
    await expect(
      service.validateCanCreateAiAgent(t, 'acc-1')
    ).resolves.toBeUndefined();

    expect(planLimitEnforcementService.ensureCanActivate).toHaveBeenCalledWith(
      t,
      'acc-1',
      'user'
    );
    expect(planLimitEnforcementService.ensureCanActivate).toHaveBeenCalledWith(
      t,
      'acc-1',
      'worker'
    );
    expect(planLimitEnforcementService.ensureCanActivate).toHaveBeenCalledWith(
      t,
      'acc-1',
      'role'
    );
    expect(planLimitEnforcementService.ensureCanActivate).toHaveBeenCalledWith(
      t,
      'acc-1',
      'chatbot'
    );
    expect(planLimitEnforcementService.ensureCanActivate).toHaveBeenCalledWith(
      t,
      'acc-1',
      'ai_agent'
    );
  });

  it('validates contact creation limits', async () => {
    const { service, accountService } = makeService();
    const contactTotal = (service as any).dashboardStatsRepository
      .getContactsTotal;

    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(0);
    contactTotal.mockResolvedValueOnce(0);
    await expect(service.validateCanCreateContact(t, 'acc-1')).rejects.toThrow(
      'contact_not_available'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(5);
    contactTotal.mockResolvedValueOnce(5);
    await expect(service.validateCanCreateContact(t, 'acc-1')).rejects.toThrow(
      'contact_not_available_additional'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(6);
    contactTotal.mockResolvedValueOnce(2);
    await expect(
      service.validateCanCreateContact(t, 'acc-1')
    ).resolves.toBeUndefined();
  });

  it('validates contact-received and mass-sending limits with boolean responses', async () => {
    const { service } = makeService();
    const accountQty = (service as any).accountService
      .viewAccountQuantityProduct;
    const contactsTotal = (service as any).dashboardStatsRepository
      .getContactsTotal;
    const schedulesTotal = (service as any).dashboardSchedulesRepository
      .getSchedulesSentMonthly;

    accountQty.mockResolvedValueOnce(0);
    contactsTotal.mockResolvedValueOnce(0);
    await expect(
      service.validateCanCreateContactReceived('acc-1')
    ).resolves.toBe(false);
    accountQty.mockResolvedValueOnce(2);
    contactsTotal.mockResolvedValueOnce(2);
    await expect(
      service.validateCanCreateContactReceived('acc-1')
    ).resolves.toBe(false);
    accountQty.mockResolvedValueOnce(3);
    contactsTotal.mockResolvedValueOnce(1);
    await expect(
      service.validateCanCreateContactReceived('acc-1')
    ).resolves.toBe(true);

    accountQty.mockResolvedValueOnce(0);
    schedulesTotal.mockResolvedValueOnce(0);
    await expect(service.validateCanCreateMassSending('acc-1')).resolves.toBe(
      false
    );
    accountQty.mockResolvedValueOnce(2);
    schedulesTotal.mockResolvedValueOnce(2);
    await expect(service.validateCanCreateMassSending('acc-1')).resolves.toBe(
      false
    );
    accountQty.mockResolvedValueOnce(3);
    schedulesTotal.mockResolvedValueOnce(1);
    await expect(service.validateCanCreateMassSending('acc-1')).resolves.toBe(
      true
    );

    accountQty.mockResolvedValueOnce(7);
    schedulesTotal.mockResolvedValueOnce(9);
    await expect(
      service.totalMassSendingLimitByAccountId('acc-1')
    ).resolves.toBe(7);
    await expect(service.getMassSendingTotal('acc-1')).resolves.toBe(9);
  });

  it('validates personalization availability', async () => {
    const { service } = makeService();

    (service as any).accountService.viewAccountQuantityProduct
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(
      service.validateCanCreatePersonalization('acc-1')
    ).resolves.toBe(false);
    await expect(
      service.validateCanCreatePersonalization('acc-1')
    ).resolves.toBe(true);
  });

  it('builds ai agent config', async () => {
    const { service } = makeService();

    (service as any).accountService.viewAccountQuantityProduct
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    (service as any).aiAgentService.totalAiAgentByAccountId
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    await expect(
      service.viewAiAgentConfigByAccountId('acc-1')
    ).resolves.toEqual({
      ai_agent: null,
      enabled: false,
      total: 1,
    });

    await expect(
      service.viewAiAgentConfigByAccountId('acc-1')
    ).resolves.toEqual({
      ai_agent: 2,
      enabled: true,
      total: 1,
    });

    await expect(
      service.viewAiAgentConfigByAccountId('acc-1')
    ).resolves.toEqual({
      ai_agent: 3,
      enabled: true,
      total: 1,
    });
  });
});
