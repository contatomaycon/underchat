import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { ChatbotOfficialCompatibilityRepository } from '@core/repositories/chatbot/ChatbotOfficialCompatibility.repository';
import { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IOfficialWhatsappTemplate } from '@core/common/interfaces/IOfficialWhatsappTemplate';

@injectable()
export class ChatbotOfficialTemplatesListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(ChatbotOfficialCompatibilityRepository)
    private readonly chatbotOfficialCompatibilityRepository: ChatbotOfficialCompatibilityRepository
  ) {}

  async execute(
    accountId: string,
    chatbotId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<OfficialTemplatesResponse> {
    const workerIds = await this.resolveOfficialWorkerIds(
      accountId,
      chatbotId,
      userChannels
    );

    if (workerIds.length === 0) {
      return [];
    }

    const templatesByWorker = await Promise.all(
      workerIds.map((workerId) => this.listWorkerTemplates(workerId))
    );

    return this.intersectTemplates(templatesByWorker);
  }

  private async resolveOfficialWorkerIds(
    accountId: string,
    chatbotId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<string[]> {
    const linkedWorkerIds =
      await this.chatbotOfficialCompatibilityRepository.listActiveLinkedOfficialWorkerIds(
        accountId,
        chatbotId
      );
    const allowedChannelIds =
      userChannels.length > 0
        ? new Set(userChannels.map((channel) => channel.id))
        : null;

    if (linkedWorkerIds.length > 0) {
      return allowedChannelIds
        ? linkedWorkerIds.filter((workerId) => allowedChannelIds.has(workerId))
        : linkedWorkerIds;
    }

    const channels = await this.chatbotService.listChatbotChannels(
      accountId,
      userChannels
    );

    return channels
      .filter(
        (channel) =>
          channel.is_official === true ||
          channel.type_id === EWorkerType.whatsapp
      )
      .map((channel) => channel.id);
  }

  private async listWorkerTemplates(
    workerId: string
  ): Promise<IOfficialWhatsappTemplate[]> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      return [];
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const approvedTemplates =
      await this.metaWhatsappEmbeddedService.listApprovedMessageTemplates({
        apiVersion: connection.api_version,
        accessToken,
        wabaId: connection.waba_id,
      });

    return this.officialWhatsappTemplateService.normalizeTemplates(
      approvedTemplates
    );
  }

  private intersectTemplates(
    templatesByWorker: IOfficialWhatsappTemplate[][]
  ): IOfficialWhatsappTemplate[] {
    if (templatesByWorker.length === 0) {
      return [];
    }

    if (templatesByWorker.length === 1) {
      return templatesByWorker[0];
    }

    if (templatesByWorker.some((templates) => templates.length === 0)) {
      return [];
    }

    const [firstTemplates, ...otherTemplateGroups] = templatesByWorker;

    return firstTemplates.filter((template) => {
      const key = this.templateKey(template);
      return otherTemplateGroups.every((templates) =>
        templates.some((candidate) => this.templateKey(candidate) === key)
      );
    });
  }

  private templateKey(
    template: Pick<IOfficialWhatsappTemplate, 'name' | 'language'>
  ): string {
    return `${template.name}::${template.language}`;
  }
}
