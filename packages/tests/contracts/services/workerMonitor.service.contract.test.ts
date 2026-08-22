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
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/workerCommandHandler.service', () => ({
  WorkerCommandHandlerService: class WorkerCommandHandlerService {},
}));

import { WorkerMonitorService } from '@core/services/workerMonitor.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import * as localConnectionStatusLog from '@core/common/functions/localConnectionStatusLog';
import {
  WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE,
  WORKER_LIVENESS_LIFECYCLE_RECOVERY_BOUND_MS,
  WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS,
  WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS,
  WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS,
  WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER,
  WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE,
} from '@core/common/functions/workerContainerLivenessPolicy';

function makeService(
  overrides: {
    workerService?: Record<string, unknown>;
    serverService?: Record<string, unknown>;
    sshService?: { runCommands: jest.Mock };
    workerLifecycleQueueService?: Record<string, unknown>;
    centrifugoService?: Record<string, unknown>;
    accountService?: Record<string, unknown>;
    workerCommandHandlerService?: Record<string, unknown>;
    redis?: Record<string, unknown>;
    workerLifecycleLockService?: Record<string, unknown>;
  } = {}
): WorkerMonitorService {
  const workerService = {
    listLivenessLifecycleRedriveCandidates: jest.fn(async () => []),
    listMissingRuntimeRecoveryCandidates: jest.fn(async () => []),
    ...(overrides.workerService ?? {}),
  };
  const workerLifecycleQueueService = {
    prepare: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    loadPrepared: jest.fn(async () => []),
    redrivePrepared: jest.fn(async () => []),
    ...(overrides.workerLifecycleQueueService ?? {}),
  };
  return new WorkerMonitorService(
    workerService as never,
    (overrides.serverService ?? {}) as never,
    (overrides.sshService ?? {}) as never,
    {} as never,
    workerLifecycleQueueService as never,
    (overrides.centrifugoService ?? {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    }) as never,
    (overrides.accountService ?? {}) as never,
    (overrides.workerCommandHandlerService ?? {}) as never,
    (overrides.redis ?? {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    }) as never,
    (overrides.workerLifecycleLockService ?? {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    }) as never
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
    runtime_container_id: 'container-1',
    runtime_generation: 1,
    session_storage: EWorkerSessionStorage.legacy_volume,
    runtime_session_volume_name: 'session-worker-1',
    lifecycle_operation_id: null,
    last_connection_check_at: oldDate,
    ...overrides,
  };
}

function makeTerminalHandoffProof(
  worker: IWorkerMonitor,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    handoff_id: 'handoff-terminal',
    lifecycle_operation_id: worker.lifecycle_operation_id,
    handoff_state: 'failed',
    error_code: 'wwebjs_canonical_import_task_failed',
    source_provider: 'wwebjs',
    target_provider: 'baileys',
    recovery_state: 'pending',
    recovery_operation_id: 'operation-source-recovery',
    resolution_state: null,
    resolution_operation_id: null,
    point_of_no_return_at: null,
    worker_type_id: worker.worker_type_id,
    worker_status_id: worker.worker_status_id,
    terminal_ownership_unique: true,
    ...overrides,
  };
}

function makeStrictConnectionHealth(
  worker: IWorkerMonitor,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const provider =
    worker.worker_type_id === EWorkerType.baileys
      ? 'baileys'
      : worker.worker_type_id === EWorkerType.whatsmeow
        ? 'whatsmeow'
        : 'wwebjs';
  const sessionStorage =
    worker.session_storage ?? EWorkerSessionStorage.legacy_volume;
  return {
    runtime_health_schema_version: 3,
    session_storage: sessionStorage,
    session_ready: true,
    connected: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    kafka_unhealthy: false,
    kafka_consumers_ready: true,
    kafka_consumers_authorized: true,
    central_online_acknowledged: true,
    native_connection_online: true,
    connection_status: {
      provider,
      status: 'online',
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      qrAvailable: false,
      sequence: 8,
      changedAt: '2026-08-04T12:00:00.000Z',
    },
    connection_status_source_id: '01900000-0000-4000-8000-000000000091',
    connection_status_source_current: true,
    connection_status_lease_required:
      sessionStorage === EWorkerSessionStorage.postgres,
    connection_status_lease_proof_valid: true,
    phone: '556192037138',
    ...overrides,
  };
}

function makeExplicitlyAvailableWwebjsHealth(
  worker: IWorkerMonitor,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    runtime_health_schema_version: 3,
    worker_id: worker.worker_id,
    account_id: worker.account_id,
    worker_type_id: worker.worker_type_id,
    runtime_state: 'active',
    activated: true,
    standby: false,
    runtime_generation: worker.runtime_generation,
    session_storage: worker.session_storage,
    has_session: false,
    qr_stream_ready: true,
    session_ready: false,
    connected: false,
    can_send: false,
    can_receive_runtime: false,
    authenticated: false,
    kafka_unhealthy: true,
    kafka_consumers_ready: false,
    kafka_consumers_authorized: false,
    central_online_acknowledged: false,
    native_connection_online: false,
    provider_state: 'missing_client',
    degraded_reason: 'No client instance',
    phone: '',
    error: '',
    ...overrides,
  };
}

function makeObservedStuckWwebjsRecreate(): IWorkerMonitor {
  const operationId = '019fe724-a608-74b9-a76a-4449f9a0f49f';
  const replacementContainerId =
    '13b429482aff9fa2899bd913d73cec3d591becc7d01c95616b8011380266ad83';

  return makeWorker({
    worker_id: '019fd88a-2894-739b-9471-cd3502f648df',
    account_id: '019a930d-c6f4-75ad-88ff-8d2fcd5839e1',
    server_id: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: EWorkerType.wwebjs,
    lifecycle_operation_id: operationId,
    container_id:
      '9c153e269215b6d5e5a3bc82f0eb6f4e8909ff54516d4ac93fe7d31c8625268b',
    runtime_container_id: replacementContainerId,
    runtime_generation: 32,
    session_storage: EWorkerSessionStorage.postgres,
    runtime_session_volume_name: null,
    recreate_bootstrap_operation_id: operationId,
    recreate_bootstrap_runtime_generation: 32,
    recreate_bootstrap_container_id: replacementContainerId,
    recreate_bootstrap_started_at: '2026-08-09T12:56:51.960629-03:00',
    recreate_retired_operation_id: null,
    recreate_retired_runtime_generation: null,
    recreate_retired_container_id: null,
    recreate_retired_at: null,
    updated_at: '2026-08-09T12:29:26.545-03:00',
  });
}

function makeServer(): IBalanceMonitorServer {
  return {
    server_id: 'server-1',
    server_status_id: 'server-status-1',
    ssh_ip: '127.0.0.1',
    ssh_port: 22,
    ssh_username: 'root',
    ssh_password: 'secret',
    web_domain: null,
    web_port: null,
    web_protocol: null,
  };
}

function exactRuntimeOwnershipFixture(input: {
  worker: IWorkerMonitor;
  containerId: string;
  runtimeGeneration: number;
  sessionVolumeName: string;
  env?: Record<string, string>;
  mount?: {
    destination?: string;
    name?: string;
    readWrite?: boolean;
    type?: string;
  };
}): string {
  const identity = [
    input.containerId,
    `/${input.worker.worker_id}`,
    'true',
    JSON.stringify({
      'underchat.worker_id': input.worker.worker_id,
      'underchat.account_id': input.worker.account_id,
      'underchat.worker_type_id': input.worker.worker_type_id,
      'underchat.runtime_generation': String(input.runtimeGeneration),
      'underchat.session_volume_name': input.sessionVolumeName,
      // Intentionally no underchat.server_id: affected legacy containers only
      // carried that ownership in SERVER_ID or inherited the exact SSH host.
    }),
  ].join('|');
  const environment = Object.entries({
    WORKER_ID: input.worker.worker_id,
    ACCOUNT_ID: input.worker.account_id,
    SERVER_ID: input.worker.server_id,
    WORKER_TYPE_ID: input.worker.worker_type_id,
    RUNTIME_GENERATION: String(input.runtimeGeneration),
    SESSION_VOLUME_NAME: input.sessionVolumeName,
    ...(input.env ?? {}),
  })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const mounts = JSON.stringify([
    {
      Destination: input.mount?.destination ?? '/app/data',
      Name: input.mount?.name ?? input.sessionVolumeName,
      RW: input.mount?.readWrite ?? true,
      Type: input.mount?.type ?? 'volume',
    },
  ]);
  return [identity, environment, mounts]
    .map((value) => Buffer.from(value, 'utf8').toString('base64'))
    .join('|');
}

function makeLivenessLifecycleMessage(
  worker: IWorkerMonitor,
  overrides: Partial<IWorkerLifecycleQueueMessage> = {}
): IWorkerLifecycleQueueMessage {
  return {
    request_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
    operation_id: worker.lifecycle_operation_id ?? 'operation-liveness',
    action: 'recreate',
    worker_id: worker.worker_id,
    account_id: worker.account_id,
    server_id: worker.server_id,
    worker_type_id: worker.worker_type_id,
    worker_status_id: EWorkerStatus.recreating,
    source: 'worker_recreate',
    previous_worker_status_id: EWorkerStatus.online,
    expected_container_id: worker.container_id ?? 'a'.repeat(64),
    expected_container_started_at: '2026-07-29T22:00:00Z',
    expected_container_restart_count: 0,
    expected_container_health_status: 'unhealthy',
    expected_container_paused: false,
    expected_runtime_generation: 7,
    requested_at: new Date(
      Date.now() - WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS - 1
    ).toISOString(),
    ...overrides,
  };
}

