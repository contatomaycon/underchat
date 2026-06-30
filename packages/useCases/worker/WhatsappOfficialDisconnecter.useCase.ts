import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { DisconnectWhatsappOfficialResponse } from '@core/schema/worker/disconnectWhatsappOfficial/response.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@injectable()
export class WhatsappOfficialDisconnecterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository
  ) {}

  private async assertCanDisconnect(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    workerId: string;
  }) {
    const [worker, workerBalancer] = await Promise.all([
      this.workerService.viewWorker(input.accountId, input.workerId),
      this.workerService.viewWorkerBalancer(input.accountId, input.workerId),
    ]);

    if (!worker || !workerBalancer) {
      throw new Error(input.t('worker_not_found'));
    }

    if (worker.type?.id !== EWorkerType.whatsapp) {
      throw new Error(input.t('whatsapp_official_disconnect_only_official'));
    }

    const openChatsCount = await this.chatService.countOpenChatsByWorkerId(
      input.accountId,
      input.workerId
    );

    if (openChatsCount > 0) {
      throw new Error(
        input.t('channel_delete_has_open_conversations', {
          count: openChatsCount,
        })
      );
    }

    return { worker, workerBalancer };
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<DisconnectWhatsappOfficialResponse> {
    const { worker, workerBalancer } = await this.assertCanDisconnect({
      t,
      accountId,
      workerId,
    });

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    const metaResult: Pick<
      DisconnectWhatsappOfficialResponse,
      'meta_deregistered' | 'meta_unsubscribed' | 'meta_warning'
    > = {
      meta_deregistered: false,
      meta_unsubscribed: false,
      meta_warning: connection
        ? t('whatsapp_official_disconnect_meta_manual_cleanup_warning')
        : null,
    };

    const disconnected =
      await this.workerWhatsappOfficialConnectionRepository.disconnectPreservingWorker(
        {
          accountId,
          workerId,
        }
      );

    if (!disconnected) {
      throw new Error(t('whatsapp_official_disconnect_error'));
    }

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.loggedOut,
      status: EBaileysConnectionStatus.disconnected,
      worker_id: workerId,
      worker_name: worker.name,
      account_id: workerBalancer.account_id,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.offline,
      disconnected_user: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'disconnected',
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(workerBalancer.account_id),
      payload
    );

    return {
      worker_id: workerId,
      disconnected: true,
      ...metaResult,
    };
  }
}
