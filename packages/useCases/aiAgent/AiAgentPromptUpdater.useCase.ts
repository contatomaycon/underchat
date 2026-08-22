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

    return this.uploadFileToS3(file, accountId, t);
  }

  private async deleteFileFromS3BestEffort(
    fileUrl: string,
    context: {
      accountId: string;
      aiAgentPromptId: string;
      reason: string;
    }
  ): Promise<void> {
    try {
      const deleted = await this.storageService.deleteImage(fileUrl);
      if (!deleted) {
        throw new Error('Storage source cleanup returned false.');
      }
    } catch (error) {
      console.error('[AiAgentPromptUpdater] source cleanup failed', {
        error,
        account_id: context.accountId,
        ai_agent_prompt_id: context.aiAgentPromptId,
        reason: context.reason,
      });
    }
  }

  private async removePromptSearchArtifacts(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    openaiFileId: string | null | undefined
  ): Promise<void> {
    let gptProvider:
      | {
          apiKey: string;
          baseUrl: string;
        }
      | undefined;
    if (openaiFileId) {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      const isGpt = agent?.ai_agent_type_id === EAiAgentType.gpt;
      if (isGpt) {
        await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
          accountId,
          aiAgentId,
          aiAgentPromptId,
          agent.openai_vector_store_id,
          openaiFileId
        );
        if (agent.api_key && agent.base_url) {
          gptProvider = {
            apiKey: agent.api_key,
            baseUrl: agent.base_url,
          };
        }
      }
    }

    const embeddingsDeleted =
      await this.embeddingService.deletePromptEmbeddings(aiAgentPromptId);
    if (!embeddingsDeleted) {
      throw new Error('Failed to remove inactive prompt embeddings.');
    }

    if (!openaiFileId) {
      return;
    }

    const cleared = await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
      aiAgentPromptId,
      accountId,
      null
    );
    if (!cleared) {
      throw new Error('Failed to clear inactive OpenAI prompt file.');
    }

    if (gptProvider) {
      await this.openAIAssistantService.cleanupPendingOpenAIFiles(
        gptProvider.apiKey,
        gptProvider.baseUrl,
        accountId,
        aiAgentId
      );
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    aiAgentPromptId: string,
    body: UpdateAiAgentPromptRequest,
    accountId: string
  ): Promise<boolean> {
    const prompt = await this.aiAgentService.viewAiAgentPrompt(
      aiAgentPromptId,
      accountId
    );

    if (!prompt) {
      throw new Error(t('ai_agent_prompt_not_found'));
    }

    return this.embeddingService.withEmbeddingGenerationLock(
      accountId,
      prompt.ai_agent_id,
      () =>
        this.executeWithEmbeddingGenerationLock(
          t,
          aiAgentPromptId,
          body,
          accountId
        )
    );
  }

  private async executeWithEmbeddingGenerationLock(
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
    let uploadedFileUrl: string | null = null;

    if (body.file) {
      const newFileUrl = await this.processFileUpdate(
        body.file,
        aiAgentPromptExists.value,
        accountId,
        t
      );

      if (newFileUrl) {
        finalValue = newFileUrl;
        uploadedFileUrl = newFileUrl;
      }
    }

    const updateBody = {
      value: finalValue,
      status:
        this.getFieldFromMultipartBody<EAiAgentStatus>(bodyRecord, 'status') ??
        undefined,
    };
    const finalStatus = updateBody.status ?? aiAgentPromptExists.status;

    let databaseUpdated = false;
    try {
      const aiAgentPromptUpdater =
        await this.aiAgentService.updateAiAgentPromptById(
          updateBody,
          aiAgentPromptId,
          accountId
        );

      if (!aiAgentPromptUpdater) {
        throw new Error(t('ai_agent_prompt_update_error'));
      }
      databaseUpdated = true;

      if (finalStatus !== EAiAgentStatus.active) {
        await this.removePromptSearchArtifacts(
          accountId,
          aiAgentPromptExists.ai_agent_id,
          aiAgentPromptId,
          aiAgentPromptExists.openai_file_id
        );
      } else {
        await this.sendToEmbeddingQueue(
          accountId,
          aiAgentPromptExists.ai_agent_id,
          aiAgentPromptId,
          finalValue,
          'update'
        );
      }

      if (uploadedFileUrl && uploadedFileUrl !== aiAgentPromptExists.value) {
        await this.deleteFileFromS3BestEffort(aiAgentPromptExists.value, {
          accountId,
          aiAgentPromptId,
          reason: 'replaced source',
        });
      }

      return aiAgentPromptUpdater;
    } catch (error) {
      let safeToRemoveUploadedFile = !databaseUpdated;
      if (databaseUpdated && finalStatus !== EAiAgentStatus.active) {
        safeToRemoveUploadedFile = false;
        console.error(
          '[AiAgentPromptUpdater] inactive prompt cleanup will retry without reactivation',
          {
            account_id: accountId,
            ai_agent_prompt_id: aiAgentPromptId,
          }
        );
      } else if (databaseUpdated) {
        const rolledBack = await this.aiAgentService.updateAiAgentPromptById(
          {
            value: aiAgentPromptExists.value,
            status: aiAgentPromptExists.status,
          },
          aiAgentPromptId,
          accountId
        );
        safeToRemoveUploadedFile = rolledBack;
        if (!rolledBack) {
          console.error('[AiAgentPromptUpdater] rollback failed', {
            account_id: accountId,
            ai_agent_prompt_id: aiAgentPromptId,
          });
        }
      }

      if (uploadedFileUrl && safeToRemoveUploadedFile) {
        await this.deleteFileFromS3BestEffort(uploadedFileUrl, {
          accountId,
          aiAgentPromptId,
          reason: 'failed update rollback',
        });
      }
      throw error;
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
