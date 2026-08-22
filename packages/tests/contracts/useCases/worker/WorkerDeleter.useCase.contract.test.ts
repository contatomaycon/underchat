import 'reflect-metadata';

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { WorkerDeleterUseCase } from '@core/useCases/worker/WorkerDeleter.useCase';

const t = ((key: string) => key) as never;

function workerMonitor(
  overrides: Partial<IWorkerMonitor> = {}
): IWorkerMonitor {
  return {
    worker_id: 'worker-1',
    name: 'Channel',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.wwebjs,
    created_at: '2026-07-27T20:00:00.000Z',
    updated_at: '2026-07-27T21:00:00.000Z',
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: null,
    last_connection_check_at: '2026-07-27T21:00:00.000Z',
    ...overrides,
  };
}

const buildUseCase = (overrides: Record<string, unknown> = {}) => {
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Channel',
      type: { id: EWorkerType.wwebjs },
    })),
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: 'server-1',
      account_id: 'account-1',
    })),
    viewWorkerForMonitorConsistent: jest.fn(async () => workerMonitor()),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    deleteWorkerById: jest.fn(async () => true),
    ...(overrides.workerService as Record<string, unknown> | undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
    ...(overrides.centrifugoService as Record<string, unknown> | undefined),
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
    publish: jest.fn(async () => undefined),
    ...(overrides.workerLifecycleQueueService as
      Record<string, unknown> | undefined),
  };
  const inactivityAlertChannelDeactivator = {
    deactivateByChannel: jest.fn(async () => 0),
    ...(overrides.inactivityAlertChannelDeactivator as
      Record<string, unknown> | undefined),
  };
  const useCase = new WorkerDeleterUseCase(
    workerService as never,
    centrifugoService as never,
    workerLifecycleQueueService as never,
    inactivityAlertChannelDeactivator as never
  );

  return {
    useCase,
    deps: {
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
      inactivityAlertChannelDeactivator,
    },
  };
};

describe('WorkerDeleterUseCase', () => {
  it('deletes official whatsapp worker without lifecycle runtime work', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => ({
          id: 'worker-1',
          name: 'Official',
          type: { id: EWorkerType.whatsapp },
        })),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toBe(
      true
    );

    expect(deps.workerService.viewWorkerBalancer).not.toHaveBeenCalled();
    expect(
      deps.workerLifecycleQueueService.preparePermanentDeletion
    ).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).toHaveBeenCalledWith('account-1', 'worker-1');
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        event_type: 'status',
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: 'worker-1',
        worker_name: 'Official',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.delete,
      })
    );
  });

  it('claims and durably queues a non-official worker deletion', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toBe(
      true
    );

    expect(
      deps.workerLifecycleQueueService.preparePermanentDeletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        source: 'worker_delete',
      })
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        operation_id: 'delete-operation-1',
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        event_type: 'status',
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-1',
        debug_trace_id: 'delete-operation-1',
      })
    );
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).toHaveBeenCalledWith('account-1', 'worker-1');
  });

  it('surfaces lifecycle delivery failure without writing an early tombstone', async () => {
    const { useCase, deps } = buildUseCase({
      workerLifecycleQueueService: {
        publish: jest.fn(async () => {
          throw new Error('kafka unavailable');
        }),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'kafka unavailable'
    );

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
