import { inject, injectable } from 'tsyringe';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { withLock } from '@core/common/functions/withLock';
import { AccountService } from './account.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { TFunction } from 'i18next';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardSchedulesRepository } from '@core/repositories/dashboard/DashboardSchedules.repository';
import { AiAgentService } from './aiAgent.service';
import { PlanLimitEnforcementService } from './planLimitEnforcement.service';
import Redis from 'ioredis';
import { PlanEntitlementService } from './planEntitlement.service';

@injectable()
export class PlanAccountService {
  constructor(
    @inject(PlanAccountUpdaterRepository)
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(DashboardStatsRepository)
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    @inject(DashboardSchedulesRepository)
    private readonly dashboardSchedulesRepository: DashboardSchedulesRepository,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(PlanLimitEnforcementService)
    private readonly planLimitEnforcementService: PlanLimitEnforcementService,
    @inject('Redis') private readonly redis: Redis,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  private readonly restoreIntegrationEntitlementAfterFailure = async (
    accountId: string,
    denyFenceOwnerToken?: string
  ): Promise<void> => {
    try {
      await (denyFenceOwnerToken
        ? this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration,
            denyFenceOwnerToken
          )
        : this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration
          ));
    } catch (error) {
      console.error(
        'Could not restore integration entitlement after a failed plan account mutation.',
        error
      );
    }
  };

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.planAccountUpdaterRepository.findPlanAccountByAccountId(
      accountId
    );
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    const projectedCycle =
      await this.planAccountUpdaterRepository.projectPlanAccountCycle(
        accountId,
        input
      );
    const projectedCycleIsActive =
      new Date(projectedCycle.nextPaymentDate).getTime() > Date.now();
    const projectedAllowed =
      projectedCycleIsActive &&
      (await this.planEntitlementService.willGrantAfterPlanAssignment({
        accountId,
        planId: input.plan_id,
        planProductId: EPlanProduct.integration,
        prospectiveLastPaymentDate: projectedCycle.lastPaymentDate,
        includeExistingAddons: true,
      }));
    const mutate = () =>
      withLock(
        this.redis,
        `plan-account:${accountId}`,
        () =>
          this.planAccountUpdaterRepository.updatePlanAccountByAccountId(
            accountId,
            input
          ),
        { ttlMs: 20000 }
      );

    if (projectedAllowed) {
      await this.planEntitlementService.refreshAfterMutation(
        accountId,
        EPlanProduct.integration
      );
      const result = await mutate();
      await this.planEntitlementService.refreshAfterMutation(
        accountId,
        EPlanProduct.integration
      );
      return result ?? false;
    }

    let denyFenceOwnerToken: string | null;
    try {
      denyFenceOwnerToken = await this.planEntitlementService.installDenyFence(
        accountId,
        EPlanProduct.integration
      );
    } catch (error) {
      throw error;
    }

    let mutationCompleted = false;

    try {
      const result = await mutate();
      mutationCompleted = true;

      await (denyFenceOwnerToken
        ? this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration,
            denyFenceOwnerToken
          )
        : this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration
          ));

      return result ?? false;
    } catch (error) {
      if (!mutationCompleted) {
        await this.restoreIntegrationEntitlementAfterFailure(
          accountId,
          denyFenceOwnerToken ?? undefined
        );
      }
      throw error;
    }
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
    await this.planLimitEnforcementService.ensureCanActivate(
      t,
      accountId,
      'user'
    );
  }

  async validateCanCreateWorker(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    await this.planLimitEnforcementService.ensureCanActivate(
      t,
      accountId,
      'worker'
    );
  }

  async validateCanCreateRole(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    await this.planLimitEnforcementService.ensureCanActivate(
      t,
      accountId,
      'role'
    );
  }

  async validateCanCreateChatbot(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    await this.planLimitEnforcementService.ensureCanActivate(
      t,
      accountId,
      'chatbot'
    );
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

  async viewAiAgentConfigByAccountId(accountId: string): Promise<{
    ai_agent: number | null;
    enabled: boolean;
    total: number;
  }> {
    const [aiAgentQuantity, total] = await Promise.all([
      this.accountService.viewAccountQuantityProduct(
        accountId,
        EPlanProduct.ai_agent
      ),
      this.aiAgentService.totalAiAgentByAccountId(accountId),
    ]);

    const enabled = aiAgentQuantity > 0;

    return {
      ai_agent: aiAgentQuantity > 0 ? aiAgentQuantity : null,
      enabled,
      total,
    };
  }

  async validateCanCreateAiAgent(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    await this.planLimitEnforcementService.ensureCanActivate(
      t,
      accountId,
      'ai_agent'
    );
  }
}
