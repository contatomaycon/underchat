import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  isMetaPermissionsError,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { DisconnectWhatsappOfficialResponse } from '@core/schema/worker/disconnectWhatsappOfficial/response.schema';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
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
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
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

    return workerBalancer;
  }

  private async unsubscribeMetaIfLastWabaConnection(input: {
    t: TFunction<'translation', undefined>;
    workerId: string;
    wabaId: string;
    accessTokenEncrypted: string;
    apiVersion: string;
  }): Promise<
    Pick<
      DisconnectWhatsappOfficialResponse,
      'meta_unsubscribed' | 'meta_warning'
    >
  > {
    const otherWabaConnections =
      await this.workerWhatsappOfficialConnectionRepository.countActiveByWabaIdExceptWorkerId(
        input.wabaId,
        input.workerId
      );

    if (otherWabaConnections > 0) {
      return {
        meta_unsubscribed: false,
        meta_warning: null,
      };
    }

    try {
      const accessToken = this.passwordEncryptorService.decrypt(
        input.accessTokenEncrypted
      );

      const unsubscribed =
        await this.metaWhatsappEmbeddedService.unsubscribeWabaApp({
          apiVersion: input.apiVersion,
          accessToken,
          wabaId: input.wabaId,
        });

      return {
        meta_unsubscribed: unsubscribed,
        meta_warning: unsubscribed
          ? null
          : input.t('whatsapp_official_disconnect_meta_cleanup_warning'),
      };
    } catch (error) {
      const warningKey = isMetaPermissionsError(error)
        ? 'whatsapp_official_disconnect_meta_permission_warning'
        : 'whatsapp_official_disconnect_meta_cleanup_warning';

      return {
        meta_unsubscribed: false,
        meta_warning: input.t(warningKey),
      };
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<DisconnectWhatsappOfficialResponse> {
    const workerBalancer = await this.assertCanDisconnect({
      t,
      accountId,
      workerId,
    });

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      throw new Error(t('whatsapp_official_connection_not_found'));
    }

    const payload: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: workerId,
      server_id: workerBalancer.server_id,
      account_id: workerBalancer.account_id,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(workerBalancer.account_id),
      payload
    );

    const deleted = await this.workerService.deleteWorkerById(
      accountId,
      workerId
    );

    if (!deleted) {
      throw new Error(t('whatsapp_official_disconnect_error'));
    }

    await this.workerWhatsappOfficialConnectionRepository.softDeleteByWorkerId(
      workerId
    );

    const metaResult = await this.unsubscribeMetaIfLastWabaConnection({
      t,
      workerId,
      wabaId: connection.waba_id,
      accessTokenEncrypted: connection.access_token_encrypted,
      apiVersion: connection.api_version,
    });

    return {
      worker_id: workerId,
      disconnected: true,
      ...metaResult,
    };
  }
}
