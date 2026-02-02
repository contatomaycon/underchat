import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ICreateAiAgentPromptInput } from '@core/common/interfaces/ICreateAiAgentPromptInput';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';

@injectable()
export class AiAgentPromptCreatorUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly openAIAssistantService: OpenAIAssistantService,
    private readonly storageService: StorageService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private getValueFromMultipart<T>(
    value: T | { value: T } | null | undefined
  ): T | null {
    if (!value) {
      return null;
    }

    if (
      typeof value === 'object' &&
      'value' in value &&
      !Array.isArray(value)
    ) {
      return value.value;
    }

    return value as T;
  }

  private validateRequiredFields(
    aiAgentId: string | null,
    t: TFunction<'translation', undefined>
  ): void {
    if (!aiAgentId) {
      throw new Error(t('ai_agent_not_found'));
    }
  }

  private validateFileFormat(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): void {
    const mimetype = file.mimetype?.toLowerCase() ?? '';
    const filename = file.filename.toLowerCase();

    const allowedMimetypes = [
      'text/plain',
      'application/json',
      'text/markdown',
      'text/csv',
      'text/tab-separated-values',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml',
      'application/msword',
    ];

    const allowedExtensions = [
      '.txt',
      '.json',
      '.md',
      '.markdown',
      '.csv',
      '.tsv',
      '.pdf',
      '.docx',
      '.doc',
    ];

    const isAllowedMimetype = allowedMimetypes.some((allowed) =>
      mimetype.includes(allowed)
    );

    const isAllowedExtension = allowedExtensions.some((ext) =>
      filename.endsWith(ext)
    );

    if (!isAllowedMimetype && !isAllowedExtension) {
      throw new Error(t('ai_agent_prompt_file_format_not_supported'));
    }
  }

  private async uploadFileToS3(
    file: UploadFileRequest | null | undefined,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string> {
    if (!file) {
      throw new Error(t('ai_agent_prompt_file_upload_failed'));
    }

    this.validateFileFormat(file, t);

    const uploadResult = await this.storageService.uploadDocument(
      file,
      accountId
    );

    if (!uploadResult) {
      throw new Error(t('ai_agent_prompt_file_upload_failed'));
    }

    return uploadResult.url;
  }

  private processInput(input: CreateAiAgentPromptRequest): {
    aiAgentId: string | null;
    status: EAiAgentStatus | null;
  } {
    return {
      aiAgentId: this.getValueFromMultipart(input.ai_agent_id),
      status: this.getValueFromMultipart(input.status),
    };
  }

  private async createPrompt(
    processedInput: ICreateAiAgentPromptInput,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string> {
    const result = await this.aiAgentService.createAiAgentPrompt(
      processedInput,
      accountId
    );

    if (!result) {
      throw new Error(t('ai_agent_prompt_creation_failed'));
    }

    return result;
  }

  private async ensureOpenAIIfNeeded(
    accountId: string,
    aiAgentId: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;
    if (!isGpt || !agent?.api_key || !agent?.base_url) {
      return;
    }

    const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
      aiAgentId,
      accountId,
      agent.api_key,
      agent.base_url
    );

    if (agent.model) {
      await this.openAIAssistantService.ensureAssistant(
        aiAgentId,
        accountId,
        agent.api_key,
        agent.base_url,
        agent.model,
        this.openAIAssistantService.getDefaultAssistantInstructions(),
        vectorStoreId
      );
    }
  }

  private async sendToEmbeddingQueue(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    value: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      value,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAiAgentPromptRequest,
    accountId: string
  ): Promise<string | null> {
    const { aiAgentId, status } = this.processInput(input);

    this.validateRequiredFields(aiAgentId, t);

    if (!aiAgentId) {
      throw new Error(t('ai_agent_prompt_creation_failed'));
    }

    const finalValue = await this.uploadFileToS3(input.file, accountId, t);

    const processedInput: ICreateAiAgentPromptInput = {
      ai_agent_id: aiAgentId,
      value: finalValue,
      status: status ?? EAiAgentStatus.active,
    };

    const aiAgentPromptId = await this.createPrompt(
      processedInput,
      accountId,
      t
    );

    await this.ensureOpenAIIfNeeded(accountId, aiAgentId);

    await this.sendToEmbeddingQueue(
      accountId,
      aiAgentId,
      aiAgentPromptId,
      finalValue
    );

    return aiAgentPromptId;
  }
}
