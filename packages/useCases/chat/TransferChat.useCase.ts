import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { ChatMessageCreatorUseCase } from './ChatMessageCreator.useCase';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  TransferChatParams,
  TransferChatBody,
} from '@core/schema/chat/transferChat/request.schema';
import { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { WorkerService } from '@core/services/worker.service';
import { generateProtocol } from '@core/common/functions/generateProtocol';

@injectable()
export class TransferChatUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly chatMessageCreatorUseCase: ChatMessageCreatorUseCase,
    private readonly centrifugoService: CentrifugoService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    params: TransferChatParams,
    body: TransferChatBody
  ): Promise<{ chat_id: string; status: boolean }> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    let user: IChat['user'] | null | undefined = undefined;
    let sector: IChat['sector'] | null | undefined = undefined;

    const userPromise = body.user_id
      ? this.userService.viewUserNamePhoto(body.user_id)
      : Promise.resolve(null);
    const sectorPromise = body.sector_id
      ? this.sectorService.viewSectorById(
          body.sector_id,
          accountId,
          isAdministrator
        )
      : Promise.resolve(null);

    const [userData, sectorData, workerConfigFields] = await Promise.all([
      userPromise,
      sectorPromise,
      this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id),
    ]);

    if (body.user_id) {
      if (!userData) {
        throw new Error(t('user_not_found'));
      }

      user = {
        id: userData.id,
        name: userData.name,
        photo: userData.photo,
      };
    }

    if (body.sector_id) {
      if (!sectorData) {
        throw new Error(t('sector_not_found'));
      }

      sector = {
        id: sectorData.sector_id,
        name: sectorData.name,
      };

      if (!body.user_id) {
        user = null;
      }
    }

    if (user === undefined && sector === undefined) {
      throw new Error(t('transfer_requires_user_or_sector'));
    }

    if (body.user_id && user === undefined) {
      throw new Error(t('user_not_found'));
    }

    if (body.sector_id && sector === undefined) {
      throw new Error(t('sector_not_found'));
    }

    const updatedChat: IChat = {
      ...chat,
      status: EChatStatus.queue,
      user: user !== undefined ? user : chat.user,
      sector: sector !== undefined ? sector : chat.sector,
    };

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

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

    if (body.annotation && body.annotation.trim()) {
      const messageBody: CreateMessageChatsBody = {
        type: EMessageType.annotation,
        message: body.annotation.trim(),
      };

      await this.chatMessageCreatorUseCase.execute(
        t,
        accountId,
        {
          chat_id: params.chat_id,
        },
        messageBody
      );
    }

    if (workerConfigFields?.generate_protocol_at_transfer) {
      const protocol = generateProtocol();

      const protocolMessageBody: CreateMessageChatsBody = {
        type: EMessageType.system,
        message: `${t('transfer_protocol')}: ${protocol}`,
      };

      await this.chatMessageCreatorUseCase.execute(
        t,
        accountId,
        {
          chat_id: params.chat_id,
        },
        protocolMessageBody
      );
    }

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }
}
