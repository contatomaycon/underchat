import { injectable, inject } from 'tsyringe';
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
import Redis from 'ioredis';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private async getChat(accountId: string, chatId: string) {
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

    console.log(result);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody,
    userId: string
  ): Promise<boolean> {
    const [account, user] = await Promise.all([
      this.accountService.viewAccountName(accountId),
      this.userService.viewUserNamePhoto(userId),
    ]);

    if (!account) {
      throw new Error(t('account_not_found'));
    }

    if (!user) {
      throw new Error(t('user_not_found'));
    }

    const getChat = await this.getChat(accountId, params.chat_id);

    console.log(getChat);

    const inputChat: IChatMessage = {
      message_id: uuidv4(),
      chat_id: params.chat_id,
      type_user: ETypeUserChat.operator,
      account,
      user,
      message: body.message,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      date: new Date().toISOString(),
    };

    return this.chatService.saveMessageChat(inputChat);
  }
}
