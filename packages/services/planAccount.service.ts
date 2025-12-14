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
import { DashboardAdditionalRepository } from '@core/repositories/dashboard/DashboardAdditional.repository';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import Redis from 'ioredis';

@injectable()
export class PlanAccountService {
  constructor(
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly roleService: RoleService,
    private readonly dashboardAdditionalRepository: DashboardAdditionalRepository,
    private readonly dashboardStatsRepository: DashboardStatsRepository,
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

  async validateCanCreateUser(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const [viewAccountQuantityProduct, totalUserByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.user
        ),
        this.userService.totalUserByAccount(accountId),
      ]);

    const userLimit = viewAccountQuantityProduct + 1;
    if (userLimit <= 0) {
      throw new Error(t('user_not_available'));
    }

    if (totalUserByAccountId >= userLimit) {
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
        this.dashboardAdditionalRepository.getChatbotsTotal(accountId),
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
}
