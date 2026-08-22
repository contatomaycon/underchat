import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { OfficialConversationContextResponse } from '@core/schema/chat/officialConversationContext/response.schema';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import { ChatService } from '@core/services/chat.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

@injectable()
export class OfficialConversationContextViewerUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWhatsappConversationWindowService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<OfficialConversationContextResponse> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const canReadChat = canReadChatByPolicy({
      chat,
      userId,
      actions,
      userSectors,
      userChannels,
    });

    if (!canReadChat) {
      throw new Error(t('chat_access_denied'));
    }

    const workerType = chat.worker?.type_id
      ? { worker_type_id: chat.worker.type_id }
      : await this.workerService.viewWorkerType(accountId, chat.worker.id);

    if (workerType?.worker_type_id !== EWorkerType.whatsapp) {
      throw new Error(t('official_opening_only_official_channel'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        chat.worker.id
      );

    if (!connection) {
      throw new Error(t('official_opening_connection_not_found'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const approvedTemplates =
      await this.metaWhatsappEmbeddedService.listApprovedMessageTemplates({
        apiVersion: connection.api_version,
        accessToken,
        wabaId: connection.waba_id,
      });

    const officialWindow =
      await this.officialWindowService.resolveAuthoritativeForChat({
        ...chat,
        worker: {
          ...chat.worker,
          type_id: EWorkerType.whatsapp,
          is_official: true,
        },
      });

    return {
      chat_id: chat.chat_id,
      worker_id: chat.worker.id,
      contact_id: chat.contact?.id ?? null,
      phone: chat.phone,
      is_official: true,
      official_window: officialWindow,
      templates:
        this.officialWhatsappTemplateService.normalizeTemplates(
          approvedTemplates
        ),
    };
  }
}
