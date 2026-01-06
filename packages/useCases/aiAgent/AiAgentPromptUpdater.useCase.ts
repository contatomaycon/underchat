import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentService } from '@core/services/aiAgent.service';
import { StorageService } from '@core/services/storage.service';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

@injectable()
export class AiAgentPromptUpdaterUseCase {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly storageService: StorageService
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

    return aiAgentPromptUpdater;
  }
}
