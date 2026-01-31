import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
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
    promptType: EAiAgentPromptType | null,
    file: UploadFileRequest | null | undefined,
    currentValue: string,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string | null> {
    if (promptType !== EAiAgentPromptType.file) {
      return null;
    }

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

    const promptType = this.getValueFromMultipart(body.ai_agent_prompt_type);
    const finalPromptType =
      promptType ?? aiAgentPromptExists.ai_agent_prompt_type;

    let finalValue =
      this.getValueFromMultipart(body.value) ?? aiAgentPromptExists.value;

    if (finalPromptType === EAiAgentPromptType.file && body.file) {
      const newFileUrl = await this.processFileUpdate(
        finalPromptType,
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
      ai_agent_prompt_type: promptType ?? undefined,
      name: this.getValueFromMultipart(body.name) ?? undefined,
      value: finalValue,
      status: this.getValueFromMultipart(body.status) ?? undefined,
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

    await this.cleanupOpenAIFileIfNeeded(
      aiAgentPromptExists.ai_agent_id,
      accountId,
      aiAgentPromptExists.openai_file_id
    );

    await this.sendToEmbeddingQueue(
      accountId,
      aiAgentPromptExists.ai_agent_id,
      aiAgentPromptId,
      finalPromptType,
      updateBody.name ?? aiAgentPromptExists.name,
      finalValue
    );

    return aiAgentPromptUpdater;
  }

  private async cleanupOpenAIFileIfNeeded(
    aiAgentId: string,
    accountId: string,
    openaiFileId: string | null | undefined
  ): Promise<void> {
    if (!openaiFileId) {
      return;
    }

    try {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      if (!agent || agent.ai_agent_type_id !== EAiAgentType.gpt || !agent.api_key || !agent.base_url) {
        return;
      }

      await this.openAIAssistantService.cleanupOpenAIFile(
        agent.api_key,
        agent.base_url,
        agent.openai_vector_store_id,
        openaiFileId
      );
    } catch (error) {
      console.error('Erro ao limpar arquivo OpenAI:', error);
    }
  }

  private async sendToEmbeddingQueue(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    promptType: EAiAgentPromptType,
    name: string,
    value: string
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      prompt_type: promptType,
      name,
      value,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }
}
