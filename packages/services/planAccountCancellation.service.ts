import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AsaasService } from '@core/services/asaas';
import { currentTime } from '@core/common/functions/currentTime';
import {
  IPlanAccountCancellationData,
  IPlanAccountCancellationResult,
  IPlanAccountWithPayment,
  CancellationType,
} from '@core/common/interfaces/IPlanAccountCancellation';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { PlanAccountCancellerRepository } from '@core/repositories/accountSettings/PlanAccountCanceller.repository';
import { AccountUpdaterRepository } from '@core/repositories/account/AccountUpdater.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { WorkerService } from '@core/services/worker.service';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import { PlanAccountReactivatorTransactionRepository } from '@core/repositories/accountSettings/PlanAccountReactivatorTransaction.repository';
import Redis from 'ioredis';
import { PlanEntitlementService } from './planEntitlement.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { getPaymentRefundEntitlementFenceOperationKey } from '@core/common/constants/planEntitlement';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { enqueuePermanentWorkerDeletion } from '@core/common/functions/workerPermanentDeletionLifecycle';

@injectable()
export class PlanAccountCancellationService {
  constructor(
    @inject(AsaasService)
    private readonly asaasService: AsaasService,
    @inject(PlanAccountCancellerRepository)
    private readonly planAccountCancellerRepository: PlanAccountCancellerRepository,
    @inject(AccountUpdaterRepository)
    private readonly accountUpdaterRepository: AccountUpdaterRepository,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(NotificationMessageService)
    private readonly notificationMessageService: NotificationMessageService,
    @inject(PlanAccountReactivatorTransactionRepository)
    private readonly planAccountReactivatorTransactionRepository: PlanAccountReactivatorTransactionRepository,
    @inject('Redis') private readonly redis: Redis,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  private async restoreIntegrationEntitlementAfterFailure(
    accountId: string,
    denyFenceOwnerToken?: string
  ): Promise<void> {
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
        'Could not restore integration entitlement after a failed plan cancellation mutation.',
        error
      );
    }
  }

  private shouldSkipKey(key: string, userIdToKeep?: string): boolean {
    if (!userIdToKeep) return false;

    const parts = key.split(':');
    const userIndex = 2;
    const userFromKey = parts[userIndex];

    return userFromKey === userIdToKeep;
  }

  private async deleteKeysByPattern(
    pattern: string,
    userIdToKeep?: string
  ): Promise<void> {
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100,
    });

    const keysToDelete: string[] = [];

    stream.on('data', (keys: string[]) => {
      for (const key of keys) {
        const shouldSkip = this.shouldSkipKey(key, userIdToKeep);
        if (shouldSkip) continue;

        keysToDelete.push(key);
      }
    });

    await new Promise<void>((resolve) => {
      stream.on('end', () => {
        resolve();
      });
    });

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
  }

  private async deleteAccountJwtCache(
    accountId: string,
    isWithin7Days: boolean,
    userIdToKeep?: string
  ): Promise<void> {
    if (!isWithin7Days) return;

    const patterns = [`jwtCache:${accountId}:*`, `jwtSession:${accountId}:*`];
    const deletions: Promise<void>[] = [];

    for (const pattern of patterns) {
      deletions.push(this.deleteKeysByPattern(pattern, userIdToKeep));
    }

    await Promise.all(deletions);
  }

  private async setPlanInactiveInCacheKey(key: string): Promise<void> {
    const cachedValue = await this.redis.get(key);
    if (!cachedValue) return;

    let parsed: { plan_is_active?: boolean };
    try {
      parsed = JSON.parse(cachedValue) as { plan_is_active?: boolean };
    } catch {
      return;
    }

    if (parsed.plan_is_active === false) return;

    parsed.plan_is_active = false;
    await this.redis.set(key, JSON.stringify(parsed), 'EX', 600);
  }

  private async updateCurrentUserJwtCachePlanInactive(
    accountId: string,
    userId: string
  ): Promise<void> {
    const pattern = `jwtCache:${accountId}:${userId}:*`;
    const updatePromises: Promise<void>[] = [];
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100,
    });

    stream.on('data', (keys: string[]) => {
      for (const key of keys) {
        updatePromises.push(this.setPlanInactiveInCacheKey(key));
      }
    });

    await new Promise<void>((resolve) => {
      stream.on('end', () => {
        resolve();
      });
    });

    if (updatePromises.length === 0) return;

    await Promise.all(updatePromises);
  }

  private isWithin7DaysPeriod(subscriptionStartedAt: string | null): boolean {
    if (!subscriptionStartedAt) return false;

    const subscriptionStart = new Date(subscriptionStartedAt);
    if (Number.isNaN(subscriptionStart.getTime())) return false;

    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - subscriptionStart.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysDiff <= 7;
  }

  private async cancelPaymentInAsaas(paymentId: string): Promise<boolean> {
    try {
      const result = await this.asaasService.refundPayment(paymentId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao estornar pagamento no Asaas:', error);
      return false;
    }
  }

  private async cancelSubscriptionInAsaas(
    subscriptionId: string
  ): Promise<boolean> {
    try {
      const result = await this.asaasService.deleteSubscription(subscriptionId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao cancelar subscription no Asaas:', error);
      return false;
    }
  }

  private async cancelInvoiceInAsaas(invoiceId: string): Promise<boolean> {
    try {
      const result = await this.asaasService.cancelInvoice(invoiceId);
      return result !== null;
    } catch (error) {
      console.error('Erro ao cancelar invoice no Asaas:', error);
      return false;
    }
  }

  private async findInvoiceIdByAccountPaymentId(
    accountPaymentId: string
  ): Promise<string | null> {
    try {
      return await this.planAccountCancellerRepository.findInvoiceIdByAccountPaymentId(
        accountPaymentId
      );
    } catch (error) {
      console.error('Erro ao buscar invoice ID por account_payment_id:', error);
      return null;
    }
  }

  private async findSubscriptionIdByPaymentId(
    paymentId: string
  ): Promise<string | null> {
    try {
      const payment = await this.asaasService.getPayment(paymentId);
      return payment?.subscription || null;
    } catch (error) {
      console.error('Erro ao buscar subscription ID por payment ID:', error);
      return null;
    }
  }

  private async findSubscriptionAndInvoiceIds(
    data: IPlanAccountCancellationData
  ): Promise<[string | null, string | null]> {
    const promises: [Promise<string | null>, Promise<string | null>] = [
      data.billing
        ? this.findSubscriptionIdByPaymentId(data.billing)
        : Promise.resolve(null),
      data.account_payment_id
        ? this.findInvoiceIdByAccountPaymentId(data.account_payment_id)
        : Promise.resolve(null),
    ];

    return Promise.all(promises);
  }

  private buildCancellationPromises(
    billing: string,
    subscriptionId: string | null,
    invoiceId: string | null
  ): Array<
    Promise<{
      type: CancellationType;
      result: boolean;
    }>
  > {
    const promises: Array<
      Promise<{
        type: CancellationType;
        result: boolean;
      }>
    > = [
      this.cancelPaymentInAsaas(billing).then((res) => ({
        type: 'payment' as const,
        result: res,
      })),
    ];

    if (subscriptionId) {
      promises.push(
        this.cancelSubscriptionInAsaas(subscriptionId).then((res) => ({
          type: 'subscription' as const,
          result: res,
        }))
      );
    }

    if (invoiceId) {
      promises.push(
        this.cancelInvoiceInAsaas(invoiceId).then((res) => ({
          type: 'invoice' as const,
          result: res,
        }))
      );
    }

    return promises;
  }

  private processCancellationResults(
    results: Array<{
      type: CancellationType;
      result: boolean;
    }>
  ): IPlanAccountCancellationResult['asaasActions'] {
    const actions = {
      paymentRefunded: false,
      subscriptionCancelled: false,
      invoiceCancelled: false,
    };

    for (const cancellationResult of results) {
      if (cancellationResult.type === 'payment') {
        actions.paymentRefunded = cancellationResult.result;
        continue;
      }

      if (cancellationResult.type === 'subscription') {
        actions.subscriptionCancelled = cancellationResult.result;
        continue;
      }

      if (cancellationResult.type === 'invoice') {
        actions.invoiceCancelled = cancellationResult.result;
      }
    }

    return actions;
  }

  private async executeAsaasCancellationActions(
    data: IPlanAccountCancellationData
  ): Promise<IPlanAccountCancellationResult['asaasActions']> {
    const defaultResult = {
      paymentRefunded: false,
      subscriptionCancelled: false,
      invoiceCancelled: false,
    };

    if (!data.billing) {
      return defaultResult;
    }

    try {
      const [subscriptionId, invoiceId] =
        await this.findSubscriptionAndInvoiceIds(data);

      const cancellationPromises = this.buildCancellationPromises(
        data.billing,
        subscriptionId,
        invoiceId
      );

      const cancellationResults = await Promise.all(cancellationPromises);

      return this.processCancellationResults(cancellationResults);
    } catch (error) {
      console.error('Erro ao executar ações de cancelamento no Asaas:', error);
      return defaultResult;
    }
  }

  private async getAsaasActions(
    isWithin7Days: boolean,
    data: IPlanAccountCancellationData
  ): Promise<IPlanAccountCancellationResult['asaasActions']> {
    if (!isWithin7Days) {
      return {
        paymentRefunded: false,
        subscriptionCancelled: false,
        invoiceCancelled: false,
      };
    }

    return this.executeAsaasCancellationActions(data);
  }

  private async executeCancellation(
    data: IPlanAccountCancellationData
  ): Promise<IPlanAccountCancellationResult> {
    const isWithin7Days = this.isWithin7DaysPeriod(
      data.subscription_started_at
    );
    const cancellationDate = currentTime();
    const shouldCancelNextPayment = isWithin7Days;

    const asaasActions = await this.getAsaasActions(isWithin7Days, data);

    return {
      isWithin7Days,
      cancellationDate,
      shouldCancelNextPayment,
      asaasActions,
    };
  }

  private async updatePlanAccountInDatabase(
    planAccountId: string,
    cancellationDate: string,
    shouldCancelNextPayment: boolean
  ): Promise<boolean> {
    return this.planAccountCancellerRepository.updatePlanAccountById(
      planAccountId,
      cancellationDate,
      shouldCancelNextPayment
    );
  }

  private async updateAccountStatus(
    accountId: string,
    accountStatusId: string
  ): Promise<boolean> {
    return this.accountUpdaterRepository.updateAccountStatusById(
      accountId,
      accountStatusId
    );
  }

  private async findWorkersByAccountId(accountId: string): Promise<string[]> {
    return this.planAccountCancellerRepository.findWorkersByAccountId(
      accountId
    );
  }

  private async deleteWorkerByAccountId(
    accountId: string,
    workerId: string
  ): Promise<void> {
    await enqueuePermanentWorkerDeletion(
      {
        workerService: this.workerService,
        workerLifecycleQueueService: this.workerLifecycleQueueService,
      },
      {
        account_id: accountId,
        worker_id: workerId,
        source: 'plan_cancellation',
      }
    );
  }

  private async deleteAllWorkersByAccountId(accountId: string): Promise<void> {
    const workerIds = await this.findWorkersByAccountId(accountId);
    const results = await Promise.allSettled(
      workerIds.map((workerId) =>
        this.deleteWorkerByAccountId(accountId, workerId)
      )
    );
    const failures = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      .map((result) => result.reason);

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'One or more worker deletion commands could not be delivered'
      );
    }
  }

  private buildActionMessages(
    t: TFunction<'translation', undefined>,
    actions: IPlanAccountCancellationResult['asaasActions']
  ): string[] {
    const messages: string[] = [];

    if (actions.paymentRefunded) {
      messages.push(t('payment_refunded'));
    }

    if (actions.subscriptionCancelled) {
      messages.push(t('subscription_cancelled'));
    }

    if (actions.invoiceCancelled) {
      messages.push(t('invoice_cancelled'));
    }

    return messages;
  }

  private buildCancellationMessage(
    t: TFunction<'translation', undefined>,
    result: IPlanAccountCancellationResult
  ): string {
    if (!result.isWithin7Days) {
      return t('subscription_cancelled_successfully');
    }

    const actionMessages = this.buildActionMessages(t, result.asaasActions);

    if (actionMessages.length === 0) {
      return t('subscription_cancelled_successfully');
    }

    return t('subscription_cancelled_and_actions_successfully', {
      actions: actionMessages.join(', '),
    });
  }

  async cancelPlanAccount(
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountStatusId: EAccountStatus,
    tokenJwtData?: ITokenJwtData | null
  ): Promise<string> {
    const planAccountData =
      await this.planAccountCancellerRepository.findPlanAccountWithPayment(
        accountId
      );

    if (!planAccountData?.plan_account_id) {
      const existingPlanAccount =
        await this.planAccountCancellerRepository.findPlanAccountWithCancellation(
          accountId
        );

      if (existingPlanAccount?.cancellation_date) {
        const nextPaymentDateStr = existingPlanAccount.next_payment_date;
        if (nextPaymentDateStr) {
          const nextPaymentDate = new Date(nextPaymentDateStr);
          const now = new Date();
          if (nextPaymentDate > now) {
            throw new Error(t('plan_already_cancelling'));
          }
        }

        throw new Error(t('plan_not_found_or_already_cancelled'));
      }

      if (
        existingPlanAccount?.account_status_id &&
        existingPlanAccount.account_status_id !== EAccountStatus.active
      ) {
        throw new Error(t('plan_already_cancelling'));
      }

      throw new Error(t('plan_not_found_or_already_cancelled'));
    }

    return this.cancelPlanAccountByPlanAccountId(
      t,
      planAccountData.plan_account_id,
      accountId,
      accountStatusId,
      tokenJwtData
    );
  }

  private validatePlanAccountData(
    t: TFunction<'translation', undefined>,
    planAccountData: IPlanAccountWithPayment | null | undefined
  ): asserts planAccountData is IPlanAccountWithPayment {
    if (!planAccountData) {
      throw new Error(t('plan_not_found_or_already_cancelled'));
    }

    if (!planAccountData.last_payment_date) {
      throw new Error(t('last_payment_date_not_found'));
    }
  }

  private async executeCancellationWithData(
    planAccountData: IPlanAccountWithPayment
  ): Promise<IPlanAccountCancellationResult> {
    return this.executeCancellation({
      account_payment_id: planAccountData.account_payment_id,
      billing: planAccountData.apy?.billing || null,
      last_payment_date: planAccountData.last_payment_date,
      subscription_started_at: planAccountData.created_at,
    });
  }

  private async finalizeCancellation(
    accountId: string,
    accountStatusId: EAccountStatus
  ): Promise<void> {
    await Promise.all([
      this.updateAccountStatus(accountId, accountStatusId),
      this.deleteAllWorkersByAccountId(accountId),
    ]);
  }

  private async sendCancellationNotification(
    accountId: string,
    planAccountId: string,
    isWithin7Days: boolean
  ): Promise<void> {
    if (isWithin7Days) {
      return;
    }

    try {
      await this.notificationMessageService.sendPlanNotification(
        accountId,
        planAccountId,
        ENotificationTypeId.plan_cancellation
      );
    } catch (error) {
      console.error('Erro ao enviar notificação de cancelamento:', error);
    }
  }

  private async cancelPlanAccountByPlanAccountId(
    t: TFunction<'translation', undefined>,
    planAccountId: string,
    accountId: string,
    accountStatusId: EAccountStatus,
    tokenJwtData?: ITokenJwtData | null
  ): Promise<string> {
    const planAccountData =
      await this.planAccountCancellerRepository.findPlanAccountById(
        planAccountId
      );

    this.validatePlanAccountData(t, planAccountData);
    let denyFenceOwnerToken: string | null | undefined;
    let externalPaymentRefunded = false;
    const refundAccountPaymentId =
      planAccountData.account_payment_id ??
      planAccountData.apy?.account_payment_id;
    const fenceOperationKey = refundAccountPaymentId
      ? getPaymentRefundEntitlementFenceOperationKey(refundAccountPaymentId)
      : `plan-cancellation:${planAccountId}`;
    try {
      // A scheduled cancellation normally keeps the current cycle active, but
      // the cycle may expire between the initial read and the local writer.
      // Fence every cancellation conservatively so that an expiry discovered
      // at commit cannot become an unfenced true -> false transition.
      denyFenceOwnerToken =
        await this.planEntitlementService.installDenyFenceForRevocationOperation(
          accountId,
          EPlanProduct.integration,
          fenceOperationKey
        );
    } catch (error) {
      throw error;
    }

    try {
      const cancellationResult =
        await this.executeCancellationWithData(planAccountData);
      externalPaymentRefunded = cancellationResult.asaasActions.paymentRefunded;

      const success = await this.updatePlanAccountInDatabase(
        planAccountId,
        cancellationResult.cancellationDate,
        cancellationResult.shouldCancelNextPayment
      );

      if (!success) {
        throw new Error(t('subscription_cancellation_error'));
      }

      const userIdToKeep = tokenJwtData?.user_id;
      const tasks: Array<Promise<void>> = [
        this.finalizeCancellation(accountId, accountStatusId),
        this.sendCancellationNotification(
          accountId,
          planAccountId,
          cancellationResult.isWithin7Days
        ),
        this.deleteAccountJwtCache(
          accountId,
          cancellationResult.isWithin7Days,
          userIdToKeep
        ),
      ];

      if (cancellationResult.isWithin7Days && userIdToKeep) {
        tasks.push(
          this.updateCurrentUserJwtCachePlanInactive(accountId, userIdToKeep)
        );
      }

      if (cancellationResult.isWithin7Days && tokenJwtData) {
        tokenJwtData.plan_is_active = false;
      }

      await Promise.all(tasks);
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

      return this.buildCancellationMessage(t, cancellationResult);
    } catch (error) {
      if (!externalPaymentRefunded) {
        await this.restoreIntegrationEntitlementAfterFailure(
          accountId,
          denyFenceOwnerToken ?? undefined
        );
      } else {
        console.error(
          'Keeping the integration deny fence after the external payment refund succeeded but the local cancellation failed.',
          error
        );
      }
      throw error;
    }
  }

  async reactivatePlanAccount(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<string> {
    const cancelledPlan =
      await this.planAccountCancellerRepository.findCancelledPlanAccount(
        accountId
      );

    if (!cancelledPlan) {
      throw new Error(t('plan_not_cancelled'));
    }

    await this.planEntitlementService.refreshAfterMutation(
      accountId,
      EPlanProduct.integration
    );
    await this.planAccountReactivatorTransactionRepository.executeReactivation(
      t,
      accountId
    );
    await this.planEntitlementService.refreshAfterMutation(
      accountId,
      EPlanProduct.integration
    );

    return t('plan_reactivated_successfully');
  }
}
