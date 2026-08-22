import fs from 'node:fs';
import path from 'node:path';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  protoToWorkerPayload,
  workerPayloadToProto,
} from '@core/common/functions/workerCommandProtoMapper';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';

describe('workerCommandProtoMapper', () => {
  it('declares compatible source storage and server fields after session_storage', () => {
    const protoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_command.proto'),
      'utf8'
    );
    const workerPayload = protoSource.match(
      /message WorkerPayload \{([\s\S]*?)\n\}/
    )?.[1];

    expect(workerPayload).toContain('string session_storage = 22;');
    expect(workerPayload).toContain('string previous_session_storage = 23;');
    expect(workerPayload).toContain('string previous_server_id = 24;');
  });

  it('preserves lifecycle operation ids in worker payload roundtrips', () => {
    const proto = workerPayloadToProto({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      previous_server_id: 'server-source',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.whatsmeow,
      lifecycle_operation_id: 'operation-1',
      recovery_without_journal: true,
      expected_container_id: 'a'.repeat(64),
      expected_container_started_at: '2026-07-29T22:00:00Z',
      expected_container_restart_count: 0,
      expected_container_health_status: 'unhealthy',
      expected_container_paused: false,
      expected_runtime_generation: 7,
      lifecycle_semantic_fingerprint: 'fingerprint-1',
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
    });

    expect(proto.lifecycle_operation_id).toBe('operation-1');
    expect(proto.lifecycle_semantic_fingerprint).toBe('fingerprint-1');
    expect(proto.previous_worker_type_id).toBe(EWorkerType.whatsmeow);
    expect(proto.previous_server_id).toBe('server-source');
    expect(proto.session_storage).toBe(EWorkerSessionStorage.postgres);
    expect(proto.previous_session_storage).toBe(
      EWorkerSessionStorage.legacy_volume
    );
    expect(proto.recovery_without_journal).toBe(true);
    expect(protoToWorkerPayload(proto)).toEqual(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        previous_server_id: 'server-source',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.whatsmeow,
        lifecycle_operation_id: 'operation-1',
        recovery_without_journal: true,
        expected_container_id: 'a'.repeat(64),
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
        lifecycle_semantic_fingerprint: 'fingerprint-1',
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
      })
    );
  });

  it('preserves both backends through the real protobuf descriptor and treats its empty default as absent', () => {
    const packageDefinition = loadSync(
      path.join(process.cwd(), 'packages/proto/worker_command.proto'),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      }
    );
    const grpcPackage = loadPackageDefinition(packageDefinition) as unknown as {
      worker_command: {
        WorkerCommand: {
          service: {
            CreateWorker: {
              requestSerialize(value: Record<string, unknown>): Buffer;
              requestDeserialize(value: Buffer): Record<string, unknown>;
            };
          };
        };
      };
    };
    const createWorker =
      grpcPackage.worker_command.WorkerCommand.service.CreateWorker;
    const throughDescriptor = (sessionStorage?: EWorkerSessionStorage) =>
      createWorker.requestDeserialize(
        createWorker.requestSerialize({
          action: EWorkerAction.create,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          ...(sessionStorage ? { session_storage: sessionStorage } : {}),
        })
      );

    expect(
      protoToWorkerPayload(
        throughDescriptor(EWorkerSessionStorage.postgres) as never
      ).session_storage
    ).toBe(EWorkerSessionStorage.postgres);
    expect(
      protoToWorkerPayload(
        throughDescriptor(EWorkerSessionStorage.legacy_volume) as never
      ).session_storage
    ).toBe(EWorkerSessionStorage.legacy_volume);

    const omitted = throughDescriptor();
    expect(omitted.session_storage).toBe('');
    expect(protoToWorkerPayload(omitted as never)).not.toHaveProperty(
      'session_storage'
    );
  });

  it('preserves explicit false lifecycle flags through the real protobuf descriptor', () => {
    const packageDefinition = loadSync(
      path.join(process.cwd(), 'packages/proto/worker_command.proto'),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      }
    );
    const grpcPackage = loadPackageDefinition(packageDefinition) as unknown as {
      worker_command: {
        WorkerCommand: {
          service: {
            CleanupWorker: {
              requestSerialize(value: Record<string, unknown>): Buffer;
              requestDeserialize(value: Buffer): IWorkerPayloadProto;
            };
          };
        };
      };
    };
    const cleanupWorker =
      grpcPackage.worker_command.WorkerCommand.service.CleanupWorker;
    const decoded = cleanupWorker.requestDeserialize(
      cleanupWorker.requestSerialize(
        workerPayloadToProto({
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          server_id: 'server-old',
          account_id: 'account-1',
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        }) as Record<string, unknown>
      )
    );

    expect(decoded._remove_session).toBe('remove_session');
    expect(decoded._remove_volume).toBe('remove_volume');
    expect(protoToWorkerPayload(decoded)).toEqual(
      expect.objectContaining({
        remove_session: false,
        remove_volume: false,
      })
    );

    const omitted = cleanupWorker.requestDeserialize(
      cleanupWorker.requestSerialize({
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
      })
    );
    expect(omitted._remove_session).toBeUndefined();
    expect(omitted._remove_volume).toBeUndefined();
    expect(protoToWorkerPayload(omitted)).not.toHaveProperty('remove_session');
    expect(protoToWorkerPayload(omitted)).not.toHaveProperty('remove_volume');
  });

  it('rejects an unknown session backend received over protobuf', () => {
    expect(() =>
      protoToWorkerPayload({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        session_storage: 'filesystem',
      })
    ).toThrow('Invalid session_storage');

    expect(() =>
      protoToWorkerPayload({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        previous_session_storage: 'filesystem',
      })
    ).toThrow('Invalid previous_session_storage');
  });
});
