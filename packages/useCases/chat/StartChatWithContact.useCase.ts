import { injectable } from 'tsyringe';
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
import { ContactService } from '@core/services/contact.service';
import { SectorService } from '@core/services/sector.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

@injectable()
export class StartChatWithContactUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly contactService: ContactService,
    private readonly sectorService: SectorService,
    private readonly encryptService: EncryptService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    isAdministrator: boolean,
    body: StartChatWithContactRequest
  ): Promise<IChat> {
    const contact = await this.contactService.viewContactById(
      body.contact_id,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    if (!contact.is_valided) {
      throw new Error(t('contact_must_be_validated'));
    }

    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(
        body.contact_id
      );

    if (!sensitiveData?.phone) {
      throw new Error(t('contact_phone_required'));
    }

    const [viewUserNamePhoto, viewAccountName, viewWorkerNameAndId] =
      await Promise.all([
        this.userService.viewUserNamePhoto(userId),
        this.accountService.viewAccountName(accountId),
        this.workerService.viewWorkerNameAndId(accountId, body.worker_id),
      ]);

    if (!viewUserNamePhoto || !viewAccountName || !viewWorkerNameAndId) {
      throw new Error(t('chat_create_not_found'));
    }

    let sectorData: { id: string; name: string } | null = null;
    if (body.sector_id) {
      const sector = await this.sectorService.viewSectorById(
        body.sector_id,
        accountId,
        isAdministrator
      );

      if (sector) {
        sectorData = {
          id: sector.sector_id,
          name: sector.name,
        };
      }
    }

    const currentDate = new Date().toISOString();
    const contactName = `${contact.name}${contact.last_name ? ` ${contact.last_name}` : ''}`;

    const phonePartial = this.encryptService.sanitize(
      sensitiveData.phone,
      ETypeSanetize.phone
    );
    const fullPhone = `${contact.phone_ddi}${sensitiveData.phone}`;

    const inputChatMessage: IChat = {
      chat_id: uuidv7(),
      account: viewAccountName,
      worker: {
        id: viewWorkerNameAndId.id,
        name: viewWorkerNameAndId.name,
      },
      sector: sectorData,
      user: viewUserNamePhoto,
      contact: {
        id: contact.contact_id,
        name: contactName,
        phone: phonePartial,
        phone_ddi: contact.phone_ddi,
        photo: contact.photo,
      },
      name: contactName,
      phone: fullPhone,
      photo: contact.photo,
      status: EChatStatus.in_chat,
      date: currentDate,
      started_at: currentDate,
    };

    const result = await this.chatService.saveChat(inputChatMessage);
    if (!result) {
      throw new Error(t('chat_create_error'));
    }

    const channelAccountId = inputChatMessage.account.id;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        inputChatMessage
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        inputChatMessage
      ),
    ]);

    return inputChatMessage;
  }
}
