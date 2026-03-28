import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  EditMessageParams,
  EditMessageBody,
} from '@core/schema/chat/editMessage/request.schema';
import { MessageVersion } from '@core/schema/chat/listMessageChats/response.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { ensureMessageSendHash } from '@core/common/functions/messageIdentity';

@injectable()
export class ChatMessageEditorUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: EditMessageParams,
    body: EditMessageBody,
    userId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<boolean> {
    console.log('[BAILEYS_EDIT_DEBUG] edit_request_received', {
      account_id: accountId,
      chat_id: params.chat_id,
      message_id: params.message_id,
      user_id: userId,
      new_text_length: body.message?.length ?? 0,
    });

    const message = await this.chatService.findMessageByMessageId(
      accountId,
      params.message_id
    );

    if (!message) {
      console.warn('[BAILEYS_EDIT_DEBUG] edit_message_not_found', {
        account_id: accountId,
        chat_id: params.chat_id,
        message_id: params.message_id,
      });
      throw new Error(t('message_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!message.worker?.id || !channelIds.includes(message.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    if (message.chat_id !== params.chat_id) {
      throw new Error(t('message_chat_mismatch'));
    }

    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!isChatParticipant(chat, userId)) {
      throw new Error(t('chat_access_denied'));
    }

    if (message.content?.type !== EMessageType.text) {
      throw new Error(t('only_text_messages_can_be_edited'));
    }

    const messageDate = new Date(message.date);
    const now = new Date();
    const diffInMinutes = (now.getTime() - messageDate.getTime()) / (1000 * 60);

    if (diffInMinutes >= 10) {
      throw new Error(t('message_edit_timeout'));
    }

    const newVersion: MessageVersion = {
      type: message.content.type,
      message: body.message,
      date: new Date().toISOString(),
    };

    const versions = message.content.version ?? [];
    const updatedContent = {
      ...message.content,
      version: [...versions, newVersion],
    };

    console.log('[BAILEYS_EDIT_DEBUG] edit_message_versions_prepared', {
      account_id: accountId,
      chat_id: params.chat_id,
      message_id: params.message_id,
      current_versions: versions.length,
      next_versions: updatedContent.version.length,
      message_key: {
        id: message.message_key?.id ?? null,
        from_me: message.message_key?.from_me ?? null,
        remote_jid: message.message_key?.remote_jid ?? null,
        remote_jid_alt: message.message_key?.remote_jid_alt ?? null,
        participant: message.message_key?.participant ?? null,
        participant_alt: message.message_key?.participant_alt ?? null,
        addressing_mode: message.message_key?.addressing_mode ?? null,
      },
    });

    const contentUpdated = await this.chatService.updateMessageContent(
      params.message_id,
      updatedContent
    );

    if (!contentUpdated) {
      console.warn('[BAILEYS_EDIT_DEBUG] edit_content_update_failed', {
        account_id: accountId,
        chat_id: params.chat_id,
        message_id: params.message_id,
      });
      return false;
    }

    if (!message.message_key?.id || !message.message_key?.remote_jid) {
      console.warn('[BAILEYS_EDIT_DEBUG] edit_skipped_missing_message_key', {
        account_id: accountId,
        chat_id: params.chat_id,
        message_id: params.message_id,
        has_message_key_id: !!message.message_key?.id,
        has_remote_jid: !!message.message_key?.remote_jid,
      });
      return true;
    }

    const editedMessage: IChatMessage = {
      ...message,
      content: {
        ...message.content,
        ...updatedContent,
      },
    };
    ensureMessageSendHash(editedMessage);

    console.log('[BAILEYS_EDIT_DEBUG] edit_enqueued_to_worker', {
      account_id: accountId,
      worker_id: message.worker?.id ?? null,
      chat_id: editedMessage.chat_id,
      message_id: editedMessage.message_id,
      message_hash: editedMessage.hash,
      message_key_id: editedMessage.message_key?.id ?? null,
    });

    await this.streamProducerService.send(
      this.kafkaBaileysQueueService.workerSendMessage(message.worker.id),
      editedMessage,
      editedMessage.chat_id
    );

    console.log('[BAILEYS_EDIT_DEBUG] edit_enqueued_to_worker_success', {
      account_id: accountId,
      worker_id: message.worker?.id ?? null,
      chat_id: editedMessage.chat_id,
      message_id: editedMessage.message_id,
    });

    return true;
  }
}
