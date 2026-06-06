import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';

@injectable()
export class WorkerChangeStatusConnectionUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  private cleanPhoneNumber(phone?: string): string {
    return phone ? phone.replaceAll(/\D/g, '') : '';
  }

  private async validate(
    t: TFunction<'translation', undefined>,
    input: StatusConnectionWorkerRequest,
    accountId: string
  ) {
    if (input.type === EBaileysConnectionType.phone) {
      recordConnectionLifecycle({
        stage: 'connection.manager.status_change.validation',
        decision: 'connection_type_validation',
        outcome: 'error',
        reason: 'phone_connection_disabled',
        level: 'warn',
      });
      throw new Error(t('phone_connection_disabled'));
    }

    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      input.worker_id
    );

    if (!existsWorkerAccountById) {
      recordConnectionLifecycle({
        stage: 'connection.manager.status_change.validation',
        decision: 'exists_worker_by_id',
        outcome: 'error',
        reason: 'worker_not_found',
        level: 'warn',
      });
      throw new Error(t('worker_not_found'));
    }
  }

  private async onChangeConnectionStatus(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    const view = await this.workerService.viewWorker(
      accountId,
      input.worker_id
    );
    const serverId = view?.server?.id;
    if (!serverId) {
      recordConnectionLifecycle({
        stage: 'connection.manager.status_change.server_validation',
        decision: 'view_worker_server',
        outcome: 'error',
        reason: 'server_not_found',
        level: 'warn',
      });
      throw new Error(t('worker_not_found'));
    }

    const cleanPhone = this.cleanPhoneNumber(input.phone_connection);
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: input.status,
      type: input.type,
      phone_connection: cleanPhone,
      remove_session: input.remove_session,
    };

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.status_change_start',
        decision: 'change_connection_status',
        outcome: 'started',
        server_id: serverId,
        status: payload.status,
        connection_type: payload.type,
        remove_session: payload.remove_session === true,
      });
      await this.workerGrpcClientService.changeConnectionStatus(
        serverId,
        payload,
        accountId
      );
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.status_change_success',
        decision: 'change_connection_status',
        outcome: 'success',
        server_id: serverId,
        status: payload.status,
        connection_type: payload.type,
      });
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.manager.grpc.status_change_error',
        decision: 'change_connection_status',
        outcome: 'error',
        reason: 'grpc_error',
        level: 'error',
        server_id: serverId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private async publishConnectionIntent(
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (input.status !== EWorkerStatus.online) {
      if (input.status !== EWorkerStatus.disponible) {
        return;
      }

      try {
        recordConnectionLifecycle({
          stage: 'connection.manager.centrifugo.intent_start',
          decision: 'publish_connection_logout_intent',
          outcome: 'started',
          status: input.status,
        });
        await this.centrifugoService.publishSub(
          workerCentrifugoQueue(accountId),
          {
            status: EBaileysConnectionStatus.connecting,
            worker_id: input.worker_id,
            account_id: accountId,
            disconnected_user: true,
            code: ECodeMessage.logoutInProgress,
          } satisfies IBaileysConnectionState
        );
        recordConnectionLifecycle({
          stage: 'connection.manager.centrifugo.intent_success',
          decision: 'publish_connection_logout_intent',
          outcome: 'published',
          status: input.status,
        });
      } catch (err) {
        recordConnectionLifecycle({
          stage: 'connection.manager.centrifugo.intent_error',
          decision: 'publish_connection_logout_intent',
          outcome: 'error',
          reason: 'publish_failed',
          level: 'error',
          status: input.status,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return;
    }

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.centrifugo.intent_start',
        decision: 'publish_connection_start_intent',
        outcome: 'started',
        status: input.status,
      });
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        {
          status: EBaileysConnectionStatus.connecting,
          worker_id: input.worker_id,
          account_id: accountId,
          code: ECodeMessage.awaitConnection,
        } satisfies IBaileysConnectionState
      );
      recordConnectionLifecycle({
        stage: 'connection.manager.centrifugo.intent_success',
        decision: 'publish_connection_start_intent',
        outcome: 'published',
        status: input.status,
      });
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.manager.centrifugo.intent_error',
        decision: 'publish_connection_start_intent',
        outcome: 'error',
        reason: 'publish_failed',
        level: 'error',
        status: input.status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: input.worker_id,
      channel_id: input.worker_id,
      source_provider: 'manager',
      connection_type: input.type,
      connection_action: 'change_status',
    });

    await runWithConnectionLifecycleContext(contextData, async () => {
      recordConnectionLifecycle({
        stage: 'connection.manager.status_change.received',
        decision: 'change_connection_status',
        outcome: 'received',
        status: input.status,
        connection_type: input.type,
        remove_session: input.remove_session === true,
      });
      await this.validate(t, input, accountId);
      await this.publishConnectionIntent(accountId, input);
      await this.onChangeConnectionStatus(t, accountId, input);
    });
  }
}
