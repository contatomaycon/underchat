import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
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
import { WorkerService } from '@core/services/worker.service';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { AutomaticAttendanceService } from '@core/services/automaticAttendance.service';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import Redis from 'ioredis';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

@injectable()
export class TransferChatUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly chatMessageService: ChatMessageService,
    private readonly centrifugoService: CentrifugoService,
    private readonly workerService: WorkerService,
    private readonly automaticAttendanceService: AutomaticAttendanceService,
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async loadUserAndSector(
    body: TransferChatBody,
    accountId: string,
    isAdministrator: boolean
  ): Promise<{
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null;
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null;
  }> {
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

    const [userData, sectorData] = await Promise.all([
      userPromise,
      sectorPromise,
    ]);

    return { userData, sectorData };
  }

  private validateUserAndSector(
    t: TFunction<'translation', undefined>,
    body: TransferChatBody,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined
  ): void {
    if (user === undefined && sector === undefined) {
      throw new Error(t('transfer_requires_user_or_sector'));
    }

    if (body.user_id && user === undefined) {
      throw new Error(t('user_not_found'));
    }

    if (body.sector_id && sector === undefined) {
      throw new Error(t('sector_not_found'));
    }
  }

  private buildUserFromData(
    body: TransferChatBody,
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null
  ): IChat['user'] | null | undefined {
    if (!body.user_id) return undefined;

    if (!userData) return undefined;

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
    };
  }

  private buildSectorFromData(
    body: TransferChatBody,
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null
  ): IChat['sector'] | null | undefined {
    if (!body.sector_id) return undefined;

    if (!sectorData) return undefined;

    return {
      id: sectorData.sector_id,
      name: sectorData.name,
      color: sectorData.color,
    };
  }

  private async sendAnnotationMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    annotation: string
  ): Promise<void> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId,
      type: EMessageType.annotation,
      message: annotation.trim(),
      typeUser: ETypeUserChat.system,
    });
  }

  private async sendProtocolMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    protocolText: string,
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer'
  ): Promise<string> {
    const protocol = generateProtocol();
    const message = protocolText.replaceAll(
      /\{\{\s*protocolo\s*\}\}/gi,
      protocol
    );

    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    await Promise.all([
      this.chatMessageService.sendMessage(t, {
        chat,
        accountId,
        type: EMessageType.system,
        message,
        typeUser: ETypeUserChat.system,
      }),
      this.chatService.updateChatProtocol(chatId, protocolType, protocol),
    ]);

    return protocol;
  }

  private async invalidateChatCache(chat: IChat): Promise<void> {
    const cacheKey = `underchat:chat:${chat.account.id}:${chat.worker.id}:${chat.phone}`;
    const cacheKeyChat = `chat:${chat.account.id}:${chat.chat_id}`;
    await Promise.all([this.redis.del(cacheKey), this.redis.del(cacheKeyChat)]);
  }

  private async validateTransferTarget(
    t: TFunction<'translation', undefined>,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    > | null,
    body: TransferChatBody
  ): Promise<void> {
    if (workerConfigFields?.allow_attendance_only_online && body.user_id) {
      const targetUserStatus =
        await this.chatUserViewerRepository.findStatusByUserId(body.user_id);

      if (targetUserStatus !== EChatUserStatus.online) {
        throw new Error(t('user_unavailable_for_transfer'));
      }
    }
  }

  private buildUpdatedChatForTransfer(
    chat: IChat,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined,
    shouldClearUser: boolean,
    shouldClearSector: boolean
  ): IChat {
    return {
      ...chat,
      status: EChatStatus.queue,
      user: shouldClearUser ? null : (user ?? chat.user),
      sector: shouldClearSector ? null : (sector ?? chat.sector),
    };
  }

  private async buildChatWithProtocol(
    updatedChat: IChat,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    > | null,
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string
  ): Promise<IChat> {
    let protocol: string | null = null;
    if (workerConfigFields?.generate_protocol_at_transfer) {
      protocol = await this.sendProtocolMessage(
        t,
        accountId,
        chatId,
        workerConfigFields.generate_protocol_at_transfer,
        'protocol_transfer'
      );
    }

    const existingProtocols = updatedChat.protocol_transfer ?? [];
    let protocolTransfer: string[] | null = null;
    if (protocol) {
      protocolTransfer = [...existingProtocols, protocol];
    } else if (existingProtocols.length > 0) {
      protocolTransfer = existingProtocols;
    }

    return {
      ...updatedChat,
      protocol_transfer: protocolTransfer,
    };
  }

  private async publishChatUpdate(
    chatWithProtocol: IChat,
    accountId: string
  ): Promise<void> {
    const channelAccountId = chatWithProtocol.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        chatWithProtocol
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        chatWithProtocol
      ),
    ]);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    params: TransferChatParams,
    body: TransferChatBody,
    userId: string,
    userSectors: string[]
  ): Promise<{ chat_id: string; status: boolean }> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const { userData, sectorData } = await this.loadUserAndSector(
      body,
      accountId,
      isAdministrator
    );

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    let user = this.buildUserFromData(body, userData);
    let sector = this.buildSectorFromData(body, sectorData);

    const shouldClearUser = !!(body.sector_id && !body.user_id);
    const shouldClearSector = !!(body.user_id && !body.sector_id);

    if (shouldClearUser) {
      user = null;
    }

    if (shouldClearSector) {
      sector = null;
    }

    this.validateUserAndSector(t, body, user, sector);

    await this.validateTransferTarget(t, workerConfigFields, body);

    const updatedChat = this.buildUpdatedChatForTransfer(
      chat,
      user,
      sector,
      shouldClearUser,
      shouldClearSector
    );

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

    await this.invalidateChatCache(updatedChat);

    const chatWithProtocol = await this.buildChatWithProtocol(
      updatedChat,
      workerConfigFields,
      t,
      accountId,
      params.chat_id
    );

    await this.publishChatUpdate(chatWithProtocol, accountId);

    if (body.annotation?.trim()) {
      await this.sendAnnotationMessage(
        t,
        accountId,
        params.chat_id,
        body.annotation
      );
    }

    await this.automaticAttendanceService.handleAutomaticAttendance(
      t,
      accountId,
      chat.worker.id,
      userId,
      userSectors,
      params.chat_id
    );

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }
}
