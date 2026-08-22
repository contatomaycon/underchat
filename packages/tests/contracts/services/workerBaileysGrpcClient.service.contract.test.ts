import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { status } from '@grpc/grpc-js';

jest.mock('@core/config/environments', () => ({
  balanceEnvironment: {
    workerBaileysGrpcPort: 50051,
    workerWwebjsGrpcPort: 50053,
    workerWhatsmeowGrpcPort: 50055,
  },
}));

import {
  isWorkerConnectionDeadlineExceeded,
  WorkerBaileysGrpcClientService,
} from '@core/services/workerBaileysGrpcClient.service';

describe('WorkerBaileysGrpcClientService', () => {
  it('keeps a dedicated whatsmeow gRPC port route', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );

    expect(source).toContain('workerType === EWorkerType.whatsmeow');
    expect(source).toContain('balanceEnvironment.workerWhatsmeowGrpcPort');
  });

  it('does not manufacture provider handoff identity or empty checkpoint proof from the request', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );
    const method = source.match(
      /private async prepareProviderHandoffByAddress[\s\S]*?\n  private async callWithFallback/
    )?.[0];

    expect(method).toBeDefined();
    expect(method).toContain("response.worker_id ?? ''");
    expect(method).toContain("response.handoff_id ?? ''");
    expect(method).toContain("response.source_revision_id ?? ''");
    expect(method).toContain("response.checkpoint_size_bytes ?? ''");
    expect(method).toContain("response.checkpoint_record_count ?? ''");
    expect(method).not.toContain('?? payload.');
    expect(method).not.toContain("checkpoint_size_bytes ?? '0'");
    expect(method).not.toContain("checkpoint_record_count ?? '0'");
  });

  it('gives worker connection startup a 45 second default deadline', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );
    const wwebjsConnectionSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/wwebjs/methods/connection.service.ts'
      ),
      'utf8'
    );

    expect(source).toContain('WORKER_REQUEST_CONNECTION_GRPC_DEADLINE_MS');
    expect(source).toContain(
      'Number(process.env.WORKER_REQUEST_CONNECTION_GRPC_DEADLINE_MS) || 45_000'
    );
    expect(source).toContain(
      'Date.now() + REQUEST_CONNECTION_GRPC_DEADLINE_MS'
    );
    expect(source).toContain(
      '(client as any).RequestConnection(\n' +
        '        protoPayload,\n' +
        '        metadata,\n' +
        '        { deadline },'
    );
    expect(wwebjsConnectionSource).toContain(
      'const CONNECTION_ATTEMPT_GUARD_TIMEOUT_GRACE_MS = 5_000;'
    );
    expect(wwebjsConnectionSource).toContain(
      "'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',\n  25_000,"
    );
  });

  it('preserves qr_pending in the worker connection proto payload', () => {
    const service = new WorkerBaileysGrpcClientService();
    const buildConnectionProtoPayload = (
      service as unknown as {
        buildConnectionProtoPayload: (payload: {
          worker_id: string;
          status: string;
          type: string;
          qr_pending?: boolean;
        }) => Record<string, unknown>;
      }
    ).buildConnectionProtoPayload.bind(service);

    expect(
      buildConnectionProtoPayload({
        worker_id: 'worker-1',
        status: 'online',
        type: 'qrcode',
        qr_pending: true,
      })
    ).toEqual(
      expect.objectContaining({
        worker_id: 'worker-1',
        qr_pending: true,
      })
    );
    expect(
      buildConnectionProtoPayload({
        worker_id: 'worker-1',
        status: 'online',
        type: 'qrcode',
      })
    ).not.toHaveProperty('qr_pending');
  });

  it('preserves the attempt-bound authorized epoch in the worker connection proto payload', () => {
    const service = new WorkerBaileysGrpcClientService();
    const buildConnectionProtoPayload = (
      service as unknown as {
        buildConnectionProtoPayload: (payload: {
          worker_id: string;
          status: string;
          type: string;
          connection_attempt_id?: string;
          authorized_connection_epoch?: string;
        }) => Record<string, unknown>;
      }
    ).buildConnectionProtoPayload.bind(service);
    const connectionAttemptId = '22222222-2222-4222-8222-222222222222';
    const authorizedConnectionEpoch = '11111111-1111-4111-8111-111111111111';

    expect(
      buildConnectionProtoPayload({
        worker_id: 'worker-1',
        status: 'online',
        type: 'qrcode',
        connection_attempt_id: connectionAttemptId,
        authorized_connection_epoch: authorizedConnectionEpoch,
      })
    ).toEqual(
      expect.objectContaining({
        connection_attempt_id: connectionAttemptId,
        authorized_connection_epoch: authorizedConnectionEpoch,
      })
    );
  });

  it('omits protobuf runtime generation zero while preserving positive generations', () => {
    const service = new WorkerBaileysGrpcClientService();
    const buildConnectionProtoPayload = (
      service as unknown as {
        buildConnectionProtoPayload: (payload: {
          worker_id: string;
          status: string;
          type: string;
          runtime_generation?: number;
        }) => Record<string, unknown>;
      }
    ).buildConnectionProtoPayload.bind(service);

    const basePayload = {
      worker_id: 'worker-1',
      status: 'online',
      type: 'qrcode',
    };

    expect(
      buildConnectionProtoPayload({
        ...basePayload,
        runtime_generation: 0,
      })
    ).not.toHaveProperty('runtime_generation');
    expect(
      buildConnectionProtoPayload({
        ...basePayload,
        runtime_generation: 7,
      })
    ).toEqual(expect.objectContaining({ runtime_generation: 7 }));
  });

  it('classifies DEADLINE_EXCEEDED without treating other gRPC errors as a deadline', () => {
    expect(
      isWorkerConnectionDeadlineExceeded({
        code: status.DEADLINE_EXCEEDED,
      })
    ).toBe(true);
    expect(
      isWorkerConnectionDeadlineExceeded({ code: status.UNAVAILABLE })
    ).toBe(false);
  });

  it('declares and receives qr_pending as compatible field 12', () => {
    const protoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_connection.proto'),
      'utf8'
    );
    const serverSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/plugins/proto/workerConnectionGrpcServer.ts'
      ),
      'utf8'
    );
    const requestMessage = protoSource.match(
      /message StatusConnectionRequest \{([\s\S]*?)\n\}/
    )?.[1];

    expect(requestMessage).toContain('reserved 7, 8;');
    expect(requestMessage).toContain('bool qr_pending = 12;');
    expect(serverSource).toContain('if (req.qr_pending === true)');
    expect(serverSource).toContain('payload.qr_pending = true;');
  });

  it('declares the authorized connection epoch on connection and secure-import requests', () => {
    const protoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_connection.proto'),
      'utf8'
    );
    const commandProtoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_command.proto'),
      'utf8'
    );
    const workerClientSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/workerBaileysGrpcClient.service.ts'
      ),
      'utf8'
    );
    const commandClientSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );
    const workerServerSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/plugins/proto/workerConnectionGrpcServer.ts'
      ),
      'utf8'
    );
    const commandServerSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const requestMessage = protoSource.match(
      /message StatusConnectionRequest \{([\s\S]*?)\n\}/
    )?.[1];
    const responseMessage = protoSource.match(
      /message WorkerConnectionResponse \{([\s\S]*?)\n\}/
    )?.[1];
    const workerSecureImportMessage = protoSource.match(
      /message SecureSessionImportRequest \{([\s\S]*?)\n\}/
    )?.[1];
    const commandSecureImportMessage = commandProtoSource.match(
      /message SecureSessionImportRequest \{([\s\S]*?)\n\}/
    )?.[1];

    expect(requestMessage).toContain(
      'optional string authorized_connection_epoch = 13;'
    );
    expect(responseMessage).toContain(
      'optional string authorized_connection_epoch = 46;'
    );
    expect(workerSecureImportMessage).toContain(
      'optional string authorized_connection_epoch = 13;'
    );
    expect(commandSecureImportMessage).toContain(
      'optional string authorized_connection_epoch = 13;'
    );
    for (const source of [
      workerClientSource,
      commandClientSource,
      workerServerSource,
      commandServerSource,
    ]) {
      expect(source).toContain('authorized_connection_epoch');
    }
  });

  it('retires the legacy scoped NATS credential field 13', () => {
    const protoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_connection.proto'),
      'utf8'
    );
    const activationMessage = protoSource.match(
      /message WorkerRuntimeActivationRequest \{([\s\S]*?)\n\}/
    )?.[1];
    expect(activationMessage).toContain('reserved 8, 13;');
    expect(activationMessage).not.toContain('nats_creds_base64');
  });

  it('exposes Kafka consumer readiness and authorization as compatible runtime-health fields', () => {
    const connectionProtoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_connection.proto'),
      'utf8'
    );
    const commandProtoSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/proto/worker_command.proto'),
      'utf8'
    );
    const serverSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/plugins/proto/workerConnectionGrpcServer.ts'
      ),
      'utf8'
    );
    const connectionHealthMessage = connectionProtoSource.match(
      /message WorkerRuntimeHealthResponse \{([\s\S]*?)\n\}/
    )?.[1];
    const commandHealthMessage = commandProtoSource.match(
      /message WorkerRuntimeHealthResponse \{([\s\S]*?)\n\}/
    )?.[1];

    expect(connectionHealthMessage).toContain(
      'bool kafka_consumers_ready = 24;'
    );
    expect(commandHealthMessage).toContain('bool kafka_consumers_ready = 24;');
    expect(connectionHealthMessage).toContain(
      'bool kafka_consumers_authorized = 25;'
    );
    expect(commandHealthMessage).toContain(
      'bool kafka_consumers_authorized = 25;'
    );
    expect(connectionHealthMessage).toContain(
      'uint32 runtime_health_schema_version = 26;'
    );
    expect(commandHealthMessage).toContain(
      'uint32 runtime_health_schema_version = 26;'
    );
    expect(serverSource).toContain(
      'kafka_consumers_ready: kafkaHealth.kafkaConsumersReady'
    );
    expect(serverSource).toContain(
      'kafka_consumers_authorized: kafkaConsumersAuthorized'
    );
    expect(serverSource).toContain('kafka_consumers_ready: false');
    expect(serverSource).toContain('kafka_consumers_authorized: false');
    expect(serverSource).toContain('runtime_health_schema_version: 4');
  });

  it('reports durable provider session presence independently from live authentication', () => {
    const serverSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/plugins/proto/workerConnectionGrpcServer.ts'
      ),
      'utf8'
    );

    expect(serverSource).toContain(
      'const hasDurableSession = phoneValidationService.hasSession()'
    );
    expect(serverSource).toContain('has_session: hasDurableSession');
    expect(serverSource).toContain(
      'authenticated: readiness.authenticated === true'
    );
    expect(serverSource).not.toContain(
      'has_session: readiness.authenticated === true'
    );
  });
});
