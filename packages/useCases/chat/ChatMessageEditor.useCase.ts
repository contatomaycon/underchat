import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  EditMessageParams,
  EditMessageBody,
} from '@core/schema/chat/editMessage/request.schema';
import { MessageVersion } from '@core/schema/chat/listMessageChats/response.schema';

@injectable()
export class ChatMessageEditorUseCase {
  constructor(private readonly chatService: ChatService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: EditMessageParams,
    body: EditMessageBody
  ): Promise<boolean> {
    const message = await this.chatService.findMessageByMessageId(
      accountId,
      params.message_id
    );

    if (!message) {
      throw new Error(t('message_not_found'));
    }

    if (message.chat_id !== params.chat_id) {
      throw new Error(t('message_chat_mismatch'));
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

    return await this.chatService.updateMessageContent(
      params.message_id,
      updatedContent
    );
  }
}
