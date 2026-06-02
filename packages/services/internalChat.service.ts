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
import { ConverterService } from '@core/services/converter';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ChatContactService } from '@core/services/chatContact.service';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';
import { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';
import { ListInternalChatContactsRequest } from '@core/schema/internalChat/listContacts/request.schema';
import { ListInternalChatContactsResponse } from '@core/schema/internalChat/listContacts/response.schema';
import { ViewInternalChatContactPhoneResponse } from '@core/schema/internalChat/viewContactPhone/response.schema';
import { ListMessagesQuery } from '@core/schema/internalChat/listMessages/request.schema';
import { SearchInternalChatMessagesQuery } from '@core/schema/internalChat/searchMessages/request.schema';
import {
  SearchInternalChatMessagesResponse,
  SearchInternalChatMessagesResult,
} from '@core/schema/internalChat/searchMessages/response.schema';
import { CreateMessageBody } from '@core/schema/internalChat/createMessage/request.schema';
import { EditMessageBody } from '@core/schema/internalChat/editMessage/request.schema';
import { ReactMessageBody } from '@core/schema/internalChat/reactMessage/request.schema';
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

type InternalChatGroupSystemAction =
  | 'group_created'
  | 'group_member_added'
  | 'group_member_removed'
  | 'group_member_left';

type InternalChatSystemUser = {
  id: string;
  name: string;
  photo: string | null;
};

type InternalChatMessageHistoryKind =
  | 'current'
  | 'deleted_snapshot'
  | 'original'
  | 'previous_version';

type InternalChatMessageHistoryItem = {
  type: EMessageType | string;
  message: string | null;
  date: string;
  kind: InternalChatMessageHistoryKind;
  is_current: boolean;
  is_deleted_snapshot: boolean;
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
    @inject(ConverterService)
    private readonly converterService: ConverterService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
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

  private assertMessageAuthor(
    userId: string,
    message: IInternalChatMessage
  ): void {
    const isAuthor = message.user?.id === userId;
    if (isAuthor) return;

    throw new Error('chat_access_denied');
  }

  private async assertCanViewMessageHistory(
    accountId: string,
    conversationId: string,
    userId: string,
    message: IInternalChatMessage
  ): Promise<void> {
    const isAuthor = message.user?.id === userId;
    if (isAuthor) return;

    const conversation = await this.getConversationOrThrow(
      accountId,
      conversationId
    );
    const isGroupLeader =
      conversation.type === EInternalChatConversationType.group &&
      conversation.leader_user_id === userId;

    if (!isGroupLeader) {
      throw new Error('chat_access_denied');
    }
  }

  private hasMessageHistory(message: IInternalChatMessage): boolean {
    return Array.isArray(message.content?.version)
      ? message.content.version.length > 0
      : false;
  }

  private sanitizeMessageForPublicPayload(
    message: IInternalChatMessage
  ): IInternalChatMessage {
    const historyAvailable = this.hasMessageHistory(message);

    if (
      message.deleted ||
      message.content?.type === EMessageType.delete_message
    ) {
      const reactions = message.content?.reactions ?? null;

      return {
        ...message,
        content: {
          type: EMessageType.delete_message,
          message: null,
          reactions,
          history_available: historyAvailable,
        },
      };
    }

    const content = {
      ...message.content,
      history_available: historyAvailable,
    };
    delete content.version;

    return {
      ...message,
      content,
    };
  }

  private buildMessageHistoryItems(
    message: IInternalChatMessage
  ): InternalChatMessageHistoryItem[] {
    if (!message.content) return [];

    const versions = Array.isArray(message.content.version)
      ? [...message.content.version]
      : [];

    const sortedVersions = versions.sort(
      (a, b) =>
        new Date(b?.date ?? 0).getTime() - new Date(a?.date ?? 0).getTime()
    );

    const history: InternalChatMessageHistoryItem[] = [];
    const latestVersionDate = sortedVersions[0]?.date;
    const currentMessage = message.content.message?.trim() ?? '';

    if (!message.deleted && currentMessage) {
      history.push({
        type: message.content.type,
        message: currentMessage,
        date: latestVersionDate || message.date,
        kind: 'current',
        is_current: true,
        is_deleted_snapshot: false,
      });
    }

    sortedVersions.forEach((version, index) => {
      const isFirstDeletedSnapshot = Boolean(message.deleted && index === 0);
      const isOriginal = index === sortedVersions.length - 1;
      const versionMessage =
        typeof version?.message === 'string' ? version.message.trim() : '';

      history.push({
        type: version?.type ?? EMessageType.text,
        message: versionMessage || null,
        date: version?.date || message.date,
        kind: isFirstDeletedSnapshot
          ? 'deleted_snapshot'
          : isOriginal
            ? 'original'
            : 'previous_version',
        is_current: false,
        is_deleted_snapshot: isFirstDeletedSnapshot,
      });
    });

    return history;
  }

  private buildMessagePreview(message: IInternalChatMessage): string | null {
    if (message.content.type === EMessageType.system) {
      return 'internal_chat_preview_group_event';
    }

    if (message.content.type === EMessageType.text) {
      return message.content.message ?? null;
    }

    if (message.content.type === EMessageType.image) {
      return 'internal_chat_preview_image';
    }
    if (message.content.type === EMessageType.video) {
      return 'internal_chat_preview_video';
    }
    if (message.content.type === EMessageType.audio) {
      return 'internal_chat_preview_audio';
    }
    if (message.content.type === EMessageType.document) {
      return 'internal_chat_preview_document';
    }
    if (message.content.type === EMessageType.location) {
      return 'internal_chat_preview_location';
    }
    if (message.content.type === EMessageType.contact_card) {
      return 'internal_chat_preview_contact';
    }
    if (message.content.type === EMessageType.contacts) {
      return 'internal_chat_preview_contacts';
    }

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

  private async uploadVideoForMessage(
    video: UploadFileRequest,
    accountId: string
  ): Promise<
    | (UploadFileResponse & {
        duration?: number;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    const originalBuffer = await video.toBuffer();
    console.info('[MediaConversionDebug]', {
      event: 'internal_chat_video_upload_received',
      filename: video.filename,
      input_mimetype: video.mimetype ?? null,
      input_size: originalBuffer.byteLength,
    });
    const converted = await this.converterService.convertVideo(
      originalBuffer,
      video.mimetype ?? null
    );
    console.info('[MediaConversionDebug]', {
      event: 'internal_chat_video_upload_converted',
      filename: video.filename,
      output_mimetype: converted.mimetype,
      output_extension: converted.extension,
      output_size: converted.buffer.byteLength,
      duration: converted.duration ?? null,
      width: converted.width ?? null,
      height: converted.height ?? null,
    });
    const filename = video.filename.replace(/\.[^.]+$/, '') || 'video';
    const newFilename = `${filename}.${converted.extension}`;
    const uploaded = await this.storageService.uploadVideoFromBuffer(
      converted.buffer,
      newFilename,
      converted.mimetype,
      accountId,
      converted.width,
      converted.height
    );

    if (!uploaded) return null;

    return {
      ...uploaded,
      mimetype: converted.mimetype,
      extension: converted.extension,
      duration: converted.duration,
      width: converted.width ?? uploaded.width ?? null,
      height: converted.height ?? uploaded.height ?? null,
    };
  }

  private async uploadAudioForMessage(
    audio: UploadFileRequest,
    accountId: string,
    isPtt: boolean
  ): Promise<
    | (UploadFileResponse & {
        duration?: number;
        waveform?: string;
      })
    | null
  > {
    const originalBuffer = await audio.toBuffer();
    console.info('[MediaConversionDebug]', {
      event: 'internal_chat_audio_upload_received',
      filename: audio.filename,
      input_mimetype: audio.mimetype ?? null,
      input_size: originalBuffer.byteLength,
      ptt: isPtt,
    });
    const converted = await this.converterService.convertAudio(
      originalBuffer,
      audio.mimetype ?? null,
      isPtt
    );
    console.info('[MediaConversionDebug]', {
      event: 'internal_chat_audio_upload_converted',
      filename: audio.filename,
      output_mimetype: converted.mimetype,
      output_extension: converted.extension,
      output_size: converted.buffer.byteLength,
      duration: converted.duration ?? null,
      ptt: isPtt,
    });
    const filename = audio.filename.replace(/\.[^.]+$/, '') || 'audio';
    const newFilename = `${filename}.${converted.extension}`;

    const [uploaded, waveform] = await Promise.all([
      this.storageService.uploadAudioFromBuffer(
        converted.buffer,
        newFilename,
        converted.mimetype,
        accountId
      ),
      this.converterService
        .generateWaveformWithFfmpeg(converted.buffer)
        .catch(() => undefined),
    ]);

    if (!uploaded) return null;

    return {
      ...uploaded,
      mimetype: converted.mimetype,
      extension: converted.extension,
      duration: converted.duration,
      waveform,
    };
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

  private normalizeBooleanField(value: unknown, fallback = false): boolean {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'off', 'no'].includes(normalized)) return false;
      return fallback;
    }
    if (typeof value === 'object' && 'value' in value) {
      return this.normalizeBooleanField(value.value, fallback);
    }
    return fallback;
  }

  private normalizeLinkPreview(value: unknown): Record<string, unknown> | null {
    if (!value) return null;

    if (typeof value === 'object' && 'value' in value) {
      return this.normalizeLinkPreview((value as { value?: unknown }).value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return this.normalizeLinkPreview(parsed);
      } catch {
        return null;
      }
    }

    if (typeof value === 'object') {
      return value as Record<string, unknown>;
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

  private resolveGroupSystemMessageKey(
    action: InternalChatGroupSystemAction
  ): string {
    return `internal_chat_system_${action}`;
  }

  private createGroupSystemMessage(input: {
    accountId: string;
    conversationId: string;
    action: InternalChatGroupSystemAction;
    actor: InternalChatSystemUser;
    target?: InternalChatSystemUser | null;
  }): IInternalChatMessage {
    const key = this.resolveGroupSystemMessageKey(input.action);

    return {
      message_id: uuidv7(),
      account_id: input.accountId,
      conversation_id: input.conversationId,
      type_user: ETypeUserChat.system,
      user: null,
      content: {
        type: EMessageType.system,
        message: key,
        system: {
          action: input.action,
          key,
          actor_user_id: input.actor.id,
          actor_name: input.actor.name,
          target_user_id: input.target?.id ?? null,
          target_name: input.target?.name ?? null,
          params: {
            actor: input.actor.name,
            target: input.target?.name ?? null,
          },
        },
      },
      hash: uuidv7(),
      date: new Date().toISOString(),
      deleted: false,
    };
  }

  private async enqueueGroupSystemMessage(input: {
    accountId: string;
    conversationId: string;
    action: InternalChatGroupSystemAction;
    actor: InternalChatSystemUser;
    target?: InternalChatSystemUser | null;
  }): Promise<void> {
    await this.enqueueInternalMessage({
      message: this.createGroupSystemMessage(input),
      conversationType: EInternalChatConversationType.group,
      senderUserId: input.actor.id,
    });
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
    const linkPreview = this.normalizeLinkPreview(
      (input.body as { link_preview?: unknown }).link_preview
    );
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
    const audioDuration = this.normalizeNumberField(
      (input.body as { audio_duration?: unknown }).audio_duration as any
    );
    const audioPtt = this.normalizeBooleanField(
      (input.body as { audio_ptt?: unknown }).audio_ptt,
      false
    );
    const audioViewOnce = this.normalizeBooleanField(
      (input.body as { audio_view_once?: unknown }).audio_view_once,
      false
    );
    const videoDuration = this.normalizeNumberField(
      (input.body as { video_duration?: unknown }).video_duration as any
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
      if (messageType === EMessageType.text && linkPreview) {
        base.content.link_preview = linkPreview as any;
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
        const uploaded = await this.uploadVideoForMessage(
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
          duration: uploaded.duration ?? videoDuration ?? null,
          width: uploaded.width ?? null,
          height: uploaded.height ?? null,
        };
        messages.push(msg);
      }
    }

    if (type === EMessageType.audio && audios.length > 0) {
      for (const audio of audios) {
        const uploaded = await this.uploadAudioForMessage(
          audio,
          input.accountId,
          audioPtt
        );
        if (!uploaded) continue;

        const msg = appendBaseMessage(EMessageType.audio);
        msg.content.audio = {
          url: uploaded.url,
          name: uploaded.name,
          mimetype: uploaded.mimetype,
          extension: uploaded.extension,
          size: uploaded.size,
          duration: uploaded.duration ?? audioDuration ?? null,
          ptt: audioPtt,
          view_once: audioViewOnce,
          waveform: uploaded.waveform ?? null,
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

      const contactUuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const contactIds = contacts.filter((contactId) =>
        contactUuidPattern.test(contactId)
      );
      const contactRows = contactIds.length
        ? await this.chatContactService.viewChatContactsByIds(
            contactIds,
            input.accountId
          )
        : [];
      const contactsById = new Map(
        contactRows.map((contact) => [contact.contact_id, contact])
      );
      const normalizedContacts = contacts.map((contactId) => {
        const contact = contactsById.get(contactId);
        if (!contact) {
          return {
            contact_id: null,
            name: contactId,
          };
        }

        return {
          contact_id: contact.contact_id,
          name: contact.name,
          last_name: contact.last_name ?? null,
          phone: contact.phone_partial ?? null,
          phone_partial: contact.phone_partial ?? null,
          phone_ddi: contact.phone_ddi ?? null,
          email_partial: contact.email_partial ?? null,
          photo: contact.photo ?? null,
        };
      });

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

  async listContacts(
    accountId: string,
    query: ListInternalChatContactsRequest,
    allowedChannelIds: string[] = []
  ): Promise<ListInternalChatContactsResponse['data']> {
    const { currentPage, perPage } = this.normalizePaging({
      current_page: query.current_page,
      per_page: query.per_page,
    });

    const [results, total] = await this.chatContactService.listChatContacts(
      perPage,
      currentPage,
      accountId,
      query,
      allowedChannelIds
    );

    return {
      pagings: setPaginationData(results.length, total, perPage, currentPage),
      results,
    };
  }

  async viewContactPhone(
    accountId: string,
    contactId: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewInternalChatContactPhoneResponse['data']> {
    const contact = await this.chatContactService.viewChatContactById(
      contactId,
      accountId,
      allowedChannelIds
    );

    if (!contact) {
      throw new Error('contact_not_found');
    }

    const phone =
      await this.chatContactService.getChatContactPhoneDecrypted(contactId);

    if (phone === null) {
      throw new Error('contact_not_found');
    }

    return {
      phone,
      phone_ddi: contact.phone_ddi ?? null,
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
    const conversation = await this.getConversationOrThrow(
      accountId,
      conversationId
    );
    const groupLeavingActor =
      conversation.type === EInternalChatConversationType.group
        ? await this.loadActorUser(userId)
        : null;

    const closed =
      conversation.type === EInternalChatConversationType.group
        ? await this.conversationRepository.leaveGroupConversation(
            conversationId,
            userId
          )
        : await this.conversationRepository.closeConversationForUser(
            conversationId,
            userId
          );

    if (!closed) {
      throw new Error('chat_update_error');
    }

    if (groupLeavingActor) {
      const remainingConversation =
        await this.conversationRepository.getConversationById(
          accountId,
          conversationId
        );

      if (remainingConversation) {
        await this.enqueueGroupSystemMessage({
          accountId,
          conversationId,
          action: 'group_member_left',
          actor: groupLeavingActor,
        });
      }
    }

    await this.publishConversationSync(accountId, conversationId);
    return true;
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
      results: results.map((message) =>
        this.sanitizeMessageForPublicPayload(message)
      ),
    };
  }

  async searchMessages(
    accountId: string,
    userId: string,
    conversationId: string,
    query: SearchInternalChatMessagesQuery
  ): Promise<SearchInternalChatMessagesResponse> {
    await this.assertParticipant(accountId, conversationId, userId);

    const { currentPage, perPage } = this.normalizePaging(query);
    const searchTerm = query.search.trim();

    if (!searchTerm) {
      return {
        results: [],
        pagings: setPaginationData(0, 0, perPage, currentPage),
      };
    }

    const { results, total } = await this.messageRepository.searchMessages({
      accountId,
      conversationId,
      currentPage,
      perPage,
      search: searchTerm,
    });

    const visibleResults: SearchInternalChatMessagesResult[] = results
      .filter((message) => {
        const text = message.content?.message?.trim();
        const type = message.content?.type;

        return Boolean(
          text &&
          !message.deleted &&
          type !== EMessageType.delete_message &&
          type !== EMessageType.system
        );
      })
      .map((message) => ({
        message_id: message.message_id,
        date: message.date,
        message: message.content.message ?? null,
      }));

    return {
      results: visibleResults,
      pagings: setPaginationData(
        visibleResults.length,
        total,
        perPage,
        currentPage
      ),
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

    this.assertMessageAuthor(userId, message);

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

    this.assertMessageAuthor(userId, message);

    const currentContent = message.content ?? { type: EMessageType.text };
    const versions = Array.isArray(currentContent.version)
      ? [...currentContent.version]
      : [];

    if (currentContent.type !== EMessageType.delete_message) {
      versions.push({
        type: currentContent.type,
        message: currentContent.message ?? null,
        date: new Date().toISOString(),
      });
    }

    message.deleted = true;
    message.hash = uuidv7();
    message.content = {
      ...currentContent,
      type: EMessageType.delete_message,
      message: null,
      version: versions,
    };

    const updated = await this.messageRepository.updateMessage(message);
    if (!updated) return false;

    await this.publishMessageRealtime(message);
    return true;
  }

  async viewMessageHistory(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<{ results: InternalChatMessageHistoryItem[] }> {
    await this.assertParticipant(accountId, conversationId, userId);

    const message = await this.messageRepository.getMessageById(
      accountId,
      conversationId,
      messageId
    );

    if (!message || !message.content) {
      throw new Error('message_not_found');
    }

    await this.assertCanViewMessageHistory(
      accountId,
      conversationId,
      userId,
      message
    );

    return {
      results: this.buildMessageHistoryItems(message),
    };
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

    const actor = await this.loadActorUser(userId);
    await this.enqueueGroupSystemMessage({
      accountId,
      conversationId,
      action: 'group_created',
      actor,
    });

    for (const memberUserId of normalizedMembers) {
      if (memberUserId === userId) continue;

      const target = await this.loadActorUser(memberUserId);
      await this.enqueueGroupSystemMessage({
        accountId,
        conversationId,
        action: 'group_member_added',
        actor,
        target,
      });
    }

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

    const wasParticipant = await this.conversationRepository.isUserParticipant({
      accountId,
      conversationId,
      userId: body.user_id,
    });

    await this.conversationRepository.addGroupMember({
      accountId,
      conversationId,
      userId: body.user_id,
    });

    if (!wasParticipant) {
      const [actor, target] = await Promise.all([
        this.loadActorUser(userId),
        this.loadActorUser(body.user_id),
      ]);

      await this.enqueueGroupSystemMessage({
        accountId,
        conversationId,
        action: 'group_member_added',
        actor,
        target,
      });
    }

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

    const [actor, target] = await Promise.all([
      this.loadActorUser(userId),
      this.loadActorUser(memberUserId),
    ]);

    const removed = await this.conversationRepository.removeGroupMember(
      conversationId,
      memberUserId
    );

    if (removed) {
      await this.enqueueGroupSystemMessage({
        accountId,
        conversationId,
        action: 'group_member_removed',
        actor,
        target,
      });
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
      message.conversation_id,
      'message',
      message.message_id
    );
  }

  async publishConversationSync(
    accountId: string,
    conversationId: string,
    reason: 'conversation' | 'message' = 'conversation',
    messageId?: string
  ): Promise<void> {
    const payload = {
      type: 'internal_chat_conversation_sync',
      account_id: accountId,
      conversation_id: conversationId,
      reason,
      message_id: messageId,
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
    const publicMessage = this.sanitizeMessageForPublicPayload(message);

    await Promise.all([
      this.centrifugoService.publishSub(
        internalChatConversationCentrifugo(message.conversation_id),
        publicMessage
      ),
      this.centrifugoService.publishSub(
        internalChatAccountCentrifugo(message.account_id),
        publicMessage
      ),
    ]);
  }
}
