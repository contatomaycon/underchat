import 'reflect-metadata';

const mockLoadSync = jest.fn(() => ({ package: 'definition' }));
const mockLoadPackageDefinition = jest.fn(() => ({
  worker_command: {
    WorkerCommand: jest.fn().mockImplementation(() => ({
      AuthorizeChromiumLockCleanup: mockAuthorizeChromiumLockCleanup,
      close: mockClose,
    })),
  },
}));
const mockCreateInsecure = jest.fn(() => ({ insecure: true }));
const mockMetadataSet = jest.fn();
const mockClose = jest.fn();
const mockAuthorizeChromiumLockCleanup = jest.fn(
  (
    _request: unknown,
    _metadata: unknown,
    _options: unknown,
    callback: (error: null, response: { authorized: boolean }) => void
  ) => callback(null, { authorized: true })
);

jest.mock('@grpc/proto-loader', () => ({
  loadSync: mockLoadSync,
}));

jest.mock('@grpc/grpc-js', () => ({
  credentials: { createInsecure: mockCreateInsecure },
  loadPackageDefinition: mockLoadPackageDefinition,
  Metadata: class Metadata {
    set(...args: unknown[]): void {
      mockMetadataSet(...args);
    }
  },
}));

jest.mock('@core/config/environments', () => ({
  balanceEnvironment: {
    grpcHost: 'balance.test',
    grpcPort: 50_052,
  },
}));

jest.mock('@core/common/functions/resolveProtoPath', () => ({
  resolveProtoPath: jest.fn(() => '/test/worker_command.proto'),
}));

jest.mock('@core/common/functions/balancerRuntimeFenceAuth', () => ({
  BALANCER_RUNTIME_FENCE_TOKEN_METADATA: 'x-underchat-runtime-fence-token',
  balancerRuntimeFenceToken: jest.fn(() => 'runtime-fence-token'),
}));

jest.mock('@core/services/workerRuntimeDatabase.service', () => ({
  WorkerRuntimeDatabaseService: class WorkerRuntimeDatabaseService {},
}));

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';

describe('BalanceWorkerStatusGrpcClientService legacy Chromium client', () => {
  it('loads and parses gRPC only on legacy cleanup, then reuses the descriptor', async () => {
    const workerRuntimeDatabaseService = {
      getTypingSimulationConfig: jest.fn(async () => ({
        typing_simulation_enabled: false,
      })),
    };
    const service = new BalanceWorkerStatusGrpcClientService(
      workerRuntimeDatabaseService as never
    );

    await expect(
      service.getTypingSimulationConfig({
        worker_id: 'worker-1',
        account_id: 'account-1',
      })
    ).resolves.toEqual({ typing_simulation_enabled: false });
    expect(mockLoadSync).not.toHaveBeenCalled();
    expect(mockLoadPackageDefinition).not.toHaveBeenCalled();

    const payload = {
      request_id: 'request-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 1,
      requester_container_id: 'ABC123',
      session_volume_name: 'session-worker-1',
      singleton_lock_target: 'SingletonLock',
    };

    await expect(
      service.authorizeChromiumLockCleanup(payload)
    ).resolves.toEqual({ authorized: true });
    await expect(
      service.authorizeChromiumLockCleanup({
        ...payload,
        request_id: 'request-2',
      })
    ).resolves.toEqual({ authorized: true });

    expect(mockLoadSync).toHaveBeenCalledTimes(1);
    expect(mockLoadPackageDefinition).toHaveBeenCalledTimes(1);
    expect(mockCreateInsecure).toHaveBeenCalledTimes(2);
    expect(mockAuthorizeChromiumLockCleanup).toHaveBeenCalledTimes(2);
    expect(mockClose).toHaveBeenCalledTimes(2);
    expect(mockMetadataSet).toHaveBeenCalledWith(
      'x-underchat-runtime-fence-token',
      'runtime-fence-token'
    );
  });

  it('rejects invalid cleanup requests without loading gRPC', async () => {
    const service = new BalanceWorkerStatusGrpcClientService({} as never);

    await expect(
      service.authorizeChromiumLockCleanup({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('Invalid Chromium lock cleanup authorization payload');
  });
});
