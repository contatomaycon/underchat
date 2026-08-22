import 'reflect-metadata';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));
jest.mock('@core/services/asaas', () => ({ AsaasService: class {} }));
jest.mock(
  '@core/repositories/accountSettings/PlanAccountCanceller.repository',
  () => ({ PlanAccountCancellerRepository: class {} })
);
jest.mock('@core/repositories/account/AccountUpdater.repository', () => ({
  AccountUpdaterRepository: class {},
}));
jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class {},
}));
jest.mock('@core/services/notificationMessage.service', () => ({
  NotificationMessageService: class {},
}));
jest.mock(
  '@core/repositories/accountSettings/PlanAccountReactivatorTransaction.repository',
  () => ({ PlanAccountReactivatorTransactionRepository: class {} })
);
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));

import { currentTime } from '@core/common/functions/currentTime';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanAccountCancellationService } from '@core/services/planAccountCancellation.service';
import { IPlanAccountWithPayment } from '@core/common/interfaces/IPlanAccountCancellation';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';

type ScanStreamCallback = (payload?: string[]) => void;

interface EmptyScanStream {
  on: (event: string, callback: ScanStreamCallback) => EmptyScanStream;
}

function createEmptyScanStream(): EmptyScanStream {
  let stream: EmptyScanStream;

  stream = {
    on: jest.fn(
      (event: string, callback: ScanStreamCallback): EmptyScanStream => {
        if (event === 'data') {
          callback([]);
        }

        if (event === 'end') {
          callback();
        }

        return stream;
      }
    ),
  };

  return stream;
}

function buildPlanAccount(
  overrides: Partial<IPlanAccountWithPayment> = {}
): IPlanAccountWithPayment {
  return {
    plan_account_id: 'plan-account-1',
    account_id: 'acc-1',
    account_payment_id: 'account-payment-1',
    last_payment_date: '2026-01-01T12:00:00.000Z',
    next_payment_date: '2026-02-01T12:00:00.000Z',
    cancellation_date: null,
    created_at: '2026-01-01T12:00:00.000Z',
    apy: {
      account_payment_id: 'account-payment-1',
      billing: 'pay-1',
      recurring_payment: true,
    },
    ...overrides,
  };
}

