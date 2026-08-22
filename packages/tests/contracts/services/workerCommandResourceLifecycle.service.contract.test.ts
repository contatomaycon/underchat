import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { workerCommandSubject } from '@core/common/functions/workerCommandEnvelope';
import type { ILockLeaseContext } from '@core/common/functions/withLock';
import { workerCommandDurableName } from '@core/services/workerCommandJetStreamIngress.service';
import { WorkerCommandResourceLifecycleService } from '@core/services/workerCommandResourceLifecycle.service';

const request = {
  action: EWorkerAction.delete as const,
  worker_id: 'worker-1',
  account_id: 'account-1',
  lifecycle_operation_id: 'operation-delete-1',
  debug_trace_id: 'trace-delete-1',
};

function buildHarness(
  epoch: {
    state: 'active' | 'draining' | 'closed';
    accountId?: string;
  } | null = { state: 'active' }
) {
  const transition = jest.fn(async () => undefined);
  const epochs = {
    get: jest.fn(async () =>
      epoch
        ? {
            revision: 7,
            record: {
              account_id: epoch.accountId ?? 'account-1',
              worker_id: 'worker-1',
              epoch: 'writer-epoch-7',
              state: epoch.state,
            },
          }
        : null
    ),
    transition,
  };
  const deletionAuthorizer = {
    assertIntent: jest.fn(async () => ({
      permanently_deleted: false,
    })),
    assertTombstone: jest.fn(async () => undefined),
  };
  const deletionResult = {
    durable_name: workerCommandDurableName('worker-1'),
    durable_deleted: true,
    subject: workerCommandSubject('worker-1'),
    backlog_disposition: 'expires_by_stream_max_age' as const,
    backlog_max_age_ms: 300_000,
    purge_performed: false as const,
  };
  const controlPlane = {
    deleteWorkerResources: jest.fn(async () => deletionResult),
  };
  const lifecycleQueue = {
    completePermanentDeletionFinalization: jest.fn(async () => true),
  };
  const lease = {
    signal: new AbortController().signal,
    assertActive: jest.fn(),
  } as ILockLeaseContext;
  const service = new WorkerCommandResourceLifecycleService(
    epochs as never,
    deletionAuthorizer as never,
    controlPlane as never,
    lifecycleQueue as never
  );
  return {
    service,
    epochs,
    transition,
    deletionAuthorizer,
    controlPlane,
    lifecycleQueue,
    lease,
    deletionResult,
  };
}

const expectedResources = [
  workerCommandSubject('worker-1'),
  `durable:${workerCommandDurableName('worker-1')}`,
];

describe('WorkerCommandResourceLifecycleService contract', () => {
  it('authorizes from the durable deletion proof and drains the epoch before teardown', async () => {
    const deps = buildHarness();

    await expect(
      deps.service.beginPermanentDeletion(request, deps.lease)
    ).resolves.toEqual({
      authorization: { permanently_deleted: false },
      epoch: 'writer-epoch-7',
    });
    expect(deps.deletionAuthorizer.assertIntent).toHaveBeenCalledWith(
      request,
      expectedResources
    );
    expect(deps.transition).toHaveBeenCalledWith(
      'worker-1',
      'writer-epoch-7',
      'draining'
    );
  });

  it('closes the epoch, deletes the durable, then completes the DB finalizer', async () => {
    const deps = buildHarness({ state: 'draining' });

    await expect(
      deps.service.finalizePermanentDeletion(request, deps.lease)
    ).resolves.toBe(deps.deletionResult);
    expect(deps.deletionAuthorizer.assertTombstone).toHaveBeenCalledWith(
      request,
      expectedResources
    );
    expect(deps.transition).toHaveBeenCalledWith(
      'worker-1',
      'writer-epoch-7',
      'closed'
    );
    expect(deps.controlPlane.deleteWorkerResources).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(
      deps.lifecycleQueue.completePermanentDeletionFinalization
    ).toHaveBeenCalledWith('worker-1', 'account-1', 'operation-delete-1');
    expect(deps.transition.mock.invocationCallOrder[0]).toBeLessThan(
      deps.controlPlane.deleteWorkerResources.mock.invocationCallOrder[0]
    );
    expect(
      deps.controlPlane.deleteWorkerResources.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.lifecycleQueue.completePermanentDeletionFinalization.mock
        .invocationCallOrder[0]
    );
  });

  it('still deletes the durable and completes finalization when no epoch ever existed', async () => {
    const deps = buildHarness(null);

    await deps.service.finalizePermanentDeletion(request, deps.lease);

    expect(deps.transition).not.toHaveBeenCalled();
    expect(deps.controlPlane.deleteWorkerResources).toHaveBeenCalledTimes(1);
    expect(
      deps.lifecycleQueue.completePermanentDeletionFinalization
    ).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an epoch/account identity conflict', async () => {
    const deps = buildHarness({ state: 'active', accountId: 'account-other' });

    await expect(
      deps.service.beginPermanentDeletion(request, deps.lease)
    ).rejects.toThrow('worker_command_epoch_account_mismatch:worker-1');
    expect(deps.transition).not.toHaveBeenCalled();
  });
});
