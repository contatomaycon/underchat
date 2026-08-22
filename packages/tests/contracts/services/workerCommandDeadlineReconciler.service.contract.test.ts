import 'reflect-metadata';
import {
  WORKER_COMMAND_TYPES,
  WORKER_DEFERRED_SCHEDULE_SUBJECT_WILDCARD,
} from '@core/common/constants/workerCommandTransport';
import type { WorkerCommandType } from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  WORKER_COMMAND_DEADLINE_POLICY,
  type WorkerCommandDeadlineClaim,
  type WorkerCommandDeadlineRecordV1,
} from '@core/services/workerCommandDeadlineRegistry.service';
import { WorkerCommandDeadlineReconcilerService } from '@core/services/workerCommandDeadlineReconciler.service';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

const ISSUED_AT = '2026-08-13T12:00:00.000Z';
const DEADLINE_AT = '2026-08-13T12:05:00.000Z';

function record(
  commandType: WorkerCommandType = 'direct_send'
): WorkerCommandDeadlineRecordV1 {
  return {
    schema_version: 1,
    command_id: `command-${commandType}`,
    operation_id: `operation-${commandType}`,
    account_id: 'account-1',
    worker_id: 'worker-1',
    command_type: commandType,
    entity_key: `entity:${commandType}`,
    entity_sequence: 1,
    origin_epoch: 'epoch-1',
    issued_at: ISSUED_AT,
    deadline_at: DEADLINE_AT,
    payload_digest: 'a'.repeat(64),
  };
}

