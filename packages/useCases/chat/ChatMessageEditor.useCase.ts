import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  EditMessageParams,
  EditMessageBody,
} from '@core/schema/chat/editMessage/request.schema';
import { MessageVersion } from '@core/schema/chat/listMessageChats/response.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { resolveWorkerCommandChatEntityKey } from '@core/common/functions/messageIdentity';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { WorkerCommandAdmissionService } from '@core/services/workerCommandAdmission.service';
import { workerCommandMessagePayload } from '@core/common/functions/workerCommandMessagePayload';
import { currentWorkerCommandRetryOf } from '@core/common/functions/workerCommandAcceptanceContext';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ChatMessageEditorUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerCommandAdmissionService)
    private readonly workerCommandAdmissionService: WorkerCommandAdmissionService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: EditMessageParams,
    body: EditMessageBody,
    userId: string,
    userChannels: { id: string; name: string }[] = [],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const message = await this.chatService.findMessageByMessageId(
      accountId,
      params.message_id
    );

    if (!message) {
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

    if (await this.isOfficialWorker(accountId, message.worker?.id)) {
      throw new Error(t('whatsapp_official_edit_message_not_supported'));
    }

    if (message.content?.type !== EMessageType.text) {
      throw new Error(t('only_text_messages_can_be_edited'));
    }

    const operationId =
      body.operation_id === undefined ? uuidv7() : body.operation_id.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(operationId)) {
      throw new Error('worker_command_operation_id_invalid');
    }
    if (
      body.retry_of &&
      (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(body.retry_of) ||
        body.retry_of === operationId)
    ) {
      throw new Error('worker_command_retry_of_invalid');
    }

    const versions = message.content.version ?? [];
    const latestVersion = [...versions].sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime()
    )[0];
    const effectiveMessage = latestVersion?.message ?? message.content.message;
    if (effectiveMessage === body.message) {
      if (
        latestVersion &&
        message.message_key?.id &&
        message.message_key.remote_jid
      ) {
        await this.admitEdit(
          accountId,
          this.buildEditCommandMessage(message, operationId, body.message),
          operationId,
          webhookSource,
          true
        );
      }
      return true;
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

    const updatedContent = {
      ...message.content,
      version: [...versions, newVersion],
    };

    const editedMessage: IChatMessage = {
      ...message,
      content: {
        ...message.content,
        ...updatedContent,
      },
      hash: operationId,
    };

    const contentUpdated = await this.chatService.updateMessageChat(
      editedMessage,
      {
        eventTypes: ['message.edited'],
        idempotencyKey: `message-edit:${message.message_id}:${operationId}`,
        source: webhookSource,
        previousMessage: message,
        actor: { type: 'user', id: userId },
        changes: {
          edited_at: newVersion.date,
          origin: webhookSource,
        },
      }
    );

    if (!contentUpdated) {
      return false;
    }

    if (!message.message_key?.id || !message.message_key?.remote_jid) {
      return true;
    }

    await this.admitEdit(
      accountId,
      this.buildEditCommandMessage(editedMessage, operationId, body.message),
      operationId,
      webhookSource,
      false
    );

    return true;
  }

  private async admitEdit(
    accountId: string,
    message: IChatMessage,
    operationId: string,
    source: OutboundWebhookRequestSource,
    retry: boolean
  ): Promise<void> {
    const workerId = message.worker.id?.trim();
    if (!workerId) {
      throw new Error('Worker ID is required to edit message');
    }
    await this.workerCommandAdmissionService.admit({
      accountId,
      workerId,
      commandType: 'direct_send',
      entityKey: resolveWorkerCommandChatEntityKey(
        accountId,
        workerId,
        message
      ),
      operationId,
      retryOf: currentWorkerCommandRetryOf(),
      payload: workerCommandMessagePayload(message),
      source,
      retry,
    });
  }

  private buildEditCommandMessage(
    message: IChatMessage,
    operationId: string,
    editedText: string
  ): IChatMessage {
    return {
      message_id: message.message_id,
      chat_id: message.chat_id,
      message_key: message.message_key
        ? {
            remote_jid: message.message_key.remote_jid ?? null,
            remote_jid_alt: message.message_key.remote_jid_alt ?? null,
            from_me: message.message_key.from_me ?? false,
            id: message.message_key.id ?? null,
            participant: message.message_key.participant ?? null,
            participant_alt: message.message_key.participant_alt ?? null,
            addressing_mode: message.message_key.addressing_mode ?? null,
            is_view_once: false,
          }
        : null,
      type_user: message.type_user,
      account: message.account,
      worker: message.worker,
      user: null,
      phone: message.phone,
      content: {
        type: EMessageType.text,
        message: message.content?.message ?? null,
        version: [
          {
            type: EMessageType.text,
            message: editedText,
            // Provider ordering is carried by the lane; the original
            // message clock keeps retries byte-for-byte stable.
            date: message.date,
          },
        ],
      },
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      date: message.date,
      deleted: false,
      has_quoted: false,
      sent_from_platform: true,
      hash: operationId,
    };
  }

  private async isOfficialWorker(
    accountId: string,
    workerId?: string | null
  ): Promise<boolean> {
    if (!workerId) {
      return false;
    }

    const workerType = await this.workerService.viewWorkerType(
      accountId,
      workerId
    );

    return workerType?.worker_type_id === EWorkerType.whatsapp;
  }
}
