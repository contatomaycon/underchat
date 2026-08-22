import { enqueuePermanentWorkerDeletion } from '@core/common/functions/workerPermanentDeletionLifecycle';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';

function workerMonitor(
  overrides: Partial<IWorkerMonitor> = {}
): IWorkerMonitor {
  return {
    worker_id: 'worker-1',
    name: 'Worker 1',
    account_id: 'account-1',
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

function buildDependencies() {
  const workerService = {
    viewWorkerForMonitorConsistent: jest.fn(async () => workerMonitor()),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
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
          source: input.source as 'worker_delete',
          debug_trace_id: operationId,
          requested_at: '2026-07-27T22:00:00.000Z',
        };
      }
    ),
    loadPermanentDeletionProof: jest.fn<
      Promise<Record<string, unknown> | null>,
      [string, string]
    >(async () => null),
    publish: jest.fn(async () => undefined),
  };

  return { workerService, workerLifecycleQueueService };
}

describe('enqueuePermanentWorkerDeletion', () => {
  it('journals before claiming and publishes only after the exact CAS', async () => {
    const dependencies = buildDependencies();

    await expect(
      enqueuePermanentWorkerDeletion(dependencies as never, {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source: 'worker_delete',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'delete',
        operation_id: 'delete-operation-1',
      })
    );

    expect(
      dependencies.workerLifecycleQueueService.preparePermanentDeletion.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      dependencies.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    );
    expect(
      dependencies.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      dependencies.workerLifecycleQueueService.publish.mock
        .invocationCallOrder[0]
    );
  });

  it('recovers an ambiguous CAS response with the same operation id', async () => {
    const dependencies = buildDependencies();
    dependencies.workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      new Error('database response lost')
    );
    dependencies.workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(workerMonitor())
      .mockResolvedValueOnce(
        workerMonitor({
          worker_status_id: EWorkerStatus.deleting,
          lifecycle_operation_id: 'delete-operation-1',
        })
      );

    await expect(
      enqueuePermanentWorkerDeletion(dependencies as never, {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source: 'worker_delete',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        operation_id: 'delete-operation-1',
      })
    );

    expect(
      dependencies.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.workerLifecycleQueueService.publish
    ).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: 'delete-operation-1' })
    );
  });

  it('requeues an existing tombstone with its persisted deletion proof', async () => {
    const dependencies = buildDependencies();
    dependencies.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      workerMonitor({
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-existing',
        deleted_at: '2026-07-27T22:00:00.000Z',
      })
    );
    dependencies.workerLifecycleQueueService.loadPermanentDeletionProof.mockResolvedValueOnce(
      {
        request_id: 'delete-request-existing',
        operation_id: 'delete-operation-existing',
        action: 'delete',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.deleting,
        source: 'worker_delete',
        debug_trace_id: 'delete-operation-existing',
        requested_at: '2026-07-27T22:00:00.000Z',
      }
    );

    await expect(
      enqueuePermanentWorkerDeletion(dependencies as never, {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source: 'worker_delete',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        operation_id: 'delete-operation-existing',
      })
    );

    expect(
      dependencies.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(
      dependencies.workerLifecycleQueueService.publish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'delete-operation-existing',
      })
    );
  });

  it('does not synthesize a proof after a tombstone', async () => {
    const dependencies = buildDependencies();
    dependencies.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      workerMonitor({
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-existing',
        deleted_at: '2026-07-27T22:00:00.000Z',
      })
    );

    await expect(
      enqueuePermanentWorkerDeletion(dependencies as never, {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source: 'worker_delete',
      })
    ).rejects.toThrow('missing its immutable deletion proof');
    expect(
      dependencies.workerLifecycleQueueService.preparePermanentDeletion
    ).not.toHaveBeenCalled();
    expect(
      dependencies.workerLifecycleQueueService.publish
    ).not.toHaveBeenCalled();
  });

  it('surfaces persistent publish failure without compensating the deleting fence', async () => {
    const dependencies = buildDependencies();
    dependencies.workerLifecycleQueueService.publish.mockRejectedValue(
      new Error('kafka unavailable')
    );

    await expect(
      enqueuePermanentWorkerDeletion(dependencies as never, {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source: 'worker_delete',
      })
    ).rejects.toThrow('kafka unavailable');

    expect(
      dependencies.workerLifecycleQueueService.publish
    ).toHaveBeenCalledTimes(3);
    expect(
      dependencies.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
  });
});
