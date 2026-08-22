import 'reflect-metadata';
import { RetentionPolicy, type JetStreamManager } from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import type { NatsConnection } from '@nats-io/transport-node';
import { container } from 'tsyringe';
import {
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_SUBJECT_WILDCARD,
} from '@core/common/constants/workerCommandTransport';
import { workerCommandDurableName } from '@core/services/workerCommandJetStreamIngress.service';
import {
  WorkerCommandJetStreamControlPlaneService,
  workerCommandControlPlaneOptionsFromEnvironment,
} from '@core/services/workerCommandJetStreamControlPlane.service';

function buildSubject(workerId: string): string {
  return `uc.worker.command.${workerId}`;
}

function buildHarness(overrides: { denyPurge?: boolean } = {}) {
  const connection = {
    isClosed: jest.fn(() => false),
    closed: jest.fn(() => new Promise(() => undefined)),
    drain: jest.fn(async () => undefined),
  } as unknown as NatsConnection;
  const deleteConsumer = jest.fn(async () => true);
  const manager = {
    streams: {
      info: jest.fn(async () => ({
        config: {
          retention: RetentionPolicy.Workqueue,
          max_age: nanos(WORKER_COMMAND_MAX_AGE_MS),
          deny_purge: overrides.denyPurge ?? true,
          subjects: [WORKER_COMMAND_SUBJECT_WILDCARD],
        },
      })),
    },
    consumers: { delete: deleteConsumer },
  } as unknown as JetStreamManager;
  const service = new WorkerCommandJetStreamControlPlaneService({
    connect: jest.fn(async () => connection),
    manager: jest.fn(async () => manager),
  } as never);
  return { service, manager, deleteConsumer };
}

describe('WorkerCommandJetStreamControlPlaneService contract', () => {
  it('resolves through tsyringe without requiring a test dependency object', () => {
    const scope = container.createChildContainer();

    expect(() =>
      scope.resolve(WorkerCommandJetStreamControlPlaneService)
    ).not.toThrow();
  });

  it('deletes only the provider-neutral durable and relies on the hard 5m stream expiry', async () => {
    const { service, manager, deleteConsumer } = buildHarness();

    await expect(service.deleteWorkerResources('worker-1')).resolves.toEqual({
      durable_name: workerCommandDurableName('worker-1'),
      durable_deleted: true,
      subject: buildSubject('worker-1'),
      backlog_disposition: 'expires_by_stream_max_age',
      backlog_max_age_ms: 300_000,
      purge_performed: false,
    });
    expect(manager.streams.info).toHaveBeenCalledWith(WORKER_COMMAND_STREAM);
    expect(deleteConsumer).toHaveBeenCalledWith(
      WORKER_COMMAND_STREAM,
      workerCommandDurableName('worker-1')
    );
    expect((manager.streams as unknown as { purge?: jest.Mock }).purge).toBe(
      undefined
    );
  });

  it('is idempotent when the durable consumer is already absent', async () => {
    const { service, deleteConsumer } = buildHarness();
    deleteConsumer.mockRejectedValueOnce(
      Object.assign(new Error('consumer not found'), {
        name: 'ConsumerNotFoundError',
      })
    );

    await expect(
      service.deleteWorkerResources('worker-1')
    ).resolves.toMatchObject({
      durable_deleted: false,
      purge_performed: false,
    });
  });

  it('fails closed if MaxAge or deny_purge drift from the expiration safety contract', async () => {
    const { service, deleteConsumer } = buildHarness({ denyPurge: false });

    await expect(service.deleteWorkerResources('worker-1')).rejects.toThrow(
      'worker_command_stream_expiration_contract_drift'
    );
    expect(deleteConsumer).not.toHaveBeenCalled();
  });

  it('uses the process-routable endpoints and admin identity only on the control plane', () => {
    expect(
      workerCommandControlPlaneOptionsFromEnvironment({
        NATS_URL: 'nats://public:4222',
        NATS_PRIVATE_URL: 'nats://private-1:4222,nats://private-2:4222',
        NATS_USER: 'runtime',
        NATS_PASSWORD: 'runtime-secret',
        NATS_ADMIN_USER: 'admin',
        NATS_ADMIN_PASSWORD: 'admin-secret',
      })
    ).toMatchObject({
      servers: ['nats://public:4222'],
      user: 'admin',
      password: 'admin-secret',
      connectionName: 'underchat-worker-command-finalizer',
    });
  });

  it('never falls back to the runtime identity when admin credentials are absent or partial', () => {
    const runtimeOnly = {
      NATS_URL: 'tls://nats:4222',
      NATS_USER: 'runtime',
      NATS_PASSWORD: 'runtime-secret',
    };

    expect(() =>
      workerCommandControlPlaneOptionsFromEnvironment(runtimeOnly)
    ).toThrow('NATS_ADMIN_USER e NATS_ADMIN_PASSWORD sao obrigatorias');
    expect(() =>
      workerCommandControlPlaneOptionsFromEnvironment({
        ...runtimeOnly,
        NATS_ADMIN_USER: 'admin',
      })
    ).toThrow('NATS_ADMIN_USER e NATS_ADMIN_PASSWORD sao obrigatorias');
  });
});
