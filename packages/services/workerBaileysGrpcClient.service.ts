import { injectable } from 'tsyringe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  Metadata,
  ServiceError,
  status,
} from '@grpc/grpc-js';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { balanceEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { protoToConnectionState } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  buildConnectionLifecycleContext,
  injectGrpcConnectionMetadata,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import {
  recordConnectionQrSummary,
  summarizeConnectionQrState,
} from '@core/plugins/telemetry/connectionQrSummary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protoPath = path.join(
  __dirname,
  '..',
  'proto',
  'worker_connection.proto'
);
const packageDefinition = loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = loadPackageDefinition(packageDefinition);
const WorkerConnectionClient = (protoDescriptor as any).worker_connection
  ?.WorkerConnection;

if (!WorkerConnectionClient) {
  throw new Error('WorkerConnection client not found in proto');
}

const GRPC_DEADLINE_MS = 10_000;
const CONNECTION_QR_GRPC_DEADLINE_MS = 30_000;
const GRPC_READY_DEADLINE_MS = 10_000;

@injectable()
export class WorkerBaileysGrpcClientService {
  private buildConnectionProtoPayload(payload: StatusConnectionWorkerRequest): {
    worker_id: string;
    status: string;
    type: string;
    phone_connection?: string;
    remove_session?: boolean;
    connection_attempt_id?: string;
  } {
    const protoPayload = {
      worker_id: payload.worker_id,
      status: payload.status,
      type: payload.type,
    };
    if (payload.phone_connection) {
      (protoPayload as Record<string, string>).phone_connection =
        payload.phone_connection;
    }
    if (payload.remove_session === true) {
      (protoPayload as { remove_session?: boolean }).remove_session = true;
    }
    if (payload.connection_attempt_id) {
      (
        protoPayload as { connection_attempt_id?: string }
      ).connection_attempt_id = payload.connection_attempt_id;
    }

    return protoPayload;
  }

  private getGrpcPorts(workerType?: EWorkerType): number[] {
    if (workerType === EWorkerType.wwebjs) {
      return [balanceEnvironment.workerWwebjsGrpcPort];
    }

    if (workerType === EWorkerType.whatsmeow) {
      return [balanceEnvironment.workerWhatsmeowGrpcPort];
    }

    if (workerType === EWorkerType.baileys) {
      return [balanceEnvironment.workerBaileysGrpcPort];
    }

    return [
      balanceEnvironment.workerBaileysGrpcPort,
      balanceEnvironment.workerWwebjsGrpcPort,
      balanceEnvironment.workerWhatsmeowGrpcPort,
    ];
  }

