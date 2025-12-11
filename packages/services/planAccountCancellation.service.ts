import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AsaasService } from '@core/services/asaas';
import { currentTime } from '@core/common/functions/currentTime';
import {
  IPlanAccountCancellationData,
  IPlanAccountCancellationResult,
  IPlanAccountWithPayment,
  CancellationType,
} from '@core/common/interfaces/IPlanAccountCancellation';
import { PlanAccountCancellerRepository } from '@core/repositories/accountSettings/PlanAccountCanceller.repository';
import { AccountUpdaterRepository } from '@core/repositories/account/AccountUpdater.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import { PlanAccountReactivatorTransactionRepository } from '@core/repositories/accountSettings/PlanAccountReactivatorTransaction.repository';

@injectable()
export class PlanAccountCancellationService {
  constructor(
    private readonly asaasService: AsaasService,
    private readonly planAccountCancellerRepository: PlanAccountCancellerRepository,
    private readonly accountUpdaterRepository: AccountUpdaterRepository,
    private readonly workerService: WorkerService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService,
    private readonly notificationMessageService: NotificationMessageService,
    private readonly planAccountReactivatorTransactionRepository: PlanAccountReactivatorTransactionRepository
  ) {}

  private isWithin7DaysPeriod(lastPaymentDate: string | null): boolean {
    if (!lastPaymentDate) return false;

    const lastPayment = new Date(lastPaymentDate);
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - lastPayment.getTime()) / (1000 * 60 * 60 * 24)
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
    const isWithin7Days = this.isWithin7DaysPeriod(data.last_payment_date);
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

  private async findWorkersByAccountId(
    accountId: string
  ): Promise<Array<{ worker_id: string; workerData: IViewWorkerServer }>> {
    try {
      const workerIds =
        await this.planAccountCancellerRepository.findWorkersByAccountId(
          accountId
        );

      const workersWithBalancerPromises = workerIds.map(async (workerId) => {
        const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
          accountId,
          workerId
        );

        if (viewWorkerBalancer) {
          return {
            worker_id: workerId,
            workerData: viewWorkerBalancer,
          };
        }

        return null;
      });

      const workersWithBalancer = await Promise.all(
        workersWithBalancerPromises
      );

      return workersWithBalancer.filter(
        (
          worker
        ): worker is { worker_id: string; workerData: IViewWorkerServer } =>
          worker !== null
      );
    } catch (error) {
      console.error('Erro ao buscar workers por account_id:', error);
      return [];
    }
  }

  private createWorkerDeleterPayload(
    workerId: string,
    workerData: IViewWorkerServer
  ): IWorkerPayload {
    return {
      action: EWorkerAction.delete,
      worker_id: workerId,
      server_id: workerData.server_id,
      account_id: workerData.account_id,
    };
  }

  private async publishWorkerDeletionEvents(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(payload.account_id),
        payload
      ),
      this.streamProducerService
        .send(this.kafkaBalanceQueueService.worker(payload.server_id), payload)
        .catch(() => {
          throw new Error(t('kafka_error'));
        }),
    ]);
  }

  private async updateWorkerStatusToDeleting(
    accountId: string,
    workerId: string
  ): Promise<boolean> {
    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.deleting,
    };

    return this.workerService.updateWorkerById(accountId, inputUpdate);
  }

  private async deleteWorkerByAccountId(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    workerData: IViewWorkerServer
  ): Promise<boolean> {
    try {
      const payload = this.createWorkerDeleterPayload(workerId, workerData);

      await this.publishWorkerDeletionEvents(t, payload);

      return await this.updateWorkerStatusToDeleting(accountId, workerId);
    } catch (error) {
      console.error('Erro ao deletar worker:', error);
      return false;
    }
  }

  private async deleteAllWorkersByAccountId(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const workers = await this.findWorkersByAccountId(accountId);

    await Promise.all(
      workers.map(({ worker_id, workerData }) =>
        this.deleteWorkerByAccountId(t, accountId, worker_id, workerData)
      )
    );
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
    accountStatusId: EAccountStatus
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
      accountStatusId
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
    });
  }

  private async finalizeCancellation(
    t: TFunction<'translation', undefined>,
    accountId: string,
    accountStatusId: EAccountStatus
  ): Promise<void> {
    await Promise.all([
      this.updateAccountStatus(accountId, accountStatusId),
      this.deleteAllWorkersByAccountId(t, accountId),
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
    accountStatusId: EAccountStatus
  ): Promise<string> {
    const planAccountData =
      await this.planAccountCancellerRepository.findPlanAccountById(
        planAccountId
      );

    this.validatePlanAccountData(t, planAccountData);

    const cancellationResult =
      await this.executeCancellationWithData(planAccountData);

    const success = await this.updatePlanAccountInDatabase(
      planAccountId,
      cancellationResult.cancellationDate,
      cancellationResult.shouldCancelNextPayment
    );

    if (!success) {
      throw new Error(t('subscription_cancellation_error'));
    }

    await Promise.all([
      this.finalizeCancellation(t, accountId, accountStatusId),
      this.sendCancellationNotification(
        accountId,
        planAccountId,
        cancellationResult.isWithin7Days
      ),
    ]);

    return this.buildCancellationMessage(t, cancellationResult);
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

    await this.planAccountReactivatorTransactionRepository.executeReactivation(
      t,
      accountId
    );

    return t('plan_reactivated_successfully');
  }
}
