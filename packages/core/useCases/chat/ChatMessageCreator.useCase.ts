import { injectable } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { v4 as uuidv4 } from 'uuid';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { AccountService } from '@core/services/account.service';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ChatService } from '@core/services/chat.service';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly accountService: AccountService,
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody,
    userId?: string | null,
    typeUser: ETypeUserChat = ETypeUserChat.operator
  ): Promise<boolean> {
    const account = await this.accountService.viewAccountName(accountId);

    if (!account) {
      throw new Error(t('account_not_found'));
    }

    const inputChat: IChatMessage = {
      message_id: uuidv4(),
      chat_id: params.chat_id,
      type_user: typeUser,
      account,
      message: body.message,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      date: new Date().toISOString(),
    };

    if (userId && typeUser === ETypeUserChat.operator) {
      const user = await this.userService.viewUserNamePhoto(userId);

      if (user) {
        inputChat.user = user;
      }
    }

    return this.chatService.saveMessageChat(inputChat);
  }
}
