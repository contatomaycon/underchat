import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { buildOfficialWhatsappDisplayFromTemplate } from '@core/common/functions/officialWhatsappDisplay';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import {
  IOfficialWhatsappTemplate,
  IOfficialWhatsappTemplateMessage,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { OfficialTemplateMessageRequest } from '@core/schema/chat/startChatWithContact/request.schema';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { ChatService } from '@core/services/chat.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';

@injectable()
export class SendOfficialTemplateToChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWhatsappConversationWindowService,
    @inject('Redis') private readonly redis?: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    userId: string,
    input: OfficialTemplateMessageRequest,
    _actions: IJwtGroupHierarchy[],
    _userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<IChat> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((channel) => channel.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    if (!isChatParticipant(chat, userId)) {
      throw new Error(t('chat_access_denied'));
    }

    const workerType = chat.worker?.type_id
      ? { worker_type_id: chat.worker.type_id }
      : await this.workerService.viewWorkerType(accountId, chat.worker.id);

    if (workerType?.worker_type_id !== EWorkerType.whatsapp) {
      throw new Error(t('official_opening_only_official_channel'));
    }

    const officialChat: IChat = {
      ...chat,
      worker: {
        ...chat.worker,
        type_id: EWorkerType.whatsapp,
        is_official: true,
      },
    };
    const sendInsideLock = async (): Promise<IChat> => {
      const officialWindow =
        await this.officialWindowService.resolveAuthoritativeForChat(
          officialChat,
          new Date()
        );
      if (officialWindow.state === 'send_uncertain') {
        throw new Error(t('whatsapp_official_template_send_uncertain'));
      }
      if (!officialWindow.can_send_template) {
        throw new Error(t('whatsapp_official_waiting_contact_reply'));
      }

      const template = await this.resolveOfficialTemplate(
        t,
        officialChat.worker.id,
        input,
        officialChat
      );
      const message = await this.buildTemplateMessage(
        officialChat,
        userId,
        template
      );

      const reservedChat =
        await this.officialWindowService.recordTemplateSentForChat(
          officialChat,
          {
            messageId: message.message_id,
            sentAt: message.date,
          }
        );

      try {
        const accepted =
          await this.chatMessageService.publishPreparedMessage(message);
        if (!accepted) {
          throw new Error('official_template_queue_not_accepted');
        }
      } catch (error) {
        await this.officialWindowService.recordTemplateFailureForMessage(
          message
        );
        throw error;
      }

      const authoritativeWindow =
        await this.officialWindowService.resolveAuthoritativeForChat(
          officialChat,
          new Date()
        );
      return {
        ...(reservedChat ?? officialChat),
        official_window: authoritativeWindow,
      };
    };

    if (!this.redis) {
      return sendInsideLock();
    }

    return withLock(
      this.redis,
      buildChatIdentityLockKey(accountId, officialChat.worker.id, {
        phone: officialChat.phone,
        remoteJid: officialChat.message_key?.remote_jid ?? null,
      }),
      sendInsideLock,
      { ttlMs: 30_000, retryMs: 100, maxWaitMs: 30_000 }
    );
  }

  private async resolveOfficialTemplate(
    t: TFunction<'translation', undefined>,
    workerId: string,
    input: OfficialTemplateMessageRequest,
    chat: IChat
  ): Promise<IOfficialWhatsappTemplateMessage> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
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
    const templates =
      this.officialWhatsappTemplateService.normalizeTemplates(
        approvedTemplates
      );
    const template = this.officialWhatsappTemplateService.findTemplate(
      templates,
      input
    );

    if (!template) {
      throw new Error(t('official_template_not_approved_or_not_found'));
    }

    let variables: IOfficialWhatsappTemplateMessage['variables'];
    try {
      const resolvedValues = input.variables?.map((variable) => ({
        ...variable,
        value: replaceMessageTags({
          message: this.officialWhatsappTemplateService.normalizeVariableValue(
            variable.value
          ),
          chat,
          t,
        }),
      }));
      variables = this.officialWhatsappTemplateService.validateVariableValues({
        template,
        values: resolvedValues,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'official_template_variables_required' ||
          error.message === 'official_template_variable_value_invalid' ||
          error.message === 'official_template_variables_invalid')
      ) {
        throw new Error(t('official_template_variables_required'));
      }

      throw error;
    }

    return this.buildOfficialTemplateMessage(template, variables);
  }

  private buildOfficialTemplateMessage(
    template: IOfficialWhatsappTemplate,
    variables: IOfficialWhatsappTemplateMessage['variables']
  ): IOfficialWhatsappTemplateMessage {
    return {
      name: template.name,
      language: template.language,
      status: template.status,
      parameter_format: template.parameter_format,
      category: template.category,
      components: template.components,
      variables,
      preview: template.preview,
    };
  }

  private async buildTemplateMessage(
    chat: IChat,
    userId: string,
    template: IOfficialWhatsappTemplateMessage
  ): Promise<IChatMessage> {
    const user = await this.userService.viewUserNamePhoto(userId);
    const messageText = this.officialWhatsappTemplateService.buildPreviewText(
      {
        id: null,
        name: template.name,
        language: template.language,
        status: 'APPROVED',
        category: template.category ?? null,
        components: template.components ?? [],
        variables:
          template.components?.flatMap((component) => [
            ...(component.variables ?? []),
            ...(component.buttons?.flatMap(
              (button) => button.variables ?? []
            ) ?? []),
          ]) ?? [],
        preview: template.preview ?? {},
      },
      template.variables
    );

    return {
      message_id: uuidv7(),
      chat_id: chat.chat_id,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: user
        ? {
            id: user.id,
            name: user.name,
            photo: user.photo ?? null,
          }
        : (chat.user ?? null),
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      content: {
        type: EMessageType.official_template,
        message: messageText,
        official_template: template,
        official: {
          provider: 'meta_whatsapp',
          type: 'template',
          display: buildOfficialWhatsappDisplayFromTemplate(
            template,
            messageText
          ),
        },
      },
      date: new Date().toISOString(),
    };
  }
}
