import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import { recordConnectionQrSummary } from '@core/plugins/telemetry/connectionQrSummary';
import { getErrorMessage } from '@core/common/functions/toError';
import { status as GrpcStatus } from '@grpc/grpc-js';

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
  private readonly qrHttpSoftTimeoutMs = 12_000;

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<IBaileysConnectionState> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: workerId,
      channel_id: workerId,
      source_provider: 'manager',
      connection_type: EBaileysConnectionType.qrcode,
      connection_action: 'request_qrcode',
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.received',
        decision: 'request_connection_qrcode',
        outcome: 'received',
      });

      return this.executeWithLifecycle(t, accountId, workerId);
    });
  }

  private async executeWithLifecycle(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<IBaileysConnectionState> {
    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );
    recordConnectionLifecycle({
      stage: 'connection.manager.qrcode_request.worker_validation',
      decision: 'exists_worker_by_id',
      outcome: existsWorkerAccountById ? 'success' : 'error',
      reason: existsWorkerAccountById ? undefined : 'worker_not_found',
      level: existsWorkerAccountById ? 'info' : 'warn',
    });

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }

    const view = await this.workerService.viewWorker(accountId, workerId);
    const serverId = view?.server?.id;
    if (!serverId) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.server_validation',
        decision: 'view_worker_server',
        outcome: 'error',
        reason: 'server_not_found',
        level: 'warn',
      });
      throw new Error(t('worker_not_found'));
    }
    recordConnectionLifecycle({
      stage: 'connection.manager.qrcode_request.server_resolved',
      decision: 'view_worker_server',
      outcome: 'success',
      server_id: serverId,
      server_name: view?.server?.name,
      worker_type: view?.type?.id,
      worker_type_name: view?.type?.name,
      worker_status_id: view?.status?.id,
    });

    const connectionAttemptId = uuidv7();
    const pendingResponse = this.buildPendingResponse(
      accountId,
      workerId,
      connectionAttemptId
    );

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_start',
        decision: 'request_connection_qrcode',
        outcome: 'started',
        server_id: serverId,
        connection_attempt_id: connectionAttemptId,
      });
      let returnedPendingBySoftTimeout = false;
      const grpcRequest = this.workerGrpcClientService.requestConnectionQrCode(
        serverId,
        {
          worker_id: workerId,
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: connectionAttemptId,
        },
        accountId
      );

      void grpcRequest.catch((err) => {
        if (!returnedPendingBySoftTimeout) {
          return;
        }

        recordConnectionLifecycle({
          stage: 'connection.manager.grpc.background_request_error',
          decision: 'request_connection_qrcode',
          outcome: 'error',
          reason: 'grpc_error_after_http_fallback',
          level: this.isRetryableQrGrpcError(err) ? 'warn' : 'error',
          server_id: serverId,
          connection_attempt_id: connectionAttemptId,
          error: getErrorMessage(err),
        });
      });

      const response = await this.withQrSoftTimeout(
        grpcRequest,
        pendingResponse,
        serverId,
        () => {
          returnedPendingBySoftTimeout = true;
        }
      );
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_success',
        decision: 'request_connection_qrcode',
        outcome: 'success',
        server_id: serverId,
        connection_attempt_id: response.connection_attempt_id,
        status: response.status,
        code: response.code,
        qrcode: response.qrcode,
        pairing_code: response.pairing_code,
        has_qr: Boolean(response.qrcode),
        has_pairing_code: Boolean(response.pairing_code),
      });
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.http_response_ready',
        decision: 'return_connection_qrcode_response',
        outcome: 'completed',
        server_id: serverId,
        connection_attempt_id: response.connection_attempt_id,
        status: response.status,
        code: response.code,
        qrcode: response.qrcode,
        pairing_code: response.pairing_code,
        has_qr: Boolean(response.qrcode),
        has_pairing_code: Boolean(response.pairing_code),
      });
      return response;
    } catch (err) {
      if (this.isRetryableQrGrpcError(err)) {
        recordConnectionLifecycle({
          stage: 'connection.manager.grpc.request_pending_fallback',
          decision: 'return_pending_after_retryable_grpc_error',
          outcome: 'fallback',
          reason: 'retryable_grpc_error',
          level: 'warn',
          server_id: serverId,
          connection_attempt_id: connectionAttemptId,
          error: getErrorMessage(err),
        });
        recordConnectionQrSummary({
          event: 'manager_balancer_qrcode_retryable_error_pending',
          ...pendingResponse,
          server_id: serverId,
          reason: 'retryable_grpc_error',
          error: getErrorMessage(err),
          qr_pending: true,
          level: 'warn',
        });
        return pendingResponse;
      }

      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_error',
        decision: 'request_connection_qrcode',
        outcome: 'error',
        reason: 'grpc_error',
        level: 'error',
        server_id: serverId,
        connection_attempt_id: connectionAttemptId,
        error: getErrorMessage(err),
      });
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private buildPendingResponse(
    accountId: string,
    workerId: string,
    connectionAttemptId: string
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: connectionAttemptId,
      qr_pending: true,
    };
  }

  private async withQrSoftTimeout(
    grpcRequest: Promise<IBaileysConnectionState>,
    pendingResponse: IBaileysConnectionState,
    serverId: string,
    onSoftTimeout: () => void
  ): Promise<IBaileysConnectionState> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const pendingAfterTimeout = new Promise<IBaileysConnectionState>(
      (resolve) => {
        timeout = setTimeout(() => {
          onSoftTimeout();
          recordConnectionLifecycle({
            stage: 'connection.manager.grpc.request_soft_timeout',
            decision: 'return_pending_before_grpc_deadline',
            outcome: 'fallback',
            reason: 'qr_http_soft_timeout',
            level: 'warn',
            server_id: serverId,
            connection_attempt_id: pendingResponse.connection_attempt_id,
            time: this.qrHttpSoftTimeoutMs,
          });
          recordConnectionQrSummary({
            event: 'manager_balancer_qrcode_soft_timeout_pending',
            ...pendingResponse,
            server_id: serverId,
            reason: 'qr_http_soft_timeout',
            qr_pending: true,
            level: 'warn',
          });
          resolve(pendingResponse);
        }, this.qrHttpSoftTimeoutMs);
      }
    );

    const response = await Promise.race([grpcRequest, pendingAfterTimeout]);
    if (timeout) {
      clearTimeout(timeout);
    }

    return response;
  }

  private isRetryableQrGrpcError(error: unknown): boolean {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? Number((error as { code?: unknown }).code)
        : undefined;
    const message = getErrorMessage(error).toLowerCase();

    return (
      code === GrpcStatus.DEADLINE_EXCEEDED ||
      code === GrpcStatus.UNAVAILABLE ||
      message.includes('deadline') ||
      message.includes('unavailable') ||
      message.includes('econnrefused') ||
      message.includes('failed to connect before the deadline')
    );
  }
}