function createService(planAccountData: IPlanAccountWithPayment) {
  const asaasService = {
    refundPayment: jest.fn(async () => ({ id: 'refund-1' })),
    deleteSubscription: jest.fn(async () => ({ id: 'subscription-1' })),
    cancelInvoice: jest.fn(async () => ({ id: 'invoice-1' })),
    getPayment: jest.fn(async () => ({ subscription: 'sub-1' })),
  };
  const planAccountCancellerRepository = {
    findPlanAccountWithPayment: jest.fn(async () => planAccountData),
    findPlanAccountWithCancellation: jest.fn(),
    findPlanAccountById: jest.fn(async () => planAccountData),
    updatePlanAccountById: jest.fn(async () => true),
    findWorkersByAccountId: jest.fn(async () => []),
    findInvoiceIdByAccountPaymentId: jest.fn(async () => 'invoice-1'),
    findCancelledPlanAccount: jest.fn(),
  };
  const accountUpdaterRepository = {
    updateAccountStatusById: jest.fn(async () => true),
  };
  const workerService = {
    viewWorkerBalancer: jest.fn(),
    updateWorkerById: jest.fn(),
    viewWorkerForMonitorConsistent: jest.fn<
      Promise<IWorkerMonitor | null>,
      [string]
    >(async () => null),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => false),
  };
  const workerLifecycleQueueService = {
    preparePermanentDeletion: jest.fn(
      async (input: {
        worker_id: string;
        account_id: string;
        server_id: string;
        worker_type_id: EWorkerType;
        source: string;
        lifecycle_operation_id?: string;
      }) => {
        const operationId =
          input.lifecycle_operation_id ?? 'delete-operation-1';
        return {
          request_id: 'delete-request-1',
          operation_id: operationId,
          action: 'delete' as const,
          worker_id: input.worker_id,
          account_id: input.account_id,
          server_id: input.server_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: EWorkerStatus.deleting,
          source: input.source,
          debug_trace_id: operationId,
          requested_at: '2026-07-27T22:00:00.000Z',
        };
      }
    ),
    publish: jest.fn<Promise<void>, [unknown]>(async () => undefined),
  };
  const notificationMessageService = {
    sendPlanNotification: jest.fn(async () => undefined),
  };
  const planAccountReactivatorTransactionRepository = {
    executeReactivation: jest.fn(async () => undefined),
  };
  const redis = {
    scanStream: jest.fn(() => createEmptyScanStream()),
    del: jest.fn(async () => 0),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
  };
  const planEntitlementService = {
    installDenyFenceForRevocationOperation: jest.fn<
      Promise<string | undefined>,
      [string, string, string]
    >(async () => undefined),
    refreshAfterMutation: jest.fn(async () => ({ allowed: true })),
  };

  const service = new PlanAccountCancellationService(
    asaasService as never,
    planAccountCancellerRepository as never,
    accountUpdaterRepository as never,
    workerService as never,
    workerLifecycleQueueService as never,
    notificationMessageService as never,
    planAccountReactivatorTransactionRepository as never,
    redis as never,
    planEntitlementService as never
  );

  return {
    service,
    mocks: {
      asaasService,
      planAccountCancellerRepository,
      accountUpdaterRepository,
      notificationMessageService,
      planAccountReactivatorTransactionRepository,
      planEntitlementService,
      redis,
      workerService,
      workerLifecycleQueueService,
    },
  };
}

function createTranslator() {
  return jest.fn((key: string, options?: { actions?: string }) => {
    if (options?.actions) {
      return `${key}:${options.actions}`;
    }

    return key;
  });
}

function buildWorkerMonitor(
  overrides: Partial<IWorkerMonitor> = {}
): IWorkerMonitor {
  return {
    worker_id: 'worker-1',
    name: 'Worker 1',
    account_id: 'acc-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.whatsmeow,
    created_at: '2026-07-27T20:00:00.000Z',
    updated_at: '2026-07-27T21:00:00.000Z',
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: null,
    last_connection_check_at: '2026-07-27T21:00:00.000Z',
    ...overrides,
  };
}

