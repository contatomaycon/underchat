import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
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

    if (!existsWorkerAccountById) {
      recordConnectionLifecycle({
        stage: 'connection.manager.qrcode_request.worker_validation',
        decision: 'exists_worker_by_id',
        outcome: 'error',
        reason: 'worker_not_found',
        level: 'warn',
      });
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

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_start',
        decision: 'request_connection_qrcode',
        outcome: 'started',
        server_id: serverId,
      });
      const response =
        await this.workerGrpcClientService.requestConnectionQrCode(
          serverId,
          {
            worker_id: workerId,
            status: EWorkerStatus.online,
            type: EBaileysConnectionType.qrcode,
          },
          accountId
        );
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_success',
        decision: 'request_connection_qrcode',
        outcome: 'success',
        server_id: serverId,
        status: response.status,
        code: response.code,
        has_qr: Boolean(response.qrcode),
        has_pairing_code: Boolean(response.pairing_code),
      });
      return response;
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.request_error',
        decision: 'request_connection_qrcode',
        outcome: 'error',
        reason: 'grpc_error',
        level: 'error',
        server_id: serverId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(t('grpc_error'), { cause: err });
    }
  }
}
