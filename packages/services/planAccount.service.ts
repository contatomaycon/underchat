import { inject, injectable } from 'tsyringe';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { withLock } from '@core/common/functions/withLock';
import { AccountService } from './account.service';
import { UserService } from './user.service';
import { WorkerService } from './worker.service';
import { RoleService } from './role.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { TFunction } from 'i18next';
import { DashboardChatbotsRepository } from '@core/repositories/dashboard/DashboardChatbots.repository';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardSchedulesRepository } from '@core/repositories/dashboard/DashboardSchedules.repository';
import { WorkerConfigService } from './workerConfig.service';
import { AiAgentService } from './aiAgent.service';
import Redis from 'ioredis';

@injectable()
export class PlanAccountService {
  constructor(
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly roleService: RoleService,
    private readonly dashboardChatbotsRepository: DashboardChatbotsRepository,
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    private readonly dashboardSchedulesRepository: DashboardSchedulesRepository,
    private readonly workerConfigService: WorkerConfigService,
    private readonly aiAgentService: AiAgentService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.planAccountUpdaterRepository.findPlanAccountByAccountId(
      accountId
    );
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    const lockKey = `plan-account:${accountId}`;
    const result = await withLock(
      this.redis,
      lockKey,
      () =>
        this.planAccountUpdaterRepository.updatePlanAccountByAccountId(
          accountId,
          input
        ),
      { ttlMs: 20000 }
    );

    return result ?? false;
  };

  async totalUserLimitByAccountId(accountId: string): Promise<number> {
    const viewAccountQuantityProduct =
      await this.accountService.viewAccountQuantityProduct(
        accountId,
        EPlanProduct.user
      );

    return viewAccountQuantityProduct + 1;
  }

  async validateCanCreateUser(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalUserByAccountId] =
      await Promise.all([
        this.totalUserLimitByAccountId(accountId),
        this.userService.totalUserByAccount(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('user_not_available'));
    }

    if (totalUserByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('user_not_available_additional'));
    }
  }

  async validateCanCreateWorker(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalWorkerByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.worker
        ),
        this.workerService.totalWorkerByAccountId(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('worker_not_available'));
    }

    if (totalWorkerByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('worker_not_available_additional'));
    }
  }

  async validateCanCreateRole(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalRoleByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.role
        ),
        this.roleService.totalRoleByAccount(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('role_not_available'));
    }

    if (totalRoleByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('role_not_available_additional'));
    }
  }

  async validateCanCreateChatbot(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalChatbotByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.chatbot
        ),
        this.dashboardChatbotsRepository.getChatbotsTotal(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('chatbot_not_available'));
    }

    if (totalChatbotByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('chatbot_not_available_additional'));
    }
  }

  async validateCanCreateContact(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalContactByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.contact
        ),
        this.dashboardStatsRepository.getContactsTotal(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('contact_not_available'));
    }

    if (totalContactByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('contact_not_available_additional'));
    }
  }

  async validateCanCreateContactReceived(accountId: string): Promise<boolean> {
    const [viewAccountQuantityProduct, totalContactByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.contact
        ),
        this.dashboardStatsRepository.getContactsTotal(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      return false;
    }

    if (totalContactByAccountId >= viewAccountQuantityProduct) {
      return false;
    }

    return true;
  }

  async validateCanCreateMassSending(accountId: string): Promise<boolean> {
    const [viewAccountQuantityProduct, totalMassSendingByAccountId] =
      await Promise.all([
        this.totalMassSendingLimitByAccountId(accountId),
        this.getMassSendingTotal(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      return false;
    }

    if (totalMassSendingByAccountId >= viewAccountQuantityProduct) {
      return false;
    }

    return true;
  }

  async totalMassSendingLimitByAccountId(accountId: string): Promise<number> {
    const viewAccountQuantityProduct =
      await this.accountService.viewAccountQuantityProduct(
        accountId,
        EPlanProduct.mass_sending
      );

    return viewAccountQuantityProduct;
  }

  async getMassSendingTotal(accountId: string): Promise<number> {
    return this.dashboardSchedulesRepository.getSchedulesSentMonthly(accountId);
  }

  async validateCanCreatePersonalization(accountId: string): Promise<boolean> {
    const viewAccountQuantityProduct =
      await this.accountService.viewAccountQuantityProduct(
        accountId,
        EPlanProduct.personalization
      );

    if (viewAccountQuantityProduct <= 0) {
      return false;
    }

    return true;
  }

  async validateCanCreateAiAgent(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [aiAgentConfig, totalAiAgentsByAccountId] = await Promise.all([
      this.workerConfigService.viewAiAgentConfigByAccountId(accountId),
      this.aiAgentService.totalAiAgentByAccountId(accountId),
    ]);

    if (
      !aiAgentConfig.enabled ||
      aiAgentConfig.ai_agent === null ||
      aiAgentConfig.ai_agent <= 0
    ) {
      throw new Error(t('ai_agent_not_available'));
    }

    if (totalAiAgentsByAccountId >= aiAgentConfig.ai_agent) {
      throw new Error(t('ai_agent_not_available_additional'));
    }
  }
}