  private isRetryableConnectionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const grpcError = error as ServiceError;
    const details = (grpcError.details ?? '').toLowerCase();
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    return (
      grpcError.code === status.UNAVAILABLE ||
      grpcError.code === status.DEADLINE_EXCEEDED ||
      details.includes('econnrefused') ||
      details.includes('no connection established') ||
      details.includes('name resolution') ||
      details.includes('enotfound') ||
      message.includes('failed to connect before the deadline')
    );
  }

  private async requestConnectionByAddress(
    address: string,
    protoPayload: {
      worker_id: string;
      status: string;
      type: string;
      phone_connection?: string;
      remove_session?: boolean;
      connection_attempt_id?: string;
    }
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = injectGrpcConnectionMetadata(new Metadata());

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_connection_grpc.request_start',
      decision: 'grpc_request_connection',
      outcome: 'started',
      grpc_method: 'RequestConnection',
      grpc_address: address,
      deadline_ms: GRPC_DEADLINE_MS,
      status: protoPayload.status,
      connection_type: protoPayload.type,
      remove_session: protoPayload.remove_session === true,
    });

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).RequestConnection(
        protoPayload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            recordConnectionLifecycle({
              stage: 'connection.balancer.worker_connection_grpc.request_error',
              decision: 'grpc_request_connection',
              outcome: 'error',
              reason: 'grpc_error',
              level: 'error',
              grpc_method: 'RequestConnection',
              grpc_address: address,
              deadline_ms: GRPC_DEADLINE_MS,
              error: err.message,
            });
            reject(err);
            return;
          }
          const state = protoToConnectionState(response ?? {});
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_connection_grpc.request_success',
            decision: 'grpc_request_connection',
            outcome: 'success',
            grpc_method: 'RequestConnection',
            grpc_address: address,
            deadline_ms: GRPC_DEADLINE_MS,
            status: state.status,
            code: state.code,
            qrcode: state.qrcode,
            pairing_code: state.pairing_code,
            has_qr: Boolean(state.qrcode),
            has_pairing_code: Boolean(state.pairing_code),
          });
          resolve(state);
        }
      );
    });
  }

  private async requestConnectionQrCodeByAddress(
    address: string,
    protoPayload: {
      worker_id: string;
      status: string;
      type: string;
      phone_connection?: string;
      remove_session?: boolean;
      connection_attempt_id?: string;
    }
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + CONNECTION_QR_GRPC_DEADLINE_MS);
    const metadata = injectGrpcConnectionMetadata(new Metadata());

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_connection_grpc.qrcode_start',
      decision: 'grpc_request_connection_qrcode',
      outcome: 'started',
      grpc_method: 'RequestConnection',
      grpc_address: address,
      deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
      status: protoPayload.status,
      connection_type: protoPayload.type,
    });

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).RequestConnection(
        protoPayload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            recordConnectionLifecycle({
              stage: 'connection.balancer.worker_connection_grpc.qrcode_error',
              decision: 'grpc_request_connection_qrcode',
              outcome: 'error',
              reason: 'grpc_error',
              level: 'error',
              grpc_method: 'RequestConnection',
              grpc_address: address,
              deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
              error: err.message,
            });
            recordConnectionQrSummary({
              event: 'balancer_worker_qrcode_grpc_error',
              worker_id: protoPayload.worker_id,
              connection_attempt_id: protoPayload.connection_attempt_id,
              worker_type: undefined,
              grpc_address: address,
              status: protoPayload.status,
              reason: 'grpc_error',
              error: err.message,
              level: 'error',
            });
            reject(err);
            return;
          }

          const state = protoToConnectionState(response ?? {});
          state.connection_attempt_id ??= protoPayload.connection_attempt_id;
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_connection_grpc.qrcode_success',
            decision: 'grpc_request_connection_qrcode',
            outcome: 'success',
            grpc_method: 'RequestConnection',
            grpc_address: address,
            deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
            status: state.status,
            code: state.code,
            qrcode: state.qrcode,
            pairing_code: state.pairing_code,
            has_qr: Boolean(state.qrcode),
            has_pairing_code: Boolean(state.pairing_code),
          });
          recordConnectionQrSummary({
            event: state.qrcode
              ? 'balancer_worker_qrcode_grpc_success'
              : 'balancer_worker_qrcode_grpc_no_qr',
            ...summarizeConnectionQrState(state),
            grpc_address: address,
            qr_pending: state.qr_pending,
            level: state.qrcode ? 'info' : 'warn',
          });
          resolve(state);
        }
      );
    });
  }

  private async validatePhoneByAddress(
    address: string,
    payload: IPhoneValidationRequest
  ): Promise<IPhoneValidationResponse> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    return new Promise<IPhoneValidationResponse>((resolve, reject) => {
      (client as any).ValidatePhone(
        payload,
        { deadline },
        (
          err: ServiceError | null,
          response?: IPhoneValidationResponse
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }

          resolve(
            response ?? {
              request_id: payload.request_id,
              account_id: payload.account_id,
              worker_id: payload.worker_id,
              valid: false,
              error: 'Empty gRPC response',
            }
          );
        }
      );
    });
  }

  private async waitForReadyByAddress(
    address: string,
    timeoutMs: number
  ): Promise<string> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + timeoutMs);

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_connection_grpc.readiness_start',
      decision: 'grpc_wait_for_ready',
      outcome: 'started',
      grpc_address: address,
      grpc_probe_address: address,
      deadline_ms: timeoutMs,
      grpc_ready: false,
    });

    return new Promise<string>((resolve, reject) => {
      client.waitForReady(deadline, (err?: Error) => {
        client.close();
        if (err) {
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_connection_grpc.readiness_error',
            decision: 'grpc_wait_for_ready',
            outcome: 'not_ready',
            reason: 'grpc_wait_for_ready_failed',
            level: 'warn',
            grpc_address: address,
            grpc_probe_address: address,
            grpc_probe_error: err.message,
            deadline_ms: timeoutMs,
            grpc_ready: false,
          });
          reject(err);
          return;
        }

        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_connection_grpc.readiness_success',
          decision: 'grpc_wait_for_ready',
          outcome: 'ready',
          grpc_address: address,
          grpc_probe_address: address,
          deadline_ms: timeoutMs,
          grpc_ready: true,
        });
        resolve(address);
      });
    });
  }

  private async callWithFallback<T>(
    workerId: string,
    workerType: EWorkerType | undefined,
    callByAddress: (address: string) => Promise<T>
  ): Promise<T> {
    const ports = this.getGrpcPorts(workerType);
    let lastError: unknown;

    for (let index = 0; index < ports.length; index++) {
      const port = ports[index];
      const isLastPort = index === ports.length - 1;
      const address = `${workerId}:${port}`;

      try {
        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_connection_grpc.fallback_attempt',
          decision: 'grpc_port_fallback',
          outcome: 'started',
          grpc_address: address,
          attempt: index + 1,
          max_attempts: ports.length,
          worker_type: workerType,
        });
        return await callByAddress(address);
      } catch (error) {
        lastError = error;
        if (isLastPort || !this.isRetryableConnectionError(error)) {
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_connection_grpc.fallback_error',
            decision: 'grpc_port_fallback',
            outcome: 'error',
            reason: isLastPort ? 'last_port_failed' : 'non_retryable_error',
            level: 'error',
            grpc_address: address,
            attempt: index + 1,
            max_attempts: ports.length,
            worker_type: workerType,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_connection_grpc.fallback_retry',
          decision: 'grpc_port_fallback',
          outcome: 'retrying',
          reason: 'retryable_error',
          level: 'warn',
          grpc_address: address,
          attempt: index + 1,
          max_attempts: ports.length,
          worker_type: workerType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('gRPC call failed with no explicit error');
  }

  async requestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<IBaileysConnectionState> {
    const protoPayload = this.buildConnectionProtoPayload(payload);

    const contextData = buildConnectionLifecycleContext({
      worker_id: workerId,
      channel_id: workerId,
      worker_type: workerType,
      source_provider: 'balancer',
      connection_type: payload.type,
      connection_action: 'request_connection',
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
      return this.callWithFallback(workerId, workerType, (address) =>
        this.requestConnectionByAddress(address, protoPayload)
      );
    });
  }

  async requestConnectionQrCode(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<IBaileysConnectionState> {
    const protoPayload = this.buildConnectionProtoPayload(payload);

    const contextData = buildConnectionLifecycleContext({
      worker_id: workerId,
      channel_id: workerId,
      worker_type: workerType,
      source_provider: 'balancer',
      connection_type: payload.type,
      connection_action: 'request_qrcode',
    });

    return runWithConnectionLifecycleContext(contextData, () =>
      this.callWithFallback(workerId, workerType, (address) =>
        this.requestConnectionQrCodeByAddress(address, protoPayload)
      )
    );
  }

  async waitForReady(
    workerId: string,
    workerType?: EWorkerType,
    timeoutMs: number = GRPC_READY_DEADLINE_MS
  ): Promise<string> {
    const contextData = buildConnectionLifecycleContext({
      worker_id: workerId,
      channel_id: workerId,
      worker_type: workerType,
      source_provider: 'balancer',
      connection_action: 'grpc_readiness',
    });

    return runWithConnectionLifecycleContext(contextData, () =>
      this.callWithFallback(workerId, workerType, (address) =>
        this.waitForReadyByAddress(address, timeoutMs)
      )
    );
  }

  async validatePhone(
    workerId: string,
    payload: IPhoneValidationRequest,
    workerType?: EWorkerType
  ): Promise<IPhoneValidationResponse> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.validatePhoneByAddress(address, payload)
    );
  }
}
