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
jest.mock('@core/services/user.service', () => ({ UserService: class {} }));
jest.mock('@core/services/worker.service', () => ({ WorkerService: class {} }));
jest.mock('@core/services/role.service', () => ({ RoleService: class {} }));
jest.mock('@core/repositories/dashboard/DashboardChatbots.repository', () => ({
  DashboardChatbotsRepository: class {},
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
      updatePlanAccountByAccountId: jest.fn(async () => true),
    };

    const accountService = {
      viewAccountQuantityProduct: jest.fn(async () => 1),
    };

    const userService = {
      totalUserByAccount: jest.fn(async () => 0),
    };

    const workerService = {
      totalWorkerByAccountId: jest.fn(async () => 0),
    };

    const roleService = {
      totalRoleByAccount: jest.fn(async () => 0),
    };

    const dashboardChatbotsRepository = {
      getChatbotsTotal: jest.fn(async () => 0),
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

    const redis = {};

    const service = new PlanAccountService(
      planAccountUpdaterRepository as never,
      accountService as never,
      userService as never,
      workerService as never,
      roleService as never,
      dashboardChatbotsRepository as never,
      dashboardStatsRepository as never,
      dashboardSchedulesRepository as never,
      aiAgentService as never,
      redis as never
    );

    return {
      service,
      planAccountUpdaterRepository,
      accountService,
      userService,
      workerService,
      roleService,
      dashboardChatbotsRepository,
      dashboardStatsRepository,
      dashboardSchedulesRepository,
      aiAgentService,
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
    const { service, planAccountUpdaterRepository, redis } = makeService();

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

  it('validates user creation limits and throws translated errors', async () => {
    const { service } = makeService();

    jest.spyOn(service, 'totalUserLimitByAccountId').mockResolvedValueOnce(0);
    jest
      .spyOn((service as any).userService, 'totalUserByAccount')
      .mockResolvedValueOnce(0);

    await expect(service.validateCanCreateUser(t, 'acc-1')).rejects.toThrow(
      'user_not_available'
    );

    jest.spyOn(service, 'totalUserLimitByAccountId').mockResolvedValueOnce(2);
    jest
      .spyOn((service as any).userService, 'totalUserByAccount')
      .mockResolvedValueOnce(2);

    await expect(service.validateCanCreateUser(t, 'acc-1')).rejects.toThrow(
      'user_not_available_additional'
    );

    jest.spyOn(service, 'totalUserLimitByAccountId').mockResolvedValueOnce(3);
    jest
      .spyOn((service as any).userService, 'totalUserByAccount')
      .mockResolvedValueOnce(1);

    await expect(
      service.validateCanCreateUser(t, 'acc-1')
    ).resolves.toBeUndefined();
  });

  it('validates worker, role, chatbot and contact creation limits', async () => {
    const { service, accountService } = makeService();
    const workerTotal = (service as any).workerService.totalWorkerByAccountId;
    const roleTotal = (service as any).roleService.totalRoleByAccount;
    const chatbotTotal = (service as any).dashboardChatbotsRepository
      .getChatbotsTotal;
    const contactTotal = (service as any).dashboardStatsRepository
      .getContactsTotal;

    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(0);
    workerTotal.mockResolvedValueOnce(0);
    await expect(service.validateCanCreateWorker(t, 'acc-1')).rejects.toThrow(
      'worker_not_available'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(1);
    workerTotal.mockResolvedValueOnce(1);
    await expect(service.validateCanCreateWorker(t, 'acc-1')).rejects.toThrow(
      'worker_not_available_additional'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(2);
    workerTotal.mockResolvedValueOnce(1);
    await expect(
      service.validateCanCreateWorker(t, 'acc-1')
    ).resolves.toBeUndefined();

    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(0);
    roleTotal.mockResolvedValueOnce(0);
    await expect(service.validateCanCreateRole(t, 'acc-1')).rejects.toThrow(
      'role_not_available'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(2);
    roleTotal.mockResolvedValueOnce(2);
    await expect(service.validateCanCreateRole(t, 'acc-1')).rejects.toThrow(
      'role_not_available_additional'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(3);
    roleTotal.mockResolvedValueOnce(1);
    await expect(
      service.validateCanCreateRole(t, 'acc-1')
    ).resolves.toBeUndefined();

    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(0);
    chatbotTotal.mockResolvedValueOnce(0);
    await expect(service.validateCanCreateChatbot(t, 'acc-1')).rejects.toThrow(
      'chatbot_not_available'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(1);
    chatbotTotal.mockResolvedValueOnce(1);
    await expect(service.validateCanCreateChatbot(t, 'acc-1')).rejects.toThrow(
      'chatbot_not_available_additional'
    );
    accountService.viewAccountQuantityProduct.mockResolvedValueOnce(2);
    chatbotTotal.mockResolvedValueOnce(0);
    await expect(
      service.validateCanCreateChatbot(t, 'acc-1')
    ).resolves.toBeUndefined();

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

  it('builds ai agent config and validates ai agent creation limits', async () => {
    const { service } = makeService();

    (service as any).accountService.viewAccountQuantityProduct
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    (service as any).aiAgentService.totalAiAgentByAccountId
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
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

    await expect(service.validateCanCreateAiAgent(t, 'acc-1')).rejects.toThrow(
      'ai_agent_not_available'
    );

    await expect(service.validateCanCreateAiAgent(t, 'acc-1')).rejects.toThrow(
      'ai_agent_not_available_additional'
    );

    await expect(
      service.validateCanCreateAiAgent(t, 'acc-1')
    ).resolves.toBeUndefined();
  });
});
