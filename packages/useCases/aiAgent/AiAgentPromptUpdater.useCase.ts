import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';

@injectable()
export class AiAgentPromptUpdaterUseCase {
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

  private getFieldFromMultipartBody<T>(
    body: Record<string, unknown>,
    fieldKey: string
  ): T | null {
    const direct = body[fieldKey];
    const fromDirect = this.getValueFromMultipart(
      direct as T | { value: T } | null | undefined
    );
    if (fromDirect !== null) {
      return fromDirect;
    }

    const bracketKey = `${fieldKey}[value]`;
    const bracketField = body[bracketKey];
    if (
      bracketField &&
      typeof bracketField === 'object' &&
      'value' in bracketField &&
      !Array.isArray(bracketField)
    ) {
      return (bracketField as { value: T }).value;
    }

    return null;
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

  private async deleteFileFromS3(
    fileUrl: string | null | undefined,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    if (!fileUrl) {
      return;
    }

    const deleted = await this.storageService.deleteImage(fileUrl);
    if (!deleted) {
      throw new Error(t('ai_agent_prompt_file_delete_failed'));
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

  private async processFileUpdate(
    file: UploadFileRequest | null | undefined,
    currentValue: string,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string | null> {
    if (!file) {
      return currentValue;
    }

    await this.deleteFileFromS3(currentValue, t);

    return this.uploadFileToS3(file, accountId, t);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    body: UpdateAiAgentPromptRequest,
    accountId: string
  ): Promise<boolean> {
    const aiAgentPromptExists = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!aiAgentPromptExists) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    const bodyRecord = body as unknown as Record<string, unknown>;
    let finalValue =
      this.getFieldFromMultipartBody<string>(bodyRecord, 'value') ??
      aiAgentPromptExists.value;

    if (body.file) {
      const newFileUrl = await this.processFileUpdate(
        body.file,
        aiAgentPromptExists.value,
        accountId,
        t
      );

      if (newFileUrl) {
        finalValue = newFileUrl;
      }
    }

    const updateBody = {
      value: finalValue,
      status:
        this.getFieldFromMultipartBody<EAiAgentStatus>(bodyRecord, 'status') ??
        undefined,
    };

    const aiAgentPromptUpdater =
      await this.aiAgentService.updateAiAgentPromptById(
        updateBody,
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptUpdater) {
      throw new Error(t('ai_agent_prompt_update_error'));
    }

    await this.ensureOpenAIAndCleanupIfNeeded(
      accountId,
      aiAgentPromptExists.ai_agent_id,
      aiAgentPromptExists.openai_file_id
    );

    await this.sendToEmbeddingQueue(
      accountId,
      aiAgentPromptExists.ai_agent_id,
      aiAgentPromptId,
      finalValue
    );

    return aiAgentPromptUpdater;
  }

  private async ensureOpenAIAndCleanupIfNeeded(
    accountId: string,
    aiAgentId: string,
    openaiFileId: string | null | undefined
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

    if (openaiFileId) {
      try {
        await this.openAIAssistantService.cleanupOpenAIFile(
          agent.api_key,
          agent.base_url,
          vectorStoreId,
          openaiFileId
        );
      } catch (error) {
        console.error('Erro ao limpar arquivo OpenAI:', error);
      }
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
}
