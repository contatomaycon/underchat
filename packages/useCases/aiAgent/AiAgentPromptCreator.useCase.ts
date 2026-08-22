import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { StorageService } from '@core/services/storage.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ICreateAiAgentPromptInput } from '@core/common/interfaces/ICreateAiAgentPromptInput';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';

@injectable()
export class AiAgentPromptCreatorUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
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

  private async cleanupUploadedSourceBestEffort(
    fileUrl: string,
    accountId: string
  ): Promise<void> {
    try {
      const deleted = await this.storageService.deleteImage(fileUrl);
      if (!deleted) {
        throw new Error('Storage source cleanup returned false.');
      }
    } catch (error) {
      console.error('[AiAgentPromptCreator] source rollback failed', {
        error,
        account_id: accountId,
      });
    }
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
    const finalStatus = processedInput.status;

    let aiAgentPromptId: string | null = null;
    try {
      aiAgentPromptId = await this.createPrompt(processedInput, accountId, t);

      if (finalStatus === EAiAgentStatus.active) {
        await this.sendToEmbeddingQueue(
          accountId,
          aiAgentId,
          aiAgentPromptId,
          finalValue,
          'create'
        );
      }

      return aiAgentPromptId;
    } catch (error) {
      let safeToRemoveSource = aiAgentPromptId === null;
      if (aiAgentPromptId) {
        try {
          safeToRemoveSource =
            await this.aiAgentService.deleteAiAgentPromptById(
              aiAgentPromptId,
              accountId
            );
        } catch (rollbackError) {
          console.error('[AiAgentPromptCreator] prompt rollback failed', {
            rollback_error: rollbackError,
            account_id: accountId,
            ai_agent_prompt_id: aiAgentPromptId,
          });
        }
      }

      if (safeToRemoveSource) {
        await this.cleanupUploadedSourceBestEffort(finalValue, accountId);
      }
      throw error;
    }
  }
}
