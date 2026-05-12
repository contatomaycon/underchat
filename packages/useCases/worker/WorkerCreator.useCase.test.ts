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

function buildUseCase() {
  const callOrder: string[] = [];

  const workerService = {
    listWorkerServers: jest.fn(async () => [{ server_id: 'server-1' }]),
    viewWorkerServer: jest.fn(async () => ({ server_id: 'server-1' })),
    createWorker: jest.fn(async () => {
      callOrder.push('create-worker');
      return true;
    }),
    updateWorkerById: jest.fn(async () => {
      callOrder.push('mark-disponible');
      return true;
    }),
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

  it('creates active security and typing defaults immediately after creating a channel', async () => {
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
      worker_status_id: EWorkerStatus.new,
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
      })
    );
    expect(deps.callOrder).toEqual([
      'create-worker',
      'typing-default',
      'security-key-default',
      'publish',
      'grpc-create',
      'mark-disponible',
    ]);
  });
});
