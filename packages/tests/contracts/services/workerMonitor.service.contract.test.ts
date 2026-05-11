import 'reflect-metadata';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/server.service', () => ({
  ServerService: class ServerService {},
}));
jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

import { WorkerMonitorService } from '@core/services/workerMonitor.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';

function makeService(): WorkerMonitorService {
  return new WorkerMonitorService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

function makeWorker(overrides: Partial<IWorkerMonitor> = {}): IWorkerMonitor {
  const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  return {
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.disponible,
    worker_type_id: EWorkerType.wwebjs,
    created_at: oldDate,
    updated_at: oldDate,
    deleted_at: null,
    container_id: 'container-1',
    last_connection_check_at: oldDate,
    ...overrides,
  };
}

describe('WorkerMonitorService', () => {
  it('does not stop a disponible worker recently touched by connection setup', () => {
    const service = makeService();
    const recentDate = new Date().toISOString();
    const worker = makeWorker({
      updated_at: recentDate,
      last_connection_check_at: new Date(
        Date.now() - 25 * 60 * 60 * 1000
      ).toISOString(),
    });

    const shouldStop = (service as any).shouldStopDueToInactivity(worker);

    expect(shouldStop).toBe(false);
  });

  it('stops a disponible worker when all activity timestamps are stale', () => {
    const service = makeService();
    const worker = makeWorker();

    const shouldStop = (service as any).shouldStopDueToInactivity(worker);

    expect(shouldStop).toBe(true);
  });
});
