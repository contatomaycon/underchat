import { injectable, inject } from 'tsyringe';
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
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { protoToConnectionState } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IWorkerRuntimeActivationRequestProto,
  IWorkerRuntimeActivationResponseProto,
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

const protoPath = resolveProtoPath('worker_connection.proto');
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
const GRPC_READY_DEADLINE_MS = 10_000;
const SECURE_IMPORT_GRPC_DEADLINE_MS = 120_000;

export interface WorkerPasskeyResponseProtoPayload {
  worker_id: string;
  account_id: string;
  connection_attempt_id?: string;
  passkey_response: string;
  debug_trace_id?: string;
}

export interface WorkerPasskeyConfirmationProtoPayload {
  worker_id: string;
  account_id: string;
  connection_attempt_id?: string;
  debug_trace_id?: string;
}

export type WorkerSecureSessionImportProtoPayload =
  ISecureConnectionImportRequest;

@injectable()
export class WorkerBaileysGrpcClientService {
  constructor(
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  private logFlow(event: string, fields: Record<string, unknown>): void {
    logConnectionFlowConsole(event, {
      layer: 'service.worker_connection_grpc_client',
      ...fields,
    });
  }

  private buildConnectionProtoPayload(payload: StatusConnectionWorkerRequest): {
    worker_id: string;
    status: string;
    type: string;
    phone_connection?: string;
    remove_session?: boolean;
    connection_attempt_id?: string;
    debug_trace_id?: string;
    runtime_generation?: number;
    warm_pool_id?: string;
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
    if (payload.debug_trace_id) {
      (protoPayload as { debug_trace_id?: string }).debug_trace_id =
        payload.debug_trace_id;
    }
    if (payload.runtime_generation) {
      (protoPayload as { runtime_generation?: number }).runtime_generation =
        payload.runtime_generation;
    }
    if (payload.warm_pool_id) {
      (protoPayload as { warm_pool_id?: string }).warm_pool_id =
        payload.warm_pool_id;
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
      debug_trace_id?: string;
      runtime_generation?: number;
      warm_pool_id?: string;
    }
  ): Promise<IBaileysConnectionState> {
    const startedAt = Date.now();
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    void this.connectionLifecycleDebugService.log(
      'service.worker_connection_grpc.request_connection_call',
      {
        trace_id: protoPayload.debug_trace_id,
        layer: 'service',
        worker_id: protoPayload.worker_id,
        connection_attempt_id: protoPayload.connection_attempt_id,
        runtime_generation: protoPayload.runtime_generation,
        status: protoPayload.status,
        method: 'RequestConnection',
        grpc_address: address,
      }
    );
    this.logFlow('service.worker_connection_grpc.request_connection_call', {
      trace_id: protoPayload.debug_trace_id,
      worker_id: protoPayload.worker_id,
      connection_attempt_id: protoPayload.connection_attempt_id,
      runtime_generation: protoPayload.runtime_generation,
      status: protoPayload.status,
      type: protoPayload.type,
      remove_session: protoPayload.remove_session === true,
      method: 'RequestConnection',
      grpc_address: address,
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
            reject(err);
            return;
          }
          const state = protoToConnectionState(response ?? {});
          resolve(state);
        }
      );
    })
      .then((state) => {
        void this.connectionLifecycleDebugService.log(
          'service.worker_connection_grpc.request_connection_ok',
          {
            trace_id: protoPayload.debug_trace_id,
            layer: 'service',
            worker_id: protoPayload.worker_id,
            account_id: state.account_id,
            worker_type_id: state.worker_type_id,
            connection_attempt_id:
              state.connection_attempt_id ?? protoPayload.connection_attempt_id,
            runtime_generation:
              state.runtime_generation ?? protoPayload.runtime_generation,
            status: state.status,
            code: state.code,
            reason: state.reason,
            duration_ms: Date.now() - startedAt,
            qrcode: state.qrcode,
            pairing_code: state.pairing_code,
            method: 'RequestConnection',
            grpc_address: address,
          }
        );
        this.logFlow('service.worker_connection_grpc.request_connection_ok', {
          trace_id: state.debug_trace_id ?? protoPayload.debug_trace_id,
          worker_id: protoPayload.worker_id,
          account_id: state.account_id,
          worker_type_id: state.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? protoPayload.connection_attempt_id,
          runtime_generation:
            state.runtime_generation ?? protoPayload.runtime_generation,
          status: state.status,
          code: state.code,
          reason: state.reason,
          duration_ms: Date.now() - startedAt,
          qrcode: state.qrcode,
          pairing_code: state.pairing_code,
          has_passkey_public_key: Boolean(state.passkey_public_key),
          passkey_public_key: state.passkey_public_key,
          has_passkey_confirmation_code: Boolean(
            state.passkey_confirmation_code
          ),
          passkey_confirmation_code: state.passkey_confirmation_code,
          method: 'RequestConnection',
          grpc_address: address,
        });
        return {
          ...state,
          debug_trace_id: state.debug_trace_id ?? protoPayload.debug_trace_id,
        };
      })
      .catch((error) => {
        void this.connectionLifecycleDebugService.log(
          'service.worker_connection_grpc.request_connection_error',
          {
            trace_id: protoPayload.debug_trace_id,
            layer: 'service',
            worker_id: protoPayload.worker_id,
            connection_attempt_id: protoPayload.connection_attempt_id,
            runtime_generation: protoPayload.runtime_generation,
            status: protoPayload.status,
            reason: error instanceof Error ? error.message : String(error),
            duration_ms: Date.now() - startedAt,
            method: 'RequestConnection',
            grpc_address: address,
          }
        );
        this.logFlow(
          'service.worker_connection_grpc.request_connection_error',
          {
            trace_id: protoPayload.debug_trace_id,
            worker_id: protoPayload.worker_id,
            connection_attempt_id: protoPayload.connection_attempt_id,
            runtime_generation: protoPayload.runtime_generation,
            status: protoPayload.status,
            reason: error instanceof Error ? error.message : String(error),
            duration_ms: Date.now() - startedAt,
            method: 'RequestConnection',
            grpc_address: address,
          }
        );
        throw error;
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

  private async sendPasskeyResponseByAddress(
    address: string,
    payload: WorkerPasskeyResponseProtoPayload
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    void this.connectionLifecycleDebugService.log(
      'service.worker_connection_grpc.passkey_response_call',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        connection_attempt_id: payload.connection_attempt_id,
        passkey_response_len: payload.passkey_response.length,
        method: 'SendPasskeyResponse',
        grpc_address: address,
      }
    );
    this.logFlow('service.worker_connection_grpc.passkey_response_call', {
      trace_id: payload.debug_trace_id,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      connection_attempt_id: payload.connection_attempt_id,
      passkey_response: payload.passkey_response,
      method: 'SendPasskeyResponse',
      grpc_address: address,
    });

    const startedAt = Date.now();
    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).SendPasskeyResponse(
        payload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }
          resolve(protoToConnectionState(response ?? {}));
        }
      );
    })
      .then((state) => {
        this.logFlow('service.worker_connection_grpc.passkey_response_ok', {
          trace_id: state.debug_trace_id ?? payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: state.account_id ?? payload.account_id,
          worker_type_id: state.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? payload.connection_attempt_id,
          status: state.status,
          code: state.code,
          reason: state.reason,
          duration_ms: Date.now() - startedAt,
          has_passkey_public_key: Boolean(state.passkey_public_key),
          has_passkey_confirmation_code: Boolean(
            state.passkey_confirmation_code
          ),
          method: 'SendPasskeyResponse',
          grpc_address: address,
        });
        return state;
      })
      .catch((error) => {
        this.logFlow('service.worker_connection_grpc.passkey_response_error', {
          trace_id: payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          connection_attempt_id: payload.connection_attempt_id,
          reason: error instanceof Error ? error.message : String(error),
          duration_ms: Date.now() - startedAt,
          method: 'SendPasskeyResponse',
          grpc_address: address,
        });
        throw error;
      });
  }

  private async confirmPasskeyByAddress(
    address: string,
    payload: WorkerPasskeyConfirmationProtoPayload
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();
    const startedAt = Date.now();

    this.logFlow('service.worker_connection_grpc.passkey_confirmation_call', {
      trace_id: payload.debug_trace_id,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      connection_attempt_id: payload.connection_attempt_id,
      method: 'ConfirmPasskey',
      grpc_address: address,
    });

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).ConfirmPasskey(
        payload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }
          resolve(protoToConnectionState(response ?? {}));
        }
      );
    })
      .then((state) => {
        this.logFlow('service.worker_connection_grpc.passkey_confirmation_ok', {
          trace_id: state.debug_trace_id ?? payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: state.account_id ?? payload.account_id,
          worker_type_id: state.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? payload.connection_attempt_id,
          status: state.status,
          code: state.code,
          reason: state.reason,
          duration_ms: Date.now() - startedAt,
          has_passkey_public_key: Boolean(state.passkey_public_key),
          has_passkey_confirmation_code: Boolean(
            state.passkey_confirmation_code
          ),
          method: 'ConfirmPasskey',
          grpc_address: address,
        });
        return state;
      })
      .catch((error) => {
        this.logFlow(
          'service.worker_connection_grpc.passkey_confirmation_error',
          {
            trace_id: payload.debug_trace_id,
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            connection_attempt_id: payload.connection_attempt_id,
            reason: error instanceof Error ? error.message : String(error),
            duration_ms: Date.now() - startedAt,
            method: 'ConfirmPasskey',
            grpc_address: address,
          }
        );
        throw error;
      });
  }

  private async importSecureSessionByAddress(
    address: string,
    payload: WorkerSecureSessionImportProtoPayload
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + SECURE_IMPORT_GRPC_DEADLINE_MS);
    const metadata = new Metadata();
    const startedAt = Date.now();
    const protoPayload = {
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id ?? '',
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation ?? 0,
      format_version: payload.format_version,
      source: payload.source,
      target_provider: payload.target_provider,
      payload_ref: payload.payload_ref ?? '',
      payload_json: payload.payload_json ?? '',
      checksum: payload.checksum ?? '',
      debug_trace_id: payload.debug_trace_id ?? '',
    };

    this.logFlow('service.worker_connection_grpc.secure_import_call', {
      trace_id: payload.debug_trace_id,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      format_version: payload.format_version,
      source: payload.source,
      target_provider: payload.target_provider,
      has_payload_ref: Boolean(payload.payload_ref),
      has_payload_json: Boolean(payload.payload_json),
      method: 'ImportSecureSession',
      grpc_address: address,
    });

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).ImportSecureSession(
        protoPayload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }
          resolve(protoToConnectionState(response ?? {}));
        }
      );
    })
      .then((state) => {
        this.logFlow('service.worker_connection_grpc.secure_import_ok', {
          trace_id: state.debug_trace_id ?? payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: state.account_id ?? payload.account_id,
          worker_type_id: state.worker_type_id ?? payload.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? payload.connection_attempt_id,
          status: state.status,
          code: state.code,
          reason: state.reason,
          session_ready: state.session_ready,
          authenticated: state.authenticated,
          duration_ms: Date.now() - startedAt,
          method: 'ImportSecureSession',
          grpc_address: address,
        });
        return state;
      })
      .catch((error) => {
        this.logFlow('service.worker_connection_grpc.secure_import_error', {
          trace_id: payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          connection_attempt_id: payload.connection_attempt_id,
          reason: error instanceof Error ? error.message : String(error),
          duration_ms: Date.now() - startedAt,
          method: 'ImportSecureSession',
          grpc_address: address,
        });
        throw error;
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

    return new Promise<string>((resolve, reject) => {
      client.waitForReady(deadline, (err?: Error) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }

        resolve(address);
      });
    });
  }

  private async activateRuntimeByAddress(
    address: string,
    payload: IWorkerRuntimeActivationRequestProto
  ): Promise<IWorkerRuntimeActivationResponseProto> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    return new Promise<IWorkerRuntimeActivationResponseProto>(
      (resolve, reject) => {
        (client as any).ActivateRuntime(
          payload,
          metadata,
          { deadline },
          (
            err: ServiceError | null,
            response?: IWorkerRuntimeActivationResponseProto
          ): void => {
            client.close();
            if (err) {
              reject(err);
              return;
            }

            resolve(
              response ?? {
                worker_id: payload.worker_id,
                account_id: payload.account_id,
                activated: false,
                error: 'Empty gRPC response',
              }
            );
          }
        );
      }
    );
  }

  private async runtimeHealthByAddress(
    address: string,
    payload: IWorkerRuntimeHealthRequestProto
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_READY_DEADLINE_MS);

    return new Promise<IWorkerRuntimeHealthResponseProto>((resolve, reject) => {
      (client as any).RuntimeHealth(
        payload,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerRuntimeHealthResponseProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }

          resolve(
            response ?? {
              worker_id: payload.worker_id,
              warm_pool_id: payload.warm_pool_id,
              ready: false,
              error: 'Empty gRPC response',
            }
          );
        }
      );
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
        this.logFlow('service.worker_connection_grpc.fallback_attempt', {
          worker_id: workerId,
          worker_type_id: workerType,
          grpc_address: address,
          port,
          attempt: index + 1,
          max_attempts: ports.length,
        });
        return await callByAddress(address);
      } catch (error) {
        lastError = error;
        this.logFlow('service.worker_connection_grpc.fallback_error', {
          worker_id: workerId,
          worker_type_id: workerType,
          grpc_address: address,
          port,
          attempt: index + 1,
          max_attempts: ports.length,
          retryable: this.isRetryableConnectionError(error),
          is_last_port: isLastPort,
          reason: error instanceof Error ? error.message : String(error),
        });
        if (isLastPort || !this.isRetryableConnectionError(error)) {
          throw error;
        }
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

    return this.callWithFallback(workerId, workerType, (address) =>
      this.requestConnectionByAddress(address, protoPayload)
    );
  }

  async waitForReady(
    workerId: string,
    workerType?: EWorkerType,
    timeoutMs: number = GRPC_READY_DEADLINE_MS
  ): Promise<string> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.waitForReadyByAddress(address, timeoutMs)
    );
  }

  async activateRuntime(
    containerName: string,
    payload: IWorkerRuntimeActivationRequestProto,
    workerType?: EWorkerType
  ): Promise<IWorkerRuntimeActivationResponseProto> {
    return this.callWithFallback(containerName, workerType, (address) =>
      this.activateRuntimeByAddress(address, payload)
    );
  }

  async runtimeHealth(
    containerName: string,
    payload: IWorkerRuntimeHealthRequestProto,
    workerType?: EWorkerType
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    return this.callWithFallback(containerName, workerType, (address) =>
      this.runtimeHealthByAddress(address, payload)
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

  async sendPasskeyResponse(
    workerId: string,
    payload: WorkerPasskeyResponseProtoPayload,
    workerType?: EWorkerType
  ): Promise<IBaileysConnectionState> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.sendPasskeyResponseByAddress(address, payload)
    );
  }

  async confirmPasskey(
    workerId: string,
    payload: WorkerPasskeyConfirmationProtoPayload,
    workerType?: EWorkerType
  ): Promise<IBaileysConnectionState> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.confirmPasskeyByAddress(address, payload)
    );
  }

  async importSecureSession(
    workerId: string,
    payload: WorkerSecureSessionImportProtoPayload,
    workerType?: EWorkerType
  ): Promise<IBaileysConnectionState> {
    const startedAt = Date.now();
    this.logFlow('service.worker_connection_grpc.secure_import.start', {
      trace_id: payload.debug_trace_id,
      worker_id: workerId,
      account_id: payload.account_id,
      worker_type_id: workerType ?? payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      format_version: payload.format_version,
      target_provider: payload.target_provider,
      has_payload_ref: Boolean(payload.payload_ref),
      has_payload_json: Boolean(payload.payload_json),
      method: 'ImportSecureSession',
    });

    try {
      const response = await this.callWithFallback(
        workerId,
        workerType,
        (address) => this.importSecureSessionByAddress(address, payload)
      );
      this.logFlow('service.worker_connection_grpc.secure_import.done', {
        trace_id: response.debug_trace_id ?? payload.debug_trace_id,
        worker_id: response.worker_id ?? workerId,
        account_id: response.account_id ?? payload.account_id,
        worker_type_id:
          response.worker_type_id ?? workerType ?? payload.worker_type_id,
        connection_attempt_id:
          response.connection_attempt_id ?? payload.connection_attempt_id,
        runtime_generation:
          response.runtime_generation ?? payload.runtime_generation,
        status: response.status,
        code: response.code,
        reason: response.reason,
        session_ready: response.session_ready,
        authenticated: response.authenticated,
        duration_ms: Date.now() - startedAt,
        method: 'ImportSecureSession',
      });
      return response;
    } catch (error) {
      this.logFlow('service.worker_connection_grpc.secure_import.failed', {
        trace_id: payload.debug_trace_id,
        worker_id: workerId,
        account_id: payload.account_id,
        worker_type_id: workerType ?? payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        reason: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
        method: 'ImportSecureSession',
      });
      throw error;
    }
  }
}
