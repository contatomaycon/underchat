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
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';

function makeService(
  overrides: {
    workerService?: Record<string, unknown>;
    sshService?: { runCommands: jest.Mock };
    centrifugoService?: Record<string, unknown>;
  } = {}
): WorkerMonitorService {
  return new WorkerMonitorService(
    (overrides.workerService ?? {}) as never,
    {} as never,
    (overrides.sshService ?? {}) as never,
    {} as never,
    {} as never,
    (overrides.centrifugoService ?? {}) as never,
    {} as never
  );
}

function makeWorker(overrides: Partial<IWorkerMonitor> = {}): IWorkerMonitor {
  const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  return {
    worker_id: 'worker-1',
    name: 'Canal 1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.disponible,
    worker_type_id: EWorkerType.wwebjs,
    created_at: oldDate,
    updated_at: oldDate,
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: null,
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

  it('ignores warm standby containers when listing remote containers', async () => {
    const sshService = {
      runCommands: jest.fn(async () => [
        {
          output: [
            'under-balance-api||',
            'worker-1||',
            '019dfe2c-2c30-730d-88e9-63b839bb1b37|true|pool-assigned',
            'warm-pool-1|true|pool-1',
            'warm-pool-2||pool-2',
            'warm-legacy||',
          ].join('\n'),
        },
      ]),
    };
    const service = makeService({ sshService });

    const containers = await (service as any).listContainers(
      'server-1',
      {} as never
    );

    expect(containers).toEqual([
      'under-balance-api',
      'worker-1',
      '019dfe2c-2c30-730d-88e9-63b839bb1b37',
    ]);
  });

  it('checks connection for disponible workers', () => {
    const service = makeService();

    const shouldCheck = (service as any).shouldCheckConnection(
      makeWorker({ worker_status_id: EWorkerStatus.disponible })
    );

    expect(shouldCheck).toBe(true);
  });

  it('treats enveloped TypeScript worker health as session ready', async () => {
    const body = {
      status: true,
      message: '',
      data: {
        session_ready: true,
        connected: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        last_probe_at: '2026-06-27T13:17:51.090Z',
        probe_latency_ms: 216,
        phone: '556192037138',
        kafka_unhealthy: false,
      },
    };
    const sshService = {
      runCommands: jest.fn(async () => [
        {
          output: `${JSON.stringify(body)}__HTTP_STATUS__200`,
        },
      ]),
    };
    const service = makeService({ sshService });

    const result = await (service as any).checkConnection(
      makeWorker({ worker_status_id: EWorkerStatus.online }),
      'server-1',
      {} as never
    );

    expect(result).toEqual(
      expect.objectContaining({
        healthy: true,
        code: 200,
        session_ready: true,
        connected: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        last_probe_at: '2026-06-27T13:17:51.090Z',
        probe_latency_ms: 216,
        phone: '556192037138',
        kafka_unhealthy: false,
      })
    );
  });

  it('promotes a disponible worker to online when health proves session readiness', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
      viewWorkerPhoneConnectionDate: jest.fn(async () => ({
        id: 'worker-1',
        number: '556192037138',
        connection_date: null,
      })),
      updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
      publish: jest.fn(async () => true),
    };
    const service = makeService({ workerService, centrifugoService });

    await (service as any).syncConnectionStatusWithFailureTracking(
      makeWorker({ worker_status_id: EWorkerStatus.disponible }),
      {
        healthy: true,
        code: 200,
        body: {},
        session_ready: true,
        connected: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        last_probe_at: '2026-06-25T17:21:00.000Z',
        probe_latency_ms: 12,
        phone: '556192037138',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(
      workerService.updateWorkerLastConnectionCheckAt
    ).toHaveBeenCalledWith('worker-1');
    expect(
      workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      status: EWorkerStatus.online,
      number: '556192037138',
      connection_date: expect.any(String),
    });
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        code: 200,
        status: 'connected',
        worker_id: 'worker-1',
        worker_name: 'Canal 1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
        phone: '556192037138',
      })
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_name: 'Canal 1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
      })
    );
  });

  it('publishes complete offline status when connection failures reach the threshold', async () => {
    const workerService = {
      updateStatusWorker: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const service = makeService({ workerService, centrifugoService });
    const worker = makeWorker({ worker_status_id: EWorkerStatus.online });

    await (service as any).syncConnectionStatusWithFailureTracking(
      worker,
      {
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'DISCONNECTED',
        degraded_reason: 'probe_failed',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );
    await (service as any).syncConnectionStatusWithFailureTracking(
      worker,
      {
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'DISCONNECTED',
        degraded_reason: 'probe_failed',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );
    await (service as any).syncConnectionStatusWithFailureTracking(
      worker,
      {
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'DISCONNECTED',
        degraded_reason: 'probe_failed',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(workerService.updateStatusWorker).toHaveBeenCalledWith(
      'worker-1',
      EWorkerStatus.offline
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: 'worker-1',
        worker_name: 'Canal 1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.offline,
      })
    );
  });

  it('keeps a disponible worker disponible when health is not session ready', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
      updateStatusWorker: jest.fn(async () => true),
      updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    };
    const service = makeService({ workerService });

    await (service as any).syncConnectionStatusWithFailureTracking(
      makeWorker({ worker_status_id: EWorkerStatus.disponible }),
      {
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: true,
        authenticated: false,
        provider_state: 'PAIRING',
        degraded_reason: 'missing_local_session',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(
      workerService.updateWorkerLastConnectionCheckAt
    ).not.toHaveBeenCalled();
    expect(workerService.updateStatusWorker).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
  });
});
