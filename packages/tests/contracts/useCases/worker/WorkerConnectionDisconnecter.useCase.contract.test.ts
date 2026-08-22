import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/repositories/worker/WorkerRuntime.repository', () => ({
  WorkerRuntimeRepository: class WorkerRuntimeRepository {},
}));
jest.mock('@core/services/workerConnectionQrCodeRedisQueue.service', () => ({
  WorkerConnectionQrCodeRedisQueueService: class WorkerConnectionQrCodeRedisQueueService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

import {
  WorkerConnectionDisconnectConflictError,
  WorkerConnectionDisconnectPostconditionError,
  WorkerConnectionDisconnecterUseCase,
} from '@core/useCases/worker/WorkerConnectionDisconnecter.useCase';

const t = ((key: string) => key) as never;
const runtimeContainerId = 'a'.repeat(64);
const observedAt = '2026-08-09T14:15:16.123Z';

function makeSut() {
  const workerService = {
    viewWorkerForMonitorConsistent: jest.fn<
      Promise<Record<string, unknown> | null>,
      [string]
    >(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
      deleted_at: null,
      runtime_generation: 7,
      runtime_container_id: runtimeContainerId,
      container_id: runtimeContainerId,
    })),
  };
  const workerGrpcClientService = {
    changeConnectionStatus: jest.fn(async () => undefined),
  };
  const workerRuntimeRepository = {
    finalizeWorkerConnectionDisconnect: jest.fn<
      Promise<Record<string, unknown>>,
      [Record<string, unknown>]
    >(async () => ({
      status: 'completed' as const,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.disponible,
      runtime_generation: 7,
      container_id: runtimeContainerId,
      worker_status_observed_at: observedAt,
    })),
  };
  const redisQueueService = {
    invalidateWorkerState: jest.fn(async () => ({
      deleted_keys: 4,
      scanned_processed_keys: 2,
      duration_ms: 1,
      group_destroy_timeout_count: 0,
      scan_timeout_count: 0,
      delete_timeout_count: 0,
    })),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
  };
  const debugService = { log: jest.fn(async () => undefined) };

  const sut = new WorkerConnectionDisconnecterUseCase(
    workerService as never,
    workerGrpcClientService as never,
    workerRuntimeRepository as never,
    redisQueueService as never,
    centrifugoService as never,
    debugService as never
  );

  return {
    sut,
    workerService,
    workerGrpcClientService,
    workerRuntimeRepository,
    redisQueueService,
    centrifugoService,
  };
}

describe('WorkerConnectionDisconnecterUseCase', () => {
  it('removes the session in place and returns the durable terminal snapshot', async () => {
    const deps = makeSut();

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1', {
        debug_trace_id: 'trace-1',
      })
    ).resolves.toEqual({
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.disponible,
      session_removed: true,
      disconnected_user: true,
      runtime_generation: 7,
      container_id: runtimeContainerId,
      worker_status_observed_at: observedAt,
      debug_trace_id: 'trace-1',
    });

    expect(deps.redisQueueService.invalidateWorkerState).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        accountId: 'account-1',
        workerTypeId: EWorkerType.baileys,
        runtimeGeneration: 7,
        debugTraceId: 'trace-1',
      })
    );
    expect(
      deps.workerGrpcClientService.changeConnectionStatus
    ).toHaveBeenCalledWith(
      'server-1',
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        debug_trace_id: 'trace-1',
        runtime_generation: 7,
      },
      'account-1'
    );
    expect(
      deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      expected_runtime_generation: 7,
      expected_container_id: runtimeContainerId,
      expected_connection_epoch: null,
    });
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.disconnected,
        worker_status_id: EWorkerStatus.disponible,
        session_removed: true,
        disconnected_user: true,
        worker_status_observed_at: observedAt,
      })
    );
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('revalidates an already removed session without clearing the provider twice', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      lifecycle_operation_id: null,
      deleted_at: null,
      runtime_generation: 7,
      runtime_container_id: runtimeContainerId,
      container_id: runtimeContainerId,
      connection_epoch: 'connection-epoch-1',
      disconnected_connection_epoch: 'connection-epoch-1',
      connection_disconnected_at: observedAt,
    });

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      session_removed: true,
      worker_status_id: EWorkerStatus.disponible,
    });

    expect(deps.redisQueueService.invalidateWorkerState).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.changeConnectionStatus
    ).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_connection_epoch: 'connection-epoch-1',
      })
    );
  });

  it('keeps the authoritative HTTP success when realtime publication fails', async () => {
    const deps = makeSut();
    deps.centrifugoService.publishSub.mockRejectedValueOnce(
      new Error('centrifugo unavailable')
    );

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      session_removed: true,
      worker_status_id: EWorkerStatus.disponible,
    });
  });

  it('recovers a lost provider acknowledgement after durable cleanup completed', async () => {
    const deps = makeSut();
    deps.workerGrpcClientService.changeConnectionStatus.mockRejectedValueOnce(
      new Error('worker grpc response lost')
    );

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1', {
        debug_trace_id: 'trace-provider-ack-lost',
      })
    ).resolves.toMatchObject({
      session_removed: true,
      worker_status_id: EWorkerStatus.disponible,
    });

    expect(deps.redisQueueService.invalidateWorkerState).toHaveBeenCalledTimes(
      2
    );
    expect(
      deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        session_removed: true,
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('keeps the provider error when durable cleanup is not proven', async () => {
    const deps = makeSut();
    deps.workerGrpcClientService.changeConnectionStatus.mockRejectedValueOnce(
      new Error('worker grpc response lost')
    );
    deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect.mockResolvedValueOnce(
      { status: 'session_not_empty' }
    );
    deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect.mockResolvedValueOnce(
      { status: 'runtime_mismatch' }
    );

    await expect(deps.sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'grpc_error'
    );

    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('waits for a delayed durable clear after the provider acknowledgement is lost', async () => {
    const deps = makeSut();
    deps.workerGrpcClientService.changeConnectionStatus.mockRejectedValueOnce(
      new Error('worker grpc deadline exceeded')
    );
    deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect
      .mockResolvedValueOnce({ status: 'session_not_empty' })
      .mockResolvedValueOnce({ status: 'session_fence_invalid' });

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      session_removed: true,
      worker_status_id: EWorkerStatus.disponible,
    });

    expect(
      deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledTimes(3);
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledTimes(1);
  });

  it('blocks a disconnect while a lifecycle operation owns the worker', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-1',
      deleted_at: null,
      runtime_generation: 7,
      runtime_container_id: runtimeContainerId,
      container_id: runtimeContainerId,
    });

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1')
    ).rejects.toBeInstanceOf(WorkerConnectionDisconnectConflictError);
    expect(deps.redisQueueService.invalidateWorkerState).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.changeConnectionStatus
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the PostgreSQL operational tree is not empty', async () => {
    const deps = makeSut();
    deps.workerRuntimeRepository.finalizeWorkerConnectionDisconnect.mockResolvedValueOnce(
      { status: 'session_not_empty' }
    );

    await expect(
      deps.sut.execute(t, 'account-1', 'worker-1')
    ).rejects.toBeInstanceOf(WorkerConnectionDisconnectPostconditionError);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
