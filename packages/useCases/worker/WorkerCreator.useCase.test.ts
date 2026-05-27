import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerCreatorUseCase } from './WorkerCreator.useCase';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class PlanAccountService {},
}));

jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'worker-created-id'),
}));

const t = ((key: string) => key) as never;

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

function buildUseCase() {
  const callOrder: string[] = [];

  const workerService = {
    listWorkerServers: jest.fn(async () => [{ server_id: 'server-1' }]),
    viewWorkerServer: jest.fn(async () => ({ server_id: 'server-1' })),
    createWorker: jest.fn(async () => {
      callOrder.push('create-worker');
      return true;
    }),
    updateWorkerById: jest.fn(
      async (
        _accountId: string,
        input: { worker_status_id?: EWorkerStatus }
      ) => {
        callOrder.push(
          input?.worker_status_id === EWorkerStatus.error
            ? 'mark-error'
            : 'update-worker'
        );
        return true;
      }
    ),
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const centrifugoService = {
    publishSub: jest.fn(async () => {
      callOrder.push('publish');
      return {};
    }),
  };

  const planAccountService = {
    validateCanCreateWorker: jest.fn(async () => undefined),
  };

  const workerGrpcClientService = {
    createWorker: jest.fn(async () => {
      callOrder.push('grpc-create');
      return undefined;
    }),
  };

  const workerConfigService = {
    ensureTypingSimulationDefault: jest.fn(async () => {
      callOrder.push('typing-default');
      return { enabled: true, speed: 50 };
    }),
    ensureSecurityKeyDefault: jest.fn(async () => {
      callOrder.push('security-key-default');
      return {
        enabled: true,
        chatbot: true,
        schedule: true,
        quick_message: true,
      };
    }),
  };

  const useCase = new WorkerCreatorUseCase(
    workerService as never,
    accountService as never,
    centrifugoService as never,
    planAccountService as never,
    workerGrpcClientService as never,
    workerConfigService as never
  );

  return {
    accountService,
    callOrder,
    centrifugoService,
    planAccountService,
    useCase,
    workerConfigService,
    workerGrpcClientService,
    workerService,
  };
}

describe('WorkerCreatorUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates active security and typing defaults before dispatching channel creation', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toBe(true);

    expect(deps.workerService.createWorker).toHaveBeenCalledWith({
      worker_id: 'worker-created-id',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      server_id: 'server-1',
      account_id: 'account-1',
      name: 'Canal principal',
    });
    expect(
      deps.workerConfigService.ensureTypingSimulationDefault
    ).toHaveBeenCalledWith('worker-created-id');
    expect(
      deps.workerConfigService.ensureSecurityKeyDefault
    ).toHaveBeenCalledWith('worker-created-id');
    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-created-id',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.creating,
      })
    );
    expect(deps.callOrder).toEqual([
      'create-worker',
      'typing-default',
      'security-key-default',
      'publish',
      'grpc-create',
    ]);
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('returns after publishing creating status without waiting for gRPC completion', async () => {
    const deps = buildUseCase();
    let resolveCreate!: () => void;
    deps.workerGrpcClientService.createWorker.mockImplementationOnce(() => {
      deps.callOrder.push('grpc-create');
      return new Promise<undefined>((resolve) => {
        resolveCreate = () => resolve(undefined);
      });
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toBe(true);

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.creating,
      })
    );
    expect(deps.callOrder).toContain('grpc-create');
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();

    resolveCreate();
    await flushPromises();
  });

  it('marks and publishes error when async gRPC dispatch fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = buildUseCase();
    deps.workerGrpcClientService.createWorker.mockImplementationOnce(
      async () => {
        deps.callOrder.push('grpc-create');
        throw new Error('grpc failed');
      }
    );

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toBe(true);
    await flushPromises();

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.error,
      }
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenLastCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.error,
      })
    );

    jest.restoreAllMocks();
  });
});
