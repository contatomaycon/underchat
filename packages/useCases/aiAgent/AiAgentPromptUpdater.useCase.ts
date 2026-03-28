import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { StorageService } from '@core/services/storage.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EmbeddingService } from '@core/services/embedding.service';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';

@injectable()
export class AiAgentPromptUpdaterUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService
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
    ];

    const allowedExtensions = [
      '.txt',
      '.json',
      '.md',
      '.markdown',
      '.csv',
      '.tsv',
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

  private async removePromptSearchArtifacts(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    openaiFileId: string | null | undefined
  ): Promise<void> {
    await this.embeddingService.deletePromptEmbeddings(aiAgentPromptId);

    if (!openaiFileId) {
      return;
    }

    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;
    if (isGpt && agent?.api_key && agent?.base_url) {
      try {
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

    await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
      aiAgentPromptId,
      accountId,
      null
    );
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
    const finalStatus = updateBody.status ?? aiAgentPromptExists.status;

    const aiAgentPromptUpdater =
      await this.aiAgentService.updateAiAgentPromptById(
        updateBody,
        aiAgentPromptId,
        accountId
      );

    if (!aiAgentPromptUpdater) {
      throw new Error(t('ai_agent_prompt_update_error'));
    }

    if (finalStatus !== EAiAgentStatus.active) {
      await this.removePromptSearchArtifacts(
        accountId,
        aiAgentPromptExists.ai_agent_id,
        aiAgentPromptId,
        aiAgentPromptExists.openai_file_id
      );
      return true;
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
      finalValue,
      'update'
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
      const instructions =
        this.openAIAssistantService.getAssistantInstructionsFromSystemPrompt(
          agent.system_prompt
        );
      await this.openAIAssistantService.ensureAssistant(
        aiAgentId,
        accountId,
        agent.api_key,
        agent.base_url,
        agent.model,
        instructions,
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
    value: string,
    source: IAiAgentPromptEmbeddingRequest['source']
  ): Promise<void> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);

    const payload: IAiAgentPromptEmbeddingRequest = {
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      ai_agent_type_id: agent?.ai_agent_type_id,
      value,
      source,
      retry_count: 0,
    };

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await this.streamProducerService.send(topic, payload, aiAgentPromptId);
  }
}
