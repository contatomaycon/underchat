import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { ChatService } from '@core/services/chat.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import {
  ForwardMessageBody,
  ForwardMessageParams,
} from '@core/schema/chat/forwardMessage/request.schema';
import {
  ForwardMessageResponse,
  ForwardMessageResult,
} from '@core/schema/chat/forwardMessage/response.schema';

@injectable()
export class ChatMessageForwarderUseCase {
  private readonly FORWARD_ALLOWED_TYPES = new Set<EMessageType>([
    EMessageType.text,
    EMessageType.image,
    EMessageType.document,
    EMessageType.audio,
    EMessageType.video,
    EMessageType.video_note,
    EMessageType.sticker,
    EMessageType.location,
    EMessageType.contact_card,
    EMessageType.contacts,
  ]);

  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService
  ) {}

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canViewChatsInSector(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_in_sector,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canListAllChatsWithoutSectorLimit(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_without_sector_limit,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canAccessChat(
    chat: IChat,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): boolean {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        return false;
      }
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);
    if (canViewOthers || canListAll) return true;

    const isOwnChat = chat.user?.id === userId;
    if (isOwnChat) return true;

    const canViewInSector = this.canViewChatsInSector(actions);
    if (!canViewInSector) return false;

    if (
      userSectors.length > 0 &&
      chat.sector?.id &&
      userSectors.includes(chat.sector.id)
    )
      return true;
    if (userSectors.length === 0 && !chat.sector?.id) return true;
    if (canViewInSector && !chat.sector?.id) return true;

    return false;
  }

  private ensureSourceCanBeForwarded(
    t: TFunction<'translation', undefined>,
    message: IChatMessage
  ): NonNullable<IChatMessage['content']> {
    if (message.deleted) {
      throw new Error(t('chat_forward_deleted_message_not_allowed'));
    }

    if (!message.content) {
      throw new Error(t('message_not_found'));
    }

    if (message.content.type === EMessageType.view_once) {
      throw new Error(t('chat_forward_type_not_supported'));
    }

    if (message.message_key?.is_view_once === true) {
      throw new Error(t('chat_forward_type_not_supported'));
    }

    if (!this.FORWARD_ALLOWED_TYPES.has(message.content.type)) {
      throw new Error(t('chat_forward_type_not_supported'));
    }

    return message.content;
  }

  private buildForwardedContextInfo(
    sourceContent: NonNullable<IChatMessage['content']>
  ): NonNullable<IChatMessage['content']>['context_info'] {
    const sourceContext = sourceContent.context_info ?? null;
    const sourceScore =
      typeof sourceContext?.forwarding_score === 'number'
        ? sourceContext.forwarding_score
        : 0;

    return {
      ...(sourceContext ?? {}),
      is_forwarded: true,
      forwarding_score: Math.max(1, sourceScore),
    };
  }

  private normalizeMessageKey(
    key?: IChatMessage['message_key'] | null
  ): IChatMessage['message_key'] | null {
    if (!key) {
      return null;
    }

    return {
      remote_jid: key.remote_jid ?? null,
      remote_jid_alt: key.remote_jid_alt ?? null,
      from_me: key.from_me ?? null,
      id: key.id ?? null,
      participant: key.participant ?? null,
      participant_alt: key.participant_alt ?? null,
      addressing_mode: key.addressing_mode ?? null,
      is_view_once: key.is_view_once ?? false,
    };
  }

  private buildForwardedContent(
    sourceMessage: IChatMessage,
    sourceContent: NonNullable<IChatMessage['content']>
  ): NonNullable<IChatMessage['content']> {
    return {
      type: sourceContent.type,
      message: sourceContent.message ?? null,
      link_preview: sourceContent.link_preview ?? null,
      image: sourceContent.image ?? null,
      video: sourceContent.video ?? null,
      document: sourceContent.document ?? null,
      audio: sourceContent.audio ?? null,
      sticker: sourceContent.sticker ?? null,
      location: sourceContent.location ?? null,
      contact: sourceContent.contact ?? null,
      contacts: sourceContent.contacts ?? null,
      context_info: this.buildForwardedContextInfo(sourceContent),
      forward: {
        source_message_id: sourceMessage.message_id,
        source_chat_id: sourceMessage.chat_id,
        source_type: sourceContent.type,
        source_worker_id: sourceMessage.worker?.id ?? null,
        source_message_key: this.normalizeMessageKey(sourceMessage.message_key),
      },
    };
  }

  private buildForwardedMessage(
    sourceMessage: IChatMessage,
    sourceContent: NonNullable<IChatMessage['content']>,
    targetChat: IChat
  ): IChatMessage {
    return {
      message_id: uuidv7(),
      chat_id: targetChat.chat_id,
      message_key: {
        remote_jid: targetChat.message_key?.remote_jid ?? null,
        remote_jid_alt: targetChat.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: targetChat.account,
      worker: targetChat.worker,
      user: targetChat.user,
      phone: targetChat.phone,
      content: this.buildForwardedContent(sourceMessage, sourceContent),
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      date: new Date().toISOString(),
      deleted: false,
      has_quoted: false,
      hash: uuidv7(),
    };
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: ForwardMessageParams,
    body: ForwardMessageBody,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ForwardMessageResponse> {
    if (!body.target_chat_ids || body.target_chat_ids.length === 0) {
      throw new Error(t('chat_forward_target_chat_ids_required'));
    }

    const sourceChat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!sourceChat) {
      throw new Error(t('chat_not_found'));
    }

    if (
      !this.canAccessChat(
        sourceChat,
        userId,
        actions,
        userSectors,
        userChannels
      )
    ) {
      throw new Error(t('chat_access_denied'));
    }

    const sourceMessage = await this.chatService.findMessageByMessageId(
      accountId,
      params.message_id
    );

    if (!sourceMessage) {
      throw new Error(t('message_not_found'));
    }

    if (sourceMessage.chat_id !== params.chat_id) {
      throw new Error(t('message_chat_mismatch'));
    }

    const sourceContent = this.ensureSourceCanBeForwarded(t, sourceMessage);

    const results: ForwardMessageResult[] = [];
    let sent = 0;

    for (const targetChatId of body.target_chat_ids) {
      if (targetChatId === params.chat_id) {
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: t('chat_forward_same_chat_not_allowed'),
        });
        continue;
      }

      const targetChat = await this.chatService.findChatByChatId(
        accountId,
        targetChatId
      );

      if (!targetChat) {
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: t('chat_not_found'),
        });
        continue;
      }

      if (
        !this.canAccessChat(
          targetChat,
          userId,
          actions,
          userSectors,
          userChannels
        )
      ) {
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: t('chat_access_denied'),
        });
        continue;
      }

      if (!targetChat.worker?.id) {
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: t('worker_not_found'),
        });
        continue;
      }

      if (
        !targetChat.message_key?.remote_jid &&
        !targetChat.message_key?.remote_jid_alt
      ) {
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: t('message_jid_not_found'),
        });
        continue;
      }

      try {
        const messageToForward = this.buildForwardedMessage(
          sourceMessage,
          sourceContent,
          targetChat
        );

        const published =
          await this.chatMessageService.publishPreparedMessage(
            messageToForward
          );

        if (!published) {
          results.push({
            target_chat_id: targetChatId,
            status: 'failed',
            message: t('chat_forward_publish_failed'),
          });
          continue;
        }

        sent += 1;
        results.push({
          target_chat_id: targetChatId,
          status: 'sent',
          message: null,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t('chat_forward_error');
        results.push({
          target_chat_id: targetChatId,
          status: 'failed',
          message: errorMessage,
        });
      }
    }

    const requested = body.target_chat_ids.length;
    const failed = requested - sent;

    return {
      requested,
      sent,
      failed,
      results,
    };
  }
}
