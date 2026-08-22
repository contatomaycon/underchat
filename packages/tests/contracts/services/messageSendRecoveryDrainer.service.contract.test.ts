import 'reflect-metadata';
import {
  buildMessageSendRecoveryPlan,
  type MessageSendRecoveryPlanV1,
} from '@core/common/functions/messageSendRecoveryPlan';
import type { IMessageSendRecoveryClaim } from '@core/services/messageSendIdempotency.service';
import { MessageSendRecoveryDrainerService } from '@core/services/messageSendRecoveryDrainer.service';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

function openBarrier() {
  return {
    runWithPermit: jest.fn(async (_scope: string, action: () => Promise<any>) =>
      action()
    ),
  };
}

function plan(kind: MessageSendRecoveryPlanV1['kind']) {
  const built = buildMessageSendRecoveryPlan({
    accountId: 'account-1',
    operationType: 'direct',
    operationId: 'message-1',
    expectedState: 'provider_invoked',
    targetState: 'ambiguous',
    recovery: {
      provider:
        kind === 'official_handler_recovery_v1' ? 'official' : 'baileys',
      status_update: {
        event_id: 'event-1',
        account_id: 'account-1',
        worker_id: 'worker-1',
        message_id: 'message-1',
        patch: {},
        failed: true,
      },
    },
    meta: {
      provider:
        kind === 'official_handler_recovery_v1'
          ? 'official-whatsapp'
          : 'baileys',
      worker_id: 'worker-1',
    },
    now: new Date('2026-08-13T00:00:00.000Z'),
  });
  if (!built || built.kind !== kind) throw new Error('test plan invalid');
  return built;
}

function claim(
  recoveryPlan: MessageSendRecoveryPlanV1
): IMessageSendRecoveryClaim {
  return {
    ledgerKey: 'message-send:idempotency:v4:account-1:digest',
    recoveryRecordKey: 'message-send:recovery-record:v4:account-1:digest',
    accountId: 'account-1',
    workerId: 'worker-1',
    operationType: 'direct',
    operationId: 'message-1',
    state: 'ambiguous',
    recovery: { status_update: recoveryPlan.steps[0] },
    plan: recoveryPlan,
    owner: 'recovery-owner-1',
    completedStepIds: [],
  };
}