// This contract intentionally keeps the monitor's interdependent recovery
// branches in one suite so shared fence fixtures cannot drift.
// eslint-disable-next-line max-statements
describe('WorkerMonitorService', () => {
  const imageDrift = {
    account_id: '019fa877-2825-741a-a3b2-2b48fdd47ac0',
    alias: EWorkerImage.baileys,
    container_id: 'a'.repeat(64),
    current_content_id: `sha256:${'b'.repeat(64)}`,
    expected_content_id: `sha256:${'c'.repeat(64)}`,
    runtime_generation: 7,
    server_id: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
    worker_id: '019fa877-9f95-7518-9753-3f4e32569dee',
  } as const;

  const imageDriftInspection = {
    exists: true,
    container_id: imageDrift.container_id,
    container_name: imageDrift.worker_id,
    container_image: imageDrift.alias,
    container_image_id: imageDrift.current_content_id,
    container_labels: {
      'underchat.account_id': imageDrift.account_id,
      'underchat.runtime_generation': String(imageDrift.runtime_generation),
      'underchat.server_id': imageDrift.server_id,
      'underchat.warm_standby': 'false',
      'underchat.worker_id': imageDrift.worker_id,
    },
  } as const;
  const wwebjsSafetyDrift = {
    account_id: imageDrift.account_id,
    alias: EWorkerImage.wwebjs,
    container_id: 'd'.repeat(64),
    current_content_id: `sha256:${'e'.repeat(64)}`,
    expected_content_id: `sha256:${'f'.repeat(64)}`,
    runtime_generation: 9,
    safety_reasons: ['image_mismatch', 'tini_missing', 'pids_limit_missing'],
    server_id: imageDrift.server_id,
    worker_id: imageDrift.worker_id,
  } as const;
  const wwebjsSessionVolumeName = 'session-wwebjs-safety';
  const wwebjsSafetyInspection = {
    exists: true,
    running: true,
    container_id: wwebjsSafetyDrift.container_id,
    container_name: wwebjsSafetyDrift.worker_id,
    container_image: EWorkerImage.wwebjs,
    container_image_id: wwebjsSafetyDrift.current_content_id,
    container_entrypoint: ['docker-entrypoint.sh'],
    container_pids_limit: null,
    container_labels: {
      'underchat.account_id': wwebjsSafetyDrift.account_id,
      'underchat.runtime_generation': String(
        wwebjsSafetyDrift.runtime_generation
      ),
      'underchat.session_volume_name': wwebjsSessionVolumeName,
      'underchat.warm_standby': 'false',
      'underchat.worker_id': wwebjsSafetyDrift.worker_id,
      'underchat.worker_image': EWorkerImage.wwebjs,
      'underchat.worker_type_id': EWorkerType.wwebjs,
      // Legacy runtimes may legitimately lack server/lifecycle labels.
    },
    container_env: {
      ACCOUNT_ID: wwebjsSafetyDrift.account_id,
      RUNTIME_GENERATION: String(wwebjsSafetyDrift.runtime_generation),
      SESSION_VOLUME_NAME: wwebjsSessionVolumeName,
      WARM_STANDBY: 'false',
      WORKER_ID: wwebjsSafetyDrift.worker_id,
      WORKER_IMAGE: EWorkerImage.wwebjs,
      WORKER_TYPE_ID: EWorkerType.wwebjs,
    },
    container_mounts: [
      {
        destination: '/app/data',
        name: wwebjsSessionVolumeName,
        read_write: true,
        type: 'volume',
      },
    ],
  } as const;

  it('keeps the legacy image-drift entry point fail-closed', async () => {
    const worker = makeWorker({
      account_id: imageDrift.account_id,
      container_id: imageDrift.container_id,
      runtime_generation: imageDrift.runtime_generation,
      server_id: imageDrift.server_id,
      worker_id: imageDrift.worker_id,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(
          async () => imageDriftInspection
        ),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
    });

    await expect(service.enqueueImageDriftRecreate(imageDrift)).resolves.toBe(
      false
    );

    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('reports a stale image candidate when database state changes after preflight', async () => {
    const worker = makeWorker({
      account_id: imageDrift.account_id,
      container_id: imageDrift.container_id,
      runtime_generation: imageDrift.runtime_generation,
      server_id: imageDrift.server_id,
      worker_id: imageDrift.worker_id,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const viewWorkerForMonitorConsistent = jest
      .fn()
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce({
        ...worker,
        worker_status_id: EWorkerStatus.offline,
      });
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(
          async () => imageDriftInspection
        ),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
        viewWorkerForMonitorConsistent,
      },
      workerLifecycleQueueService,
    });

    await expect(service.enqueueImageDriftRecreate(imageDrift)).resolves.toBe(
      false
    );

    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('never auto-rolls a disconnected image-drift worker', async () => {
    const worker = makeWorker({
      account_id: imageDrift.account_id,
      container_id: imageDrift.container_id,
      runtime_generation: imageDrift.runtime_generation,
      server_id: imageDrift.server_id,
      worker_id: imageDrift.worker_id,
      worker_status_id: EWorkerStatus.offline,
      worker_type_id: EWorkerType.baileys,
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(
          async () => imageDriftInspection
        ),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
    });

    await expect(service.enqueueImageDriftRecreate(imageDrift)).resolves.toBe(
      false
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('ignores a candidate whose container already runs the expected image', async () => {
    const viewWorkerForMonitorConsistent = jest.fn();
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(async () => ({
          ...imageDriftInspection,
          container_image_id: imageDrift.expected_content_id,
        })),
        viewWorkerForMonitorConsistent,
      },
    });

    await expect(service.enqueueImageDriftRecreate(imageDrift)).resolves.toBe(
      false
    );
    expect(viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
  });

  it.each([
    EWorkerStatus.online,
    EWorkerStatus.disponible,
    EWorkerStatus.mismatched,
  ])(
    'keeps the legacy WWebJS safety entry point fail-closed for status %s',
    async (workerStatusId) => {
      const worker = makeWorker({
        account_id: wwebjsSafetyDrift.account_id,
        container_id: wwebjsSafetyDrift.container_id,
        runtime_container_id: wwebjsSafetyDrift.container_id,
        runtime_generation: wwebjsSafetyDrift.runtime_generation,
        runtime_session_volume_name: wwebjsSessionVolumeName,
        server_id: wwebjsSafetyDrift.server_id,
        worker_id: wwebjsSafetyDrift.worker_id,
        worker_status_id: workerStatusId,
        worker_type_id: EWorkerType.wwebjs,
      });
      const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
      const workerLifecycleQueueService = {
        prepare: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService: {
          inspectContainerWorkerByIdStrict: jest.fn(
            async () => wwebjsSafetyInspection
          ),
          updateWorkerByIdIfLifecycleMatches,
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        },
        workerLifecycleQueueService,
      });

      await expect(
        service.enqueueWwebjsRuntimeSafetyRecreate(wwebjsSafetyDrift)
      ).resolves.toBe(false);

      expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
      expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
      expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    }
  );

  it('fails closed before the database read when WWebJS Docker identity mismatches', async () => {
    const viewWorkerForMonitorConsistent = jest.fn();
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(async () => ({
          ...wwebjsSafetyInspection,
          container_env: {
            ...wwebjsSafetyInspection.container_env,
            ACCOUNT_ID: 'different-account',
          },
        })),
        viewWorkerForMonitorConsistent,
      },
      workerLifecycleQueueService,
    });

    await expect(
      service.enqueueWwebjsRuntimeSafetyRecreate(wwebjsSafetyDrift)
    ).resolves.toBe(false);
    expect(viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'worker runtime points at another container',
      worker: {
        runtime_container_id: '0'.repeat(64),
      },
    },
    {
      name: 'another lifecycle is active',
      worker: {
        lifecycle_operation_id: '019fb01a-7284-7378-b20e-dc9d420ee15d',
        worker_status_id: EWorkerStatus.recreating,
      },
    },
  ])('fails closed when $name', async ({ worker: workerOverrides }) => {
    const worker = makeWorker({
      account_id: wwebjsSafetyDrift.account_id,
      container_id: wwebjsSafetyDrift.container_id,
      runtime_container_id: wwebjsSafetyDrift.container_id,
      runtime_generation: wwebjsSafetyDrift.runtime_generation,
      runtime_session_volume_name: wwebjsSessionVolumeName,
      server_id: wwebjsSafetyDrift.server_id,
      worker_id: wwebjsSafetyDrift.worker_id,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      ...workerOverrides,
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(
          async () => wwebjsSafetyInspection
        ),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
    });

    await expect(
      service.enqueueWwebjsRuntimeSafetyRecreate(wwebjsSafetyDrift)
    ).resolves.toBe(false);
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('never claims a WWebJS safety lifecycle through the legacy entry point', async () => {
    const worker = makeWorker({
      account_id: wwebjsSafetyDrift.account_id,
      container_id: wwebjsSafetyDrift.container_id,
      runtime_container_id: wwebjsSafetyDrift.container_id,
      runtime_generation: wwebjsSafetyDrift.runtime_generation,
      runtime_session_volume_name: wwebjsSessionVolumeName,
      server_id: wwebjsSafetyDrift.server_id,
      worker_id: wwebjsSafetyDrift.worker_id,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
    });
    const claimedWorker = {
      ...worker,
      lifecycle_operation_id: '019fb01a-7284-7378-b20e-dc9d420ee15d',
      worker_status_id: EWorkerStatus.recreating,
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const viewWorkerForMonitorConsistent = jest
      .fn()
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(claimedWorker);
    const service = makeService({
      workerService: {
        inspectContainerWorkerByIdStrict: jest.fn(
          async () => wwebjsSafetyInspection
        ),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
        viewWorkerForMonitorConsistent,
      },
      workerLifecycleQueueService,
    });

    await expect(
      service.enqueueWwebjsRuntimeSafetyRecreate(wwebjsSafetyDrift)
    ).resolves.toBe(false);
    await expect(
      service.enqueueWwebjsRuntimeSafetyRecreate(wwebjsSafetyDrift)
    ).resolves.toBe(false);

    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

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

  it('does not use Fastify failure to auto-recreate an offline worker', () => {
    const service = makeService();

    expect(
      (service as any).shouldCheckFastify(
        makeWorker({ worker_status_id: EWorkerStatus.offline })
      )
    ).toBe(false);
    expect(
      (service as any).shouldCheckFastify(
        makeWorker({ worker_status_id: EWorkerStatus.online })
      )
    ).toBe(true);
    expect(
      (service as any).shouldCheckFastify(
        makeWorker({ worker_status_id: EWorkerStatus.disponible })
      )
    ).toBe(false);
  });

  it('does not stop or remove a worker when a lifecycle starts after the inactivity snapshot', async () => {
    const snapshot = makeWorker({
      worker_status_id: EWorkerStatus.offline,
    });
    const current = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-new',
      updated_at: new Date().toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => current),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      centrifugoService,
    });
    (service as any).confirmRuntimeInactive = jest.fn(async () => true);

    await (service as any).handleStop(snapshot, makeServer(), {} as never);

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      snapshot.worker_id
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not remove or publish stopped when another pod wins the inactivity CAS', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.offline,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => false),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      centrifugoService,
    });
    (service as any).confirmRuntimeInactive = jest.fn(async () => true);

    await (service as any).handleStop(worker, makeServer(), {} as never);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.stopped,
      },
      {
        lifecycle_operation_id: null,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.offline,
        updated_at: worker.updated_at,
        last_connection_check_at: worker.last_connection_check_at,
      }
    );
    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not stop an inactive-looking worker when the runtime is healthy', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.offline,
    });
    const workerService = {
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      sshService: { runCommands: jest.fn(async () => []) },
    });
    const syncConnectionStatusWithFailureTracking = jest.fn();
    (service as any).checkConnection = jest.fn(async () => ({
      healthy: true,
      code: 200,
      body: {},
      session_ready: true,
      connected: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'connected',
      kafka_unhealthy: false,
    }));
    (service as any).syncConnectionStatusWithFailureTracking =
      syncConnectionStatusWithFailureTracking;

    await (service as any).handleStop(worker, makeServer(), {} as never);

    expect(syncConnectionStatusWithFailureTracking).toHaveBeenCalledTimes(1);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('fails open when the inactivity runtime probe is inconclusive', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.offline,
    });
    const workerService = {
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      sshService: { runCommands: jest.fn(async () => []) },
    });
    (service as any).checkConnection = jest.fn(async () => ({
      healthy: false,
      code: null,
      body: null,
      degraded_reason: 'connection refused',
      kafka_unhealthy: false,
    }));

    await (service as any).handleStop(worker, makeServer(), {} as never);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('accepts an inactivity stop only with explicit session absence evidence', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.disponible,
    });
    const service = makeService({
      sshService: { runCommands: jest.fn(async () => []) },
    });
    (service as any).checkConnection = jest.fn(async () => ({
      healthy: false,
      code: 200,
      body: {},
      session_ready: false,
      connected: false,
      authenticated: false,
      provider_state: 'qr_pending',
      degraded_reason: 'no_session',
      kafka_unhealthy: false,
    }));

    await expect(
      (service as any).confirmRuntimeInactive(worker, makeServer(), {} as never)
    ).resolves.toBe(true);
  });

  it('removes a plan-blocked container idempotently on the next monitor pass', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.blocked,
    });
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const service = makeService({
      workerService,
      sshService,
      accountService,
    });

    await (service as any).processContainer(
      worker.worker_id,
      makeServer(),
      {} as never,
      new Map([[worker.worker_id, worker]])
    );

    expect(sshService.runCommands).toHaveBeenCalledWith(
      worker.server_id,
      expect.anything(),
      [`docker rm -f ${worker.worker_id}`],
      false,
      expect.objectContaining({ failOnNonZero: true })
    );
    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      worker.worker_id
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not recreate a plan-blocked worker whose container is already absent', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.blocked,
    });
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(),
    };
    const service = makeService({
      accountService,
      workerLifecycleQueueService,
    });

    await (service as any).handleMissingContainer(
      worker,
      makeServer(),
      {} as never
    );

    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('preserves a deleting fence for immutable-command redrive', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: 'delete-operation',
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => false),
      deleteWorkerById: jest.fn(async () => true),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      centrifugoService,
    });

    await (service as any).handleDeleting(
      worker,
      makeServer(),
      {} as never,
      true
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('never finalizes deleting from timeout observation alone', async () => {
    const deletingWorker = makeWorker({
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: 'delete-operation',
    });
    const deleteWorker = makeWorker({
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(deletingWorker)
        .mockResolvedValueOnce(deleteWorker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      deleteWorkerById: jest.fn(async () => true),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      centrifugoService,
    });

    await (service as any).handleDeleting(
      deletingWorker,
      makeServer(),
      {} as never,
      true
    );

    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not reach Docker while a deleting command is pending', async () => {
    const deletingWorker = makeWorker({
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: 'delete-operation',
    });
    const deleteWorker = makeWorker({
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(deletingWorker)
        .mockResolvedValueOnce(deleteWorker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      deleteWorkerById: jest.fn(async () => true),
    };
    const removalError = new Error('ssh unavailable');
    const sshService = {
      runCommands: jest.fn(async () => {
        throw removalError;
      }),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      centrifugoService,
    });

    await expect(
      (service as any).handleDeleting(
        deletingWorker,
        makeServer(),
        {} as never,
        true
      )
    ).resolves.toBeUndefined();

    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not finalize a legacy delete status from the monitor', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
      deleteWorkerById: jest.fn(async () => true),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      accountService,
      centrifugoService,
    });

    await (service as any).processContainer(
      worker.worker_id,
      makeServer(),
      {} as never,
      new Map([[worker.worker_id, worker]])
    );

    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
  });

  it('does not finalize a missing legacy delete worker', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      deleteWorkerById: jest.fn(async () => true),
    };
    const sshService = {
      runCommands: jest.fn(async () => []),
    };
    const accountService = {
      viewPlanStatus: jest.fn(async () => ({
        account_status_id: EAccountStatus.active,
        next_payment_date: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        cancellation_date: null,
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      accountService,
      centrifugoService,
    });

    await (service as any).handleMissingContainer(
      worker,
      makeServer(),
      {} as never
    );

    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('ignores warm standby containers when listing remote containers', async () => {
    const activeWorkerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const sshService = {
      runCommands: jest.fn(async () => [
        {
          output: [
            'under-balance-api||',
            'not-a-worker||',
            activeWorkerId.slice(0, 19),
          ].join('\n'),
        },
        {
          output: [
            `${activeWorkerId.slice(19)}|true|pool-assigned`,
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

    expect(containers).toEqual([activeWorkerId]);
  });

  it('isolates a worker-specific failure and continues the remaining server checks', async () => {
    const first = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
    });
    const second = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b38',
    });
    const service = makeService();
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    (service as any).listContainers = jest.fn(async () => [
      first.worker_id,
      second.worker_id,
    ]);
    (service as any).processContainer = jest
      .fn()
      .mockRejectedValueOnce(new Error('one worker failed'))
      .mockResolvedValueOnce(undefined);
    const logSpy = jest
      .spyOn(localConnectionStatusLog, 'logLocalConnectionStatus')
      .mockImplementation(() => undefined);

    await expect(
      (service as any).checkServer(
        makeServer(),
        new Map([
          [first.worker_id, first],
          [second.worker_id, second],
        ]),
        new Map([['server-1', [first, second]]])
      )
    ).resolves.toBeUndefined();

    expect((service as any).processContainer).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      'service.monitor.worker_check_failed',
      expect.objectContaining({
        worker_id: first.worker_id,
        server_id: 'server-1',
      })
    );
    logSpy.mockRestore();
  });

  it('isolates an SSH failure to one server and checks the next server', async () => {
    const firstServer = makeServer();
    const secondServer = { ...makeServer(), server_id: 'server-2' };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [firstServer, secondServer]),
      },
      workerService: {
        listWorkersForMonitor: jest.fn(async () => []),
      },
    });
    (service as any).checkServer = jest
      .fn()
      .mockRejectedValueOnce(new Error('ssh unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(service.run()).resolves.toBeUndefined();

    expect((service as any).checkServer).toHaveBeenCalledTimes(2);
    expect((service as any).checkServer).toHaveBeenCalledWith(
      secondServer,
      expect.any(Map),
      expect.any(Map),
      expect.anything()
    );
  });

  it('does not swallow a revoked monitor lease in the server isolation catch', async () => {
    const leaseError = new Error('monitor lease revoked');
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        listWorkersForMonitor: jest.fn(async () => []),
      },
    });
    let revoked = false;
    (service as any).checkServer = jest.fn(async () => {
      revoked = true;
      throw new Error('ssh unavailable');
    });
    const context = {
      signal: new AbortController().signal,
      assertActive: () => {
        if (revoked) {
          throw leaseError;
        }
      },
    };

    await expect(service.run(context)).rejects.toBe(leaseError);
  });

  it('checks connection for disponible workers', () => {
    const service = makeService();

    const shouldCheck = (service as any).shouldCheckConnection(
      makeWorker({ worker_status_id: EWorkerStatus.disponible })
    );

    expect(shouldCheck).toBe(true);
  });

  it('removes a container found on a server superseded by the primary assignment', async () => {
    const snapshot = makeWorker({
      server_id: 'server-2',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-migration',
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => snapshot),
    };
    const sshService = {
      runCommands: jest.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      sshService,
      accountService,
      workerLifecycleQueueService,
    });

    await (service as any).processContainer(
      snapshot.worker_id,
      makeServer(),
      {} as never,
      new Map([[snapshot.worker_id, snapshot]])
    );

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      snapshot.worker_id
    );
    expect(sshService.runCommands).toHaveBeenCalledWith(
      'server-1',
      expect.anything(),
      [`docker rm -f ${snapshot.worker_id}`],
      false,
      expect.objectContaining({ failOnNonZero: true })
    );
    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('keeps a container when the primary assignment still points to the observed server', async () => {
    const snapshot = makeWorker({
      server_id: 'server-2',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-migration',
      updated_at: new Date().toISOString(),
    });
    const current = {
      ...snapshot,
      server_id: 'server-1',
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => current),
    };
    const sshService = {
      runCommands: jest.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const service = makeService({
      workerService,
      sshService,
      accountService,
    });

    await (service as any).processContainer(
      snapshot.worker_id,
      makeServer(),
      {} as never,
      new Map([[snapshot.worker_id, snapshot]])
    );

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      snapshot.worker_id
    );
    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(accountService.viewPlanStatus).not.toHaveBeenCalled();
  });

  it('recovers an orphan recreating worker through the fenced lifecycle queue without refreshing updated_at', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: null,
      updated_at: new Date().toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      updateWorkerUpdatedAt: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const accountService = {
      viewPlanStatus: jest.fn(async () => ({
        account_status_id: EAccountStatus.active,
        next_payment_date: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        cancellation_date: null,
      })),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      centrifugoService,
      accountService,
    });

    await (service as any).processContainer(
      worker.worker_id,
      makeServer(),
      {} as never,
      new Map([[worker.worker_id, worker]])
    );

    expect(workerService.updateWorkerUpdatedAt).not.toHaveBeenCalled();
    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      worker.worker_id
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      expect.objectContaining({
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: expect.any(String),
      }),
      {
        lifecycle_operation_id: null,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.recreating,
      }
    );

    const operationId = (
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0][1] as { lifecycle_operation_id: string }
    ).lifecycle_operation_id;
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: operationId,
        action: 'recreate',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.recreating,
        previous_worker_status_id: EWorkerStatus.recreating,
      })
    );
  });

  it('does not clobber a lifecycle operation found by the primary recheck', async () => {
    const snapshot = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: null,
    });
    const current = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-already-pending',
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => current),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await (service as any).handleRecreate(
      snapshot,
      makeServer(),
      'orphan_lifecycle'
    );

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledWith(
      snapshot.worker_id
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('redrives a stale lifecycle with its exact durable payload', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-stuck',
      updated_at: staleDate,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => [
        {
          operation_id: 'operation-stuck',
          worker_id: worker.worker_id,
          action: 'activate_warm',
          warm_pool_id: 'warm-1',
        },
      ]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      {
        assertActive: jest.fn(),
      }
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-stuck'
    );
  });

  it('terminalizes an expired provisioning lifecycle before it can redrive forever', async () => {
    const lifecycleOperationId = '01900000-0000-7000-8000-000000000000';
    const recentRuntimeAttempt = new Date().toISOString();
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      updated_at: recentRuntimeAttempt,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(),
    };
    const claimToken = `${lifecycleOperationId}:019fe267-40c7-767d-a866-7c83bcfd0350`;
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(
        worker,
        makeServer(),
        { assertActive: jest.fn() },
        true
      )
    ).resolves.toBe(true);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: lifecycleOperationId,
        container_id: worker.container_id,
        runtime_container_id: worker.runtime_container_id,
        runtime_generation: worker.runtime_generation,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.recreating,
        updated_at: recentRuntimeAttempt,
      })
    );
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      lifecycleOperationId,
      claimToken
    );
  });

  it('fails a stale PostgreSQL handoff target and never republishes its original lifecycle', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-stale-handoff',
      session_storage: EWorkerSessionStorage.postgres,
      runtime_session_volume_name: null,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const failStaleWhatsappProviderHandoffTarget = jest.fn(async () => ({
      outcome: 'failed' as const,
      handoff_id: 'handoff-stale-target',
      recovery_operation_id: 'operation-source-recovery',
      recovery_state: 'pending',
      error_code: 'whatsapp_handoff_target_lease_expired_before_promotion',
    }));
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn(
          async () => null
        ),
        failStaleWhatsappProviderHandoffTarget,
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(failStaleWhatsappProviderHandoffTarget).toHaveBeenCalledWith({
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      lifecycle_operation_id: 'operation-stale-handoff',
    });
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'dispatching',
    'running',
    'blocked',
    'cancelled',
    'completed',
  ] as const)(
    'suppresses an original terminal handoff lifecycle while recovery is %s',
    async (recoveryState) => {
      const worker = makeWorker({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-terminal-handoff',
        session_storage: EWorkerSessionStorage.postgres,
        runtime_session_volume_name: null,
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      });
      const viewTerminalProof = jest.fn(async () =>
        makeTerminalHandoffProof(worker, { recovery_state: recoveryState })
      );
      const failStaleWhatsappProviderHandoffTarget = jest.fn();
      const workerLifecycleQueueService = {
        redrivePrepared: jest.fn(async () => []),
      };
      const workerLifecycleLockService = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService: {
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
          viewWhatsappProviderHandoffTerminalLifecycleProof: viewTerminalProof,
          failStaleWhatsappProviderHandoffTarget,
        },
        workerLifecycleQueueService,
        workerLifecycleLockService,
      });

      await expect(
        (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
          assertActive: jest.fn(),
        })
      ).resolves.toBe(true);

      expect(viewTerminalProof).toHaveBeenCalledWith({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        lifecycle_operation_id: 'operation-terminal-handoff',
      });
      expect(failStaleWhatsappProviderHandoffTarget).not.toHaveBeenCalled();
      expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
      expect(
        workerLifecycleQueueService.redrivePrepared
      ).not.toHaveBeenCalled();
    }
  );

  it.each(['running', 'completed'] as const)(
    'suppresses the original terminal handoff while resolution is %s',
    async (resolutionState) => {
      const worker = makeWorker({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-resolved-handoff',
        session_storage: EWorkerSessionStorage.postgres,
        runtime_session_volume_name: null,
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      });
      const workerLifecycleQueueService = {
        redrivePrepared: jest.fn(async () => []),
      };
      const workerLifecycleLockService = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService: {
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
          viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn(async () =>
            makeTerminalHandoffProof(worker, {
              recovery_state: 'completed',
              resolution_state: resolutionState,
              resolution_operation_id: 'operation-resolution',
            })
          ),
          failStaleWhatsappProviderHandoffTarget: jest.fn(),
        },
        workerLifecycleQueueService,
        workerLifecycleLockService,
      });

      await expect(
        (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
          assertActive: jest.fn(),
        })
      ).resolves.toBe(true);

      expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
      expect(
        workerLifecycleQueueService.redrivePrepared
      ).not.toHaveBeenCalled();
    }
  );

  it('rechecks terminal ownership after claiming and never publishes a raced failure', async () => {
    const claimToken =
      'operation-terminal-race:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-terminal-race',
      session_storage: EWorkerSessionStorage.postgres,
      runtime_session_volume_name: null,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const viewTerminalProof = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeTerminalHandoffProof(worker));
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        viewWhatsappProviderHandoffTerminalLifecycleProof: viewTerminalProof,
        failStaleWhatsappProviderHandoffTarget: jest.fn(async () => ({
          outcome: 'not_applicable',
        })),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(viewTerminalProof).toHaveBeenCalledTimes(2);
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-terminal-race',
      claimToken
    );
  });

  it('reconstructs a safe cold recreate when the durable lifecycle journal is missing', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-journal-missing',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-journal-missing',
        action: 'recreate',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
        previous_worker_status_id: EWorkerStatus.recreating,
        recovery_without_journal: true,
      })
    );
    const [reconstructed] = (workerLifecycleQueueService.publish.mock
      .calls[0] ?? []) as unknown as [IWorkerLifecycleQueueMessage];
    expect(reconstructed?.remove_session).toBeUndefined();
    expect(reconstructed?.remove_volume).toBeUndefined();
    expect(reconstructed?.warm_pool_id).toBeUndefined();
    expect(reconstructed?.recreate_server_slot_key).toBeUndefined();
    expect(reconstructed?.recreate_server_slot_token).toBeUndefined();
    expect(reconstructed?.recovery_without_journal).toBe(true);
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      reconstructed
    );
    expect(
      workerLifecycleQueueService.prepare.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    );
  });

  it('releases only its owned claim when the original lifecycle lock appears after claim', async () => {
    const claimToken = 'operation-race:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-race',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleLockService = {
      isLocked: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-race',
      undefined,
      claimToken
    );
    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-race',
      claimToken
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('releases its owned claim when the lifecycle snapshot changes before any recovery publish', async () => {
    const claimToken =
      'operation-state-race:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-state-race',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const changed = makeWorker({
      ...worker,
      lifecycle_operation_id: 'operation-new-owner',
      runtime_generation: (worker.runtime_generation ?? 0) + 1,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(worker)
        .mockResolvedValueOnce(changed),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-state-race',
      claimToken
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('redrives a stale creating lifecycle with its exact durable payload', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.creating,
      lifecycle_operation_id: 'operation-create-stuck',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => [
        {
          operation_id: 'operation-create-stuck',
          worker_id: worker.worker_id,
          action: 'activate_warm',
          warm_pool_id: 'warm-create-1',
        },
      ]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleLockService.tryClaimRedrive).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-create-stuck',
      expect.any(Number)
    );
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-create-stuck'
    );
  });

  it('does not redrive a recent creating lifecycle', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.creating,
      lifecycle_operation_id: 'operation-create-recent',
      updated_at: new Date().toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(),
      tryClaimRedrive: jest.fn(),
      releaseRedriveClaim: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(false);
    expect(workerService.viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.isLocked).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('does not redrive a stale creating lifecycle while its lock is active', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.creating,
      lifecycle_operation_id: 'operation-create-active',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => true),
      tryClaimRedrive: jest.fn(),
      releaseRedriveClaim: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
      worker.worker_id
    );
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('does not supersede an active lifecycle before the gRPC safety deadline', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-active',
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => true),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('clears a stale terminal lifecycle fence by exact CAS without changing status', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-completed',
      updated_at: staleDate,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
      worker.worker_id
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: null,
      },
      {
        container_id: worker.container_id,
        lifecycle_operation_id: 'operation-completed',
        runtime_container_id: worker.runtime_container_id,
        runtime_generation: worker.runtime_generation,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.online,
      }
    );
  });

  it('records the exact recreate completion before clearing an already-online same-pointer lifecycle', async () => {
    const containerId = '9'.repeat(64);
    const operationId = 'operation-current-g18';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 18,
      recreate_bootstrap_operation_id: operationId,
      recreate_bootstrap_runtime_generation: 18,
      recreate_bootstrap_container_id: containerId,
      recreate_bootstrap_started_at: '2026-08-08T14:24:38.408-03:00',
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
      recreate_completed_operation_id: 'operation-previous-g17',
      recreate_completed_runtime_generation: 17,
      recreate_completed_at: '2026-08-08T14:06:50.916-03:00',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const service = makeService({ workerService });

    await expect(
      (service as any).repairStaleTerminalLifecycleFence(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.online,
        container_id: containerId,
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 18,
        recreate_completion: {
          operation_id: operationId,
          runtime_generation: 18,
          mode: 'replacement_runtime_already_online',
        },
      })
    );
  });

  it('preserves a recreate lifecycle when its bootstrap was retired or mismatched', async () => {
    const containerId = '8'.repeat(64);
    const operationId = 'operation-current-g18';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 18,
      recreate_bootstrap_operation_id: operationId,
      recreate_bootstrap_runtime_generation: 18,
      recreate_bootstrap_container_id: containerId,
      recreate_bootstrap_started_at: '2026-08-08T14:24:38.408-03:00',
      recreate_retired_operation_id: operationId,
      recreate_retired_runtime_generation: 18,
      recreate_retired_container_id: containerId,
      recreate_retired_at: '2026-08-08T14:44:30.000-03:00',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const service = makeService({ workerService });

    await expect(
      (service as any).repairStaleTerminalLifecycleFence(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).resolves.toBe(true);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('reconciles an exact online replacement instead of clearing a missing-journal fence blindly', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oldContainerId = 'a'.repeat(64);
    const replacementContainerId = 'b'.repeat(64);
    const operationId = 'operation-liveness';
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 8,
      recreate_bootstrap_operation_id: operationId,
      recreate_bootstrap_runtime_generation: 8,
      recreate_bootstrap_container_id: replacementContainerId,
      recreate_bootstrap_started_at: '2026-08-08T14:24:38.408-03:00',
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
      updated_at: staleDate,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '8',
      'underchat.lifecycle_operation_id': operationId,
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-29T22:01:00Z|0|false|${labels}`;
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const redis = {
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService,
      workerLifecycleQueueService,
      redis,
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => [
            {
              output: commands[0]?.includes('/v1/connection/health/check')
                ? `${JSON.stringify(
                    makeStrictConnectionHealth(worker, {
                      runtime_generation: 8,
                    })
                  )}__HTTP_STATUS__200`
                : replacement,
            },
          ]
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    const handled = await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      context
    );

    expect(handled).toBe(true);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.online,
        container_id: replacementContainerId,
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        worker_status_id: EWorkerStatus.online,
        recreate_completion: {
          operation_id: operationId,
          runtime_generation: 8,
          mode: 'replacement_runtime',
        },
      })
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      1,
      `underchat:worker:liveness-recreate:${worker.worker_id}:${oldContainerId}`,
      operationId
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('promotes a strict-ready legacy replacement only after the old pointer is confirmed absent', async () => {
    const oldContainerId = '7'.repeat(64);
    const replacementContainerId = '8'.repeat(64);
    const operationId = 'operation-config-recreate';
    const worker = makeWorker({
      worker_id: '019ea8d6-6b54-754e-b5a4-6d4e4458bbdb',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 74,
      updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '74',
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-30T23:22:00Z|0|false|${labels}`;
    const ownership = exactRuntimeOwnershipFixture({
      worker,
      containerId: replacementContainerId,
      runtimeGeneration: 74,
      sessionVolumeName: worker.runtime_session_volume_name as string,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const lifecycleLock = {
      isLocked: jest.fn(async () => false),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService: lifecycleLock,
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => {
            if (commands[0]?.includes('/v1/connection/health/check')) {
              return [
                {
                  output: `${JSON.stringify({
                    ...makeStrictConnectionHealth(worker, {
                      phone: '554796627154',
                      runtime_generation: 74,
                    }),
                  })}__HTTP_STATUS__200`,
                },
              ];
            }
            if (commands[0]?.includes('base64 -w0')) {
              return [{ output: ownership }];
            }
            if (commands[0]?.includes(oldContainerId)) {
              throw Object.assign(new Error('docker inspect failed'), {
                output: `Error: No such object: ${oldContainerId}`,
              });
            }
            return [{ output: replacement }];
          }
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    const handled = await (
      service as any
    ).reconcileProvisioningLifecycleRuntimeDivergence(worker, makeServer(), {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(lifecycleLock.isLocked).toHaveBeenCalledWith(worker.worker_id);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.online,
        container_id: replacementContainerId,
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 74,
        worker_status_id: EWorkerStatus.recreating,
      })
    );
  });

  it('finalizes the observed empty-session WWebJS replacement as disponible without redrive', async () => {
    const worker = makeObservedStuckWwebjsRecreate();
    const server = { ...makeServer(), server_id: worker.server_id };
    const operationId = worker.lifecycle_operation_id as string;
    const oldContainerId = worker.container_id as string;
    const replacementContainerId = worker.runtime_container_id as string;
    const completedAt = '2026-08-09T14:18:00.000-03:00';
    const completedWorker = {
      ...worker,
      worker_status_id: EWorkerStatus.disponible,
      container_id: replacementContainerId,
      lifecycle_operation_id: null,
      recreate_completed_operation_id: operationId,
      recreate_completed_runtime_generation: 32,
      recreate_completed_at: completedAt,
    };
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '32',
      'underchat.lifecycle_operation_id': operationId,
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-08-09T15:56:51.846Z|0|false|${labels}`;
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const viewWorkerForMonitorConsistent = jest
      .fn()
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(completedWorker);
    const lifecycleQueue = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => []),
    };
    const lifecycleLock = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
      publish: jest.fn(async () => true),
    };
    const service = makeService({
      workerService: {
        updateWorkerByIdIfLifecycleMatches,
        viewWorkerForMonitorConsistent,
      },
      workerLifecycleQueueService: lifecycleQueue,
      workerLifecycleLockService: lifecycleLock,
      centrifugoService,
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => {
            if (commands[0]?.includes('/v1/connection/health/check')) {
              return [
                {
                  output: `${JSON.stringify({
                    status: false,
                    message: '',
                    data: makeExplicitlyAvailableWwebjsHealth(worker),
                  })}__HTTP_STATUS__503`,
                },
              ];
            }
            return [{ output: replacement }];
          }
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    const handled = await (
      service as any
    ).reconcileProvisioningLifecycleRuntimeDivergence(worker, server, {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.disponible,
        container_id: replacementContainerId,
        lifecycle_operation_id: null,
        number: null,
        connection_date: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 32,
        server_id: worker.server_id,
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        recreate_completion: {
          operation_id: operationId,
          runtime_generation: 32,
          mode: 'replacement_runtime',
        },
      })
    );
    const terminalEvent = expect.objectContaining({
      event_type: 'status',
      lifecycle_source: 'manager',
      lifecycle_action: 'recreate',
      lifecycle_phase: 'completed',
      lifecycle_operation_id: operationId,
      worker_id: worker.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      runtime_generation: 32,
      connection_online_acknowledged: false,
      recreate_completed_operation_id: operationId,
      recreate_completed_runtime_generation: 32,
      recreate_completed_at: new Date(completedAt).toISOString(),
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
    });
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.any(String),
      terminalEvent
    );
    // Lifecycle terminals are tenant-scoped. Never mirror this payload to the
    // legacy global channels:config publication, which is cross-account.
    expect(centrifugoService.publish).not.toHaveBeenCalled();
    expect(viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(2);
    expect(lifecycleQueue.redrivePrepared).not.toHaveBeenCalled();
    expect(lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(lifecycleLock.tryClaimRedrive).not.toHaveBeenCalled();
  });

  it.each([
    {
      condition: 'QR/control stream is not ready',
      healthOverrides: { qr_stream_ready: false },
    },
    {
      condition: 'a durable session still exists',
      healthOverrides: { has_session: true },
    },
  ])(
    'preserves the recreate fence when $condition',
    async ({ healthOverrides }) => {
      const worker = makeObservedStuckWwebjsRecreate();
      const server = { ...makeServer(), server_id: worker.server_id };
      const operationId = worker.lifecycle_operation_id as string;
      const replacementContainerId = worker.runtime_container_id as string;
      const labels = JSON.stringify({
        'underchat.worker_id': worker.worker_id,
        'underchat.account_id': worker.account_id,
        'underchat.server_id': worker.server_id,
        'underchat.worker_type_id': worker.worker_type_id,
        'underchat.runtime_generation': '32',
        'underchat.lifecycle_operation_id': operationId,
      });
      const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-08-09T15:56:51.846Z|0|false|${labels}`;
      const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
      const lifecycleQueue = {
        prepare: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
        redrivePrepared: jest.fn(async () => []),
      };
      const lifecycleLock = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
      };
      const centrifugoService = {
        publishSub: jest.fn(async () => true),
        publish: jest.fn(async () => true),
      };
      const service = makeService({
        workerService: {
          updateWorkerByIdIfLifecycleMatches,
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        },
        workerLifecycleQueueService: lifecycleQueue,
        workerLifecycleLockService: lifecycleLock,
        centrifugoService,
        sshService: {
          runCommands: jest.fn(
            async (_serverId: string, _config: unknown, commands: string[]) => {
              if (commands[0]?.includes('/v1/connection/health/check')) {
                return [
                  {
                    output: `${JSON.stringify({
                      status: false,
                      message: '',
                      data: makeExplicitlyAvailableWwebjsHealth(
                        worker,
                        healthOverrides
                      ),
                    })}__HTTP_STATUS__503`,
                  },
                ];
              }
              return [{ output: replacement }];
            }
          ),
        },
      });
      (service as any).passwordEncryptorService = {
        decrypt: jest.fn((value: string) => value),
      };

      const handled = await (
        service as any
      ).reconcileProvisioningLifecycleRuntimeDivergence(worker, server, {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      });

      expect(handled).toBe(false);
      expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
      expect(centrifugoService.publishSub).not.toHaveBeenCalled();
      expect(centrifugoService.publish).not.toHaveBeenCalled();
      expect(lifecycleQueue.redrivePrepared).not.toHaveBeenCalled();
      expect(lifecycleQueue.prepare).not.toHaveBeenCalled();
      expect(lifecycleQueue.publish).not.toHaveBeenCalled();
      expect(lifecycleLock.tryClaimRedrive).not.toHaveBeenCalled();
    }
  );

  it('aligns only the control pointer and redrives the same journal when provisioning blocks strict readiness', async () => {
    const oldContainerId = 'd'.repeat(64);
    const replacementContainerId = 'e'.repeat(64);
    const operationId = 'operation-config-recreate-circular-readiness';
    const worker = makeWorker({
      worker_id: '019ef562-9a75-74ef-bba0-b6a76c12c48e',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 53,
      updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '53',
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-30T21:30:00Z|0|false|${labels}`;
    const ownership = exactRuntimeOwnershipFixture({
      worker,
      containerId: replacementContainerId,
      runtimeGeneration: 53,
      sessionVolumeName: worker.runtime_session_volume_name as string,
    });
    const alignedWorker = {
      ...worker,
      container_id: replacementContainerId,
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(worker)
        .mockResolvedValue(alignedWorker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const redrivePrepared = jest.fn(async () => []);
    const prepare = jest.fn(
      async (_payload: IWorkerLifecycleQueueMessage) => undefined
    );
    const publish = jest.fn(
      async (_payload: IWorkerLifecycleQueueMessage) => undefined
    );
    const lifecycleLock = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService: { redrivePrepared, prepare, publish },
      workerLifecycleLockService: lifecycleLock,
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => {
            if (commands[0]?.includes('/v1/connection/health/check')) {
              return [
                {
                  output: `${JSON.stringify({
                    session_ready: false,
                    connected: true,
                    can_send: false,
                    can_receive_runtime: true,
                    authenticated: true,
                    kafka_unhealthy: false,
                    kafka_consumers_ready: false,
                    phone: '559392358298',
                    central_online_acknowledged: false,
                    runtime_generation: 53,
                  })}__HTTP_STATUS__200`,
                },
              ];
            }
            if (commands[0]?.includes('base64 -w0')) {
              return [{ output: ownership }];
            }
            if (commands[0]?.includes(oldContainerId)) {
              throw Object.assign(new Error('docker inspect failed'), {
                output: `Error: No such object: ${oldContainerId}`,
              });
            }
            return [{ output: replacement }];
          }
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    const handled = await (
      service as any
    ).reconcileProvisioningLifecycleRuntimeDivergence(worker, makeServer(), {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
        container_id: replacementContainerId,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 53,
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(lifecycleLock.tryClaimRedrive).toHaveBeenCalledWith(
      worker.worker_id,
      operationId,
      WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS
    );
    expect(redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      operationId,
      operationId
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: operationId,
        action: 'recreate',
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
        recovery_without_journal: true,
      })
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: operationId,
        action: 'recreate',
        worker_id: worker.worker_id,
        recovery_without_journal: true,
      })
    );
    const reconstructed = prepare.mock.calls[0]?.[0];
    expect(reconstructed).not.toHaveProperty('recreate_server_slot_key');
    expect(reconstructed).not.toHaveProperty('recreate_server_slot_token');
    expect(lifecycleLock.isLocked).toHaveBeenCalledTimes(2);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      publish.mock.invocationCallOrder[0]
    );
  });

  it('releases an aligned provisioning claim when no durable or reconstructable payload remains', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-align-noop',
      container_id: 'a'.repeat(64),
      runtime_container_id: 'b'.repeat(64),
      runtime_generation: 54,
    });
    const claimToken =
      'operation-align-noop:019fe267-40c7-767d-a866-7c83bcfd0350';
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
        viewWorkerForMonitorConsistent: jest.fn(async () => null),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).alignLegacyProvisioningRuntimeAndRedrive(
        worker,
        worker.container_id,
        worker.runtime_container_id,
        worker.runtime_generation,
        worker.lifecycle_operation_id,
        { assertActive: jest.fn() },
        'not_ready'
      )
    ).resolves.toBeUndefined();

    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-align-noop',
      claimToken
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it.each([
    {
      conflict: 'SERVER_ID env',
      env: { SERVER_ID: 'different-server' },
      mount: undefined,
    },
    {
      conflict: '/app/data mount',
      env: undefined,
      mount: { name: 'different-session-volume' },
    },
  ])(
    'rejects legacy pointer adoption when the exact $conflict conflicts with the runtime row',
    async ({ env, mount }) => {
      const oldContainerId = '1'.repeat(64);
      const replacementContainerId = '2'.repeat(64);
      const operationId = 'operation-config-recreate-ownership-conflict';
      const worker = makeWorker({
        worker_id: '019ef562-9a75-74ef-bba0-b6a76c12c48e',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 76,
      });
      const replacementLabels = JSON.stringify({
        'underchat.worker_id': worker.worker_id,
        'underchat.account_id': worker.account_id,
        'underchat.worker_type_id': worker.worker_type_id,
        'underchat.runtime_generation': '76',
      });
      const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-30T21:30:00Z|0|false|${replacementLabels}`;
      const ownership = exactRuntimeOwnershipFixture({
        worker,
        containerId: replacementContainerId,
        runtimeGeneration: 76,
        sessionVolumeName: worker.runtime_session_volume_name as string,
        env,
        mount,
      });
      const workerService = {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(),
      };
      const redrivePrepared = jest.fn();
      const service = makeService({
        workerService,
        workerLifecycleQueueService: { redrivePrepared },
        workerLifecycleLockService: {
          isLocked: jest.fn(async () => false),
          tryClaimRedrive: jest.fn(),
          releaseRedriveClaim: jest.fn(),
        },
        sshService: {
          runCommands: jest.fn(
            async (_serverId: string, _config: unknown, commands: string[]) => {
              if (commands[0]?.includes('base64 -w0')) {
                return [{ output: ownership }];
              }
              if (commands[0]?.includes(oldContainerId)) {
                throw Object.assign(new Error('docker inspect failed'), {
                  output: `Error: No such object: ${oldContainerId}`,
                });
              }
              return [{ output: replacement }];
            }
          ),
        },
      });
      (service as any).passwordEncryptorService = {
        decrypt: jest.fn((value: string) => value),
      };

      const handled = await (
        service as any
      ).reconcileProvisioningLifecycleRuntimeDivergence(worker, makeServer(), {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      });

      expect(handled).toBe(false);
      expect(
        workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(redrivePrepared).not.toHaveBeenCalled();
    }
  );

  it('preserves an unlabelled replacement while the old control container still exists', async () => {
    const oldContainerId = 'b'.repeat(64);
    const replacementContainerId = 'c'.repeat(64);
    const operationId = 'operation-config-recreate-ambiguous';
    const worker = makeWorker({
      worker_id: '019ea8d6-6b54-754e-b5a4-6d4e4458bbdb',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 75,
    });
    const replacementLabels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '75',
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-30T23:22:00Z|0|false|${replacementLabels}`;
    const oldContainer = `${oldContainerId}|/old-worker-runtime|true|healthy|2026-07-30T22:00:00Z|0|false|{}`;
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService: {
        isLocked: jest.fn(async () => false),
      },
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => [
            {
              output: commands[0]?.includes(oldContainerId)
                ? oldContainer
                : replacement,
            },
          ]
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    const handled = await (
      service as any
    ).reconcileProvisioningLifecycleRuntimeDivergence(worker, makeServer(), {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

    expect(handled).toBe(false);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not reconcile a provisioning replacement while its lifecycle lock is active', async () => {
    const worker = makeWorker({
      worker_id: '019ef562-9a75-74ef-bba0-b6a76c12c48e',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-active-recreate',
      container_id: '9'.repeat(64),
      runtime_container_id: 'a'.repeat(64),
      runtime_generation: 53,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const sshService = {
      runCommands: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService: {
        isLocked: jest.fn(async () => true),
      },
      sshService,
    });

    const handled = await (
      service as any
    ).reconcileProvisioningLifecycleRuntimeDivergence(worker, makeServer(), {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(sshService.runCommands).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('queues cold recovery instead of sealing a Docker-healthy replacement with degraded Kafka', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oldContainerId = 'c'.repeat(64);
    const replacementContainerId = 'd'.repeat(64);
    const operationId = 'operation-liveness-degraded';
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 9,
      updated_at: staleDate,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '9',
      'underchat.lifecycle_operation_id': operationId,
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-29T22:01:00Z|0|false|${labels}`;
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService: {
        isLocked: jest.fn(async () => false),
      },
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => [
            {
              output: commands[0]?.includes('/v1/connection/health/check')
                ? `${JSON.stringify({
                    session_ready: true,
                    connected: true,
                    can_send: false,
                    can_receive_runtime: true,
                    authenticated: true,
                    kafka_unhealthy: true,
                    phone: '556192037138',
                    central_online_acknowledged: false,
                    runtime_generation: 9,
                  })}__HTTP_STATUS__503`
                : replacement,
            },
          ]
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(lifecycle.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: operationId,
        action: 'recreate',
        recovery_without_journal: true,
      })
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 9,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(lifecycle.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: operationId,
        recovery_without_journal: true,
      })
    );
  });

  it('queues missing-journal cold recovery when the owned runtime pointer is confirmed absent', async () => {
    const oldContainerId = 'e'.repeat(64);
    const replacementContainerId = 'f'.repeat(64);
    const operationId = 'operation-liveness-absent';
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 10,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService: lifecycle,
      workerLifecycleLockService: {
        isLocked: jest.fn(async () => false),
      },
      sshService: {
        runCommands: jest.fn(async () => {
          throw Object.assign(new Error('docker inspect failed'), {
            output: `Error: No such object: ${replacementContainerId}`,
          });
        }),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
      },
      expect.objectContaining({
        lifecycle_operation_id: operationId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 10,
      })
    );
    expect(lifecycle.prepare).toHaveBeenCalledTimes(1);
    expect(lifecycle.publish).toHaveBeenCalledTimes(1);
  });

  it('preserves a divergent terminal fence when replacement readiness cannot be read', async () => {
    const oldContainerId = '1'.repeat(64);
    const replacementContainerId = '2'.repeat(64);
    const operationId = 'operation-liveness-unavailable';
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: operationId,
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 11,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const labels = JSON.stringify({
      'underchat.worker_id': worker.worker_id,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '11',
      'underchat.lifecycle_operation_id': operationId,
    });
    const replacement = `${replacementContainerId}|/${worker.worker_id}|true|healthy|2026-07-29T22:01:00Z|0|false|${labels}`;
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService: lifecycle,
      workerLifecycleLockService: {
        isLocked: jest.fn(async () => false),
      },
      sshService: {
        runCommands: jest.fn(
          async (_serverId: string, _config: unknown, commands: string[]) => {
            if (commands[0]?.includes('/v1/connection/health/check')) {
              throw new Error('ssh timeout');
            }
            return [{ output: replacement }];
          }
        ),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };

    await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('does not clear a stale terminal lifecycle fence while its lock is active', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.disponible,
      lifecycle_operation_id: 'operation-active',
      updated_at: staleDate,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not treat an active recreate lifecycle as a terminal fence', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-recreating',
      updated_at: staleDate,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(),
    };
    const service = makeService({
      workerService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).repairStaleTerminalLifecycleFence(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(false);
    expect(workerService.viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.isLocked).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('redrives the exact lifecycle even when a partial failure changed the status to error', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.error,
      lifecycle_operation_id: 'operation-stuck-in-error',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => [
        {
          operation_id: 'operation-stuck-in-error',
          worker_id: worker.worker_id,
          action: 'recreate',
        },
      ]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-stuck-in-error'
    );
  });

  it('clears an orphaned error lifecycle fence when its durable journal is missing', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.error,
      lifecycle_operation_id: 'operation-error-journal-missing',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-error-journal-missing'
    );
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      },
      {
        lifecycle_operation_id: 'operation-error-journal-missing',
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.error,
      }
    );
  });

  it('never synthesizes a delete payload when immutable journal data is missing', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: 'operation-delete',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => []),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    const handled = await (service as any).redriveStalledLifecycleIfNeeded(
      worker,
      makeServer(),
      { assertActive: jest.fn() }
    );

    expect(handled).toBe(true);
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-delete'
    );
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('redrives the exact durable deletion payload before server discovery', async () => {
    const payload = {
      request_id: 'request-delete',
      operation_id: 'operation-delete',
      action: 'delete' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.deleting,
      source: 'worker_delete' as const,
      debug_trace_id: 'trace-delete',
      requested_at: new Date().toISOString(),
    };
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: payload.operation_id,
      deleted_at: new Date().toISOString(),
    });
    const workerLifecycleQueueService = {
      listPendingPermanentDeletions: jest.fn(async () => [payload]),
      publish: jest.fn<Promise<void>, [unknown]>(async () => undefined),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      listWorkersForMonitor: jest.fn(async () => []),
    };
    const serverService = {
      listBalanceServers: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      serverService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await service.run();

    expect(
      workerLifecycleQueueService.listPendingPermanentDeletions
    ).toHaveBeenCalledWith(100);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish.mock.calls[0][0]).toBe(payload);
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(
      serverService.listBalanceServers.mock.invocationCallOrder[0]
    );
  });

  it('does not turn an offline worker into an automatic recreate loop', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.offline,
      lifecycle_operation_id: null,
      updated_at: new Date().toISOString(),
      last_connection_check_at: new Date().toISOString(),
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await (service as any).handleRecreate(
      worker,
      makeServer(),
      'missing_container'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('does not claim a missing-container recreate after the runtime identity changes', async () => {
    const observedMissingRuntime = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
      container_id: 'a'.repeat(64),
      runtime_container_id: 'a'.repeat(64),
      runtime_generation: 7,
      runtime_session_volume_name: 'session-generation-7',
    });
    const replacementRuntime = {
      ...observedMissingRuntime,
      container_id: 'b'.repeat(64),
      runtime_container_id: 'b'.repeat(64),
      runtime_generation: 8,
      runtime_session_volume_name: 'session-generation-8',
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => replacementRuntime),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await (service as any).handleRecreate(
      observedMissingRuntime,
      makeServer(),
      'missing_container'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('does not enqueue when another service pod wins the lifecycle CAS', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => false),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await (service as any).handleRecreate(
      worker,
      makeServer(),
      'missing_container'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('preserves a non-liveness lifecycle fence when Kafka publish fails', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    };
    const publishError = new Error('kafka unavailable');
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => {
        throw publishError;
      }),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      centrifugoService,
    });

    await expect(
      (service as any).handleRecreate(worker, makeServer(), 'missing_container')
    ).rejects.toBe(publishError);

    const operationId = (
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0][1] as { lifecycle_operation_id: string }
    ).lifecycle_operation_id;
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(operationId).toEqual(expect.any(String));
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
  });

  it('never mutates the durable claim while Kafka retry is exhausted', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    let operationId: string | undefined;
    const updateWorkerByIdIfLifecycleMatches = jest
      .fn<
        Promise<boolean>,
        [string, { lifecycle_operation_id?: string }, unknown]
      >()
      .mockImplementationOnce(
        async (
          _accountId: string,
          update: { lifecycle_operation_id?: string }
        ) => {
          operationId = update.lifecycle_operation_id;
          return true;
        }
      )
      .mockRejectedValueOnce(new Error('transient database failure'))
      .mockResolvedValueOnce(true);
    const viewWorkerForMonitorConsistent = jest.fn<
      Promise<IWorkerMonitor>,
      [string]
    >(async () => {
      const currentOperationId = operationId;
      return currentOperationId
        ? {
            ...worker,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: currentOperationId,
          }
        : worker;
    });
    const workerService = {
      viewWorkerForMonitorConsistent,
      updateWorkerByIdIfLifecycleMatches,
    };
    const publishError = new Error('kafka unavailable');
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => {
        throw publishError;
      }),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      centrifugoService: {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      },
    });

    await expect(
      (service as any).handleRecreate(worker, makeServer(), 'missing_container')
    ).rejects.toBe(publishError);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
  });

  it('retries the exact prepared lifecycle before waiting for fast redrive', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    let operationId: string | undefined;
    const updateWorkerByIdIfLifecycleMatches = jest
      .fn<
        Promise<boolean>,
        [string, { lifecycle_operation_id?: string }, unknown]
      >()
      .mockImplementationOnce(
        async (
          _accountId: string,
          update: { lifecycle_operation_id?: string }
        ) => {
          operationId = update.lifecycle_operation_id;
          return true;
        }
      )
      .mockResolvedValue(false);
    const viewWorkerForMonitorConsistent = jest.fn<
      Promise<IWorkerMonitor>,
      [string]
    >(async () => {
      const currentOperationId = operationId;
      return currentOperationId
        ? {
            ...worker,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: currentOperationId,
          }
        : worker;
    });
    const workerService = {
      viewWorkerForMonitorConsistent,
      updateWorkerByIdIfLifecycleMatches,
    };
    const publishError = new Error('first kafka publish failed');
    const workerLifecycleQueueService = {
      publish: jest
        .fn()
        .mockRejectedValueOnce(publishError)
        .mockResolvedValueOnce(undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await expect(
      (service as any).handleRecreate(worker, makeServer(), 'missing_container')
    ).resolves.toBeUndefined();

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(2);
    expect(workerLifecycleQueueService.publish.mock.calls[1][0]).toEqual(
      workerLifecycleQueueService.publish.mock.calls[0][0]
    );
  });

  it('publishes the same prepared operation when lifecycle CAS and its verification are ambiguous', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const casError = new Error('lifecycle CAS result unknown');
    const compensationError = new Error('compensation database unavailable');
    const primaryReadError = new Error('primary read unavailable');
    let operationId: string | undefined;
    let updateCall = 0;
    const updateWorkerByIdIfLifecycleMatches = jest.fn<
      Promise<boolean>,
      [string, { lifecycle_operation_id?: string }, unknown]
    >(
      async (
        _accountId: string,
        update: { lifecycle_operation_id?: string }
      ) => {
        updateCall += 1;
        if (updateCall === 1) {
          operationId = update.lifecycle_operation_id;
          throw casError;
        }
        throw compensationError;
      }
    );
    let readCall = 0;
    const viewWorkerForMonitorConsistent = jest.fn<
      Promise<IWorkerMonitor>,
      [string]
    >(async () => {
      readCall += 1;
      if (readCall === 1) {
        return worker;
      }
      throw primaryReadError;
    });
    const workerLifecycleQueueService = {
      publish: jest.fn<Promise<void>, [unknown]>(async (_message) => undefined),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent,
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService,
    });

    await expect(
      (service as any).handleRecreate(worker, makeServer(), 'missing_container')
    ).rejects.toBe(casError);

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
    expect(viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(2);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        operation_id: operationId,
        worker_id: worker.worker_id,
        account_id: worker.account_id,
      })
    );
  });

  it('recovers a transient Kafka failure without compensating the primary row', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const publishError = new Error('initial lifecycle publish failed');
    const compensationError = new Error('compensation database unavailable');
    const primaryReadError = new Error('primary read unavailable');
    let operationId: string | undefined;
    let updateCall = 0;
    const updateWorkerByIdIfLifecycleMatches = jest.fn<
      Promise<boolean>,
      [string, { lifecycle_operation_id?: string }, unknown]
    >(
      async (
        _accountId: string,
        update: { lifecycle_operation_id?: string }
      ) => {
        updateCall += 1;
        if (updateCall === 1) {
          operationId = update.lifecycle_operation_id;
          return true;
        }
        throw compensationError;
      }
    );
    let readCall = 0;
    const viewWorkerForMonitorConsistent = jest.fn<
      Promise<IWorkerMonitor>,
      [string]
    >(async () => {
      readCall += 1;
      if (readCall === 1) {
        return worker;
      }
      throw primaryReadError;
    });
    const workerLifecycleQueueService = {
      publish: jest
        .fn()
        .mockRejectedValueOnce(publishError)
        .mockResolvedValueOnce(undefined),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent,
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService,
    });

    await expect(
      (service as any).handleRecreate(worker, makeServer(), 'missing_container')
    ).resolves.toBeUndefined();

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
    expect(viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(2);
    expect(workerLifecycleQueueService.publish.mock.calls[1][0]).toBe(
      workerLifecycleQueueService.publish.mock.calls[0][0]
    );
    expect(workerLifecycleQueueService.publish.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        operation_id: operationId,
        worker_id: worker.worker_id,
        account_id: worker.account_id,
      })
    );
  });

  it('never rolls back a prepared lifecycle when the monitor lease is lost', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const leaseLost = new Error('monitor lease lost');
    let active = true;
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(() => {
        if (!active) {
          throw leaseLost;
        }
      }),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest
        .fn()
        .mockImplementationOnce(async () => {
          active = false;
          return true;
        })
        .mockResolvedValueOnce(true),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
    });

    await expect(
      (service as any).handleRecreate(
        worker,
        makeServer(),
        'missing_container',
        context
      )
    ).rejects.toBe(leaseLost);

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('treats enveloped TypeScript worker health as session ready', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      runtime_generation: 7,
    });
    const body = {
      status: true,
      message: '',
      data: {
        ...makeStrictConnectionHealth(worker, {
          runtime_generation: 7,
        }),
        provider_state: 'CONNECTED',
        last_probe_at: '2026-06-27T13:17:51.090Z',
        probe_latency_ms: 216,
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
      worker,
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
        central_online_acknowledged: true,
        runtime_generation: 7,
        kafka_unhealthy: false,
      })
    );
  });

  it('preserves the schema-v2 readiness contract for non-WhatsApp workers', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.telegram,
    });
    const body = {
      status: true,
      message: '',
      data: {
        runtime_health_schema_version: 2,
        session_ready: true,
        connected: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        central_online_acknowledged: true,
        phone: '556192037138',
      },
    };
    const sshService = {
      runCommands: jest.fn(async () => [
        { output: `${JSON.stringify(body)}__HTTP_STATUS__200` },
      ]),
    };
    const service = makeService({ sshService });

    await expect(
      (service as any).checkConnection(worker, 'server-1', {} as never)
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: true,
        code: 200,
        runtime_health_schema_version: 2,
      })
    );
  });

  it('fails closed for schema-v2 HTTP health without Kafka dispatch authorization', async () => {
    const body = {
      status: false,
      message: '',
      data: {
        session_ready: true,
        connected: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        central_online_acknowledged: true,
        runtime_generation: 7,
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: false,
        runtime_health_schema_version: 2,
      },
    };
    const sshService = {
      runCommands: jest.fn(async () => [
        {
          output: `${JSON.stringify(body)}__HTTP_STATUS__503`,
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
        healthy: false,
        code: 503,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: false,
        runtime_health_schema_version: 2,
      })
    );
  });

  it('routes online reconciliation through the lifecycle and runtime fenced handler', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
      updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
      publish: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      notifyWorkerStatus: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      centrifugoService,
      workerCommandHandlerService,
    });

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
        central_online_acknowledged: true,
        runtime_generation: 7,
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
    ).not.toHaveBeenCalled();
    expect(workerCommandHandlerService.notifyWorkerStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ECodeMessage.connectionEstablished,
        status: EBaileysConnectionStatus.connected,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
        phone: '556192037138',
        runtime_generation: 7,
        container_id: 'container-1',
      })
    );
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('does not reconcile online without central ACK and runtime generation', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      notifyWorkerStatus: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerCommandHandlerService,
    });

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
        phone: '556192037138',
        central_online_acknowledged: false,
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(workerService.updateWorkerLastConnectionCheckAt).toHaveBeenCalled();
    expect(
      workerCommandHandlerService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('does not reconcile online while a lifecycle operation is pending', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      notifyWorkerStatus: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerCommandHandlerService,
    });

    await (service as any).syncConnectionStatusWithFailureTracking(
      makeWorker({
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: 'lifecycle-1',
      }),
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
        phone: '556192037138',
        central_online_acknowledged: true,
        runtime_generation: 7,
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(
      workerCommandHandlerService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('suppresses lease-lost degradation while the exact disconnect barrier is active', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      viewWorkerForMonitorConsistent: jest.fn(),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      notifyWorkerStatus: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      centrifugoService,
      workerCommandHandlerService,
    });
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      connection_epoch: 'removed-connection-epoch',
      disconnected_connection_epoch: 'removed-connection-epoch',
      connection_disconnected_at: '2026-08-09T16:49:16.029Z',
    });

    await (service as any).syncConnectionStatusWithFailureTracking(
      worker,
      {
        healthy: false,
        code: 408,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'lease_lost',
        degraded_reason: 'session_lease_expired',
        kafka_unhealthy: false,
      },
      'server-1',
      {} as never
    );

    expect(
      workerService.updateWorkerLastConnectionCheckAt
    ).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(
      workerCommandHandlerService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('redrives a crash-left disconnect barrier and replays its durable terminal event', async () => {
    const disconnectedAt = '2026-08-09T19:49:16.029Z';
    const observedAt = '2026-08-09T19:49:23.334Z';
    const barrierWorker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 7,
      connection_epoch: 'removed-connection-epoch',
      disconnected_connection_epoch: 'removed-connection-epoch',
      connection_disconnected_at: disconnectedAt,
      number: '556192037138',
      connection_date: '2026-08-09T19:44:06.092Z',
    });
    const terminalWorker = makeWorker({
      ...barrierWorker,
      worker_status_id: EWorkerStatus.disponible,
      number: null,
      connection_date: null,
      updated_at: observedAt,
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => terminalWorker),
    };
    const workerCommandHandlerService = {
      handleChangeConnectionStatus: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    };
    const service = makeService({
      workerService,
      workerCommandHandlerService,
      centrifugoService,
      redis,
    });
    const context = {
      signal: new AbortController().signal,
      assertActive: () => undefined,
    };

    await expect(
      (service as any).reconcileConnectionDisconnectBarrier(
        barrierWorker,
        context
      )
    ).resolves.toBe(true);

    expect(
      workerCommandHandlerService.handleChangeConnectionStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        remove_session: true,
        runtime_generation: 7,
      }),
      'account-1'
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.disconnected,
        session_removed: true,
        disconnected_user: true,
        worker_status_observed_at: observedAt,
      })
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(
        `worker:connection-disconnect:terminal:worker-1:7:${disconnectedAt}`
      ),
      observedAt,
      'EX',
      7 * 24 * 60 * 60,
      'NX'
    );
  });

  it('keeps a failed disconnect redrive fenced for the next monitor cycle', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.offline,
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 7,
      connection_epoch: 'removed-connection-epoch',
      disconnected_connection_epoch: 'removed-connection-epoch',
      connection_disconnected_at: '2026-08-09T19:49:16.029Z',
    });
    const workerCommandHandlerService = {
      handleChangeConnectionStatus: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerCommandHandlerService,
      centrifugoService,
    });

    await expect(
      (service as any).reconcileConnectionDisconnectBarrier(worker, {
        signal: new AbortController().signal,
        assertActive: () => undefined,
      })
    ).resolves.toBe(true);

    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('marks the worker degraded without creating an automatic self-heal loop', async () => {
    jest.useFakeTimers();
    try {
      const worker = makeWorker({ worker_status_id: EWorkerStatus.online });
      const workerService = {
        updateStatusWorker: jest.fn(async () => true),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      };
      const centrifugoService = {
        publishSub: jest.fn(async () => true),
      };
      const workerCommandHandlerService = {
        requestWorkerSelfHealing: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService,
        centrifugoService,
        workerCommandHandlerService,
      });

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
          provider_state: 'PAIRING',
          degraded_reason: 'missing_local_session',
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
          provider_state: 'PAIRING',
          degraded_reason: 'missing_local_session',
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
          provider_state: 'PAIRING',
          degraded_reason: 'missing_local_session',
          kafka_unhealthy: false,
        },
        'server-1',
        {} as never
      );

      expect(workerService.updateStatusWorker).not.toHaveBeenCalled();
      expect(
        workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: EWorkerStatus.disponible,
        },
        {
          lifecycle_operation_id: null,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: EWorkerStatus.online,
          updated_at: worker.updated_at,
        }
      );
      expect(centrifugoService.publishSub).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          code: ECodeMessage.awaitConnection,
          status: EBaileysConnectionStatus.connecting,
          worker_id: 'worker-1',
          worker_name: 'Canal 1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.disponible,
          degraded_reason: 'missing_local_session',
        })
      );
      expect(
        workerCommandHandlerService.requestWorkerSelfHealing
      ).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('never marks an authenticated online session disponible during Kafka readiness degradation', async () => {
    const worker = makeWorker({ worker_status_id: EWorkerStatus.online });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      centrifugoService,
    });
    const kafkaReadinessDegradation = {
      healthy: false,
      code: 503,
      body: {},
      session_ready: true,
      connected: true,
      can_send: true,
      can_receive_runtime: false,
      authenticated: true,
      provider_state: 'kafka_consumers_not_ready',
      degraded_reason: 'kafka_unhealthy',
      phone: '556296742780',
      kafka_unhealthy: true,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (service as any).syncConnectionStatusWithFailureTracking(
        worker,
        kafkaReadinessDegradation,
        'server-1',
        {} as never
      );
    }

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(
      1
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not treat a generic disconnected transport as proof that the persisted session is absent', async () => {
    const worker = makeWorker({ worker_status_id: EWorkerStatus.online });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      centrifugoService,
    });
    const transientDisconnect = {
      healthy: false,
      code: 503,
      body: {},
      session_ready: false,
      connected: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'DISCONNECTED',
      degraded_reason: 'connection_closed',
      kafka_unhealthy: false,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (service as any).syncConnectionStatusWithFailureTracking(
        worker,
        transientDisconnect,
        'server-1',
        {} as never
      );
    }

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(
      1
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it.each(['missing_client', 'not_authenticated'])(
    'preserves online for the provider-local transient state %s',
    async (providerState) => {
      const worker = makeWorker({ worker_status_id: EWorkerStatus.online });
      const workerService = {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      };
      const centrifugoService = {
        publishSub: jest.fn(async () => true),
      };
      const service = makeService({
        workerService,
        centrifugoService,
      });
      const transientState = {
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: providerState,
        degraded_reason: providerState,
        kafka_unhealthy: false,
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await (service as any).syncConnectionStatusWithFailureTracking(
          worker,
          transientState,
          'server-1',
          {} as never
        );
      }

      expect(
        workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    }
  );

  it('treats an explicitly missing local session as absent even when a stale phone remains', () => {
    const service = makeService();

    expect(
      (service as any).hasStrongSessionAbsenceEvidence({
        healthy: false,
        code: 503,
        body: {},
        session_ready: false,
        connected: false,
        can_send: false,
        can_receive_runtime: true,
        authenticated: false,
        provider_state: 'open',
        degraded_reason: 'missing_local_session',
        phone: '556296742780',
        kafka_unhealthy: false,
      })
    ).toBe(true);
  });

  it('does not downgrade online to disponible when the health probe cannot prove the session is absent', async () => {
    const worker = makeWorker({ worker_status_id: EWorkerStatus.online });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const service = makeService({
      workerService,
      centrifugoService,
    });
    const ambiguousProbeFailure = {
      healthy: false,
      code: null,
      body: null,
      degraded_reason: 'connection refused',
      kafka_unhealthy: false,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (service as any).syncConnectionStatusWithFailureTracking(
        worker,
        ambiguousProbeFailure,
        'server-1',
        {} as never
      );
    }

    expect(workerService.viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(
      1
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not degrade or self-heal a stale snapshot after a lifecycle fence appears', async () => {
    const snapshot = makeWorker({
      worker_status_id: EWorkerStatus.offline,
      lifecycle_operation_id: null,
    });
    const current = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-new',
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => current),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      requestWorkerSelfHealing: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      centrifugoService,
      workerCommandHandlerService,
    });

    await (service as any).handlePersistentConnectionDegradation(snapshot, {
      healthy: false,
      code: 503,
      body: {},
      kafka_unhealthy: false,
      degraded_reason: 'probe_failed',
    });

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(
      workerCommandHandlerService.requestWorkerSelfHealing
    ).not.toHaveBeenCalled();
  });

  it('keeps a disponible worker disponible without self-heal while waiting for QR or session', async () => {
    const workerService = {
      updateWorkerLastConnectionCheckAt: jest.fn(async () => true),
      updateStatusWorker: jest.fn(async () => true),
      updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    };
    const workerCommandHandlerService = {
      requestWorkerSelfHealing: jest.fn(async () => undefined),
    };
    const service = makeService({ workerService, workerCommandHandlerService });

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
    expect(
      workerCommandHandlerService.requestWorkerSelfHealing
    ).not.toHaveBeenCalled();
  });

  it('starts every server liveness scan without head-of-line blocking on a hung host', async () => {
    const secondServer = {
      ...makeServer(),
      server_id: 'server-2',
      ssh_ip: '127.0.0.2',
    };
    let releaseFirstServer!: (value: { output: string }[]) => void;
    const firstServerBlocked = new Promise<{ output: string }[]>((resolve) => {
      releaseFirstServer = resolve;
    });
    const sshService = {
      runCommands: jest.fn((serverId: string) =>
        serverId === 'server-1'
          ? firstServerBlocked
          : Promise.resolve([{ output: '' }])
      ),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer(), secondServer]),
      },
      sshService,
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    const runPromise = service.runLiveness();

    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedServerIds = (
      sshService.runCommands.mock.calls as unknown as Array<[string]>
    ).map((call) => call[0]);
    releaseFirstServer([{ output: '' }]);
    await runPromise;
    randomSpy.mockRestore();

    expect(startedServerIds).toEqual(
      expect.arrayContaining(['server-1', 'server-2'])
    );
  });

  it('recovers an online DB runtime only after two exact Docker-absence observations', async () => {
    const workerId = '019f609a-3675-7698-ae1d-690cf4dd69b4';
    const containerId = 'a'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 2,
    });
    const workerService = {
      listMissingRuntimeRecoveryCandidates: jest.fn(async () => [worker]),
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const sshService = {
      runCommands: jest.fn(
        async (_serverId: string, _config: unknown, commands: string[]) => {
          const command = commands[0] ?? '';
          return command.includes('__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__')
            ? [
                {
                  output: '__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__\n',
                },
              ]
            : [{ output: '' }];
        }
      ),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService,
      workerLifecycleQueueService: lifecycle,
      sshService,
      redis: {
        get: jest.fn(async () => String(Date.now() - 60_000)),
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async () => 1),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(
      workerService.listMissingRuntimeRecoveryCandidates
    ).toHaveBeenCalledWith(WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE, undefined);
    const snapshotCommands = sshService.runCommands.mock.calls.filter((call) =>
      String(call[2]?.[0]).includes(
        '__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__'
      )
    );
    expect(snapshotCommands).toHaveLength(2);
    expect(workerService.updateWorkerByIdIfLifecycleMatches).toHaveBeenCalled();
    expect(lifecycle.prepare).toHaveBeenCalledTimes(1);
    expect(lifecycle.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: workerId,
        action: 'recreate',
        source: 'worker_recreate',
      })
    );
  });

  it('records the first exact Docker absence without immediately recreating', async () => {
    const workerId = '019f609a-3675-7698-ae1d-690cf4dd69b4';
    const containerId = 'b'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 3,
    });
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        listMissingRuntimeRecoveryCandidates: jest.fn(async () => [worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      },
      workerLifecycleQueueService: lifecycle,
      redis,
      sshService: {
        runCommands: jest.fn(async () => [
          { output: '__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__\n' },
        ]),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await (service as any).recoverMissingRuntimeCandidates(
      [makeServer()],
      context
    );

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(`${workerId}:${containerId}`),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX'
    );
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('bounds missing-runtime recovery per server and fails closed on Docker snapshot errors', async () => {
    const candidates = Array.from(
      { length: WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER + 3 },
      (_value, index) => {
        const suffix = String(index + 1).padStart(12, '0');
        const containerId = (index + 1).toString(16).padStart(64, '0');
        return makeWorker({
          worker_id: `019f609a-3675-7698-ae1d-${suffix}`,
          worker_status_id: EWorkerStatus.online,
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: index + 1,
        });
      }
    );
    const workers = new Map(
      candidates.map((candidate) => [candidate.worker_id, candidate])
    );
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const snapshotFailure = { enabled: false };
    const sshService = {
      runCommands: jest.fn(async () => {
        if (snapshotFailure.enabled) {
          throw new Error('docker daemon unavailable');
        }
        return [{ output: '__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__\n' }];
      }),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const service = makeService({
      workerService: {
        listMissingRuntimeRecoveryCandidates: jest.fn(async () => candidates),
        viewWorkerForMonitorConsistent: jest.fn(async (workerId: string) =>
          workers.get(workerId)
        ),
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService: lifecycle,
      sshService,
      redis: {
        get: jest.fn(async () => String(Date.now() - 60_000)),
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async () => 1),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await (service as any).recoverMissingRuntimeCandidates(
      [makeServer()],
      context
    );

    expect(lifecycle.prepare).toHaveBeenCalledTimes(
      WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER
    );
    expect(lifecycle.publish).toHaveBeenCalledTimes(
      WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER
    );

    lifecycle.prepare.mockClear();
    lifecycle.publish.mockClear();
    updateWorkerByIdIfLifecycleMatches.mockClear();
    snapshotFailure.enabled = true;
    await (service as any).recoverMissingRuntimeCandidates(
      [makeServer()],
      context
    );

    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('accepts Docker not-found evidence only for the exact requested identity', () => {
    const service = makeService();
    const expectedId = 'a'.repeat(64);
    const otherId = 'b'.repeat(64);
    const isNotFound = (output: string) =>
      (service as any).isContainerNotFoundError(
        { output },
        expectedId
      ) as boolean;

    expect(isNotFound(`Error: No such object: ${expectedId}`)).toBe(true);
    expect(
      isNotFound(`Error response from daemon: No such container: ${expectedId}`)
    ).toBe(true);
    expect(
      isNotFound(`Error response from daemon: No such container: ${otherId}`)
    ).toBe(false);
    expect(isNotFound('Error: No such container')).toBe(false);
  });

  it('continues recovering another candidate when one exact container vanishes during reinspection', async () => {
    const firstWorkerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const secondWorkerId = '019dfe2c-2c30-730d-88e9-63b839bb1b38';
    const firstContainerId = 'a'.repeat(64);
    const secondContainerId = 'b'.repeat(64);
    const workers = new Map(
      [
        [firstWorkerId, firstContainerId],
        [secondWorkerId, secondContainerId],
      ].map(([workerId, containerId]) => [
        workerId,
        makeWorker({
          worker_id: workerId,
          worker_status_id: EWorkerStatus.online,
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: 7,
        }),
      ])
    );
    const observation = (workerId: string, containerId: string) => {
      const worker = workers.get(workerId) as IWorkerMonitor;
      const labels = JSON.stringify({
        'underchat.worker_id': workerId,
        'underchat.account_id': worker.account_id,
        'underchat.server_id': worker.server_id,
        'underchat.worker_type_id': worker.worker_type_id,
        'underchat.runtime_generation': '7',
      });
      return `${containerId}|/${workerId}|true|unhealthy|2026-07-29T22:00:00Z|0|false|${labels}`;
    };
    const firstObservation = observation(firstWorkerId, firstContainerId);
    const secondObservation = observation(secondWorkerId, secondContainerId);
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const sshService = {
      runCommands: jest.fn(
        async (_serverId: string, _config: unknown, commands: string[]) => {
          const command = commands[0] ?? '';
          if (command.includes('docker ps --no-trunc')) {
            return [{ output: `${firstContainerId}\n${secondContainerId}` }];
          }
          if (command.includes(firstContainerId)) {
            throw new Error(`No such container: ${firstContainerId}`);
          }
          if (command.includes(secondContainerId)) {
            return [{ output: secondObservation }];
          }
          return [{ output: '' }];
        }
      ),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async (workerId: string) =>
          workers.get(workerId)
        ),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      },
      workerLifecycleQueueService: lifecycle,
      sshService,
      redis: {
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async () => 1),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
      centrifugoService: {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(lifecycle.publish).toHaveBeenCalledTimes(1);
    expect(lifecycle.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: secondWorkerId,
        expected_container_id: secondContainerId,
      })
    );
    const scanCommand = String(
      (
        sshService.runCommands.mock.calls as unknown as Array<
          [unknown, unknown, string[]]
        >
      )[0]?.[2]?.[0]
    );
    expect(scanCommand).toContain('docker ps --no-trunc');
    const exactInspectCommands = sshService.runCommands.mock.calls
      .flatMap((call) => call[2])
      .filter((command) => command.includes('docker inspect --type=container'));
    expect(
      exactInspectCommands.some((command) => command.includes(firstContainerId))
    ).toBe(true);
    expect(
      exactInspectCommands.some((command) =>
        command.includes(secondContainerId)
      )
    ).toBe(true);
  });

  it('fails the entire host observation closed when docker ps returns nonzero', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const sshService = {
      runCommands: jest.fn(async () => {
        throw new Error('docker daemon unavailable');
      }),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService,
      workerLifecycleQueueService: lifecycle,
      sshService,
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerService.viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
    const scanCommand = String(
      (
        sshService.runCommands.mock.calls as unknown as Array<
          [unknown, unknown, string[]]
        >
      )[0]?.[2]?.[0]
    );
    expect(scanCommand.match(/docker ps --no-trunc/g)).toHaveLength(3);
    expect(scanCommand).toContain('docker ps -a --no-trunc');
    expect(scanCommand).toContain('--filter label=underchat.worker_id');
    expect(scanCommand).toContain('--filter status=created');
    expect(scanCommand).toContain('--filter status=exited');
    expect(scanCommand).toContain('--filter status=dead');
    expect(scanCommand.match(/\|\| exit \$\?/g)).toHaveLength(4);
  });

  it('rotates a bounded discovery batch so repeated inspect timeouts cannot starve later containers', async () => {
    const containerIds = Array.from({ length: 30 }, (_value, index) =>
      index.toString(16).padStart(64, '0')
    );
    const inspectedIds: string[] = [];
    const sshService = {
      runCommands: jest.fn(
        async (_serverId: string, _config: unknown, commands: string[]) => {
          const command = commands[0] ?? '';
          if (command.includes('docker ps --no-trunc')) {
            return [{ output: containerIds.join('\n') }];
          }
          const containerId = containerIds.find((id) => command.includes(id));
          if (containerId) {
            inspectedIds.push(containerId);
            throw new Error('docker inspect timeout');
          }
          return [{ output: '' }];
        }
      ),
    };
    const service = makeService({ sshService });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (service as any).listPersistentlyUnhealthyContainers(
        makeServer(),
        context
      )
    ).resolves.toEqual([]);
    const firstCycleIds = [...inspectedIds];
    inspectedIds.length = 0;
    await expect(
      (service as any).listPersistentlyUnhealthyContainers(
        makeServer(),
        context
      )
    ).resolves.toEqual([]);

    expect(firstCycleIds).toHaveLength(
      WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE
    );
    expect(inspectedIds).toHaveLength(
      WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE
    );
    expect(inspectedIds).toEqual(
      expect.arrayContaining(
        containerIds.slice(WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE)
      )
    );
  });

  it('enqueues one durable recreate for an exact persistently unhealthy runtime generation', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = 'a'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 7,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '7',
    });
    const observation = `${containerId}|/${workerId}|true|unhealthy|2026-07-29T22:00:00.000000000Z|0|${labels}`;
    const workerService = {
      listWorkersForMonitor: jest.fn(),
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const sshService = {
      runCommands: jest.fn(async () => [{ output: observation }]),
    };
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService,
      workerLifecycleQueueService,
      sshService,
      redis,
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
      centrifugoService: {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerService.listWorkersForMonitor).not.toHaveBeenCalled();
    expect(sshService.runCommands).toHaveBeenCalledTimes(3);
    expect(
      (sshService.runCommands.mock.calls as unknown[][]).every((call) =>
        String((call[2] as string[])[0]).includes('timeout --signal=KILL 5s')
      )
    ).toBe(true);
    for (const call of sshService.runCommands.mock.calls as unknown as Array<
      [
        string,
        { readyTimeout?: number },
        string[],
        boolean,
        Record<string, unknown>,
      ]
    >) {
      expect(call[1].readyTimeout).toBe(5_000);
      expect(call[4]).toEqual(
        expect.objectContaining({
          connectMaxAttempts: 1,
          commandTimeoutMs: 6_000,
        })
      );
    }
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      worker.account_id,
      expect.objectContaining({
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: expect.any(String),
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00.000000000Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      })
    );
    const remoteCommands = (
      sshService.runCommands.mock.calls as unknown as Array<
        [unknown, unknown, string[]]
      >
    )
      .flatMap((call) => call[2])
      .join('\n');
    expect(remoteCommands).not.toMatch(/docker (?:restart|rm|stop)\b/);
    expect(remoteCommands).toContain('--filter status=paused');
  });

  it('persists stopped when SIGKILL leaves the exact online runtime exited', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '9'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 14,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '14',
    });
    // Docker can retain a stale healthy value after the process was SIGKILLed.
    const exited = `${containerId}|/${workerId}|false|healthy|2026-07-29T22:00:00Z|0|false|${labels}`;
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const publishSub = jest.fn(async () => undefined);
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest.fn(async () => [{ output: exited }]),
      },
      redis: {
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async () => 1),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
      centrifugoService: { publishSub },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      worker.account_id,
      expect.objectContaining({
        worker_id: workerId,
        worker_status_id: EWorkerStatus.stopped,
      }),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        runtime_generation: 14,
      })
    );
    expect(publishSub).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_id: workerId,
        worker_status_id: EWorkerStatus.stopped,
      })
    );
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('requires the terminal running state to remain unchanged across observations', () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '9'.repeat(64);
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': 'account-1',
      'underchat.server_id': 'server-1',
      'underchat.worker_type_id': EWorkerType.wwebjs,
      'underchat.runtime_generation': '14',
    });
    const service = makeService();
    const parse = (running: boolean, health: string) =>
      (service as any).parsePersistentlyUnhealthyContainerLine(
        `${containerId}|/${workerId}|${running}|${health}|2026-07-29T22:00:00Z|0|false|${labels}`
      );
    const exited = parse(false, 'healthy');
    const stillExited = parse(false, 'none');
    const restartedUnhealthy = parse(true, 'unhealthy');
    const restartedHealthy = parse(true, 'healthy');

    expect(exited).toEqual(
      expect.objectContaining({
        running: false,
        healthStatus: 'unhealthy',
      })
    );
    expect(stillExited).toEqual(
      expect.objectContaining({
        running: false,
        healthStatus: 'unhealthy',
      })
    );
    expect(
      (service as any).isSameUnhealthyContainerObservation(exited, stillExited)
    ).toBe(true);
    expect(
      (service as any).isSameUnhealthyContainerObservation(
        exited,
        restartedUnhealthy
      )
    ).toBe(false);
    expect(
      (service as any).isSameUnhealthyContainerObservation(
        exited,
        restartedHealthy
      )
    ).toBe(false);
  });

  it.each([
    {
      terminalState: 'dead',
      startedAt: '2026-07-29T22:00:00Z',
    },
    {
      terminalState: 'created',
      startedAt: '0001-01-01T00:00:00Z',
    },
  ])(
    'discovers and normalizes a $terminalState container with Docker health none',
    async ({ terminalState, startedAt }) => {
      const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
      const containerId =
        terminalState === 'dead' ? 'd'.repeat(64) : 'c'.repeat(64);
      const labels = JSON.stringify({
        'underchat.worker_id': workerId,
        'underchat.account_id': 'account-1',
        'underchat.server_id': 'server-1',
        'underchat.worker_type_id': EWorkerType.wwebjs,
        'underchat.runtime_generation': '14',
      });
      const inspection = `${containerId}|/${workerId}|false|none|${startedAt}|0|false|${labels}`;
      const sshService = {
        runCommands: jest
          .fn()
          .mockResolvedValueOnce([{ output: containerId }])
          .mockResolvedValueOnce([{ output: inspection }]),
      };
      const service = makeService({ sshService });
      (service as any).passwordEncryptorService = {
        decrypt: jest.fn((value: string) => value),
      };
      const context = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (service as any).listPersistentlyUnhealthyContainers(
          makeServer(),
          context
        )
      ).resolves.toEqual([
        expect.objectContaining({
          containerId,
          name: workerId,
          running: false,
          healthStatus: 'unhealthy',
          startedAt,
          restartCount: 0,
          workerId,
          runtimeGeneration: 14,
        }),
      ]);

      const discoveryCommand = String(
        (
          sshService.runCommands.mock.calls as unknown as Array<
            [unknown, unknown, string[]]
          >
        )[0]?.[2]?.[0]
      );
      expect(discoveryCommand).toContain(`--filter status=${terminalState}`);
      expect(Number.isFinite(Date.parse(startedAt))).toBe(true);
    }
  );

  it('does nothing when a terminal runtime restarts healthy before the final fence', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = 'f'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 15,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '15',
    });
    const terminal = `${containerId}|/${workerId}|false|none|2026-07-29T22:00:00Z|0|false|${labels}`;
    const restartedHealthy = `${containerId}|/${workerId}|true|healthy|2026-07-29T22:01:00Z|1|false|${labels}`;
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn();
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService: lifecycle,
      redis,
      sshService: {
        runCommands: jest
          .fn()
          .mockResolvedValueOnce([{ output: terminal }])
          .mockResolvedValueOnce([{ output: terminal }])
          .mockResolvedValueOnce([{ output: restartedHealthy }]),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('never treats a terminal warm standby as an active worker candidate', async () => {
    const containerId = 'e'.repeat(64);
    const labels = JSON.stringify({
      'underchat.warm_standby': 'true',
      'underchat.warm_pool_id': 'warm-pool-1',
      'underchat.worker_id': 'warm-pool:warm-pool-1',
    });
    const warmExited = `${containerId}|/warm-warm-pool-1|false|none|0001-01-01T00:00:00Z|0|false|${labels}`;
    const viewWorkerForMonitorConsistent = jest.fn();
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: { viewWorkerForMonitorConsistent },
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest.fn(async () => [{ output: warmExited }]),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('preserves and fast-redrives a prepared liveness operation when its first Kafka publish fails', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const operationId = '019dfe2c-2c30-730d-88e9-63b839bb1b38';
    const containerId = 'a'.repeat(64);
    let current = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 7,
    });
    let preparedMessage: IWorkerLifecycleQueueMessage | undefined;
    const publishError = new Error('ambiguous Kafka publish failure');
    const publish = jest
      .fn<Promise<void>, [IWorkerLifecycleQueueMessage]>()
      .mockRejectedValueOnce(publishError)
      .mockRejectedValueOnce(publishError)
      .mockRejectedValueOnce(publishError)
      .mockResolvedValueOnce(undefined);
    const workerLifecycleQueueService = {
      prepare: jest.fn(async (message: IWorkerLifecycleQueueMessage) => {
        preparedMessage = { ...message };
      }),
      publish,
      loadPrepared: jest.fn(async () =>
        preparedMessage ? [{ ...preparedMessage }] : []
      ),
      redrivePrepared: jest.fn(async () => {
        if (!preparedMessage) {
          return [];
        }
        const redriven = {
          ...preparedMessage,
          request_id: '019dfe2c-2c30-730d-88e9-63b839bb1b39',
          requested_at: new Date().toISOString(),
        };
        await publish(redriven);
        return [redriven];
      }),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(
      async (
        _accountId: string,
        update: Partial<IWorkerMonitor>,
        _expected: Partial<IWorkerMonitor>
      ) => {
        current = { ...current, ...update };
        return true;
      }
    );
    const workerService = {
      listLivenessLifecycleRedriveCandidates: jest.fn(async () => [current]),
      viewWorkerForMonitorConsistent: jest.fn(async () => current),
      updateWorkerByIdIfLifecycleMatches,
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const unhealthyContainer = {
      containerId,
      name: workerId,
      running: true,
      healthStatus: 'unhealthy',
      isWarmStandby: false,
      paused: false,
      workerId,
      accountId: current.account_id,
      serverId: current.server_id,
      workerTypeId: current.worker_type_id,
      runtimeGeneration: 7,
      startedAt: '2026-07-29T22:00:00Z',
      restartCount: 0,
    };

    await expect(
      (service as any).handleRecreate(
        current,
        makeServer(),
        'container_unhealthy',
        undefined,
        unhealthyContainer,
        operationId
      )
    ).rejects.toBe(publishError);

    expect(current).toEqual(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: operationId,
      })
    );
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(3);

    preparedMessage = {
      ...(preparedMessage as IWorkerLifecycleQueueMessage),
      requested_at: new Date(
        Date.now() - WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS - 1
      ).toISOString(),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    await service.runLiveness();
    randomSpy.mockRestore();

    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      workerId,
      operationId,
      preparedMessage.debug_trace_id
    );
    expect(publish).toHaveBeenCalledTimes(4);
    expect(publish.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        operation_id: operationId,
        worker_id: workerId,
        expected_container_id: containerId,
        expected_runtime_generation: 7,
      })
    );
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
  });

  it('drops a stale unhealthy observation when the same container restarted and recovered before the claim', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = 'b'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 11,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '11',
    });
    const before = `${containerId}|/${workerId}|true|unhealthy|2026-07-29T22:00:00Z|0|${labels}`;
    const after = `${containerId}|/${workerId}|true|healthy|2026-07-29T22:01:00Z|1|${labels}`;
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      sshService: {
        runCommands: jest
          .fn()
          .mockResolvedValueOnce([{ output: before }])
          .mockResolvedValueOnce([{ output: after }]),
      },
      redis,
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(redis.set).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
  });

  it('drops a runtime that recovers after Redis claim but before lifecycle CAS', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '7'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 12,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '12',
    });
    const unhealthy = `${containerId}|/${workerId}|true|unhealthy|2026-07-29T22:00:00Z|0|false|${labels}`;
    const recovered = `${containerId}|/${workerId}|true|healthy|2026-07-29T22:01:00Z|1|false|${labels}`;
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService: lifecycle,
      redis,
      sshService: {
        runCommands: jest
          .fn()
          .mockResolvedValueOnce([{ output: unhealthy }])
          .mockResolvedValueOnce([{ output: unhealthy }])
          .mockResolvedValueOnce([{ output: recovered }]),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('recovers a paused runtime even when Docker health is stale healthy', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '6'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 13,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '13',
    });
    const paused = `${containerId}|/${workerId}|true|healthy|2026-07-29T22:00:00Z|0|true|${labels}`;
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      },
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest.fn(async () => [{ output: paused }]),
      },
      redis: {
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async () => 1),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
      centrifugoService: {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(lifecycle.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_container_id: containerId,
        expected_container_health_status: 'healthy',
        expected_container_paused: true,
        expected_runtime_generation: 13,
      })
    );
  });

  it('ignores legacy containers that do not expose Docker health yet', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '8'.repeat(64);
    const observation = `${containerId}|/${workerId}|true|none|2026-07-29T22:00:00Z|0|{}`;
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(),
      updateWorkerByIdIfLifecycleMatches: jest.fn(),
    };
    const redis = {
      set: jest.fn(),
      eval: jest.fn(),
    };
    const lifecycle = {
      prepare: jest.fn(),
      publish: jest.fn(),
    };
    const sshService = {
      runCommands: jest.fn(async () => [{ output: observation }]),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService,
      redis,
      workerLifecycleQueueService: lifecycle,
      sshService,
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(sshService.runCommands).toHaveBeenCalledTimes(1);
    expect(workerService.viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('accepts a non-running disconnected runtime only with exact identity', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = 'c'.repeat(64);
    const baseContainer = {
      containerId,
      name: workerId,
      running: false,
      healthStatus: 'unhealthy',
      isWarmStandby: false,
      workerId,
      accountId: 'account-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.wwebjs,
      runtimeGeneration: 6,
      startedAt: '2026-07-29T22:00:00Z',
      restartCount: 0,
    };
    const context = {
      assertActive: jest.fn(),
      signal: new AbortController().signal,
    };
    const accountService = {
      viewPlanStatus: jest.fn(),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest
          .fn()
          .mockResolvedValueOnce(
            makeWorker({
              worker_id: workerId,
              worker_status_id: EWorkerStatus.online,
              container_id: containerId,
              runtime_container_id: containerId,
              runtime_generation: 7,
            })
          )
          .mockResolvedValueOnce(
            makeWorker({
              worker_id: workerId,
              worker_status_id: EWorkerStatus.disponible,
              container_id: containerId,
              runtime_container_id: containerId,
              runtime_generation: 6,
            })
          )
          .mockResolvedValueOnce(
            makeWorker({
              worker_id: workerId,
              worker_status_id: EWorkerStatus.blocked,
              container_id: containerId,
              runtime_container_id: containerId,
              runtime_generation: 6,
            })
          )
          .mockResolvedValueOnce(
            makeWorker({
              worker_id: workerId,
              worker_status_id: EWorkerStatus.online,
              container_id: containerId,
              runtime_container_id: containerId,
              runtime_generation: 6,
            })
          ),
      },
      accountService,
    });

    await expect(
      (service as any).validatePersistentlyUnhealthyContainer(
        baseContainer,
        makeServer(),
        context as never
      )
    ).resolves.toBeNull();
    await expect(
      (service as any).validatePersistentlyUnhealthyContainer(
        baseContainer,
        makeServer(),
        context as never
      )
    ).resolves.toMatchObject({
      worker: { worker_status_id: EWorkerStatus.disponible },
      container: { running: false },
    });
    await expect(
      (service as any).validatePersistentlyUnhealthyContainer(
        baseContainer,
        makeServer(),
        context as never
      )
    ).resolves.toBeNull();
    await expect(
      (service as any).validatePersistentlyUnhealthyContainer(
        { ...baseContainer, accountId: 'different-account' },
        makeServer(),
        context as never
      )
    ).resolves.toBeNull();

    expect(accountService.viewPlanStatus).toHaveBeenCalledTimes(1);
  });

  it('persists stopped before publishing a confirmed non-running runtime', async () => {
    const containerId = 'd'.repeat(64);
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 6,
    });
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const publishSub = jest.fn(async () => undefined);
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      centrifugoService: { publishSub },
      redis,
    });
    const observation = {
      containerId,
      name: worker.worker_id,
      running: false,
      healthStatus: 'unhealthy',
      isWarmStandby: false,
      workerId: worker.worker_id,
      accountId: worker.account_id,
      serverId: worker.server_id,
      workerTypeId: worker.worker_type_id,
      runtimeGeneration: worker.runtime_generation,
      startedAt: '2026-07-29T22:00:00Z',
      restartCount: 0,
      paused: false,
    } as const;
    (service as any).inspectExactContainers = jest.fn(async () => [
      observation,
    ]);
    const handleRecreate = jest.fn(async () => undefined);
    (service as any).handleRecreate = handleRecreate;

    await (service as any).requestPersistentlyUnhealthyRecreate(
      worker,
      observation,
      makeServer(),
      {
        assertActive: jest.fn(),
        signal: new AbortController().signal,
      }
    );

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      worker.account_id,
      {
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.stopped,
      },
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
      })
    );
    expect(publishSub).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_id: worker.worker_id,
        worker_status_id: EWorkerStatus.stopped,
      })
    );
    expect(handleRecreate).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('uses the Redis NX cooldown to prevent a liveness recreate storm', async () => {
    const containerId = 'd'.repeat(64);
    const worker = makeWorker({
      worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 3,
    });
    const redis = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      eval: jest.fn(async () => 1),
    };
    const service = makeService({
      redis,
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => ({
          ...worker,
          lifecycle_operation_id: 'different-operation',
        })),
      },
    });
    const handleRecreate = jest.fn(async () => undefined);
    (service as any).handleRecreate = handleRecreate;
    const containerObservation = {
      containerId,
      name: worker.worker_id,
      running: true,
      healthStatus: 'unhealthy',
      isWarmStandby: false,
      paused: false,
    };
    (service as any).inspectExactContainers = jest.fn(async () => [
      containerObservation,
    ]);
    const context = {
      assertActive: jest.fn(),
      signal: new AbortController().signal,
    };

    await (service as any).requestPersistentlyUnhealthyRecreate(
      worker,
      containerObservation,
      makeServer(),
      context as never
    );
    await (service as any).requestPersistentlyUnhealthyRecreate(
      worker,
      containerObservation,
      makeServer(),
      context as never
    );

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set.mock.calls[0]?.[0]).toBe(
      `underchat:worker:liveness-recreate:${worker.worker_id}:${containerId}`
    );
    expect(handleRecreate).toHaveBeenCalledTimes(1);
  });

  it('reclaims an old cooldown after terminal CAS when the handler crashed before compare-delete', async () => {
    const containerId = 'f'.repeat(64);
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 7,
    });
    const redis = {
      set: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('OK'),
      get: jest.fn(async () => 'old-operation-owner'),
      pttl: jest.fn(
        async () => 10 * 60_000 - WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS - 1
      ),
      eval: jest.fn(async () => 1),
    };
    const viewWorkerForMonitorConsistent = jest.fn(async () => worker);
    const service = makeService({
      redis,
      workerService: { viewWorkerForMonitorConsistent },
    });
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (service as any).tryClaimLivenessCooldown(
        worker.worker_id,
        containerId,
        context
      )
    ).resolves.toEqual(
      expect.objectContaining({
        key: `underchat:worker:liveness-recreate:${worker.worker_id}:${containerId}`,
        owner: expect.any(String),
      })
    );

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      1,
      `underchat:worker:liveness-recreate:${worker.worker_id}:${containerId}`,
      'old-operation-owner'
    );
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('never steals a fresh cooldown during the pre-CAS preparation window', async () => {
    const containerId = 'e'.repeat(64);
    const redis = {
      set: jest.fn(async () => null),
      get: jest.fn(async () => 'preparing-operation-owner'),
      pttl: jest.fn(
        async () => 10 * 60_000 - WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS + 1
      ),
      eval: jest.fn(),
    };
    const viewWorkerForMonitorConsistent = jest.fn();
    const service = makeService({
      redis,
      workerService: { viewWorkerForMonitorConsistent },
    });
    const context = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (service as any).tryClaimLivenessCooldown(
        'worker-1',
        containerId,
        context
      )
    ).resolves.toBeNull();

    expect(viewWorkerForMonitorConsistent).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      phase: 'restart policy fenced before remove',
      runtimeContainerId: 'a'.repeat(64),
      runtimeGeneration: 7,
      workerStatus: EWorkerStatus.recreating,
    },
    {
      phase: 'replacement upserted before final worker CAS',
      runtimeContainerId: 'b'.repeat(64),
      runtimeGeneration: 8,
      workerStatus: EWorkerStatus.recreating,
    },
  ])(
    'fast-redrives the exact durable liveness operation after crash: $phase',
    async ({ runtimeContainerId, runtimeGeneration, workerStatus }) => {
      const containerId = 'a'.repeat(64);
      const worker = makeWorker({
        worker_id: '019dfe2c-2c30-730d-88e9-63b839bb1b37',
        worker_status_id: workerStatus,
        lifecycle_operation_id: '019dfe2c-2c30-730d-88e9-63b839bb1b38',
        container_id: containerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
      });
      const message = makeLivenessLifecycleMessage(worker);
      const workerService = {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      };
      const workerLifecycleQueueService = {
        loadPrepared: jest.fn(async () => [message]),
        redrivePrepared: jest.fn(async () => [message]),
      };
      const workerLifecycleLockService = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService,
        workerLifecycleQueueService,
        workerLifecycleLockService,
        serverService: { listBalanceServers: jest.fn(async () => []) },
      });
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

      await service.runLiveness();

      randomSpy.mockRestore();
      expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
        worker.worker_id,
        worker.lifecycle_operation_id,
        message.debug_trace_id
      );
      expect(workerLifecycleLockService.tryClaimRedrive).toHaveBeenCalledWith(
        worker.worker_id,
        worker.lifecycle_operation_id,
        WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS
      );
    }
  );

  it('rechecks terminal ownership after a fast-scan claim and suppresses the original journal', async () => {
    const claimToken =
      'operation-fast-terminal-race:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.recreating,
      session_storage: EWorkerSessionStorage.postgres,
      runtime_session_volume_name: null,
      lifecycle_operation_id: 'operation-fast-terminal-race',
    });
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-fast-terminal-primary',
      operation_id: 'operation-fast-terminal-race',
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      previous_server_id: worker.server_id,
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      requested_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    };
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-fast-terminal-cleanup',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.wwebjs,
    };
    const viewTerminalProof = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeTerminalHandoffProof(worker));
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [cleanup, primary]),
      redrivePrepared: jest.fn(async () => [cleanup, primary]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        viewWhatsappProviderHandoffTerminalLifecycleProof: viewTerminalProof,
        failStaleWhatsappProviderHandoffTarget: jest.fn(async () => ({
          outcome: 'not_applicable',
        })),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLivenessLifecycle(worker, {
        assertActive: jest.fn(),
      })
    ).resolves.toBeUndefined();

    expect(viewTerminalProof).toHaveBeenCalledTimes(2);
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-fast-terminal-race',
      claimToken
    );
  });

  it.each([
    {
      state: 'the exact observed runtime',
      controlContainerId: 'a'.repeat(64),
      runtimeContainerId: 'a'.repeat(64),
      runtimeGeneration: 7,
      expected: true,
    },
    {
      state: 'a newer replacement candidate',
      controlContainerId: 'a'.repeat(64),
      runtimeContainerId: 'b'.repeat(64),
      runtimeGeneration: 8,
      expected: true,
    },
    {
      state: 'a missing runtime container',
      controlContainerId: 'a'.repeat(64),
      runtimeContainerId: null,
      runtimeGeneration: 8,
      expected: false,
    },
    {
      state: 'a mismatched control container',
      controlContainerId: 'c'.repeat(64),
      runtimeContainerId: 'b'.repeat(64),
      runtimeGeneration: 8,
      expected: false,
    },
    {
      state: 'a replacement at the same generation',
      controlContainerId: 'a'.repeat(64),
      runtimeContainerId: 'b'.repeat(64),
      runtimeGeneration: 7,
      expected: false,
    },
    {
      state: 'a replacement at an older generation',
      controlContainerId: 'a'.repeat(64),
      runtimeContainerId: 'b'.repeat(64),
      runtimeGeneration: 6,
      expected: false,
    },
  ])(
    'validates liveness journal identity for $state',
    ({
      controlContainerId,
      runtimeContainerId,
      runtimeGeneration,
      expected,
    }) => {
      const worker = makeWorker({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-liveness-identity',
        container_id: controlContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
      });
      const message = makeLivenessLifecycleMessage(worker, {
        operation_id: 'operation-liveness-identity',
        expected_container_id: 'a'.repeat(64),
        expected_runtime_generation: 7,
      });
      const service = makeService();

      expect(
        (service as any).isCompleteLivenessLifecycleMessage(message, worker)
      ).toBe(expected);
    }
  );

  it('keeps the fast liveness crash-recovery bound below ninety seconds', () => {
    expect(WORKER_LIVENESS_LIFECYCLE_RECOVERY_BOUND_MS).toBe(87_000);
    expect(WORKER_LIVENESS_LIFECYCLE_RECOVERY_BOUND_MS).toBeLessThan(90_000);
  });

  it('fast-redrives a regular prepared recreate once with the general lifecycle cooldown', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-regular',
      container_id: 'a'.repeat(64),
    });
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [
        {
          ...makeLivenessLifecycleMessage(worker),
          expected_container_id: undefined,
          expected_container_started_at: undefined,
          expected_container_restart_count: undefined,
          expected_container_health_status: undefined,
          expected_container_paused: undefined,
          expected_runtime_generation: undefined,
        },
      ]),
      redrivePrepared: jest.fn(async (message) => [message]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      worker.lifecycle_operation_id,
      undefined
    );
    expect(workerLifecycleLockService.tryClaimRedrive).toHaveBeenCalledWith(
      worker.worker_id,
      worker.lifecycle_operation_id,
      60_000
    );
  });

  it('releases a fast-redrive claim when the prepared journal disappears before publish', async () => {
    const claimToken =
      'operation-fast-noop:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-fast-noop',
      container_id: 'a'.repeat(64),
    });
    const prepared = makeLivenessLifecycleMessage(worker, {
      expected_container_id: undefined,
      expected_container_started_at: undefined,
      expected_container_restart_count: undefined,
      expected_container_health_status: undefined,
      expected_container_paused: undefined,
      expected_runtime_generation: undefined,
    });
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [prepared]),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLivenessLifecycle(worker, {
        assertActive: jest.fn(),
      })
    ).resolves.toBeUndefined();

    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-fast-noop',
      prepared.debug_trace_id,
      claimToken
    );
    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-fast-noop',
      claimToken
    );
  });

  it('releases only the current claim token when an outbound redrive publish fails', async () => {
    const claimToken =
      'operation-publish-failure:019fe267-40c7-767d-a866-7c83bcfd0350';
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-publish-failure',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const publishError = new Error('ambiguous Kafka publish failure');
    const workerLifecycleQueueService = {
      redrivePrepared: jest.fn(async () => {
        throw publishError;
      }),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => claimToken),
      releaseRedriveClaim: jest.fn(async () => true),
    };
    const service = makeService({
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
    });

    await expect(
      (service as any).redriveStalledLifecycleIfNeeded(worker, makeServer(), {
        assertActive: jest.fn(),
      })
    ).rejects.toBe(publishError);

    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-publish-failure',
      claimToken
    );
  });

  it('keeps a prepared journal inert when its database CAS did not commit', async () => {
    const snapshot = makeWorker({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-not-committed',
    });
    const current = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
    });
    const message = {
      ...makeLivenessLifecycleMessage(snapshot),
      expected_container_id: undefined,
      expected_container_started_at: undefined,
      expected_container_restart_count: undefined,
      expected_container_health_status: undefined,
      expected_container_paused: undefined,
      expected_runtime_generation: undefined,
    };
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [message]),
      redrivePrepared: jest.fn(),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([snapshot]),
        viewWorkerForMonitorConsistent: jest.fn(async () => current),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('fast-redrives an authoritative cleanup and primary as one validated set', async () => {
    const worker = makeWorker({
      server_id: 'server-new',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-move',
    });
    const requestedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-primary',
      operation_id: 'operation-move',
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: 'server-new',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
      remove_session: true,
      remove_volume: true,
      requested_at: requestedAt,
    };
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-cleanup',
      action: 'cleanup_previous_runtime',
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
    };
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [cleanup, primary]),
      redrivePrepared: jest.fn(async () => [cleanup, primary]),
    };
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-move',
      undefined
    );
  });

  it('fast-redrives a fenced PostgreSQL provider handoff before the target provider is promoted', async () => {
    const worker = makeWorker({
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: 'operation-provider-handoff',
    });
    const requestedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-provider-handoff-primary',
      operation_id: 'operation-provider-handoff',
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      previous_server_id: worker.server_id,
      previous_worker_type_id: EWorkerType.baileys,
      cleanup_previous_runtime_required: true,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      requested_at: requestedAt,
    };
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-provider-handoff-cleanup',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.baileys,
    };
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [cleanup, primary]),
      redrivePrepared: jest.fn(async () => [cleanup, primary]),
    };
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn(
          async () => null
        ),
        failStaleWhatsappProviderHandoffTarget: jest.fn(async () => ({
          outcome: 'not_applicable',
          handoff_id: 'handoff-live-target',
          recovery_operation_id: null,
          recovery_state: 'none',
          error_code: null,
        })),
      },
      workerLifecycleQueueService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      'operation-provider-handoff',
      undefined
    );
  });

  it.each([
    'pending',
    'dispatching',
    'running',
    'blocked',
    'cancelled',
    'completed',
  ] as const)(
    'keeps a terminal handoff journal inert in the fast scan when recovery is %s',
    async (recoveryState) => {
      const worker = makeWorker({
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        session_storage: EWorkerSessionStorage.postgres,
        runtime_session_volume_name: null,
        lifecycle_operation_id: 'operation-stale-provider-handoff',
      });
      const requestedAt = new Date(Date.now() - 2 * 60_000).toISOString();
      const primary: IWorkerLifecycleQueueMessage = {
        request_id: 'request-stale-provider-primary',
        operation_id: 'operation-stale-provider-handoff',
        action: 'recreate',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        previous_server_id: worker.server_id,
        previous_worker_type_id: EWorkerType.wwebjs,
        cleanup_previous_runtime_required: true,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        requested_at: requestedAt,
      };
      const cleanup: IWorkerLifecycleQueueMessage = {
        ...primary,
        request_id: 'request-stale-provider-cleanup',
        action: 'cleanup_previous_runtime',
        worker_type_id: EWorkerType.wwebjs,
      };
      const viewTerminalProof = jest.fn(async () =>
        makeTerminalHandoffProof(worker, { recovery_state: recoveryState })
      );
      const failStaleWhatsappProviderHandoffTarget = jest.fn();
      const workerLifecycleQueueService = {
        loadPrepared: jest.fn(async () => [cleanup, primary]),
        redrivePrepared: jest.fn(async () => [cleanup, primary]),
      };
      const workerLifecycleLockService = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
      };
      const service = makeService({
        workerService: {
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
          viewWhatsappProviderHandoffTerminalLifecycleProof: viewTerminalProof,
          failStaleWhatsappProviderHandoffTarget,
        },
        workerLifecycleQueueService,
        workerLifecycleLockService,
      });

      await expect(
        (service as any).redriveStalledLivenessLifecycle(worker, {
          assertActive: jest.fn(),
        })
      ).resolves.toBeUndefined();

      expect(viewTerminalProof).toHaveBeenCalledTimes(1);
      expect(failStaleWhatsappProviderHandoffTarget).not.toHaveBeenCalled();
      expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
      expect(
        workerLifecycleQueueService.redrivePrepared
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      state: 'the exact source cleanup is missing',
      mutate: (primary: IWorkerLifecycleQueueMessage) => [primary],
    },
    {
      state: 'the handoff can remove the PostgreSQL session',
      mutate: (
        primary: IWorkerLifecycleQueueMessage,
        cleanup: IWorkerLifecycleQueueMessage
      ) => [
        { ...cleanup, remove_session: true },
        { ...primary, remove_session: true },
      ],
    },
    {
      state: 'the previous provider does not match the authoritative worker',
      mutate: (
        primary: IWorkerLifecycleQueueMessage,
        cleanup: IWorkerLifecycleQueueMessage
      ) => [
        {
          ...cleanup,
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: EWorkerType.wwebjs,
        },
        { ...primary, previous_worker_type_id: EWorkerType.wwebjs },
      ],
    },
  ])(
    'does not fast-redrive a provider handoff when $state',
    async ({ mutate }) => {
      const worker = makeWorker({
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        session_storage: EWorkerSessionStorage.postgres,
        lifecycle_operation_id: 'operation-provider-handoff-invalid',
      });
      const primary: IWorkerLifecycleQueueMessage = {
        request_id: 'request-provider-handoff-invalid-primary',
        operation_id: 'operation-provider-handoff-invalid',
        action: 'recreate',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        previous_server_id: worker.server_id,
        previous_worker_type_id: EWorkerType.baileys,
        cleanup_previous_runtime_required: true,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        requested_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      };
      const cleanup: IWorkerLifecycleQueueMessage = {
        ...primary,
        request_id: 'request-provider-handoff-invalid-cleanup',
        action: 'cleanup_previous_runtime',
        worker_type_id: EWorkerType.baileys,
      };
      const workerLifecycleQueueService = {
        loadPrepared: jest.fn(async () => mutate(primary, cleanup)),
        redrivePrepared: jest.fn(),
      };
      const service = makeService({
        workerService: {
          listLivenessLifecycleRedriveCandidates: jest
            .fn()
            .mockResolvedValueOnce([worker]),
          viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        },
        workerLifecycleQueueService,
        serverService: { listBalanceServers: jest.fn(async () => []) },
      });
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

      await service.runLiveness();

      randomSpy.mockRestore();
      expect(
        workerLifecycleQueueService.redrivePrepared
      ).not.toHaveBeenCalled();
    }
  );

  it('fast-redrives a blocked plan-limit cleanup and never clears it first', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.blocked,
      lifecycle_operation_id: 'operation-plan-cleanup',
    });
    const cleanup: IWorkerLifecycleQueueMessage = {
      request_id: 'request-plan-cleanup',
      operation_id: 'operation-plan-cleanup',
      action: 'cleanup_previous_runtime',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.blocked,
      source: 'plan_limit_enforcement',
      previous_server_id: worker.server_id,
      previous_worker_type_id: worker.worker_type_id,
      remove_session: false,
      remove_volume: false,
      requested_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    };
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [cleanup]),
      redrivePrepared: jest.fn(async () => [cleanup]),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn();
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches,
      },
      workerLifecycleQueueService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
  });

  it('fast-redrives a normal primary after online notification won the finalization race', async () => {
    const worker = makeWorker({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-online-before-final-cas',
    });
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-online',
      operation_id: 'operation-online-before-final-cas',
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      source: 'self_heal',
      requested_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    };
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async () => [primary]),
      redrivePrepared: jest.fn(async () => [primary]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: jest
          .fn()
          .mockResolvedValueOnce([worker]),
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      },
      workerLifecycleQueueService,
      workerLifecycleLockService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      worker.worker_id,
      worker.lifecycle_operation_id,
      undefined
    );
    expect(workerLifecycleLockService.tryClaimRedrive).toHaveBeenCalledWith(
      worker.worker_id,
      worker.lifecycle_operation_id,
      60_000
    );
  });

  it('scans beyond one hundred ineligible lifecycle rows without starving a later liveness recovery', async () => {
    const containerId = 'a'.repeat(64);
    const candidates = Array.from({ length: 101 }, (_, index) =>
      makeWorker({
        worker_id: `00000000-0000-7000-8000-${String(index + 1).padStart(
          12,
          '0'
        )}`,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: `operation-${index + 1}`,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
      })
    );
    const oldMessage = makeLivenessLifecycleMessage(candidates[100]);
    const recent = new Date().toISOString();
    const workerLifecycleQueueService = {
      loadPrepared: jest.fn(async (workerId: string) => {
        const candidate = candidates.find(
          (item) => item.worker_id === workerId
        );
        return candidate
          ? [
              makeLivenessLifecycleMessage(candidate, {
                requested_at:
                  candidate === candidates[100]
                    ? oldMessage.requested_at
                    : recent,
              }),
            ]
          : [];
      }),
      redrivePrepared: jest.fn(async () => [oldMessage]),
    };
    const listCandidates = jest
      .fn()
      .mockResolvedValueOnce(candidates.slice(0, 100))
      .mockResolvedValueOnce(candidates.slice(100));
    const service = makeService({
      workerService: {
        listLivenessLifecycleRedriveCandidates: listCandidates,
        viewWorkerForMonitorConsistent: jest.fn(async () => candidates[100]),
      },
      workerLifecycleQueueService,
      serverService: { listBalanceServers: jest.fn(async () => []) },
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();

    randomSpy.mockRestore();
    expect(listCandidates).toHaveBeenNthCalledWith(1, 100, undefined);
    expect(listCandidates).toHaveBeenNthCalledWith(
      2,
      100,
      candidates[99].worker_id
    );
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledTimes(
      1
    );
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      candidates[100].worker_id,
      candidates[100].lifecycle_operation_id,
      oldMessage.debug_trace_id
    );
  });

  it('observes a persistent starting crash loop but ignores a normal cold boot', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '9'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 7,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '7',
    });
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const normalBootStartedAt = new Date(Date.now() - 5_000).toISOString();
    const normalBoot = `${containerId}|/${workerId}|true|starting|${normalBootStartedAt}|0|false|${createdAt}|${labels}`;
    const crashLoop = (restartCount: number, ageMs: number) =>
      `${containerId}|/${workerId}|true|starting|${new Date(
        Date.now() - ageMs
      ).toISOString()}|${restartCount}|false|${createdAt}|${labels}`;
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => worker),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService,
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest
          .fn()
          .mockResolvedValueOnce([{ output: normalBoot }])
          .mockResolvedValueOnce([{ output: crashLoop(4, 5_000) }])
          .mockResolvedValueOnce([{ output: crashLoop(5, 2_000) }])
          .mockResolvedValueOnce([{ output: crashLoop(6, 500) }]),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
      centrifugoService: {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();
    expect(lifecycle.publish).not.toHaveBeenCalled();
    await service.runLiveness();

    randomSpy.mockRestore();
    expect(lifecycle.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_container_id: containerId,
        expected_container_health_status: 'starting',
        expected_container_restart_count: 6,
        expected_container_paused: false,
      })
    );
    const firstScanCommand = String(
      (
        ((service as any).sshService.runCommands as jest.Mock).mock
          .calls[0]?.[2] as string[]
      )[0]
    );
    expect(firstScanCommand).toContain('--filter health=starting');
  });

  it('never treats a stable historical restart count as a starting crash loop', async () => {
    const workerId = '019dfe2c-2c30-730d-88e9-63b839bb1b37';
    const containerId = '8'.repeat(64);
    const worker = makeWorker({
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 7,
    });
    const labels = JSON.stringify({
      'underchat.worker_id': workerId,
      'underchat.account_id': worker.account_id,
      'underchat.server_id': worker.server_id,
      'underchat.worker_type_id': worker.worker_type_id,
      'underchat.runtime_generation': '7',
    });
    const createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const stableStarting = `${containerId}|/${workerId}|true|starting|${startedAt}|4|false|${createdAt}|${labels}`;
    const lifecycle = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const service = makeService({
      serverService: {
        listBalanceServers: jest.fn(async () => [makeServer()]),
      },
      workerService: {
        viewWorkerForMonitorConsistent: jest.fn(async () => worker),
        updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
      },
      workerLifecycleQueueService: lifecycle,
      sshService: {
        runCommands: jest.fn(async () => [{ output: stableStarting }]),
      },
      accountService: {
        viewPlanStatus: jest.fn(async () => ({
          account_status_id: EAccountStatus.active,
          next_payment_date: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
          cancellation_date: null,
        })),
      },
    });
    (service as any).passwordEncryptorService = {
      decrypt: jest.fn((value: string) => value),
    };
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.runLiveness();
    await service.runLiveness();

    randomSpy.mockRestore();
    expect(lifecycle.prepare).not.toHaveBeenCalled();
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('bounds both external HTTP probes with curl and process deadlines', async () => {
    const sshService = {
      runCommands: jest
        .fn()
        .mockResolvedValueOnce([{ output: '200' }])
        .mockResolvedValueOnce([
          {
            output: '{"session_ready":false}__HTTP_STATUS__503',
          },
        ]),
    };
    const service = makeService({ sshService });

    await (service as any).checkFastify('worker-1', 'server-1', {} as never);
    await (service as any).checkConnection(
      makeWorker(),
      'server-1',
      {} as never
    );

    const commands = sshService.runCommands.mock.calls.map(
      (call) => (call[2] as string[])[0]
    );
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(command).toContain('timeout --signal=KILL 8s');
      expect(command).toContain('--connect-timeout 2');
      expect(command).toContain('--max-time 5');
    }
  });
});
