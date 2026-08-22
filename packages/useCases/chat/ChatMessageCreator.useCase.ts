import { injectable, inject } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage, IReaction } from '@core/common/interfaces/IChatMessage';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import Redis from 'ioredis';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IUploadFileInput } from '@core/common/interfaces/IUploadFileInput';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { UserService } from '@core/services/user.service';
import { IMessageContext } from '@core/common/interfaces/IMessageContext';
import { IChatContext } from '@core/common/interfaces/IChatContext';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { createChatCacheKeyChatId } from '@core/common/functions/createCacheKey';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { isUuidLike } from '@core/common/functions/isUuidLike';
import {
  buildDeterministicMessageHash,
  buildMessageSendQueueKey,
  ensureMessageSendHash,
  resolveWorkerCommandChatEntityKey,
} from '@core/common/functions/messageIdentity';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { shouldResetAttendanceInactivityFromOperatorMessageType } from '@core/common/functions/attendanceInactivityInteraction';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { WorkerCommandAdmissionService } from '@core/services/workerCommandAdmission.service';
import { workerCommandMessagePayload } from '@core/common/functions/workerCommandMessagePayload';
import { currentWorkerCommandRetryOf } from '@core/common/functions/workerCommandAcceptanceContext';
import { v7 as uuidv7 } from 'uuid';

