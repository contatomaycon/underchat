import { injectable, inject } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import Redis from 'ioredis';
import { IChat } from '@core/common/interfaces/IChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import { chatQueueAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { CreateChatRequest } from '@core/schema/chat/createChat/request.schema';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';

@injectable()
export class ChatCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService
  ) {}

  private centrifugoChatQueuePublish(
    dataPublish: IChat
  ): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      chatQueueAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    body: CreateChatRequest
  ): Promise<boolean> {
    const [viewUserNamePhoto, viewAccountName, viewWorkerNameAndId] =
      await Promise.all([
        this.userService.viewUserNamePhoto(userId),
        this.accountService.viewAccountName(accountId),
        this.workerService.viewWorkerNameAndId(accountId, body.worker_id),
      ]);

    if (!viewUserNamePhoto || !viewAccountName || !viewWorkerNameAndId) {
      throw new Error(t('chat_create_not_found'));
    }

    const inputChatMessage: IChat = {
      chat_id: uuidv4(),
      account: viewAccountName,
      worker: viewWorkerNameAndId,
      user: viewUserNamePhoto,
      name: body.name,
      phone: body.phone,
      status: EChatStatus.in_chat,
      date: new Date().toISOString(),
    };

    const result = await this.chatService.saveChat(inputChatMessage);

    if (!result) {
      throw new Error(t('chat_create_error'));
    }

    await this.centrifugoChatQueuePublish(inputChatMessage);

    return result;
  }
}
