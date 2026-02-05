import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { IChat } from '@core/common/interfaces/IChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { StartChatWithContactRequest } from '@core/schema/chat/startChatWithContact/request.schema';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ContactService } from '@core/services/contact.service';
import { SectorService } from '@core/services/sector.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import {
  IContactData,
  IRequiredData,
} from '@core/common/interfaces/IStartChatData';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import {
  createChatbotFlowCacheKey,
  createChatbotInactivityCacheKey,
  createChatbotFailedAttemptsCacheKey,
} from '@core/common/functions/createCacheKey';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

@injectable()
export class StartChatWithContactUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly workerConfigService: WorkerConfigService,
    private readonly contactService: ContactService,
    private readonly sectorService: SectorService,
    private readonly encryptService: EncryptService,
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    body: StartChatWithContactRequest,
    userChannels: { id: string; name: string }[] = []
  ): Promise<IChat> {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!body.worker_id || !channelIds.includes(body.worker_id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const contactData = await this.validateAndGetContactData(
      t,
      body.contact_id,
      accountId
    );

    const requiredData = await this.fetchRequiredData(
      t,
      accountId,
      userId,
      body.worker_id,
      body.sector_id
    );

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(body.worker_id);

    if (workerConfigFields?.allow_attendance_only_online) {
      const userStatus =
        await this.chatUserViewerRepository.findStatusByUserId(userId);

      if (userStatus !== EChatUserStatus.online) {
        throw new Error(t('attendance_only_online_allowed'));
      }
    }

    const existingChat = await this.chatService.findChatByPhone(
      accountId,
      requiredData.worker.id,
      contactData.fullPhone
    );

    if (existingChat) {
      if (existingChat.status === EChatStatus.in_chat) {
        const sectorName = existingChat.sector?.name;
        if (sectorName) {
          throw new Error(
            t('chat_already_in_service_with_sector', { sector: sectorName })
          );
        }

        throw new Error(t('chat_already_in_service'));
      }

      if (
        existingChat.status === EChatStatus.queue ||
        existingChat.status === EChatStatus.ura ||
        existingChat.status === EChatStatus.ura_output ||
        existingChat.status === EChatStatus.ura_schedule ||
        existingChat.status === EChatStatus.ura_webhook
      ) {
        return this.updateExistingChat(
          t,
          existingChat,
          contactData,
          requiredData
        );
      }
    }

    return this.createNewChat(t, contactData, requiredData);
  }

  private async validateAndGetContactData(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<IContactData> {
    const contact = await this.contactService.viewContactById(
      contactId,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    if (!contact.is_valided) {
      throw new Error(t('contact_must_be_validated'));
    }

    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData?.phone) {
      throw new Error(t('contact_phone_required'));
    }

    const contactName = contact.name ?? contact.last_name;
    const phonePartial = this.encryptService.sanitize(
      sensitiveData.phone,
      ETypeSanetize.phone
    );
    const fullPhone = `${contact.phone_ddi}${sensitiveData.phone}`;

    return {
      contact,
      sensitiveData,
      contactName,
      phonePartial,
      fullPhone,
    };
  }

  private async fetchRequiredData(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    workerId: string,
    sectorId: string | undefined
  ): Promise<IRequiredData> {
    const [user, account, worker] = await Promise.all([
      this.userService.viewUserNamePhoto(userId),
      this.accountService.viewAccountName(accountId),
      this.workerService.viewWorkerNameAndId(accountId, workerId),
    ]);

    if (!user || !account || !worker) {
      throw new Error(t('chat_create_not_found'));
    }

    let sector: { id: string; name: string; color?: string } | null = null;
    if (sectorId) {
      const sectorData = await this.sectorService.viewSectorById(
        sectorId,
        accountId
      );

      if (sectorData) {
        sector = {
          id: sectorData.sector_id,
          name: sectorData.name,
          color: sectorData.color,
        };
      }
    }

    return { user, account, worker, sector };
  }

  private async validateSimultaneousAttendanceLimit(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<void> {
    const simultaneousAttendanceLimit =
      await this.workerConfigService.viewSimultaneousAttendance(workerId);
    const simultaneousAttendanceLimitInt = Number(simultaneousAttendanceLimit);

    if (simultaneousAttendanceLimitInt > 0) {
      const currentInChatCount =
        await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          userId
        );

      if (currentInChatCount >= simultaneousAttendanceLimitInt) {
        throw new Error(
          t('simultaneous_attendance_limit_reached', {
            limit: simultaneousAttendanceLimit,
          })
        );
      }
    }
  }

  private async updateExistingChat(
    t: TFunction<'translation', undefined>,
    existingChat: IChat,
    contactData: IContactData,
    requiredData: IRequiredData
  ): Promise<IChat> {
    const currentDate = new Date().toISOString();
    const userData = requiredData.user;

    if (userData) {
      await this.validateSimultaneousAttendanceLimit(
        t,
        requiredData.account.id,
        requiredData.worker.id,
        userData.id
      );
    }

    const wasUraStatus =
      existingChat.status === EChatStatus.ura ||
      existingChat.status === EChatStatus.ura_output ||
      existingChat.status === EChatStatus.ura_schedule ||
      existingChat.status === EChatStatus.ura_webhook;

    const updatedChat = this.buildUpdatedChat(
      existingChat,
      contactData,
      requiredData,
      currentDate
    );

    const updated = await this.chatService.updateChatStatus(
      existingChat.chat_id,
      EChatStatus.in_chat,
      userData
        ? {
            id: userData.id,
            name: userData.name,
            photo: userData.photo,
          }
        : null,
      existingChat.started_at || currentDate,
      null
    );

    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    const saved = await this.chatService.saveChat(updatedChat, {
      refresh: true,
    });
    if (!saved) {
      throw new Error(t('chat_update_failed'));
    }

    if (wasUraStatus) {
      await this.invalidateChatbotFlow(updatedChat);
    }

    await this.publishChatUpdate(updatedChat);

    return updatedChat;
  }

  private async invalidateChatbotFlow(chat: IChat): Promise<void> {
    const accountId = chat.account?.id;
    const workerId = chat.worker?.id;
    const chatId = chat.chat_id;

    if (!accountId || !workerId || !chatId) {
      return;
    }

    const chatbotFlowCacheKey = createChatbotFlowCacheKey(
      accountId,
      workerId,
      chatId
    );
    const inactivityCacheKey = createChatbotInactivityCacheKey(
      accountId,
      workerId,
      chatId
    );
    const inactivityScheduleKey = 'underchat:chatbot-inactivity-schedule';
    const failedAttemptsCacheKey = createChatbotFailedAttemptsCacheKey(
      accountId,
      workerId,
      chatId
    );

    await Promise.all([
      this.redis.del(chatbotFlowCacheKey),
      this.redis.del(inactivityCacheKey),
      this.redis.zrem(inactivityScheduleKey, inactivityCacheKey),
      this.redis.del(failedAttemptsCacheKey),
      this.chatService.invalidateChatCache(chat),
    ]);
  }

  private buildUpdatedChat(
    existingChat: IChat,
    contactData: IContactData,
    requiredData: IRequiredData,
    currentDate: string
  ): IChat {
    const userData = requiredData.user;
    const remoteJid = normalizePhoneToJid(
      contactData.sensitiveData?.phone || null,
      contactData.contact.phone_ddi || null
    );

    return {
      ...existingChat,
      message_key: existingChat.message_key || {
        remote_jid: remoteJid || null,
        remote_jid_alt: null,
      },
      status: EChatStatus.in_chat,
      worker: {
        id: requiredData.worker.id,
        name: requiredData.worker.name,
      },
      sector: requiredData.sector || existingChat.sector,
      user: userData
        ? {
            id: userData.id,
            name: userData.name,
            photo: userData.photo,
          }
        : existingChat.user,
      contact: {
        id: contactData.contact.contact_id,
        name: contactData.contactName,
        phone: contactData.phonePartial,
        phone_ddi: contactData.contact.phone_ddi,
        photo: contactData.contact.photo,
        responsible_attendant: contactData.contact.user
          ? {
              id: contactData.contact.user.user_id,
              name: contactData.contact.user.name ?? '',
              photo: contactData.contact.user.photo ?? null,
            }
          : null,
        ignore: contactData.contact.ignore ?? 'not_ignore',
      },
      name: contactData.contactName,
      phone: contactData.fullPhone,
      photo: contactData.contact.photo,
      started_at: existingChat.started_at || currentDate,
      forward_to_output_chatbot: true,
    };
  }

  private async createNewChat(
    t: TFunction<'translation', undefined>,
    contactData: IContactData,
    requiredData: IRequiredData
  ): Promise<IChat> {
    const userData = requiredData.user;

    if (userData) {
      await this.validateSimultaneousAttendanceLimit(
        t,
        requiredData.account.id,
        requiredData.worker.id,
        userData.id
      );
    }

    const currentDate = new Date().toISOString();
    const remoteJid = normalizePhoneToJid(
      contactData.sensitiveData?.phone || null,
      contactData.contact.phone_ddi || null
    );

    const newChat: IChat = {
      chat_id: uuidv7(),
      message_key: {
        remote_jid: remoteJid || null,
        remote_jid_alt: null,
      },
      account: {
        id: requiredData.account.id,
        name: requiredData.account.name,
      },
      worker: {
        id: requiredData.worker.id,
        name: requiredData.worker.name,
      },
      sector: requiredData.sector,
      user: requiredData.user,
      contact: {
        id: contactData.contact.contact_id,
        name: contactData.contactName,
        phone: contactData.phonePartial,
        phone_ddi: contactData.contact.phone_ddi,
        photo: contactData.contact.photo,
        responsible_attendant: contactData.contact.user
          ? {
              id: contactData.contact.user.user_id,
              name: contactData.contact.user.name ?? '',
              photo: contactData.contact.user.photo ?? null,
            }
          : null,
        ignore: contactData.contact.ignore ?? 'not_ignore',
      },
      name: contactData.contactName,
      phone: contactData.fullPhone,
      photo: contactData.contact.photo,
      status: EChatStatus.in_chat,
      date: currentDate,
      started_at: currentDate,
      forward_to_output_chatbot: true,
    };

    const result = await this.chatService.saveChat(newChat, { refresh: true });
    if (!result) {
      throw new Error('chat_create_error');
    }

    await this.publishChatUpdate(newChat);

    return newChat;
  }

  private async publishChatUpdate(chat: IChat): Promise<void> {
    const channelAccountId = chat.account.id;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        chat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        chat
      ),
    ]);
  }
}