describe('MessageSendRecoveryDrainerService', () => {
  it('marks a Kafka step only after PubAck and then compacts', async () => {
    const recoveryPlan = plan('worker_global_publications_v1');
    const recoveryClaim = claim(recoveryPlan);
    const order: string[] = [];
    const idempotency = {
      processProviderInvocationWatchdogBatch: jest.fn().mockResolvedValue({}),
      claimGlobalRecoveryBatch: jest.fn().mockResolvedValue([recoveryClaim]),
      extendRecoveryClaim: jest.fn().mockImplementation(async () => {
        order.push('lease');
        return 'transitioned';
      }),
      markRecoveryStepCompleted: jest.fn().mockImplementation(async () => {
        order.push('step-complete');
        return 'transitioned';
      }),
      compactRecoveryClaimAfterPubAck: jest
        .fn()
        .mockImplementation(async () => {
          order.push('compact');
          return 'transitioned';
        }),
      releaseRecoveryClaim: jest.fn(),
    };
    const producer = {
      send: jest.fn().mockImplementation(async () => {
        order.push('puback');
      }),
    };
    const drainer = new MessageSendRecoveryDrainerService(
      idempotency as never,
      producer as never,
      {} as never,
      {} as never,
      openBarrier() as never
    );

    await expect(drainer.drainBatch()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
    });
    expect(order).toEqual([
      'lease',
      'puback',
      'step-complete',
      'lease',
      'compact',
    ]);
    expect(idempotency.releaseRecoveryClaim).not.toHaveBeenCalled();
  });

  it('releases without marking or compacting when broker delivery fails', async () => {
    const recoveryClaim = claim(plan('worker_global_publications_v1'));
    const idempotency = {
      processProviderInvocationWatchdogBatch: jest.fn().mockResolvedValue({}),
      claimGlobalRecoveryBatch: jest.fn().mockResolvedValue([recoveryClaim]),
      extendRecoveryClaim: jest.fn().mockResolvedValue('transitioned'),
      markRecoveryStepCompleted: jest.fn(),
      compactRecoveryClaimAfterPubAck: jest.fn(),
      releaseRecoveryClaim: jest.fn().mockResolvedValue('transitioned'),
    };
    const drainer = new MessageSendRecoveryDrainerService(
      idempotency as never,
      {
        send: jest.fn().mockRejectedValue(new Error('broker unavailable')),
      } as never,
      {} as never,
      {} as never,
      openBarrier() as never
    );

    await expect(drainer.drainBatch()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deferred: 0,
      failed: 1,
    });
    expect(idempotency.markRecoveryStepCompleted).not.toHaveBeenCalled();
    expect(idempotency.compactRecoveryClaimAfterPubAck).not.toHaveBeenCalled();
    expect(idempotency.releaseRecoveryClaim).toHaveBeenCalledWith(
      recoveryClaim
    );
  });

  it('defers official compaction to the handler after global PubAcks', async () => {
    const recoveryClaim = claim(plan('official_handler_recovery_v1'));
    const idempotency = {
      processProviderInvocationWatchdogBatch: jest.fn().mockResolvedValue({}),
      claimGlobalRecoveryBatch: jest.fn().mockResolvedValue([recoveryClaim]),
      extendRecoveryClaim: jest.fn().mockResolvedValue('transitioned'),
      markRecoveryStepCompleted: jest.fn().mockResolvedValue('transitioned'),
      compactRecoveryClaimAfterPubAck: jest.fn(),
      releaseRecoveryClaim: jest.fn().mockResolvedValue('transitioned'),
    };
    const drainer = new MessageSendRecoveryDrainerService(
      idempotency as never,
      { send: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      openBarrier() as never
    );

    await expect(drainer.drainBatch()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deferred: 1,
      failed: 0,
    });
    expect(idempotency.compactRecoveryClaimAfterPubAck).not.toHaveBeenCalled();
    expect(idempotency.releaseRecoveryClaim).toHaveBeenCalledWith(
      recoveryClaim,
      5 * 60 * 1000
    );
  });

  it('releases an ever-active NATS lane with the durable ambiguous outcome', async () => {
    const recoveryPlan = buildMessageSendRecoveryPlan({
      accountId: 'account-1',
      operationType: 'notification',
      operationId: 'notification-operation-1',
      expectedState: 'provider_invoked',
      targetState: 'ambiguous',
      recovery: {
        schema_version: 'notification_send_ambiguous_recovery_v1',
        provider: 'baileys',
        worker_id: 'worker-1',
      },
      meta: { provider: 'baileys', worker_id: 'worker-1' },
      lane: {
        accountId: 'account-1',
        workerId: 'worker-1',
        entityKey: 'chat:account-1:worker-1:5511999999999@s.whatsapp.net',
        operationId: 'notification-operation-1',
        commandId: 'command-1',
      },
      now: new Date('2026-08-13T00:00:00.000Z'),
    });
    expect(recoveryPlan?.steps).toEqual([]);
    if (!recoveryPlan) throw new Error('Expected lane-only plan');
    const recoveryClaim: IMessageSendRecoveryClaim = {
      ...claim(recoveryPlan),
      operationType: 'notification',
      operationId: 'notification-operation-1',
      recovery: null,
    };
    const idempotency = {
      processProviderInvocationWatchdogBatch: jest.fn().mockResolvedValue({}),
      claimGlobalRecoveryBatch: jest.fn().mockResolvedValue([recoveryClaim]),
      extendRecoveryClaim: jest.fn().mockResolvedValue('transitioned'),
      markRecoveryStepCompleted: jest.fn(),
      compactRecoveryClaimAfterPubAck: jest
        .fn()
        .mockResolvedValue('transitioned'),
      releaseRecoveryClaim: jest.fn(),
    };
    const lanes = { markTerminal: jest.fn().mockResolvedValue(undefined) };
    const drainer = new MessageSendRecoveryDrainerService(
      idempotency as never,
      { send: jest.fn() } as never,
      {} as never,
      lanes as never,
      openBarrier() as never
    );

    await expect(drainer.drainBatch()).resolves.toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(lanes.markTerminal).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      recoveryPlan.lane?.entity_key,
      'notification-operation-1',
      'command-1',
      'ambiguous',
      'ambiguous'
    );
    expect(lanes.markTerminal).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'expired',
      expect.anything()
    );
  });

  it('does not claim watchdog or recovery work while the barrier is paused', async () => {
    const idempotency = {
      processProviderInvocationWatchdogBatch: jest.fn(),
      claimGlobalRecoveryBatch: jest.fn(),
    };
    const barrier = openBarrier();
    barrier.runWithPermit.mockRejectedValueOnce(
      new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused'
      )
    );
    const drainer = new MessageSendRecoveryDrainerService(
      idempotency as never,
      {} as never,
      {} as never,
      {} as never,
      barrier as never
    );

    await expect(drainer.drainBatch()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      deferred: 0,
      failed: 0,
    });
    expect(
      idempotency.processProviderInvocationWatchdogBatch
    ).not.toHaveBeenCalled();
    expect(idempotency.claimGlobalRecoveryBatch).not.toHaveBeenCalled();
  });
});
