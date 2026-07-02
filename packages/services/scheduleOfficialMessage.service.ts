import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { doesChatbotFlowStartWithOfficialTemplate } from '@core/common/functions/chatbotOfficialNodes';

@injectable()
export class ScheduleOfficialMessageService {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async isOfficialWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<boolean> {
    const workerType = await this.workerService.viewWorkerType(
      accountId,
      workerId
    );

    if (!workerType) {
      throw new Error(t('worker_not_found'));
    }

    return isOfficialWhatsappWorker(workerType.worker_type_id);
  }

  async listApprovedTemplatesForWorker(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    workerId: string;
    userChannels?: { id: string; name: string }[];
  }): Promise<OfficialTemplatesResponse> {
    const userChannels = input.userChannels ?? [];
    if (userChannels.length > 0) {
      const allowedWorkerIds = new Set(
        userChannels.map((channel) => channel.id)
      );
      if (!allowedWorkerIds.has(input.workerId)) {
        throw new Error(input.t('chat_access_denied'));
      }
    }

    const isOfficial = await this.isOfficialWorker(
      input.t,
      input.accountId,
      input.workerId
    );

    if (!isOfficial) {
      throw new Error(input.t('official_opening_only_official_channel'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        input.workerId
      );

    if (!connection) {
      throw new Error(input.t('official_opening_connection_not_found'));
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

  async validateTemplateForSchedule(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    workerId: string;
    officialTemplate: IOfficialWhatsappTemplateMessage | null;
  }): Promise<IOfficialWhatsappTemplateMessage> {
    if (!input.officialTemplate?.name || !input.officialTemplate.language) {
      throw new Error(input.t('schedule_official_template_required'));
    }

    const templates = await this.listApprovedTemplatesForWorker({
      t: input.t,
      accountId: input.accountId,
      workerId: input.workerId,
    });
    const template = this.officialWhatsappTemplateService.findTemplate(
      templates,
      input.officialTemplate
    );

    if (!template) {
      throw new Error(input.t('official_template_not_approved_or_not_found'));
    }

    try {
      const variables =
        this.officialWhatsappTemplateService.validateVariableValues({
          template,
          values: input.officialTemplate.variables,
        });

      return {
        name: template.name,
        language: template.language,
        category: template.category ?? null,
        status: template.status,
        components: template.components,
        preview: template.preview,
        variables,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'official_template_variables_required';
      throw new Error(input.t(message));
    }
  }

  async assertOfficialScheduleChatbotStart(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    chatbotId: string;
  }): Promise<void> {
    const flow = await this.chatbotService.findChatbotFlowByChatbotId(
      input.accountId,
      input.chatbotId
    );

    if (!doesChatbotFlowStartWithOfficialTemplate(flow)) {
      throw new Error(
        input.t('schedule_official_chatbot_start_template_required')
      );
    }
  }
}
