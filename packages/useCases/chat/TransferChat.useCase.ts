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
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import Redis from 'ioredis';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { createChatCacheKey } from '@core/common/functions/createCacheKey';
import { isChatPrimary } from '@core/common/functions/chatParticipants';
import { isMasterOrAdministratorRole } from '@core/common/functions/isMasterOrAdministratorRole';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

@injectable()
export class TransferChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatUserViewerRepository)
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async loadUserAndSector(
    body: TransferChatBody,
    accountId: string
  ): Promise<{
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null;
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null;
  }> {
    const userPromise = body.user_id
      ? this.userService.viewUserNamePhoto(body.user_id)
      : Promise.resolve(null);
    const sectorPromise = body.sector_id
      ? this.sectorService.viewSectorById(body.sector_id, accountId)
      : Promise.resolve(null);

    const [userData, sectorData] = await Promise.all([
      userPromise,
      sectorPromise,
    ]);

    return { userData, sectorData };
  }

  private async resolveTargetWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat,
    body: TransferChatBody
  ): Promise<IChat['worker']> {
    if (!body.worker_id) {
      return chat.worker;
    }

    const worker = await this.workerService.viewWorkerNameAndId(
      accountId,
      body.worker_id
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    return {
      id: worker.id,
      name: worker.name,
    };
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

  private findChatParticipantById(
    chat: IChat,
    userId: string
  ): NonNullable<IChat['user']> | null {
    if (chat.user?.id === userId) {
      return chat.user;
    }

    const secondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    const secondaryUser = secondaryUsers.find((user) => user?.id === userId);
    return secondaryUser ?? null;
  }

  private buildUserFromData(
    body: TransferChatBody,
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null,
    chat: IChat,
    currentDate: string
  ): IChat['user'] | null | undefined {
    if (!body.user_id) return undefined;

    if (!userData) return undefined;

    const existingParticipant = this.findChatParticipantById(chat, userData.id);

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
      entered_at: existingParticipant?.entered_at ?? currentDate,
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
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer',
    sectorName?: string | null,
    userName?: string | null
  ): Promise<string> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const protocol =
      (await this.chatService.getOrCreateChatProtocol(
        accountId,
        chatId,
        protocolType
      )) || this.chatService.getLatestProtocolByType(chat, protocolType);
    if (!protocol) {
      throw new Error(t('chat_transfer_failed'));
    }

    const message = replaceMessageTags({
      message: protocolText,
      chat,
      protocol,
      t,
      sectorName,
      userName,
    });

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.system,
    });

    return protocol;
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

  private async validateUserAccessToTargetChannel(
    t: TFunction<'translation', undefined>,
    accountId: string,
    targetWorkerId: string,
    userId?: string
  ): Promise<void> {
    if (!userId) {
      return;
    }

    const userIdsWithAccess =
      await this.userService.listUserIdsWithAccessToChannel(
        accountId,
        targetWorkerId
      );

    if (!userIdsWithAccess.includes(userId)) {
      throw new Error(t('user_not_found'));
    }
  }

  private canManageInChatLifecycle(actions: IJwtGroupHierarchy[]): boolean {
    if (!actions?.length) {
      return false;
    }

    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.manage_in_chat_lifecycle,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private buildUpdatedChatForTransfer(
    chat: IChat,
    worker: IChat['worker'],
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined,
    shouldClearUser: boolean,
    shouldClearSector: boolean,
    secondaryUsers: IChat['secondary_users'] | null
  ): IChat {
    return {
      ...chat,
      worker,
      status: EChatStatus.queue,
      user: shouldClearUser ? null : (user ?? chat.user),
      secondary_users: secondaryUsers,
      sector: shouldClearSector ? null : (sector ?? chat.sector),
      forward_to_output_chatbot: true,
    };
  }

  private buildSecondaryUsersForTransfer(input: {
    chat: IChat;
    keepInChat: boolean;
    nextPrimaryUser: IChat['user'] | null;
    currentDate: string;
  }): IChat['secondary_users'] | null {
    const { chat, keepInChat, nextPrimaryUser, currentDate } = input;
    const nextPrimaryUserId = nextPrimaryUser?.id ?? null;
    const previousPrimaryUser = chat.user ?? null;
    const previousPrimaryUserId = previousPrimaryUser?.id ?? null;
    const byId = new Map<string, NonNullable<IChat['user']>>();

    const existingSecondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    for (const secondaryUser of existingSecondaryUsers) {
      if (!secondaryUser?.id || secondaryUser.id === nextPrimaryUserId) {
        continue;
      }

      if (!keepInChat && secondaryUser.id === previousPrimaryUserId) {
        continue;
      }
      byId.set(secondaryUser.id, secondaryUser);
    }

    if (
      keepInChat &&
      previousPrimaryUser?.id &&
      previousPrimaryUser.id !== nextPrimaryUserId
    ) {
      const existingSecondary = byId.get(previousPrimaryUser.id);
      const enteredAt =
        previousPrimaryUser.entered_at ??
        existingSecondary?.entered_at ??
        chat.started_at ??
        currentDate;

      byId.set(previousPrimaryUser.id, {
        id: previousPrimaryUser.id,
        name: previousPrimaryUser.name ?? existingSecondary?.name ?? '',
        photo: previousPrimaryUser.photo ?? existingSecondary?.photo ?? null,
        entered_at: enteredAt,
      });
    }

    if (byId.size === 0) {
      return [];
    }

    return Array.from(byId.values());
  }

  private async buildChatWithProtocol(
    updatedChat: IChat,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    > | null,
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined
  ): Promise<IChat> {
    let protocol: string | null = null;
    let protocolText: string | null = null;

    const hasUser = !!user;
    const hasSector = !!sector;

    if (hasUser && hasSector) {
      protocolText =
        workerConfigFields?.generate_protocol_at_transfer_sector_and_user ||
        null;
    } else if (hasSector) {
      protocolText =
        workerConfigFields?.generate_protocol_at_transfer_sector || null;
    } else if (hasUser) {
      protocolText = workerConfigFields?.generate_protocol_at_transfer || null;
    }

    if (protocolText) {
      protocol = await this.sendProtocolMessage(
        t,
        accountId,
        chatId,
        protocolText,
        'protocol_transfer',
        sector?.name || null,
        user?.name || null
      );
    }

    const existingProtocols = updatedChat.protocol_transfer ?? [];
    let protocolTransfer: string[] | null = null;
    if (protocol) {
      const hasProtocol = existingProtocols.includes(protocol);
      protocolTransfer = hasProtocol
        ? existingProtocols
        : [...existingProtocols, protocol];
    }
    if (!protocol && existingProtocols.length > 0) {
      protocolTransfer = existingProtocols;
    }

    return {
      ...updatedChat,
      protocol_transfer: protocolTransfer,
    };
  }

  private async invalidateTransferCache(
    accountId: string,
    previousChat: IChat,
    updatedChat: IChat
  ): Promise<void> {
    const cacheAccountId =
      updatedChat.account?.id ?? previousChat.account?.id ?? accountId;

    if (previousChat.worker?.id && cacheAccountId) {
      const previousWorkerCacheKey = createChatCacheKey(
        cacheAccountId,
        previousChat.worker.id,
        previousChat.phone
      );
      await this.redis.del(previousWorkerCacheKey);
    }

    await this.chatService.invalidateChatCache(updatedChat);
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
    params: TransferChatParams,
    body: TransferChatBody,
    actorUserId: string,
    permissionRoleId: string | null,
    actions: IJwtGroupHierarchy[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<{ chat_id: string; status: boolean }> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const channelIds = userChannels.map((c) => c.id);

    if (userChannels.length > 0) {
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const canManageTransfer =
      isChatPrimary(chat, actorUserId) ||
      isMasterOrAdministratorRole(permissionRoleId) ||
      this.canManageInChatLifecycle(actions);

    if (!canManageTransfer) {
      throw new Error(t('chat_only_primary_can_transfer'));
    }

    if (body.user_id && chat.user?.id && body.user_id === chat.user.id) {
      throw new Error(t('chat_cannot_transfer_to_current_primary'));
    }

    const targetWorker = await this.resolveTargetWorker(
      t,
      accountId,
      chat,
      body
    );

    if (channelIds.length > 0 && !channelIds.includes(targetWorker.id)) {
      throw new Error(t('chat_access_denied'));
    }

    const isChannelChanged = targetWorker.id !== chat.worker.id;

    const { userData, sectorData } = await this.loadUserAndSector(
      body,
      accountId
    );
    const currentDate = new Date().toISOString();

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(
        targetWorker.id
      );

    let user = this.buildUserFromData(body, userData, chat, currentDate);
    let sector = this.buildSectorFromData(body, sectorData);
    const keepInChat = body.keep_in_chat === true;

    const isChannelOnlyTransfer =
      isChannelChanged && !body.user_id && !body.sector_id;
    const shouldClearUser =
      isChannelOnlyTransfer || !!(body.sector_id && !body.user_id);
    const shouldClearSector =
      isChannelOnlyTransfer || !!(body.user_id && !body.sector_id);

    if (shouldClearUser) {
      user = null;
    }

    if (shouldClearSector) {
      sector = null;
    }

    this.validateUserAndSector(t, body, user, sector);

    await this.validateUserAccessToTargetChannel(
      t,
      accountId,
      targetWorker.id,
      body.user_id
    );

    await this.validateTransferTarget(t, workerConfigFields, body);

    const nextPrimaryUser: IChat['user'] | null = shouldClearUser
      ? null
      : (user ?? chat.user ?? null);

    const secondaryUsers = this.buildSecondaryUsersForTransfer({
      chat,
      keepInChat,
      nextPrimaryUser,
      currentDate,
    });

    const updatedChat = this.buildUpdatedChatForTransfer(
      chat,
      targetWorker,
      user,
      sector,
      shouldClearUser,
      shouldClearSector,
      secondaryUsers
    );

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

    await this.chatService.clearChatSummary(params.chat_id, accountId);

    await this.invalidateTransferCache(accountId, chat, updatedChat);

    const chatWithProtocol = await this.buildChatWithProtocol(
      updatedChat,
      workerConfigFields,
      t,
      accountId,
      params.chat_id,
      user,
      sector
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

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }
}