interface IActionMessageResult {
  sent: boolean;
  reactionTargetTypeUser?: ETypeUserChat | null;
}

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerCommandAdmissionService)
    private readonly workerCommandAdmissionService: WorkerCommandAdmissionService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(MessageTemplateService)
    private readonly messageTemplateService: MessageTemplateService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWhatsappConversationWindowService = {
      assertCanSendFreeform: async () => undefined,
    } as unknown as OfficialWhatsappConversationWindowService
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

  private async resolveSenderContext(
    chat: IChat,
    typeUser: ETypeUserChat,
    userId: string
  ): Promise<{ senderUser: IChat['user'] | null; senderName: string | null }> {
    if (typeUser !== ETypeUserChat.operator) {
      return {
        senderUser: null,
        senderName: null,
      };
    }

    const userData = await this.userService.viewUserNamePhoto(userId);
    if (userData) {
      const senderUser = this.normalizeChatUser(userData);
      return {
        senderUser,
        senderName: senderUser?.name ?? null,
      };
    }

    const participantUser = this.findChatUserById(chat, userId);
    if (participantUser) {
      return {
        senderUser: participantUser,
        senderName: participantUser.name,
      };
    }

    const primaryUser = this.normalizeChatUser(chat.user);
    return {
      senderUser: primaryUser,
      senderName: primaryUser?.name ?? null,
    };
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

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IChat | null> {
    const cacheKey = createChatCacheKeyChatId(accountId, chatId);
    const cache = await this.redis.get(cacheKey);

    if (cache) {
      return JSON.parse(cache) as IChat;
    }

    const queryElastic = {
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const data = result?.hits.hits[0]?._source as IChat | null;

    if (!data) {
      return null;
    }

    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', 1800);

    return data;
  }

  private centrifugoChatPublish(dataPublish: IChatMessage): Promise<any> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  private validate(
    t: TFunction<'translation', undefined>,
    body: CreateMessageChatsBody
  ) {
    if (
      (body.type === EMessageType.text || body.type === EMessageType.system) &&
      !body.message
    ) {
      throw new Error(t('message_content_required'));
    }
  }

  private normalizeImagesArray(images?: IUploadFileInput): UploadFileRequest[] {
    if (!images) return [];

    if (Array.isArray(images)) {
      return images;
    }

    return [images];
  }

  private normalizeDocumentsArray(
    documents?: IUploadFileInput
  ): UploadFileRequest[] {
    if (!documents) return [];

    if (Array.isArray(documents)) {
      return documents;
    }

    return [documents];
  }

  private normalizeVideosArray(videos?: IUploadFileInput): UploadFileRequest[] {
    if (!videos) return [];

    if (Array.isArray(videos)) {
      return videos;
    }

    return [videos];
  }

  private normalizeAudiosArray(audios?: IUploadFileInput): UploadFileRequest[] {
    if (!audios) return [];

    if (Array.isArray(audios)) {
      return audios;
    }

    return [audios];
  }

  private normalizeContactsArray(
    contacts?: string | string[] | { value?: string | string[] } | null
  ): string[] {
    if (!contacts) return [];

    if (typeof contacts === 'object' && 'value' in contacts) {
      return this.normalizeContactsArray(contacts.value);
    }

    if (Array.isArray(contacts)) {
      return contacts.filter(
        (c): c is string => typeof c === 'string' && c.trim().length > 0
      );
    }

    if (typeof contacts === 'string' && contacts.trim().length > 0) {
      return [contacts];
    }

    return [];
  }

  private normalizeType(type: string | { value?: string }): EMessageType {
    if (type && typeof type === 'object' && 'value' in type && type.value) {
      return type.value as EMessageType;
    }

    return type as EMessageType;
  }

  private normalizeMessage(
    message?: string | { value?: string } | null
  ): string | null {
    const rawValue = this.extractFieldValue(message);
    if (rawValue === null) {
      return null;
    }

    const normalizedValue = String(rawValue);
    if (normalizedValue === 'null' || normalizedValue === 'undefined') {
      return null;
    }

    return normalizedValue;
  }

  private normalizeDurationField(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value) && value.length > 0) {
      return this.normalizeDurationField(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('value' in record) {
        return this.normalizeDurationField(record.value);
      }
      return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    return numeric;
  }

  private normalizeBooleanFromString(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return false;
    }
    if (trimmed === 'true') return true;
    if (trimmed === '1') return true;
    if (trimmed === 'on') return true;
    return false;
  }

  private normalizeBooleanField(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (Array.isArray(value) && value.length > 0) {
      return this.normalizeBooleanField(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('value' in record) {
        return this.normalizeBooleanField(record.value);
      }
      return false;
    }

    if (typeof value === 'string') {
      return this.normalizeBooleanFromString(value);
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return false;
  }

  private extractFieldValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return this.extractFieldValue(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;

      if ('value' in record) {
        return this.extractFieldValue(record.value);
      }

      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private normalizeMessageQuotedId(
    messageQuotedId: CreateMessageChatsBody['message_quoted_id']
  ): string | null {
    const rawValue = this.extractFieldValue(messageQuotedId);
    if (!rawValue) {
      return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
  }

  private normalizeHash(hash: CreateMessageChatsBody['hash']): string | null {
    const rawValue = this.extractFieldValue(hash);
    if (!rawValue) {
      return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
  }

  private normalizeLocationCoordinate(
    coordinate?: number | string | { value?: number | string } | null
  ): number | null {
    const rawValue = this.extractFieldValue(coordinate);
    if (!rawValue) {
      return null;
    }

    const numValue =
      typeof rawValue === 'number'
        ? rawValue
        : Number.parseFloat(String(rawValue));
    if (Number.isNaN(numValue)) {
      return null;
    }

    return numValue;
  }

  private normalizeLocationField(
    field?: string | { value?: string } | null
  ): string | null {
    const rawValue = this.extractFieldValue(field);
    if (!rawValue) {
      return null;
    }

    const trimmed = String(rawValue).trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
  }

  private async getMessage(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    return this.chatService.findMessageByMessageId(accountId, messageId);
  }

  private async updateMessageReaction(
    message: IChatMessage,
    emoji: string,
    userId: string,
    userName: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<IChatMessage> {
    const existingReactions = message.content?.reactions || [];

    // Build a set of JIDs that belong to the contact (not the operator)
    const contactJids = new Set<string>();
    const contactJid = normalizeJid(message.message_key?.remote_jid);
    const contactJidAlt = normalizeJid(message.message_key?.remote_jid_alt);
    if (contactJid) contactJids.add(contactJid);
    if (contactJidAlt) contactJids.add(contactJidAlt);

    const reactionsWithoutUser = existingReactions.filter((reaction) => {
      const rid = reaction.user_id;
      if (!rid) return true;

      // Exact match with operator UUID
      if (rid === userId) return false;

      // Legacy UUID from operator (not a JID, so it's an old format)
      if (isUuidLike(rid)) return false;

      // JID that does NOT belong to the contact → it's the operator's JID/LID
      const normalizedRid = normalizeJid(rid) ?? rid;
      if (!contactJids.has(normalizedRid)) return false;

      return true;
    });

    let updatedReactions: IReaction[] = reactionsWithoutUser;
    if (emoji) {
      updatedReactions = [
        ...reactionsWithoutUser,
        {
          emoji,
          user_id: userId,
          user_name: userName,
        },
      ];
    }

    let reactionsValue: IReaction[] | null = null;
    if (updatedReactions.length > 0) {
      reactionsValue = updatedReactions;
    }

    const updatedContent: IChatMessage['content'] = {
      ...message.content,
      type: message.content?.type ?? EMessageType.text,
      reactions: reactionsValue,
    };

    const updatedMessage: IChatMessage = {
      ...message,
      content: updatedContent,
      has_quoted: message.has_quoted,
    };
    const reactionRevision =
      message.outbound_webhook_event_ids?.at(-1) ??
      message.hash ??
      message.date;

    const persisted = await this.chatService.saveMessageChat(updatedMessage, {
      eventTypes: ['message.reaction.updated'],
      idempotencyKey: `message-reaction:${updatedMessage.message_id}:${userId}:${JSON.stringify(
        existingReactions
      )}:${emoji ?? ''}:${reactionRevision}`,
      source: webhookSource,
      previousMessage: message,
      actor: { type: 'user', id: userId },
      changes: {
        emoji: emoji || null,
        actor_id: userId,
        origin: webhookSource,
      },
    });
    if (!persisted) {
      throw new Error('message_reaction_update_failed');
    }

    return updatedMessage;
  }

  private async processActionMessages(
    type: EMessageType,
    body: CreateMessageChatsBody,
    chat: IChat,
    chatId: string,
    accountId: string,
    context: IMessageContext
  ): Promise<IActionMessageResult | null> {
    if (type === EMessageType.delete_message && body.delete_message_id) {
      return {
        sent: await this.processDelete(
          chat,
          chatId,
          accountId,
          body.delete_message_id,
          context
        ),
      };
    }

    if (
      type === EMessageType.react &&
      body.reaction_message_id &&
      body.reaction_emoji !== null &&
      body.reaction_emoji !== undefined
    ) {
      return this.processReaction(
        { chat, chatId, accountId },
        body.reaction_message_id,
        body.reaction_emoji,
        context
      );
    }

    return null;
  }

  private shouldResetOperatorInactivity(
    typeUser: ETypeUserChat,
    messageType: EMessageType,
    reactionTargetTypeUser?: ETypeUserChat | null
  ): boolean {
    if (typeUser !== ETypeUserChat.operator) {
      return false;
    }

    if (messageType === EMessageType.react) {
      return reactionTargetTypeUser === ETypeUserChat.client;
    }

    return shouldResetAttendanceInactivityFromOperatorMessageType(messageType);
  }

  private async resetOperatorInactivityIfNeeded(
    chat: IChat,
    typeUser: ETypeUserChat,
    messageType: EMessageType,
    sent: boolean,
    reactionTargetTypeUser?: ETypeUserChat | null
  ): Promise<void> {
    if (!sent || chat.status !== EChatStatus.in_chat) {
      return;
    }

    if (
      typeUser === ETypeUserChat.operator &&
      messageType === EMessageType.annotation
    ) {
      await this.attendanceInactivityService.resetOnOperatorAnnotationMessage(
        chat
      );
      return;
    }

    if (
      !this.shouldResetOperatorInactivity(
        typeUser,
        messageType,
        reactionTargetTypeUser
      )
    ) {
      return;
    }

    await this.attendanceInactivityService.resetOnOperatorMessage(chat);
  }

  private async isOfficialWorker(chat: IChat): Promise<boolean> {
    if (
      chat.worker?.is_official === true ||
      chat.worker?.type_id === EWorkerType.whatsapp
    ) {
      return true;
    }

    if (!chat.account?.id || !chat.worker?.id) {
      return false;
    }

    const workerType = await this.workerService.viewWorkerType(
      chat.account.id,
      chat.worker.id
    );

    return workerType?.worker_type_id === EWorkerType.whatsapp;
  }

  private async publishProviderActionMessage(
    chat: IChat,
    message: IChatMessage
  ): Promise<void> {
    if (await this.isOfficialWorker(chat)) {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.officialWhatsappSendMessage(),
        message,
        buildMessageSendQueueKey(message.account.id, message.chat_id)
      );
      return;
    }

    const workerId = message.worker.id?.trim();
    if (!workerId) {
      throw new Error('Worker ID is required to send provider action');
    }
    await this.workerCommandAdmissionService.admit({
      accountId: message.account.id,
      workerId,
      commandType: 'direct_send',
      entityKey: resolveWorkerCommandChatEntityKey(
        message.account.id,
        workerId,
        message
      ),
      operationId: message.message_id,
      retryOf: currentWorkerCommandRetryOf(),
      payload: workerCommandMessagePayload(message),
      source: 'chat_message_action',
    });
  }

  private async assertOfficialMessageTypeSupported(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    type: EMessageType,
    input: { audioViewOnce: boolean }
  ): Promise<void> {
    if (!(await this.isOfficialWorker(chat))) {
      return;
    }

    if (type === EMessageType.edit_text) {
      throw new Error(t('whatsapp_official_edit_message_not_supported'));
    }

    if (type === EMessageType.delete_message) {
      throw new Error(t('whatsapp_official_delete_message_not_supported'));
    }

    if (type === EMessageType.view_once || input.audioViewOnce) {
      throw new Error(t('whatsapp_official_view_once_not_supported'));
    }

    if (type === EMessageType.video_note) {
      throw new Error(t('whatsapp_official_video_note_not_supported'));
    }

    if (type === EMessageType.set_disappearing_messages) {
      throw new Error(
        t('whatsapp_official_disappearing_messages_not_supported')
      );
    }
  }

  private normalizeMessageFields(
    body: CreateMessageChatsBody,
    templateMessage: string | null
  ) {
    const hasMessageField = Object.prototype.hasOwnProperty.call(
      body,
      'message'
    );
    const messageSource = hasMessageField ? body.message : templateMessage;

    return {
      message: this.normalizeMessage(messageSource),
      images: this.normalizeImagesArray(body.images),
      documents: this.normalizeDocumentsArray(body.documents),
      videos: this.normalizeVideosArray(body.videos),
      videoDuration: this.normalizeDurationField(body.video_duration),
      audios: this.normalizeAudiosArray(body.audios),
      audioDuration: this.normalizeDurationField(body.audio_duration),
      audioViewOnce: this.normalizeBooleanField(body.audio_view_once),
      audioPtt: this.normalizeBooleanField(body.audio_ptt),
      messageQuotedId: this.normalizeMessageQuotedId(body.message_quoted_id),
      contacts: this.normalizeContactsArray(body.contacts),
      hash: this.normalizeHash(body.hash),
      locationLatitude: this.normalizeLocationCoordinate(
        body.location_latitude
      ),
      locationLongitude: this.normalizeLocationCoordinate(
        body.location_longitude
      ),
      locationName: this.normalizeLocationField(body.location_name),
      locationAddress: this.normalizeLocationField(body.location_address),
    };
  }

  private async sendContactMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    contactData: {
      message: string | null;
      messageQuotedId: string | null;
      contacts: string[];
    }
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.contact_card,
      message: contactData.message,
      messageId: messageContext.messageId,
      messageQuotedId: contactData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      contactIds: contactData.contacts,
    });
  }

  private async sendLocationMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    locationData: {
      latitude: number | null;
      longitude: number | null;
      name: string | null;
      address: string | null;
    }
  ): Promise<boolean> {
    if (locationData.latitude === null || locationData.longitude === null) {
      throw new Error(messageContext.t('location_coordinates_required'));
    }

    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.location,
      message: messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      name: locationData.name,
      address: locationData.address,
    });
  }

  private async sendDocumentMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    documentData: {
      documents: UploadFileRequest[];
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
    }
  ): Promise<boolean> {
    if (documentData.documents.length === 0 && !documentData.isQuickMessage) {
      throw new Error(messageContext.t('documents_required'));
    }
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.document,
      message: messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      documents:
        documentData.documents.length > 0 ? documentData.documents : undefined,
      documentUrl: documentData.isQuickMessage
        ? documentData.quickMessageUrl
        : undefined,
      documentMimetype: documentData.isQuickMessage
        ? documentData.quickMessageMimetype
        : undefined,
    });
  }

  private async sendVideoMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    videoData: {
      videos: UploadFileRequest[];
      videoDuration: number | null;
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageDuration: number | null;
      quickMessageWidth: number | null;
      quickMessageHeight: number | null;
    }
  ): Promise<boolean> {
    if (videoData.videos.length === 0 && !videoData.isQuickMessage) {
      throw new Error(messageContext.t('videos_required'));
    }
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.video,
      message: messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      videos: videoData.videos.length > 0 ? videoData.videos : undefined,
      videoUrl: videoData.isQuickMessage
        ? videoData.quickMessageUrl
        : undefined,
      videoMimetype: videoData.isQuickMessage
        ? videoData.quickMessageMimetype
        : undefined,
      videoDuration:
        videoData.videoDuration ??
        (videoData.isQuickMessage
          ? videoData.quickMessageDuration
          : undefined) ??
        undefined,
      videoWidth: videoData.isQuickMessage
        ? videoData.quickMessageWidth
        : undefined,
      videoHeight: videoData.isQuickMessage
        ? videoData.quickMessageHeight
        : undefined,
    });
  }

  private async sendAudioMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    audioData: {
      audios: UploadFileRequest[];
      audioDuration: number | null;
      audioPtt: boolean;
      audioViewOnce: boolean;
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageDuration: number | null;
    }
  ): Promise<boolean> {
    if (audioData.audios.length === 0 && !audioData.isQuickMessage) {
      throw new Error(messageContext.t('audio_required'));
    }

    const shouldDropCaptionAndQuote = audioData.isQuickMessage;

    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.audio,
      message: shouldDropCaptionAndQuote ? null : messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: shouldDropCaptionAndQuote
        ? null
        : messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      audios: audioData.audios.length > 0 ? audioData.audios : undefined,
      audioUrl: audioData.isQuickMessage
        ? audioData.quickMessageUrl
        : undefined,
      audioMimetype: audioData.isQuickMessage
        ? audioData.quickMessageMimetype
        : undefined,
      audioDuration:
        audioData.audioDuration ??
        (audioData.isQuickMessage
          ? audioData.quickMessageDuration
          : undefined) ??
        undefined,
      audioPtt: audioData.audioPtt,
      audioViewOnce: audioData.audioViewOnce,
    });
  }

  private async sendImageMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    imageData: {
      images: UploadFileRequest[];
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageWidth: number | null;
      quickMessageHeight: number | null;
    }
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.image,
      message: messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      images: imageData.images.length > 0 ? imageData.images : undefined,
      imageUrl: imageData.isQuickMessage
        ? imageData.quickMessageUrl
        : undefined,
      imageMimetype: imageData.isQuickMessage
        ? imageData.quickMessageMimetype
        : undefined,
      imageWidth: imageData.isQuickMessage
        ? imageData.quickMessageWidth
        : undefined,
      imageHeight: imageData.isQuickMessage
        ? imageData.quickMessageHeight
        : undefined,
    });
  }

  private async sendTextMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    type: EMessageType,
    linkPreview?: any
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: type as EMessageType.text | EMessageType.system,
      message: messageData.message,
      messageId: messageContext.messageId,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      senderName: messageContext.senderName,
      senderUser: messageContext.senderUser,
      securityKeyScopes: messageContext.securityKeyScopes,
      outboundWebhookSource: messageContext.webhookSource,
      linkPreview,
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody,
    typeUser: ETypeUserChat,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = [],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    this.validate(t, body);

    const chat = await this.getChat(accountId, params.chat_id);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!this.canAccessChat(chat, userId, actions, userSectors, userChannels)) {
      throw new Error(t('chat_access_denied'));
    }

    const { senderUser, senderName } = await this.resolveSenderContext(
      chat,
      typeUser,
      userId
    );

    const quickTemplateData = await this.resolveQuickMessageTemplate(
      t,
      accountId,
      chat,
      body
    );
    const {
      templateType,
      templateMessage,
      isQuickMessage,
      quickMessageUrl,
      quickMessageMimetype,
      quickMessageDuration,
      quickMessageWidth,
      quickMessageHeight,
    } = quickTemplateData;

    const type = templateType || this.normalizeType(body.type);

    if (templateType && templateType !== this.normalizeType(body.type)) {
      throw new Error(t('message_template_type_mismatch'));
    }

    const normalizedFields = this.normalizeMessageFields(body, templateMessage);
    const requestedOperationId = this.extractFieldValue(body.operation_id);
    const retryOf = this.extractFieldValue(body.retry_of);
    if (
      requestedOperationId !== null &&
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(requestedOperationId)
    ) {
      throw new Error('worker_command_operation_id_invalid');
    }
    const operationId =
      requestedOperationId ??
      (normalizedFields.hash
        ? buildDeterministicMessageHash(
            accountId,
            params.chat_id,
            `client:${normalizedFields.hash}`
          )
        : uuidv7());
    if (
      retryOf &&
      (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(retryOf) ||
        retryOf === operationId)
    ) {
      throw new Error('worker_command_retry_of_invalid');
    }
    const messageContext: IMessageContext = {
      t,
      hash: normalizedFields.hash,
      messageId: operationId,
      typeUser,
      senderName,
      senderUser,
      senderUserId: userId,
      securityKeyScopes: isQuickMessage ? ['quick_message'] : undefined,
      webhookSource,
    };

    if (messageContext.messageId) {
      const existingMessage = await this.chatService.findMessageByMessageId(
        accountId,
        messageContext.messageId
      );
      if (
        existingMessage?.chat_id === params.chat_id &&
        (!messageContext.hash || existingMessage.hash === messageContext.hash)
      ) {
        const retryResult =
          existingMessage.summary?.is_sent === true ||
          Boolean(existingMessage.message_key?.id)
            ? true
            : await this.chatMessageService.publishPreparedMessage(
                existingMessage,
                webhookSource,
                undefined,
                true
              );

        await this.resetOperatorInactivityIfNeeded(
          chat,
          typeUser,
          existingMessage.content?.type ?? this.normalizeType(body.type),
          retryResult,
          null
        );
        return retryResult;
      }
    }

    const isOfficialChat = await this.isOfficialWorker(chat);
    const chatForOfficialWindow: IChat = isOfficialChat
      ? {
          ...chat,
          worker: {
            ...chat.worker,
            type_id: EWorkerType.whatsapp,
            is_official: true,
          },
        }
      : chat;

    await this.assertOfficialMessageTypeSupported(
      t,
      chatForOfficialWindow,
      type,
      {
        audioViewOnce: normalizedFields.audioViewOnce,
      }
    );
    await this.officialWindowService.assertCanSendFreeform(
      t,
      chatForOfficialWindow,
      type
    );

    const actionResult = await this.processActionMessages(
      type,
      body,
      chat,
      params.chat_id,
      accountId,
      messageContext
    );
    if (actionResult !== null) {
      try {
        await this.resetOperatorInactivityIfNeeded(
          chat,
          typeUser,
          type,
          actionResult.sent,
          actionResult.reactionTargetTypeUser
        );
      } catch (error) {
        // The provider PubAck is the acceptance boundary. Attendance is a
        // projection and cannot turn an accepted action into an opaque retry.
        console.error(
          '[WorkerCommand] Failed to reset inactivity after accepted action:',
          error instanceof Error ? error.message : error
        );
      }
      return actionResult.sent;
    }

    let result = false;

    if (normalizedFields.contacts.length > 0) {
      result = await this.sendContactMessage(messageContext, chat, accountId, {
        message: normalizedFields.message,
        messageQuotedId: normalizedFields.messageQuotedId,
        contacts: normalizedFields.contacts,
      });
    }

    if (
      !result &&
      type === EMessageType.location &&
      normalizedFields.locationLatitude !== null &&
      normalizedFields.locationLongitude !== null
    ) {
      result = await this.sendLocationMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          latitude: normalizedFields.locationLatitude,
          longitude: normalizedFields.locationLongitude,
          name: normalizedFields.locationName,
          address: normalizedFields.locationAddress,
        }
      );
    }

    if (!result && type === EMessageType.document) {
      result = await this.sendDocumentMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          documents: normalizedFields.documents,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
        }
      );
    }

    if (!result && type === EMessageType.video) {
      result = await this.sendVideoMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          videos: normalizedFields.videos,
          videoDuration: normalizedFields.videoDuration,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageDuration,
          quickMessageWidth,
          quickMessageHeight,
        }
      );
    }

    if (!result && type === EMessageType.audio) {
      result = await this.sendAudioMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          audios: normalizedFields.audios,
          audioDuration: normalizedFields.audioDuration,
          audioPtt: normalizedFields.audioPtt,
          audioViewOnce: normalizedFields.audioViewOnce,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageDuration,
        }
      );
    }

    if (
      !result &&
      (normalizedFields.images.length > 0 ||
        (isQuickMessage && quickMessageUrl && type === EMessageType.image))
    ) {
      result = await this.sendImageMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          images: normalizedFields.images,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageWidth,
          quickMessageHeight,
        }
      );
    }

    if (!result) {
      result = await this.sendTextMessage(
        messageContext,
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        type,
        body.link_preview
      );
    }

    await this.resetOperatorInactivityIfNeeded(
      chat,
      typeUser,
      type,
      result,
      null
    );

    return result;
  }

  private async resolveQuickMessageTemplate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat,
    body: CreateMessageChatsBody
  ): Promise<{
    templateType: EMessageType | null;
    templateMessage: string | null;
    isQuickMessage: boolean;
    quickMessageUrl: string | null;
    quickMessageMimetype: string | null;
    quickMessageDuration: number | null;
    quickMessageWidth: number | null;
    quickMessageHeight: number | null;
  }> {
    const quickMessageTemplateIdRaw = body.quick_message_template_id;
    let quickMessageTemplateId: string | null = null;

    if (typeof quickMessageTemplateIdRaw === 'string') {
      quickMessageTemplateId = quickMessageTemplateIdRaw;
    }

    if (
      !quickMessageTemplateId &&
      quickMessageTemplateIdRaw &&
      typeof quickMessageTemplateIdRaw === 'object' &&
      'value' in quickMessageTemplateIdRaw
    ) {
      quickMessageTemplateId = quickMessageTemplateIdRaw.value || null;
    }

    if (!quickMessageTemplateId) {
      return {
        templateType: null,
        templateMessage: null,
        isQuickMessage: false,
        quickMessageUrl: null,
        quickMessageMimetype: null,
        quickMessageDuration: null,
        quickMessageWidth: null,
        quickMessageHeight: null,
      };
    }

    const template = await this.messageTemplateService.viewMessageTemplateById(
      quickMessageTemplateId
    );

    if (template?.account?.account_id !== accountId) {
      throw new Error(t('message_template_not_found'));
    }

    if (
      template?.channel_ids?.length &&
      !template.channel_ids.includes(chat.worker.id)
    ) {
      throw new Error(t('message_template_not_found'));
    }

    return {
      templateType: template.type as EMessageType,
      templateMessage: template.message || null,
      isQuickMessage: true,
      quickMessageUrl: template.attachment_url || null,
      quickMessageMimetype: template.mimetype || null,
      quickMessageDuration: template.duration || null,
      quickMessageWidth: template.width || null,
      quickMessageHeight: template.height || null,
    };
  }

  private async processReaction(
    chatContext: IChatContext,
    reactionMessageId: string,
    emoji: string,
    messageContext: IMessageContext
  ): Promise<IActionMessageResult> {
    const targetMessage = await this.getMessage(
      chatContext.accountId,
      reactionMessageId
    );

    if (!targetMessage) {
      throw new Error(messageContext.t('message_not_found'));
    }

    if (targetMessage.chat_id !== chatContext.chatId) {
      throw new Error(messageContext.t('message_not_found'));
    }

    const userId =
      messageContext.senderUser?.id ??
      messageContext.senderUserId ??
      chatContext.chat.user?.id ??
      chatContext.chat.worker?.id ??
      '';
    const userName =
      messageContext.senderUser?.name ??
      messageContext.senderName ??
      chatContext.chat.user?.name ??
      chatContext.chat.worker?.name ??
      '';

    const existingActorReaction = targetMessage.content?.reactions?.find(
      (reaction) => reaction.user_id === userId
    );
    const reactionIsUnchanged = emoji
      ? existingActorReaction?.emoji === emoji
      : existingActorReaction === undefined;
    const updatedMessage = reactionIsUnchanged
      ? targetMessage
      : await this.updateMessageReaction(
          targetMessage,
          emoji,
          userId,
          userName,
          messageContext.webhookSource
        );

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      if (!reactionIsUnchanged) {
        await this.centrifugoChatPublish(updatedMessage);
      }
      return {
        sent: true,
        reactionTargetTypeUser: targetMessage.type_user,
      };
    }

    const reactionMessage = this.createReactionMessage(
      updatedMessage,
      emoji,
      this.requireActionOperationId(messageContext),
      messageContext.typeUser
    );
    ensureMessageSendHash(reactionMessage);

    if (reactionIsUnchanged) {
      await this.publishProviderActionMessage(
        chatContext.chat,
        reactionMessage
      );
    } else {
      await this.publishProviderActionMessage(
        chatContext.chat,
        reactionMessage
      );
      try {
        await this.centrifugoChatPublish(updatedMessage);
      } catch (error) {
        console.error(
          '[WorkerCommand] Failed to publish reaction projection after PubAck:',
          error instanceof Error ? error.message : error
        );
      }
    }

    return {
      sent: true,
      reactionTargetTypeUser: targetMessage.type_user,
    };
  }

  private createReactionMessage(
    targetMessage: IChatMessage,
    emoji: string,
    operationId: string,
    typeUser: ETypeUserChat
  ): IChatMessage {
    return {
      message_id: operationId,
      chat_id: targetMessage.chat_id,
      message_key: {
        remote_jid: targetMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: targetMessage.message_key?.remote_jid_alt ?? null,
        from_me: targetMessage.message_key?.from_me ?? false,
        id: targetMessage.message_key?.id ?? null,
        participant: targetMessage.message_key?.participant ?? null,
        participant_alt: targetMessage.message_key?.participant_alt ?? null,
        addressing_mode: targetMessage.message_key?.addressing_mode ?? null,
        is_view_once: false,
      },
      type_user: typeUser,
      sent_from_platform: true,
      account: targetMessage.account,
      worker: targetMessage.worker,
      user: null,
      phone: targetMessage.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      content: {
        type: EMessageType.react,
        message: emoji,
        reactions: [{ emoji }],
      },
      date: targetMessage.date,
      hash: null,
    };
  }

  private async processDelete(
    chat: IChat,
    chatId: string,
    accountId: string,
    deleteMessageId: string,
    context: IMessageContext
  ): Promise<boolean> {
    const targetMessage = await this.getMessage(accountId, deleteMessageId);

    if (!targetMessage) {
      throw new Error(context.t('message_not_found'));
    }

    if (targetMessage.chat_id !== chatId) {
      throw new Error(context.t('message_not_found'));
    }

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      throw new Error(context.t('message_key_not_found'));
    }

    if (await this.isOfficialWorker(chat)) {
      throw new Error(
        context.t('whatsapp_official_delete_message_not_supported')
      );
    }

    const alreadyDeleted = targetMessage.deleted === true;
    const updatedMessage = alreadyDeleted
      ? targetMessage
      : await this.markMessageAsDeleted(
          targetMessage,
          context.senderUser?.id,
          context.webhookSource
        );

    const deleteMessage = this.createDeleteMessage(
      updatedMessage,
      this.requireActionOperationId(context),
      context.typeUser
    );
    ensureMessageSendHash(deleteMessage);

    if (alreadyDeleted) {
      await this.publishProviderActionMessage(chat, deleteMessage);
    } else {
      await this.publishProviderActionMessage(chat, deleteMessage);
      try {
        await this.centrifugoChatPublish(updatedMessage);
      } catch (error) {
        console.error(
          '[WorkerCommand] Failed to publish delete projection after PubAck:',
          error instanceof Error ? error.message : error
        );
      }
    }

    return true;
  }

  private async markMessageAsDeleted(
    message: IChatMessage,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<IChatMessage> {
    if (message.deleted) {
      return message;
    }

    let content = message.content;
    if (content?.version && content.version.length > 0) {
      const sortedVersions = [...content.version].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestVersion = sortedVersions[0];
      if (latestVersion && content.message === latestVersion.message) {
        const oldestVersion = sortedVersions.at(-1);

        if (
          oldestVersion?.message &&
          oldestVersion.message !== content.message &&
          content
        ) {
          content = {
            ...content,
            message: oldestVersion.message,
          };
        }
      }
    }

    const updatedMessage: IChatMessage = {
      ...message,
      deleted: true,
      has_quoted: message.has_quoted,
      content: content,
    };
    const deletionRevision =
      message.outbound_webhook_event_ids?.at(-1) ??
      message.hash ??
      message.date;

    const persisted = await this.chatService.saveMessageChat(updatedMessage, {
      eventTypes: ['message.deleted'],
      idempotencyKey: `message-delete:${updatedMessage.message_id}:${deletionRevision}`,
      source: webhookSource,
      previousMessage: message,
      actor: actorUserId
        ? { type: 'user', id: actorUserId }
        : { type: 'system' },
      changes: {
        deleted: true,
        origin: webhookSource,
      },
    });
    if (!persisted) {
      throw new Error('message_delete_failed');
    }

    return updatedMessage;
  }

  private createDeleteMessage(
    targetMessage: IChatMessage,
    operationId: string,
    typeUser: ETypeUserChat
  ): IChatMessage {
    return {
      message_id: operationId,
      chat_id: targetMessage.chat_id,
      message_key: {
        remote_jid: targetMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: targetMessage.message_key?.remote_jid_alt ?? null,
        from_me: targetMessage.message_key?.from_me ?? false,
        id: targetMessage.message_key?.id ?? null,
        participant: targetMessage.message_key?.participant ?? null,
        participant_alt: targetMessage.message_key?.participant_alt ?? null,
        addressing_mode: targetMessage.message_key?.addressing_mode ?? null,
        is_view_once: false,
      },
      type_user: typeUser,
      sent_from_platform: true,
      account: targetMessage.account,
      worker: targetMessage.worker,
      user: null,
      phone: targetMessage.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: true,
      has_quoted: false,
      content: {
        type: EMessageType.delete_message,
      },
      date: targetMessage.date,
      hash: null,
    };
  }

  private requireActionOperationId(context: IMessageContext): string {
    const operationId = context.messageId?.trim();
    if (!operationId) {
      throw new Error('worker_command_operation_id_required');
    }
    return operationId;
  }
}