function setup(
  records: WorkerCommandDeadlineRecordV1[],
  laneState: string | ((entry: WorkerCommandDeadlineRecordV1) => string)
) {
  const claims: WorkerCommandDeadlineClaim[] = records.map((entry) => ({
    owner: 'lease-owner',
    record: entry,
  }));
  const registry = {
    claimDue: jest.fn(async () => claims),
    complete: jest.fn(async () => true),
    reschedule: jest.fn(async () => true),
  };
  const lanes = {
    expireNeverActive: jest.fn(
      async (_accountId: string, _workerId: string, entityKey: string) => {
        const entry = records.find((item) => item.entity_key === entityKey);
        if (!entry) throw new Error('deadline_test_record_missing');
        return typeof laneState === 'function' ? laneState(entry) : laneState;
      }
    ),
    finalizeEverActiveAmbiguous: jest.fn(
      async (): Promise<string> => 'terminal:ambiguous'
    ),
  };
  const failures = {
    publish: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const schedules = {
    setMessageOperationalState: jest.fn(async () => 'transitioned'),
  };
  const barrier = {
    runWithPermit: jest.fn(
      async (_scope: string, action: () => Promise<void>) => action()
    ),
  };
  return {
    registry,
    lanes,
    failures,
    schedules,
    barrier,
    service: new WorkerCommandDeadlineReconcilerService(
      registry as never,
      lanes as never,
      failures as never,
      schedules as never,
      barrier as never
    ),
  };
}

describe('WorkerCommandDeadlineReconcilerService contract', () => {
  it('covers every admitted command type with never-active expiry and a failure PubAck before removal', async () => {
    const records = WORKER_COMMAND_TYPES.map((type) => record(type));
    const { service, lanes, failures, registry } = setup(records, 'expired');

    await service.runOnce(new Date(DEADLINE_AT));

    expect(lanes.expireNeverActive).toHaveBeenCalledTimes(records.length);
    expect(failures.publish).toHaveBeenCalledTimes(records.length);
    expect(registry.complete).toHaveBeenCalledTimes(records.length);
    for (const entry of records) {
      expect(failures.publish).toHaveBeenCalledWith({
        workerId: entry.worker_id,
        code: 'expired',
        command: entry,
        error: expect.any(Error),
      });
    }
    expect(service.getStatus()).toMatchObject({
      claimed_total: records.length,
      completed_total: records.length,
      failure_published_total: records.length,
      failed_total: 0,
    });
  });

  it.each([
    ['missing', 'ambiguous'],
    ['terminal:failed', 'failed'],
    ['terminal:ambiguous', 'ambiguous'],
    ['terminal:expired', 'expired'],
  ])('publishes %s evidence as %s before compaction', async (state, code) => {
    const entry = record();
    const { service, failures, registry } = setup([entry], state);

    await service.runOnce(new Date(DEADLINE_AT));

    expect(failures.publish).toHaveBeenCalledWith(
      expect.objectContaining({ code, command: entry })
    );
    expect(registry.complete).toHaveBeenCalledTimes(1);
  });

  it('compacts succeeded terminal commands without emitting failure evidence', async () => {
    const { service, failures, registry } = setup(
      [record()],
      'terminal:succeeded'
    );

    await service.runOnce(new Date(DEADLINE_AT));

    expect(failures.publish).not.toHaveBeenCalled();
    expect(registry.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps ever-active commands indexed until ledger terminalization, then finalizes five minutes before record expiry', async () => {
    const entry = record();
    const beforeCap = setup([entry], 'ever_active');
    const finalizeAt = new Date(
      Date.parse(ISSUED_AT) +
        WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs -
        WORKER_COMMAND_DEADLINE_POLICY.finalizationMarginMs
    );

    await beforeCap.service.runOnce(new Date(finalizeAt.getTime() - 1));

    expect(beforeCap.failures.publish).not.toHaveBeenCalled();
    expect(beforeCap.registry.complete).not.toHaveBeenCalled();
    expect(beforeCap.registry.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ record: entry }),
      finalizeAt
    );

    const atCap = setup([entry], 'ever_active');
    await atCap.service.runOnce(finalizeAt);

    expect(atCap.failures.publish).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ambiguous', command: entry })
    );
    expect(atCap.lanes.finalizeEverActiveAmbiguous).toHaveBeenCalledWith(
      entry.account_id,
      entry.worker_id,
      entry.entity_key,
      entry.operation_id,
      entry.command_id
    );
    expect(atCap.registry.complete).toHaveBeenCalledTimes(1);
    expect(
      atCap.lanes.finalizeEverActiveAmbiguous.mock.invocationCallOrder[0]
    ).toBeLessThan(atCap.failures.publish.mock.invocationCallOrder[0] ?? 0);
    expect(atCap.failures.publish.mock.invocationCallOrder[0]).toBeLessThan(
      atCap.registry.complete.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('honors a concurrent succeeded terminal winner before publishing forced ambiguous evidence', async () => {
    const entry = record();
    const atCap = setup([entry], 'ever_active');
    atCap.lanes.finalizeEverActiveAmbiguous.mockResolvedValueOnce(
      'terminal:succeeded'
    );
    const finalizeAt = new Date(
      Date.parse(ISSUED_AT) +
        WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs -
        WORKER_COMMAND_DEADLINE_POLICY.finalizationMarginMs
    );

    await atCap.service.runOnce(finalizeAt);

    expect(atCap.failures.publish).not.toHaveBeenCalled();
    expect(atCap.registry.complete).toHaveBeenCalledTimes(1);
    expect(atCap.schedules.setMessageOperationalState).not.toHaveBeenCalled();
  });

  it('retains the record for idempotent retry when the failure PubAck is unknown', async () => {
    const entry = record();
    const { service, failures, registry } = setup([entry], 'expired');
    failures.publish.mockRejectedValueOnce(new Error('puback_timeout'));

    await service.runOnce(new Date(DEADLINE_AT));

    expect(registry.complete).not.toHaveBeenCalled();
    expect(registry.reschedule).toHaveBeenCalledTimes(1);
    expect(service.getStatus().failed_total).toBe(1);
  });

  it('reschedules a never-active command whose transitive predecessor is still active', async () => {
    const entry = record();
    const { service, failures, registry } = setup(
      [entry],
      'predecessor_pending'
    );

    await service.runOnce(new Date(DEADLINE_AT));

    expect(failures.publish).not.toHaveBeenCalled();
    expect(registry.complete).not.toHaveBeenCalled();
    expect(registry.reschedule).toHaveBeenCalledTimes(1);
  });

  it('never renews an unknown failure claim beyond the immutable 24h cap', async () => {
    const entry = record();
    const { service, failures, registry } = setup([entry], 'expired');
    failures.publish.mockRejectedValueOnce(new Error('nats_unavailable'));
    const atCap = new Date(
      Date.parse(ISSUED_AT) + WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs
    );

    await service.runOnce(atCap);

    expect(registry.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ record: entry }),
      new Date(atCap.getTime() + WORKER_COMMAND_DEADLINE_POLICY.intervalMs)
    );
    expect(registry.complete).not.toHaveBeenCalled();
  });

  it('uses the canonical token-depth wildcard for deferred schedules', () => {
    expect(WORKER_DEFERRED_SCHEDULE_SUBJECT_WILDCARD).toBe(
      'uc.worker.deferred.schedule.>'
    );
  });

  it.each([
    ['expired', 'pre_provider_failed'],
    ['terminal:failed', 'provider_rejected'],
    ['missing', 'ambiguous'],
    ['terminal:succeeded', 'succeeded'],
  ])(
    'projects schedule lane state %s so the existing ES reconciler converges it as %s',
    async (laneState, operationalState) => {
      const entry = {
        ...record('schedule_send'),
        schedule_projection: {
          schedule_id: 'schedule-1',
          message_id: 'message-1',
          attempt_id: 'operation-schedule_send',
        },
      };
      const { service, schedules } = setup([entry], laneState);

      await service.runOnce(new Date(DEADLINE_AT));

      expect(schedules.setMessageOperationalState).toHaveBeenCalledWith(
        {
          scheduleId: 'schedule-1',
          messageId: 'message-1',
          attemptId: 'operation-schedule_send',
          accountId: 'account-1',
          workerId: 'worker-1',
        },
        operationalState
      );
    }
  );

  it('does not close the shared failure publisher when leadership is lost', async () => {
    const { service, failures } = setup([], 'expired');

    service.start();
    await service.close();

    expect(failures.close).not.toHaveBeenCalled();
  });

  it('does not claim or publish while the global barrier is paused', async () => {
    const { service, barrier, registry, failures } = setup(
      [record()],
      'expired'
    );
    barrier.runWithPermit.mockRejectedValueOnce(
      new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused'
      )
    );

    await expect(
      service.runOnce(new Date(DEADLINE_AT))
    ).resolves.toBeUndefined();

    expect(registry.claimDue).not.toHaveBeenCalled();
    expect(failures.publish).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      barrier_paused: true,
      barrier_skipped_total: 1,
    });
  });
});
