import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateChatStatusBody,
  UpdateChatStatusParams,
} from '@core/schema/chat/updateChatStatus/request.schema';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { UserService } from '@core/services/user.service';

@injectable()
export class ChatStatusUpdaterUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    params: UpdateChatStatusParams,
    body: UpdateChatStatusBody
  ): Promise<IChat | null> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const status = body.status as EChatStatus;

    let user: IChat['user'] | undefined;

    if (status === EChatStatus.in_chat) {
      const userData = await this.userService.viewUserNamePhoto(userId);

      if (userData) {
        user = {
          id: userData.id,
          name: userData.name,
          photo: userData.photo,
        };
      }
    }

    const updated = await this.chatService.updateChatStatus(
      params.chat_id,
      status,
      user
    );

    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    const updatedChat: IChat = {
      ...chat,
      status,
      user: user ?? chat.user,
    };

    await this.chatService.saveChat(updatedChat);

    const channelAccountId = updatedChat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);

    return updatedChat;
  }
}
