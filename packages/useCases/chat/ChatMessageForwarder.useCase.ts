import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { ChatService } from '@core/services/chat.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { ContactService } from '@core/services/contact.service';
import { StartChatWithContactUseCase } from '@core/useCases/chat/StartChatWithContact.useCase';
import { UserService } from '@core/services/user.service';
import {
  ForwardMessageBody,
  ForwardMessageParams,
} from '@core/schema/chat/forwardMessage/request.schema';
import {
  ForwardMessageResponse,
  ForwardMessageResult,
} from '@core/schema/chat/forwardMessage/response.schema';
import { isChatParticipant } from '@core/common/functions/chatParticipants';

type ForwardTargetType = 'chat' | 'contact';

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
    private readonly chatMessageService: ChatMessageService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(StartChatWithContactUseCase)
    private readonly startChatWithContactUseCase: StartChatWithContactUseCase
  ) {}

  private normalizeChatUser(
    user?: { id: string; name: string; photo?: string | null } | null
  ): IChat['user'] | null {
    if (!user?.id || !user?.name) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
    };
  }

  private findChatUserById(chat: IChat, userId: string): IChat['user'] | null {
    if (chat.user?.id === userId) {
      return this.normalizeChatUser(chat.user);
    }

    const secondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];
    const secondaryUser = secondaryUsers.find((user) => user?.id === userId);

    return this.normalizeChatUser(secondaryUser);
  }

  private async resolveActorUser(
    chat: IChat,
    userId: string
  ): Promise<IChat['user'] | null> {
    const userData = await this.userService.viewUserNamePhoto(userId);
    if (userData) {
      return this.normalizeChatUser(userData);
    }

    const participantUser = this.findChatUserById(chat, userId);
    if (participantUser) {
      return participantUser;
    }

    return this.normalizeChatUser(chat.user);
  }

  private canAccessChat(
    chat: IChat,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): boolean {
    void actions;
    void userSectors;

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        return false;
      }
    }

    return isChatParticipant(chat, userId);
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
    targetChat: IChat,
    actorUser: IChat['user'] | null
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
      user: actorUser,
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

  private hasChannelAccess(
    workerId: string,
    userChannels: { id: string; name: string }[]
  ): boolean {
    if (userChannels.length === 0) {
      return true;
    }

    return userChannels.some((channel) => channel.id === workerId);
  }

  private buildResult(input: {
    targetType: ForwardTargetType;
    status: 'sent' | 'failed';
    targetChatId?: string | null;
    targetContactId?: string | null;
    message?: string | null;
  }): ForwardMessageResult {
    return {
      target_type: input.targetType,
      target_chat_id: input.targetChatId ?? null,
      target_contact_id: input.targetContactId ?? null,
      status: input.status,
      message: input.message ?? null,
    };
  }

  private async publishForwardMessage(input: {
    t: TFunction<'translation', undefined>;
    sourceMessage: IChatMessage;
    sourceContent: NonNullable<IChatMessage['content']>;
    targetChat: IChat;
    targetType: ForwardTargetType;
    targetContactId?: string | null;
    actorUser: IChat['user'] | null;
  }): Promise<ForwardMessageResult> {
    const {
      t,
      sourceMessage,
      sourceContent,
      targetChat,
      targetType,
      targetContactId = null,
      actorUser,
    } = input;

    if (!targetChat.worker?.id) {
      return this.buildResult({
        targetType,
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'failed',
        message: t('worker_not_found'),
      });
    }

    if (
      !targetChat.message_key?.remote_jid &&
      !targetChat.message_key?.remote_jid_alt
    ) {
      return this.buildResult({
        targetType,
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'failed',
        message: t('message_jid_not_found'),
      });
    }

    try {
      const messageToForward = this.buildForwardedMessage(
        sourceMessage,
        sourceContent,
        targetChat,
        actorUser
      );

      const published =
        await this.chatMessageService.publishPreparedMessage(messageToForward);

      if (!published) {
        return this.buildResult({
          targetType,
          targetChatId: targetChat.chat_id,
          targetContactId,
          status: 'failed',
          message: t('chat_forward_publish_failed'),
        });
      }

      return this.buildResult({
        targetType,
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'sent',
        message: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('chat_forward_error');

      return this.buildResult({
        targetType,
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'failed',
        message: errorMessage,
      });
    }
  }

  private async forwardToChatTarget(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    sourceChatId: string;
    sourceMessage: IChatMessage;
    sourceContent: NonNullable<IChatMessage['content']>;
    targetChatId: string;
    userId: string;
    actions: IJwtGroupHierarchy[];
    userSectors: string[];
    userChannels: { id: string; name: string }[];
    actorUser: IChat['user'] | null;
  }): Promise<ForwardMessageResult> {
    const {
      t,
      accountId,
      sourceChatId,
      sourceMessage,
      sourceContent,
      targetChatId,
      userId,
      actions,
      userSectors,
      userChannels,
      actorUser,
    } = input;

    if (targetChatId === sourceChatId) {
      return this.buildResult({
        targetType: 'chat',
        targetChatId,
        status: 'failed',
        message: t('chat_forward_same_chat_not_allowed'),
      });
    }

    const targetChat = await this.chatService.findChatByChatId(
      accountId,
      targetChatId
    );

    if (!targetChat) {
      return this.buildResult({
        targetType: 'chat',
        targetChatId,
        status: 'failed',
        message: t('chat_not_found'),
      });
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
      return this.buildResult({
        targetType: 'chat',
        targetChatId,
        status: 'failed',
        message: t('chat_access_denied'),
      });
    }

    return this.publishForwardMessage({
      t,
      sourceMessage,
      sourceContent,
      targetChat,
      targetType: 'chat',
      actorUser,
    });
  }

  private async forwardToContactTarget(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    sourceChatId: string;
    sourceMessage: IChatMessage;
    sourceContent: NonNullable<IChatMessage['content']>;
    targetContactId: string;
    workerId: string;
    userId: string;
    actions: IJwtGroupHierarchy[];
    userSectors: string[];
    userChannels: { id: string; name: string }[];
    actorUser: IChat['user'] | null;
  }): Promise<ForwardMessageResult> {
    const {
      t,
      accountId,
      sourceChatId,
      sourceMessage,
      sourceContent,
      targetContactId,
      workerId,
      userId,
      actions,
      userSectors,
      userChannels,
      actorUser,
    } = input;

    if (!this.hasChannelAccess(workerId, userChannels)) {
      return this.buildResult({
        targetType: 'contact',
        targetContactId,
        status: 'failed',
        message: t('chat_forward_contact_channel_not_allowed'),
      });
    }

    const contact = await this.contactService.viewContactById(
      targetContactId,
      accountId
    );

    if (!contact) {
      return this.buildResult({
        targetType: 'contact',
        targetContactId,
        status: 'failed',
        message: t('chat_forward_contact_not_found'),
      });
    }

    const contactChannelIds =
      await this.contactService.listContactChannelsByContactId(
        accountId,
        targetContactId
      );
    if (contactChannelIds.length > 0 && !contactChannelIds.includes(workerId)) {
      return this.buildResult({
        targetType: 'contact',
        targetContactId,
        status: 'failed',
        message: t('chat_forward_contact_channel_not_allowed'),
      });
    }

    if (contact.is_valided !== true) {
      return this.buildResult({
        targetType: 'contact',
        targetContactId,
        status: 'failed',
        message: t('chat_forward_contact_not_validated'),
      });
    }

    let targetChat: IChat;
    try {
      targetChat = await this.startChatWithContactUseCase.execute(
        t,
        accountId,
        userId,
        {
          contact_id: targetContactId,
          worker_id: workerId,
        },
        userChannels,
        { onExistingInChat: 'reuse_and_takeover' }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('chat_forward_error');
      return this.buildResult({
        targetType: 'contact',
        targetContactId,
        status: 'failed',
        message: errorMessage,
      });
    }

    if (targetChat.chat_id === sourceChatId) {
      return this.buildResult({
        targetType: 'contact',
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'failed',
        message: t('chat_forward_same_chat_not_allowed'),
      });
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
      return this.buildResult({
        targetType: 'contact',
        targetChatId: targetChat.chat_id,
        targetContactId,
        status: 'failed',
        message: t('chat_access_denied'),
      });
    }

    return this.publishForwardMessage({
      t,
      sourceMessage,
      sourceContent,
      targetChat,
      targetType: 'contact',
      targetContactId,
      actorUser,
    });
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
    const targetChatIds = body.target_chat_ids ?? [];
    const targetContactIds = body.target_contact_ids ?? [];

    if (targetChatIds.length === 0 && targetContactIds.length === 0) {
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
    const actorUser = await this.resolveActorUser(sourceChat, userId);

    const results: ForwardMessageResult[] = [];
    let sent = 0;

    for (const targetChatId of targetChatIds) {
      const result = await this.forwardToChatTarget({
        t,
        accountId,
        sourceChatId: params.chat_id,
        sourceMessage,
        sourceContent,
        targetChatId,
        userId,
        actions,
        userSectors,
        userChannels,
        actorUser,
      });

      if (result.status === 'sent') {
        sent += 1;
      }

      results.push(result);
    }

    if (targetContactIds.length > 0 && !body.worker_id) {
      for (const targetContactId of targetContactIds) {
        results.push(
          this.buildResult({
            targetType: 'contact',
            targetContactId,
            status: 'failed',
            message: t('chat_forward_worker_required_for_contacts'),
          })
        );
      }
    } else if (targetContactIds.length > 0 && body.worker_id) {
      for (const targetContactId of targetContactIds) {
        const result = await this.forwardToContactTarget({
          t,
          accountId,
          sourceChatId: params.chat_id,
          sourceMessage,
          sourceContent,
          targetContactId,
          workerId: body.worker_id,
          userId,
          actions,
          userSectors,
          userChannels,
          actorUser,
        });

        if (result.status === 'sent') {
          sent += 1;
        }

        results.push(result);
      }
    }

    const requested = targetChatIds.length + targetContactIds.length;
    const failed = requested - sent;

    return {
      requested,
      sent,
      failed,
      results,
    };
  }
}
