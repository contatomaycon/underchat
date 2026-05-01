import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import {
  internalChatAccountCentrifugo,
  internalChatConversationCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { InternalChatConversationRepository } from '@core/repositories/internalChat/InternalChatConversation.repository';
import { InternalChatUserRepository } from '@core/repositories/internalChat/InternalChatUser.repository';
import { InternalChatMessageRepository } from '@core/repositories/internalChat/InternalChatMessage.repository';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import { IInternalChatDispatchMessage } from '@core/common/interfaces/internalChat/IInternalChatDispatchMessage';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StorageService } from '@core/services/storage.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';
import { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';
import { ListMessagesQuery } from '@core/schema/internalChat/listMessages/request.schema';
import { CreateMessageBody } from '@core/schema/internalChat/createMessage/request.schema';
import { EditMessageBody } from '@core/schema/internalChat/editMessage/request.schema';
import { ReactMessageBody } from '@core/schema/internalChat/reactMessage/request.schema';
import { ForwardMessageBody } from '@core/schema/internalChat/forwardMessage/request.schema';
import { ActivityBody } from '@core/schema/internalChat/activity/request.schema';
import { AddGroupMemberBody } from '@core/schema/internalChat/addGroupMember/request.schema';
import { CreateGroupBody } from '@core/schema/internalChat/createGroup/request.schema';
import { UpdateGroupBody } from '@core/schema/internalChat/updateGroup/request.schema';
import { TransferLeaderBody } from '@core/schema/internalChat/transferLeader/request.schema';

type InternalConversationResponse = {
  conversation_id: string;
  account_id: string;
  type: EInternalChatConversationType;
  name: string | null;
  photo: string | null;
  leader_user_id: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_closed_for_me: boolean;
  participants: Array<{
    user_id: string;
    name: string;
    photo: string | null;
    role: EInternalChatConversationParticipantRole;
    unread_count: number;
    closed_at: string | null;
  }>;
  created_at: string;
  updated_at: string;
};

@injectable()
export class InternalChatService {
  constructor(
    @inject(InternalChatConversationRepository)
    private readonly conversationRepository: InternalChatConversationRepository,
    @inject(InternalChatUserRepository)
    private readonly userRepository: InternalChatUserRepository,
    @inject(InternalChatMessageRepository)
    private readonly messageRepository: InternalChatMessageRepository,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private normalizePaging(
    query: Pick<ListConversationsQuery, 'current_page' | 'per_page'>
  ): { currentPage: number; perPage: number } {
    const currentPage = Math.max(1, Number(query.current_page ?? 1));
    const perPage = Math.max(1, Math.min(100, Number(query.per_page ?? 20)));

    return { currentPage, perPage };
  }

  private getTopicByConversationType(
    type: EInternalChatConversationType
  ): string {
    return type === EInternalChatConversationType.direct
      ? this.kafkaServiceQueueService.internalChatDirectMessage()
      : this.kafkaServiceQueueService.internalChatGroupMessage();
  }

  private async getConversationOrThrow(
    accountId: string,
    conversationId: string
  ) {
    const conversation = await this.conversationRepository.getConversationById(
      accountId,
      conversationId
    );

    if (!conversation) {
      throw new Error('chat_not_found');
    }

    return conversation;
  }

  private async assertParticipant(
    accountId: string,
    conversationId: string,
    userId: string
  ): Promise<void> {
    const isParticipant = await this.conversationRepository.isUserParticipant({
      accountId,
      conversationId,
      userId,
    });

    if (!isParticipant) {
      throw new Error('chat_access_denied');
    }
  }

  private async assertLeader(
    accountId: string,
    conversationId: string,
    userId: string
  ): Promise<void> {
    await this.assertParticipant(accountId, conversationId, userId);
    const leaderId =
      await this.conversationRepository.getConversationLeaderUserId(
        conversationId
      );

    if (leaderId !== userId) {
      throw new Error('chat_access_denied');
    }
  }

  private buildMessagePreview(message: IInternalChatMessage): string | null {
    if (message.content.type === EMessageType.text) {
      return message.content.message ?? null;
    }

    if (message.content.type === EMessageType.image) return '[Imagem]';
    if (message.content.type === EMessageType.video) return '[Vídeo]';
    if (message.content.type === EMessageType.audio) return '[Áudio]';
    if (message.content.type === EMessageType.document) return '[Documento]';
    if (message.content.type === EMessageType.location) return '[Localização]';
    if (message.content.type === EMessageType.contact_card) return '[Contato]';
    if (message.content.type === EMessageType.contacts) return '[Contatos]';

    return message.content.message ?? message.content.type;
  }

  private normalizeUploads(
    files?: UploadFileRequest | UploadFileRequest[] | null | undefined
  ): UploadFileRequest[] {
    if (!files) return [];
    if (Array.isArray(files)) return files;
    return [files];
  }

  private isUploadFile(value: unknown): value is UploadFileRequest {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'toBuffer' in value &&
      typeof (value as UploadFileRequest).toBuffer === 'function'
    );
  }

  private async resolveGroupPhoto(
    accountId: string,
    photo: unknown
  ): Promise<string | null> {
    if (this.isUploadFile(photo)) {
      const uploaded = await this.storageService.uploadImage(photo, accountId);
      if (!uploaded?.url) {
        throw new Error('INVALID_IMAGE_FORMAT');
      }
      return uploaded.url;
    }

    const normalizedPhoto = extractFieldValue(photo as any).trim();
    return normalizedPhoto.length > 0 ? normalizedPhoto : null;
  }

  private normalizeStringArray(
    field:
      | string[]
      | Array<{ value: string }>
      | { value: string }
      | { value: string[] }
      | { value: string[] | null }
      | { value: string | null }
      | string
      | null
      | undefined
  ): string[] {
    if (Array.isArray(field)) {
      return field
        .flatMap((item) =>
          typeof item === 'object' && item !== null && 'value' in item
            ? this.normalizeStringArray(item.value)
            : this.normalizeStringArray(item as string)
        )
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    if (field && typeof field === 'object' && 'value' in field) {
      return this.normalizeStringArray(field.value as any);
    }

    if (typeof field === 'string') {
      const value = field.trim();
      if (!value) return [];

      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0);
        }
      } catch {
        return [value];
      }

      return [value];
    }

    return extractArrayFieldValue(field);
  }

  private normalizeNumberField(
    value: number | string | { value: string | number } | null | undefined
  ): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object' && 'value' in value) {
      return this.normalizeNumberField(value.value);
    }
    return null;
  }

  private async loadActorUser(userId: string): Promise<{
    id: string;
    name: string;
    photo: string | null;
  }> {
    const actor = await this.userRepository.viewUserNamePhoto(userId);

    if (!actor) {
      throw new Error('user_not_found');
    }

    return {
      id: actor.user_id,
      name: actor.name,
      photo: actor.photo ?? null,
    };
  }

  private createMessageBase(input: {
    accountId: string;
    conversationId: string;
    actor: { id: string; name: string; photo: string | null };
    type: EMessageType;
    hash?: string | null;
  }): IInternalChatMessage {
    return {
      message_id: uuidv7(),
      account_id: input.accountId,
      conversation_id: input.conversationId,
      type_user: ETypeUserChat.operator,
      user: {
        id: input.actor.id,
        name: input.actor.name,
        photo: input.actor.photo,
      },
      content: {
        type: input.type,
      },
      hash: input.hash ?? uuidv7(),
      date: new Date().toISOString(),
      deleted: false,
    };
  }

  private async buildMessagesFromCreateBody(input: {
    accountId: string;
    conversationId: string;
    actor: { id: string; name: string; photo: string | null };
    body: CreateMessageBody;
  }): Promise<IInternalChatMessage[]> {
    const type = extractFieldValue(input.body.type as any) as EMessageType;
    if (!Object.values(EMessageType).includes(type)) {
      throw new Error('message_type_invalid');
    }
    const hash = extractFieldValue(input.body.hash as any) || null;
    const messageText = extractFieldValue(input.body.message as any) || null;
    const messageQuotedId =
      extractFieldValue(input.body.message_quoted_id as any) || null;
    const contacts = this.normalizeStringArray(input.body.contacts as any);
    const locationLatitude = this.normalizeNumberField(
      input.body.location_latitude as any
    );
    const locationLongitude = this.normalizeNumberField(
      input.body.location_longitude as any
    );
    const locationName = extractFieldValue(input.body.location_name as any);
    const locationAddress = extractFieldValue(
      input.body.location_address as any
    );

    const images = this.normalizeUploads(input.body.images as any);
    const videos = this.normalizeUploads(input.body.videos as any);
    const documents = this.normalizeUploads(input.body.documents as any);
    const audios = this.normalizeUploads(input.body.audios as any);

    const messages: IInternalChatMessage[] = [];

    const appendBaseMessage = (
      messageType: EMessageType
    ): IInternalChatMessage => {
      const base = this.createMessageBase({
        accountId: input.accountId,
        conversationId: input.conversationId,
        actor: input.actor,
        type: messageType,
        hash,
      });
      if (messageText) {
        base.content.message = messageText;
      }
      if (messageQuotedId) {
        base.content.message_quoted_id = messageQuotedId;
      }
      return base;
    };

    if (type === EMessageType.image && images.length > 0) {
      for (const image of images) {
        const uploaded = await this.storageService.uploadImage(
          image,
          input.accountId
        );
        if (!uploaded) continue;

        const msg = appendBaseMessage(EMessageType.image);
        msg.content.image = {
          url: uploaded.url,
          caption: messageText,
          mimetype: uploaded.mimetype,
          extension: uploaded.extension,
          size: uploaded.size,
          width: uploaded.width,
          height: uploaded.height,
        };
        messages.push(msg);
      }
    }

    if (type === EMessageType.video && videos.length > 0) {
      for (const video of videos) {
        const uploaded = await this.storageService.uploadVideo(
          video,
          input.accountId
        );
        if (!uploaded) continue;

        const msg = appendBaseMessage(EMessageType.video);
        msg.content.video = {
          url: uploaded.url,
          caption: messageText,
          name: uploaded.name,
          mimetype: uploaded.mimetype,
          extension: uploaded.extension,
          size: uploaded.size,
        };
        messages.push(msg);
      }
    }

    if (type === EMessageType.audio && audios.length > 0) {
      for (const audio of audios) {
        const uploaded = await this.storageService.uploadAudio(
          audio,
          input.accountId
        );
        if (!uploaded) continue;

        const msg = appendBaseMessage(EMessageType.audio);
        msg.content.audio = {
          url: uploaded.url,
          name: uploaded.name,
          mimetype: uploaded.mimetype,
          extension: uploaded.extension,
          size: uploaded.size,
        };
        messages.push(msg);
      }
    }

    if (type === EMessageType.document && documents.length > 0) {
      for (const document of documents) {
        const uploaded = await this.storageService.uploadDocument(
          document,
          input.accountId
        );
        if (!uploaded) continue;

        const msg = appendBaseMessage(EMessageType.document);
        msg.content.document = {
          url: uploaded.url,
          name: uploaded.name,
          mimetype: uploaded.mimetype,
          extension: uploaded.extension,
          size: uploaded.size,
        };
        messages.push(msg);
      }
    }

    if (type === EMessageType.location) {
      if (locationLatitude === null || locationLongitude === null) {
        throw new Error('message_content_required');
      }

      const msg = appendBaseMessage(EMessageType.location);
      msg.content.location = {
        latitude: locationLatitude,
        longitude: locationLongitude,
        name: locationName || null,
        address: locationAddress || null,
      };
      messages.push(msg);
    }

    if (type === EMessageType.contact_card || type === EMessageType.contacts) {
      if (contacts.length === 0) {
        throw new Error('message_content_required');
      }

      const normalizedContacts = contacts.map((contactId) => ({
        contact_id: contactId,
        name: contactId,
      }));

      if (type === EMessageType.contact_card) {
        const msg = appendBaseMessage(EMessageType.contact_card);
        msg.content.contact = normalizedContacts[0] ?? null;
        messages.push(msg);
      } else {
        const msg = appendBaseMessage(EMessageType.contacts);
        msg.content.contacts = normalizedContacts;
        messages.push(msg);
      }
    }

    if (messages.length === 0) {
      const msg = appendBaseMessage(type || EMessageType.text);
      if (
        msg.content.type === EMessageType.text &&
        !msg.content.message?.trim().length
      ) {
        throw new Error('message_content_required');
      }
      messages.push(msg);
    }

    return messages;
  }

  private async enqueueInternalMessage(input: {
    message: IInternalChatMessage;
    conversationType: EInternalChatConversationType;
    senderUserId: string;
  }): Promise<void> {
    const payload: IInternalChatDispatchMessage = {
      message: input.message,
      conversation_type: input.conversationType,
      sender_user_id: input.senderUserId,
    };

    await this.streamProducerService.send(
      this.getTopicByConversationType(input.conversationType),
      payload,
      input.message.conversation_id
    );
  }

  async buildConversationForUser(
    accountId: string,
    conversationId: string,
    userId: string
  ): Promise<InternalConversationResponse | null> {
    const [conversation, participantState, participants] = await Promise.all([
      this.conversationRepository.getConversationById(
        accountId,
        conversationId
      ),
      this.conversationRepository.getParticipantState(conversationId, userId),
      this.conversationRepository.listParticipants(conversationId),
    ]);

    if (!conversation || !participantState) {
      return null;
    }

    let resolvedName = conversation.name ?? null;
    let resolvedPhoto = conversation.photo ?? null;

    if (conversation.type === EInternalChatConversationType.direct) {
      const other = participants.find(
        (participant) => participant.user_id !== userId
      );
      resolvedName = other?.name ?? resolvedName;
      resolvedPhoto = other?.photo ?? resolvedPhoto;
    }

    return {
      conversation_id: conversation.conversation_id,
      account_id: conversation.account_id,
      type: conversation.type,
      name: resolvedName,
      photo: resolvedPhoto,
      leader_user_id: conversation.leader_user_id,
      last_message_id: conversation.last_message_id,
      last_message_preview: conversation.last_message_preview,
      last_message_at: conversation.last_message_at,
      unread_count: participantState.unread_count,
      is_closed_for_me: participantState.closed_at !== null,
      participants,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  async listConversations(
    accountId: string,
    userId: string,
    query: ListConversationsQuery
  ): Promise<{
    pagings: ReturnType<typeof setPaginationData>;
    results: InternalConversationResponse[];
  }> {
    const { currentPage, perPage } = this.normalizePaging(query);
    const { conversationIds, total } =
      await this.conversationRepository.listOpenConversationsForUser({
        accountId,
        userId,
        currentPage,
        perPage,
        search: query.search,
        type: query.type as EInternalChatConversationType | undefined,
      });

    const resultsMap = new Map<string, InternalConversationResponse>();
    const resolvedConversations = await Promise.all(
      conversationIds.map((conversationId) =>
        this.buildConversationForUser(accountId, conversationId, userId)
      )
    );

    for (const item of resolvedConversations) {
      if (!item) continue;
      resultsMap.set(item.conversation_id, item);
    }

    const results = conversationIds
      .map((conversationId) => resultsMap.get(conversationId))
      .filter((item): item is InternalConversationResponse => Boolean(item));

    return {
      pagings: setPaginationData(results.length, total, perPage, currentPage),
      results,
    };
  }

  async listUsers(
    accountId: string,
    userId: string,
    query: ListUsersQuery
  ): Promise<{
    pagings: ReturnType<typeof setPaginationData>;
    results: Array<{ user_id: string; name: string; photo: string | null }>;
  }> {
    const { currentPage, perPage } = this.normalizePaging(query);
    const { rows, total } = await this.userRepository.listUsersFromAccount({
      accountId,
      exceptUserId: userId,
      currentPage,
      perPage,
      search: query.search,
    });

    return {
      pagings: setPaginationData(rows.length, total, perPage, currentPage),
      results: rows,
    };
  }

  async openDirectConversation(
    accountId: string,
    userId: string,
    targetUserId: string
  ): Promise<InternalConversationResponse> {
    if (targetUserId === userId) {
      throw new Error('chat_invalid_target_user');
    }

    const targetBelongs =
      await this.conversationRepository.userBelongsToAccount(
        accountId,
        targetUserId
      );

    if (!targetBelongs) {
      throw new Error('chat_access_denied');
    }

    const pairKey = this.conversationRepository.buildDirectPairKey(
      userId,
      targetUserId
    );

    let conversationId =
      await this.conversationRepository.findDirectConversationByPair(
        accountId,
        pairKey
      );

    if (!conversationId) {
      try {
        conversationId =
          await this.conversationRepository.createDirectConversation({
            accountId,
            createdByUserId: userId,
            userAId: userId,
            userBId: targetUserId,
            directPairKey: pairKey,
          });
      } catch (error: any) {
        if (error?.code === '23505') {
          conversationId =
            await this.conversationRepository.findDirectConversationByPair(
              accountId,
              pairKey
            );
        } else {
          throw error;
        }
      }
    }

    if (!conversationId) {
      throw new Error('chat_create_error');
    }

    await this.conversationRepository.ensureParticipant(
      conversationId,
      accountId,
      userId,
      EInternalChatConversationParticipantRole.member
    );
    await this.conversationRepository.ensureParticipant(
      conversationId,
      accountId,
      targetUserId,
      EInternalChatConversationParticipantRole.member
    );

    const response = await this.buildConversationForUser(
      accountId,
      conversationId,
      userId
    );

    if (!response) {
      throw new Error('chat_not_found');
    }

    return response;
  }

  async viewConversation(
    accountId: string,
    userId: string,
    conversationId: string
  ): Promise<InternalConversationResponse> {
    await this.assertParticipant(accountId, conversationId, userId);

    const response = await this.buildConversationForUser(
      accountId,
      conversationId,
      userId
    );

    if (!response) {
      throw new Error('chat_not_found');
    }

    return response;
  }

  async closeConversation(
    accountId: string,
    userId: string,
    conversationId: string
  ): Promise<boolean> {
    await this.assertParticipant(accountId, conversationId, userId);
    return this.conversationRepository.closeConversationForUser(
      conversationId,
      userId
    );
  }

  async markConversationRead(
    accountId: string,
    userId: string,
    conversationId: string,
    body: { last_read_message_id?: string | null }
  ): Promise<boolean> {
    await this.assertParticipant(accountId, conversationId, userId);
    return this.conversationRepository.markConversationRead({
      conversationId,
      userId,
      lastReadMessageId: body.last_read_message_id ?? null,
    });
  }

  async listMessages(
    accountId: string,
    userId: string,
    conversationId: string,
    query: ListMessagesQuery
  ): Promise<{
    pagings: ReturnType<typeof setPaginationData>;
    results: IInternalChatMessage[];
  }> {
    await this.assertParticipant(accountId, conversationId, userId);
    const { currentPage, perPage } = this.normalizePaging(query);
    const { results, total } = await this.messageRepository.listMessages({
      accountId,
      conversationId,
      currentPage,
      perPage,
    });

    return {
      pagings: setPaginationData(results.length, total, perPage, currentPage),
      results,
    };
  }

  async createMessage(
    accountId: string,
    userId: string,
    conversationId: string,
    body: CreateMessageBody
  ): Promise<{ message_id: string; queued: boolean }> {
    await this.assertParticipant(accountId, conversationId, userId);
    const conversation = await this.getConversationOrThrow(
      accountId,
      conversationId
    );
    const actor = await this.loadActorUser(userId);

    const messages = await this.buildMessagesFromCreateBody({
      accountId,
      conversationId,
      actor,
      body,
    });

    if (messages.length === 0) {
      throw new Error('message_content_required');
    }

    for (const message of messages) {
      await this.enqueueInternalMessage({
        message,
        conversationType: conversation.type,
        senderUserId: userId,
      });
    }

    return {
      message_id: messages[0].message_id,
      queued: true,
    };
  }

  async reactMessage(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    body: ReactMessageBody
  ): Promise<boolean> {
    await this.assertParticipant(accountId, conversationId, userId);
    const actor = await this.loadActorUser(userId);

    const message = await this.messageRepository.getMessageById(
      accountId,
      conversationId,
      messageId
    );
    if (!message || !message.content) {
      throw new Error('message_not_found');
    }

    const reactions = Array.isArray(message.content.reactions)
      ? [...message.content.reactions]
      : [];
    const emoji = body.emoji?.trim() ?? '';
    const withoutMine = reactions.filter(
      (reaction) => reaction.user_id !== userId
    );

    if (emoji.length > 0) {
      withoutMine.push({
        emoji,
        user_id: userId,
        user_name: actor.name,
      });
    }

    message.content.reactions = withoutMine.length > 0 ? withoutMine : null;
    message.hash = uuidv7();

    const updated = await this.messageRepository.updateMessage(message);
    if (!updated) return false;

    await this.publishMessageRealtime(message);
    return true;
  }

  async editMessage(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    body: EditMessageBody
  ): Promise<boolean> {
    await this.assertParticipant(accountId, conversationId, userId);

    const message = await this.messageRepository.getMessageById(
      accountId,
      conversationId,
      messageId
    );

    if (!message || !message.content) {
      throw new Error('message_not_found');
    }

    if (message.content.type !== EMessageType.text) {
      throw new Error('only_text_messages_can_be_edited');
    }

    const currentText = message.content.message ?? '';
    const newText = body.message?.trim() ?? '';
    if (!newText || newText === currentText) {
      return true;
    }

    const versions = Array.isArray(message.content.version)
      ? [...message.content.version]
      : [];
    versions.push({
      type: EMessageType.text,
      message: currentText || null,
      date: new Date().toISOString(),
    });

    message.content.message = newText;
    message.content.version = versions;
    message.hash = uuidv7();

    const updated = await this.messageRepository.updateMessage(message);
    if (!updated) return false;

    await this.publishMessageRealtime(message);
    return true;
  }

  async deleteMessage(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<boolean> {
    await this.assertParticipant(accountId, conversationId, userId);

    const message = await this.messageRepository.getMessageById(
      accountId,
      conversationId,
      messageId
    );

    if (!message) {
      throw new Error('message_not_found');
    }

    message.deleted = true;
    message.hash = uuidv7();
    message.content = {
      ...(message.content ?? { type: EMessageType.text }),
      type: EMessageType.delete_message,
      message: null,
    };

    const updated = await this.messageRepository.updateMessage(message);
    if (!updated) return false;

    await this.publishMessageRealtime(message);
    return true;
  }

  async forwardMessage(
    accountId: string,
    userId: string,
    sourceConversationId: string,
    messageId: string,
    body: ForwardMessageBody
  ): Promise<{ queued_count: number }> {
    await this.assertParticipant(accountId, sourceConversationId, userId);
    const actor = await this.loadActorUser(userId);

    const sourceMessage = await this.messageRepository.getMessageById(
      accountId,
      sourceConversationId,
      messageId
    );
    if (!sourceMessage || !sourceMessage.content) {
      throw new Error('message_not_found');
    }

    const targetConversationIds = Array.from(
      new Set(body.target_conversation_ids ?? [])
    );
    let queuedCount = 0;

    for (const targetConversationId of targetConversationIds) {
      await this.assertParticipant(accountId, targetConversationId, userId);
      const targetConversation = await this.getConversationOrThrow(
        accountId,
        targetConversationId
      );

      const forwardContent = {
        ...sourceMessage.content,
        forward: {
          source_message_id: sourceMessage.message_id,
          source_chat_id: sourceConversationId,
          source_type: sourceMessage.content.type,
        },
      };

      const forwardMessage: IInternalChatMessage = {
        message_id: uuidv7(),
        account_id: accountId,
        conversation_id: targetConversationId,
        type_user: ETypeUserChat.operator,
        user: {
          id: actor.id,
          name: actor.name,
          photo: actor.photo,
        },
        content: forwardContent as any,
        date: new Date().toISOString(),
        deleted: false,
        hash: uuidv7(),
      };

      await this.enqueueInternalMessage({
        message: forwardMessage,
        conversationType: targetConversation.type,
        senderUserId: userId,
      });

      queuedCount++;
    }

    return { queued_count: queuedCount };
  }

  async publishActivity(
    accountId: string,
    userId: string,
    body: ActivityBody
  ): Promise<void> {
    await this.assertParticipant(accountId, body.conversation_id, userId);
    const actor = await this.loadActorUser(userId);

    const state = body.state as EInternalChatActivityState;
    const activityPayload = {
      type: 'typing',
      account_id: accountId,
      conversation_id: body.conversation_id,
      user_id: userId,
      user_name: actor.name,
      user_photo: actor.photo,
      state,
      is_typing: state === EInternalChatActivityState.typing,
      is_recording: state === EInternalChatActivityState.recording,
      typing_state: state,
      date: new Date().toISOString(),
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        internalChatConversationCentrifugo(body.conversation_id),
        activityPayload
      ),
      this.centrifugoService.publishSub(
        internalChatAccountCentrifugo(accountId),
        activityPayload
      ),
    ]);
  }

  async createGroupConversation(
    accountId: string,
    userId: string,
    body: CreateGroupBody
  ): Promise<InternalConversationResponse> {
    const name = extractFieldValue(body.name as any).trim();
    const normalizedMembers = Array.from(
      new Set(this.normalizeStringArray(body.member_user_ids as any))
    );

    if (!name || normalizedMembers.length === 0) {
      throw new Error('chat_create_error');
    }

    for (const memberUserId of normalizedMembers) {
      const belongs = await this.conversationRepository.userBelongsToAccount(
        accountId,
        memberUserId
      );
      if (!belongs) {
        throw new Error('chat_access_denied');
      }
    }

    const conversationId =
      await this.conversationRepository.createGroupConversation({
        accountId,
        createdByUserId: userId,
        name,
        photo: await this.resolveGroupPhoto(accountId, body.photo),
        memberUserIds: normalizedMembers,
      });

    const conversation = await this.viewConversation(
      accountId,
      userId,
      conversationId
    );

    await this.publishConversationSync(accountId, conversationId);
    return conversation;
  }

  async updateGroupConversation(
    accountId: string,
    userId: string,
    conversationId: string,
    body: UpdateGroupBody
  ): Promise<InternalConversationResponse> {
    await this.assertLeader(accountId, conversationId, userId);

    const isGroup = await this.conversationRepository.isGroupConversation(
      accountId,
      conversationId
    );
    if (!isGroup) {
      throw new Error('chat_not_found');
    }

    const name =
      body.name === undefined
        ? undefined
        : extractFieldValue(body.name as any).trim();

    if (body.name !== undefined && !name) {
      throw new Error('chat_update_error');
    }

    const photo =
      body.photo === undefined
        ? undefined
        : await this.resolveGroupPhoto(accountId, body.photo);

    const updated = await this.conversationRepository.updateGroupConversation({
      accountId,
      conversationId,
      name,
      photo,
    });

    if (!updated) {
      throw new Error('chat_update_error');
    }

    const conversation = await this.viewConversation(
      accountId,
      userId,
      conversationId
    );

    await this.publishConversationSync(accountId, conversationId);
    return conversation;
  }

  async listGroupMembers(
    accountId: string,
    userId: string,
    conversationId: string
  ) {
    await this.assertParticipant(accountId, conversationId, userId);
    return this.conversationRepository.listParticipants(conversationId);
  }

  async addGroupMember(
    accountId: string,
    userId: string,
    conversationId: string,
    body: AddGroupMemberBody
  ): Promise<InternalConversationResponse> {
    await this.assertLeader(accountId, conversationId, userId);

    const belongs = await this.conversationRepository.userBelongsToAccount(
      accountId,
      body.user_id
    );
    if (!belongs) {
      throw new Error('chat_access_denied');
    }

    await this.conversationRepository.addGroupMember({
      accountId,
      conversationId,
      userId: body.user_id,
    });

    const conversation = await this.viewConversation(
      accountId,
      userId,
      conversationId
    );

    await this.publishConversationSync(accountId, conversationId);
    return conversation;
  }

  async removeGroupMember(
    accountId: string,
    userId: string,
    conversationId: string,
    memberUserId: string
  ): Promise<boolean> {
    await this.assertLeader(accountId, conversationId, userId);
    if (memberUserId === userId) {
      throw new Error('chat_access_denied');
    }

    const removed = await this.conversationRepository.removeGroupMember(
      conversationId,
      memberUserId
    );

    if (removed) {
      await this.publishConversationSync(accountId, conversationId);
    }

    return removed;
  }

  async transferGroupLeader(
    accountId: string,
    userId: string,
    conversationId: string,
    body: TransferLeaderBody
  ): Promise<InternalConversationResponse> {
    await this.assertLeader(accountId, conversationId, userId);

    const targetIsParticipant =
      await this.conversationRepository.isUserParticipant({
        accountId,
        conversationId,
        userId: body.user_id,
      });
    if (!targetIsParticipant) {
      throw new Error('chat_access_denied');
    }

    const updated = await this.conversationRepository.transferGroupLeader({
      conversationId,
      userId: body.user_id,
    });

    if (!updated) {
      throw new Error('chat_update_error');
    }

    const conversation = await this.viewConversation(
      accountId,
      userId,
      conversationId
    );

    await this.publishConversationSync(accountId, conversationId);
    return conversation;
  }

  async dispatchEnqueuedMessage(
    payload: IInternalChatDispatchMessage
  ): Promise<void> {
    const message = payload.message;
    if (
      !message?.message_id ||
      !message?.conversation_id ||
      !message?.account_id
    ) {
      return;
    }

    const saved = await this.messageRepository.saveMessage(message);
    if (!saved.created) {
      return;
    }

    const preview = this.buildMessagePreview(message);
    await this.conversationRepository.updateConversationLastMessage({
      conversationId: message.conversation_id,
      lastMessageId: message.message_id,
      lastMessagePreview: preview,
      lastMessageAt: message.date,
    });

    await this.conversationRepository.applyUnreadOnNewMessage({
      conversationId: message.conversation_id,
      senderUserId: payload.sender_user_id,
      messageId: message.message_id,
      messageDate: message.date,
    });

    await this.publishMessageRealtime(message);
    await this.publishConversationSync(
      message.account_id,
      message.conversation_id
    );
  }

  async publishConversationSync(
    accountId: string,
    conversationId: string
  ): Promise<void> {
    const payload = {
      type: 'internal_chat_conversation_sync',
      account_id: accountId,
      conversation_id: conversationId,
      date: new Date().toISOString(),
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        internalChatAccountCentrifugo(accountId),
        payload
      ),
      this.centrifugoService.publishSub(
        internalChatConversationCentrifugo(conversationId),
        payload
      ),
    ]);
  }

  async publishMessageRealtime(message: IInternalChatMessage): Promise<void> {
    await Promise.all([
      this.centrifugoService.publishSub(
        internalChatConversationCentrifugo(message.conversation_id),
        message
      ),
      this.centrifugoService.publishSub(
        internalChatAccountCentrifugo(message.account_id),
        message
      ),
    ]);
  }
}
