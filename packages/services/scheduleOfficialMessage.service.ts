import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  isMetaObjectAccessError,
  MetaWhatsappEmbeddedService,
  type MetaWhatsappApprovedTemplate,
} from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  IOfficialTemplateComponent,
  IOfficialWhatsappTemplate,
  IOfficialWhatsappTemplateMessage,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { getFirstNodeAfterStart } from '@core/common/functions/chatbotOfficialNodes';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';

type ChatbotFlowNode = ListChatbotFlowResponse['nodes'][number];

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
    let approvedTemplates: MetaWhatsappApprovedTemplate[];
    try {
      approvedTemplates =
        await this.metaWhatsappEmbeddedService.listApprovedMessageTemplates({
          apiVersion: connection.api_version,
          accessToken,
          wabaId: connection.waba_id,
        });
    } catch (error) {
      if (isMetaObjectAccessError(error)) {
        throw new Error(input.t('whatsapp_official_connection_access_lost'));
      }

      throw error;
    }

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
        parameter_format: template.parameter_format,
        components: template.components,
        preview: template.preview,
        variables,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'official_template_variables_required';
      const translationKey =
        message === 'official_template_variable_value_invalid' ||
        message === 'official_template_variables_invalid'
          ? 'official_template_variables_required'
          : message;
      throw new Error(input.t(translationKey));
    }
  }

  async assertOfficialScheduleChatbotStart(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    workerId: string;
    chatbotId: string;
  }): Promise<void> {
    const flow = await this.chatbotService.findChatbotFlowByChatbotId(
      input.accountId,
      input.chatbotId
    );
    const firstNode = getFirstNodeAfterStart<ChatbotFlowNode>(flow);

    if (firstNode?.type !== 'officialTemplate') {
      throw new Error(
        input.t('schedule_official_chatbot_start_template_required')
      );
    }

    const officialTemplate = this.buildOfficialTemplateMessage(firstNode);
    const validatedTemplate = await this.validateTemplateForSchedule({
      t: input.t,
      accountId: input.accountId,
      workerId: input.workerId,
      officialTemplate,
    });

    this.assertStoredTemplateSnapshotSyntax(
      input.t,
      firstNode,
      validatedTemplate
    );
  }

  private buildOfficialTemplateMessage(
    node: ChatbotFlowNode
  ): IOfficialWhatsappTemplateMessage | null {
    const templateName = this.getNodeString(node, 'templateName');
    const templateLanguage = this.getNodeString(node, 'templateLanguage');

    if (!templateName || !templateLanguage) {
      return null;
    }

    return {
      name: templateName,
      language: templateLanguage,
      variables: this.getNodeArray<
        NonNullable<IOfficialWhatsappTemplateMessage['variables']>[number]
      >(node, 'templateVariables'),
    };
  }

  private assertStoredTemplateSnapshotSyntax(
    t: TFunction<'translation', undefined>,
    node: ChatbotFlowNode,
    validatedTemplate: IOfficialWhatsappTemplateMessage
  ): void {
    const components = this.getNodeArray<IOfficialTemplateComponent>(
      node,
      'templateComponents'
    );
    const preview = this.getNodeRecord(node, 'templatePreview');

    if (components.length === 0 && !preview) {
      return;
    }

    const parameterFormat = this.getNodeString(
      node,
      'templateParameterFormat'
    )?.toUpperCase();
    const template: IOfficialWhatsappTemplate = {
      id: null,
      name: validatedTemplate.name,
      language: validatedTemplate.language,
      status: 'APPROVED',
      ...(parameterFormat === 'POSITIONAL' || parameterFormat === 'NAMED'
        ? { parameter_format: parameterFormat }
        : {}),
      category: validatedTemplate.category ?? null,
      components,
      variables: components.flatMap((component) => [
        ...(component.variables ?? []),
        ...(component.buttons?.flatMap((button) => button.variables ?? []) ??
          []),
      ]),
      preview: (preview as IOfficialWhatsappTemplate['preview'] | null) ?? {},
    };

    try {
      this.officialWhatsappTemplateService.buildPreviewText(
        template,
        validatedTemplate.variables
      );
    } catch {
      throw new Error(t('official_template_variables_required'));
    }
  }

  private getNodeString(node: ChatbotFlowNode, key: string): string | null {
    const value = this.getNodeValue(node, key);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private getNodeArray<T>(node: ChatbotFlowNode, key: string): T[] {
    const value = this.getNodeValue(node, key);
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private getNodeRecord(
    node: ChatbotFlowNode,
    key: string
  ): Record<string, unknown> | null {
    const value = this.getNodeValue(node, key);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private getNodeValue(node: ChatbotFlowNode, key: string): unknown {
    const data =
      node.data && typeof node.data === 'object'
        ? (node.data as Record<string, unknown>)
        : {};
    const directValue = data[key];
    if (
      directValue !== null &&
      directValue !== undefined &&
      !(typeof directValue === 'string' && directValue.trim().length === 0)
    ) {
      return directValue;
    }

    const official =
      data.official &&
      typeof data.official === 'object' &&
      !Array.isArray(data.official)
        ? (data.official as Record<string, unknown>)
        : {};
    const officialValue = official[key];
    if (
      officialValue !== null &&
      officialValue !== undefined &&
      !(typeof officialValue === 'string' && officialValue.trim().length === 0)
    ) {
      return officialValue;
    }

    return null;
  }
}