describe('PlanAccountCancellationService', () => {
  const currentTimeMock = currentTime as jest.MockedFunction<
    typeof currentTime
  >;

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('schedules cancellation without refund when only the renewal is within 7 days', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
    currentTimeMock.mockReturnValue('2026-05-05T12:00:00.000Z');

    const planAccountData = buildPlanAccount({
      created_at: '2026-01-01T12:00:00.000Z',
      last_payment_date: '2026-05-01T12:00:00.000Z',
      next_payment_date: '2026-06-01T12:00:00.000Z',
    });
    const { service, mocks } = createService(planAccountData);
    const t = createTranslator();

    await expect(
      service.cancelPlanAccount(t as never, 'acc-1', EAccountStatus.inactive)
    ).resolves.toBe('subscription_cancelled_successfully');

    expect(mocks.asaasService.refundPayment).not.toHaveBeenCalled();
    expect(mocks.asaasService.getPayment).not.toHaveBeenCalled();
    expect(mocks.asaasService.deleteSubscription).not.toHaveBeenCalled();
    expect(mocks.asaasService.cancelInvoice).not.toHaveBeenCalled();
    expect(
      mocks.planAccountCancellerRepository.updatePlanAccountById
    ).toHaveBeenCalledWith('plan-account-1', '2026-05-05T12:00:00.000Z', false);
    expect(
      mocks.notificationMessageService.sendPlanNotification
    ).toHaveBeenCalledWith(
      'acc-1',
      'plan-account-1',
      ENotificationTypeId.plan_cancellation
    );
    expect(mocks.redis.scanStream).not.toHaveBeenCalled();
    expect(
      mocks.planEntitlementService.installDenyFenceForRevocationOperation
    ).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'payment-refund:account-payment-1'
    );
    expect(
      mocks.planEntitlementService.refreshAfterMutation
    ).toHaveBeenCalledWith('acc-1', EPlanProduct.integration);
  });

  it('refunds and clears next payment when the original subscription is within 7 days', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-05T12:00:00.000Z'));
    currentTimeMock.mockReturnValue('2026-01-05T12:00:00.000Z');

    const planAccountData = buildPlanAccount({
      created_at: '2026-01-01T12:00:00.000Z',
      last_payment_date: '2026-01-01T12:00:00.000Z',
      next_payment_date: '2026-02-01T12:00:00.000Z',
    });
    const { service, mocks } = createService(planAccountData);
    const t = createTranslator();

    await expect(
      service.cancelPlanAccount(t as never, 'acc-1', EAccountStatus.inactive)
    ).resolves.toBe(
      'subscription_cancelled_and_actions_successfully:payment_refunded, subscription_cancelled, invoice_cancelled'
    );

    expect(mocks.asaasService.getPayment).toHaveBeenCalledWith('pay-1');
    expect(mocks.asaasService.refundPayment).toHaveBeenCalledWith('pay-1');
    expect(mocks.asaasService.deleteSubscription).toHaveBeenCalledWith('sub-1');
    expect(mocks.asaasService.cancelInvoice).toHaveBeenCalledWith('invoice-1');
    expect(
      mocks.planAccountCancellerRepository.findInvoiceIdByAccountPaymentId
    ).toHaveBeenCalledWith('account-payment-1');
    expect(
      mocks.planAccountCancellerRepository.updatePlanAccountById
    ).toHaveBeenCalledWith('plan-account-1', '2026-01-05T12:00:00.000Z', true);
    expect(
      mocks.notificationMessageService.sendPlanNotification
    ).not.toHaveBeenCalled();
    expect(mocks.redis.scanStream).toHaveBeenCalledTimes(2);
    expect(
      mocks.planEntitlementService.installDenyFenceForRevocationOperation
    ).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'payment-refund:account-payment-1'
    );
    expect(
      mocks.planEntitlementService.refreshAfterMutation
    ).toHaveBeenCalledWith('acc-1', EPlanProduct.integration);
  });

  it('keeps the deny fence when an external refund succeeds before the local cancellation fails', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-05T12:00:00.000Z'));
    currentTimeMock.mockReturnValue('2026-01-05T12:00:00.000Z');

    const { service, mocks } = createService(
      buildPlanAccount({
        created_at: '2026-01-01T12:00:00.000Z',
        last_payment_date: '2026-01-01T12:00:00.000Z',
        next_payment_date: '2026-02-01T12:00:00.000Z',
      })
    );
    mocks.planEntitlementService.installDenyFenceForRevocationOperation.mockResolvedValueOnce(
      'fence-owner-1'
    );
    mocks.planAccountCancellerRepository.updatePlanAccountById.mockResolvedValueOnce(
      false
    );
    const t = createTranslator();

    await expect(
      service.cancelPlanAccount(t as never, 'acc-1', EAccountStatus.inactive)
    ).rejects.toThrow('subscription_cancellation_error');

    expect(mocks.asaasService.refundPayment).toHaveBeenCalledWith('pay-1');
    expect(
      mocks.planEntitlementService.refreshAfterMutation
    ).not.toHaveBeenCalled();
  });

  it('schedules cancellation when the original subscription is older than 7 days', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
    currentTimeMock.mockReturnValue('2026-01-10T12:00:00.000Z');

    const planAccountData = buildPlanAccount({
      created_at: '2026-01-01T12:00:00.000Z',
      last_payment_date: '2026-01-01T12:00:00.000Z',
      next_payment_date: '2026-02-01T12:00:00.000Z',
    });
    const { service, mocks } = createService(planAccountData);
    const t = createTranslator();

    await expect(
      service.cancelPlanAccount(t as never, 'acc-1', EAccountStatus.inactive)
    ).resolves.toBe('subscription_cancelled_successfully');

    expect(mocks.asaasService.refundPayment).not.toHaveBeenCalled();
    expect(
      mocks.planAccountCancellerRepository.updatePlanAccountById
    ).toHaveBeenCalledWith('plan-account-1', '2026-01-10T12:00:00.000Z', false);
    expect(
      mocks.notificationMessageService.sendPlanNotification
    ).toHaveBeenCalledWith(
      'acc-1',
      'plan-account-1',
      ENotificationTypeId.plan_cancellation
    );
  });

  it('treats an invalid subscription start date as outside the refund window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-05T12:00:00.000Z'));
    currentTimeMock.mockReturnValue('2026-01-05T12:00:00.000Z');

    const planAccountData = buildPlanAccount({
      created_at: 'invalid-date',
      last_payment_date: '2026-01-01T12:00:00.000Z',
      next_payment_date: '2026-02-01T12:00:00.000Z',
    });
    const { service, mocks } = createService(planAccountData);
    const t = createTranslator();

    await expect(
      service.cancelPlanAccount(t as never, 'acc-1', EAccountStatus.inactive)
    ).resolves.toBe('subscription_cancelled_successfully');

    expect(mocks.asaasService.refundPayment).not.toHaveBeenCalled();
    expect(
      mocks.planAccountCancellerRepository.updatePlanAccountById
    ).toHaveBeenCalledWith('plan-account-1', '2026-01-05T12:00:00.000Z', false);
  });

  it('reconciles the denied epoch before and after reactivation', async () => {
    const { service, mocks } = createService(buildPlanAccount());
    mocks.planAccountCancellerRepository.findCancelledPlanAccount.mockResolvedValueOnce(
      { plan_account_id: 'plan-account-1' }
    );
    const t = createTranslator();

    await expect(
      service.reactivatePlanAccount(t as never, 'acc-1')
    ).resolves.toBe('plan_reactivated_successfully');

    expect(
      mocks.planEntitlementService.refreshAfterMutation
    ).toHaveBeenCalledTimes(2);
    expect(
      mocks.planEntitlementService.refreshAfterMutation.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      mocks.planAccountReactivatorTransactionRepository.executeReactivation.mock
        .invocationCallOrder[0]
    );
    expect(
      mocks.planAccountReactivatorTransactionRepository.executeReactivation.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      mocks.planEntitlementService.refreshAfterMutation.mock
        .invocationCallOrder[1]
    );
  });

  it('journals and claims the permanent deletion before publishing its durable command', async () => {
    const { service, mocks } = createService(buildPlanAccount());
    currentTimeMock.mockReturnValue('2026-07-27T22:00:00.000Z');
    mocks.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      buildWorkerMonitor()
    );
    mocks.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      true
    );
    const deleteWorkerByAccountId = (
      service as unknown as {
        deleteWorkerByAccountId: (
          accountId: string,
          workerId: string
        ) => Promise<void>;
      }
    ).deleteWorkerByAccountId.bind(service);

    await expect(
      deleteWorkerByAccountId('acc-1', 'worker-1')
    ).resolves.toBeUndefined();

    const updateInput = (
      mocks.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .calls as unknown as Array<
        [
          string,
          {
            worker_status_id: EWorkerStatus;
            lifecycle_operation_id: string;
          },
        ]
      >
    )[0]?.[1];
    const lifecycleMessage = (
      mocks.workerLifecycleQueueService.publish.mock.calls as unknown as Array<
        [
          {
            action: string;
            operation_id: string;
            debug_trace_id: string;
          },
        ]
      >
    )[0]?.[0];
    if (!updateInput || !lifecycleMessage) {
      throw new Error('Expected deletion claim and lifecycle message');
    }

    expect(updateInput).toEqual(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: expect.any(String),
      })
    );
    expect(lifecycleMessage).toEqual(
      expect.objectContaining({
        action: 'delete',
        operation_id: updateInput.lifecycle_operation_id,
        debug_trace_id: updateInput.lifecycle_operation_id,
        source: 'plan_cancellation',
        requested_at: '2026-07-27T22:00:00.000Z',
      })
    );
    expect(
      mocks.workerLifecycleQueueService.preparePermanentDeletion.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    );
    expect(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      mocks.workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    );
  });

  it('rejects instead of swallowing an unconfirmed lifecycle claim', async () => {
    const { service, mocks } = createService(buildPlanAccount());
    currentTimeMock.mockReturnValue('2026-07-27T22:00:00.000Z');
    mocks.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      buildWorkerMonitor()
    );
    mocks.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
      false
    );
    const deleteWorkerByAccountId = (
      service as unknown as {
        deleteWorkerByAccountId: (
          accountId: string,
          workerId: string
        ) => Promise<void>;
      }
    ).deleteWorkerByAccountId.bind(service);

    await expect(deleteWorkerByAccountId('acc-1', 'worker-1')).rejects.toThrow(
      'Worker deletion lifecycle claim was not confirmed'
    );

    expect(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(3);
    expect(mocks.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('keeps deleting fenced and surfaces an unavailable durable transport', async () => {
    const { service, mocks } = createService(buildPlanAccount());
    currentTimeMock.mockReturnValue('2026-07-27T22:00:00.000Z');
    mocks.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      buildWorkerMonitor()
    );
    mocks.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      true
    );
    mocks.workerLifecycleQueueService.publish.mockRejectedValue(
      new Error('kafka unavailable')
    );
    const deleteWorkerByAccountId = (
      service as unknown as {
        deleteWorkerByAccountId: (
          accountId: string,
          workerId: string
        ) => Promise<void>;
      }
    ).deleteWorkerByAccountId.bind(service);

    await expect(deleteWorkerByAccountId('acc-1', 'worker-1')).rejects.toThrow(
      'kafka unavailable'
    );

    expect(mocks.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: expect.any(String),
      }),
      expect.any(Object)
    );
    expect(mocks.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('reuses the same deleting operation on retry without claiming a new lifecycle', async () => {
    const { service, mocks } = createService(buildPlanAccount());
    currentTimeMock.mockReturnValue('2026-07-27T22:00:00.000Z');
    mocks.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      buildWorkerMonitor()
    );
    mocks.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      true
    );
    mocks.workerLifecycleQueueService.publish.mockRejectedValue(
      new Error('kafka unavailable')
    );
    const deleteWorkerByAccountId = (
      service as unknown as {
        deleteWorkerByAccountId: (
          accountId: string,
          workerId: string
        ) => Promise<void>;
      }
    ).deleteWorkerByAccountId.bind(service);

    await expect(deleteWorkerByAccountId('acc-1', 'worker-1')).rejects.toThrow(
      'kafka unavailable'
    );

    const firstMessage = mocks.workerLifecycleQueueService.publish.mock
      .calls[0]?.[0] as { operation_id: string };
    mocks.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      buildWorkerMonitor({
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: firstMessage.operation_id,
      })
    );
    mocks.workerLifecycleQueueService.publish.mockResolvedValue(undefined);

    await expect(
      deleteWorkerByAccountId('acc-1', 'worker-1')
    ).resolves.toBeUndefined();

    expect(
      mocks.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(mocks.workerLifecycleQueueService.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'delete',
        operation_id: firstMessage.operation_id,
        debug_trace_id: firstMessage.operation_id,
      })
    );
  });
});
