import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AiAgentService } from '@core/services/aiAgent.service';
import { StorageService } from '@core/services/storage.service';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ICreateAiAgentPromptInput } from '@core/common/interfaces/ICreateAiAgentPromptInput';

@injectable()
export class AiAgentPromptCreatorUseCase {
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

  private validateRequiredFields(
    aiAgentId: string | null,
    aiAgentPromptType: EAiAgentPromptType | null,
    name: string | null,
    t: TFunction<'translation', undefined>
  ): void {
    if (!aiAgentId) {
      throw new Error(t('ai_agent_not_found'));
    }

    if (!aiAgentPromptType) {
      throw new Error(t('ai_agent_prompt_type_required'));
    }

    if (!name) {
      throw new Error(t('name_required'));
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

  private async processPromptValue(
    promptType: EAiAgentPromptType,
    value: string | { value: string } | null | undefined,
    file: UploadFileRequest | null | undefined,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string> {
    if (promptType === EAiAgentPromptType.file) {
      return this.uploadFileToS3(file, accountId, t);
    }

    const textValue = this.getValueFromMultipart(value);

    if (!textValue) {
      throw new Error(t('ai_agent_prompt_value_required'));
    }

    return textValue;
  }

  private processInput(input: CreateAiAgentPromptRequest): {
    aiAgentId: string | null;
    aiAgentPromptType: EAiAgentPromptType | null;
    name: string | null;
    status: EAiAgentStatus | null;
  } {
    return {
      aiAgentId: this.getValueFromMultipart(input.ai_agent_id),
      aiAgentPromptType: this.getValueFromMultipart(input.ai_agent_prompt_type),
      name: this.getValueFromMultipart(input.name),
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

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAiAgentPromptRequest,
    accountId: string
  ): Promise<string | null> {
    const { aiAgentId, aiAgentPromptType, name, status } =
      this.processInput(input);

    this.validateRequiredFields(aiAgentId, aiAgentPromptType, name, t);

    if (!aiAgentId || !aiAgentPromptType || !name) {
      throw new Error(t('ai_agent_prompt_creation_failed'));
    }

    const finalValue = await this.processPromptValue(
      aiAgentPromptType,
      input.value,
      input.file,
      accountId,
      t
    );

    const processedInput: ICreateAiAgentPromptInput = {
      ai_agent_id: aiAgentId,
      ai_agent_prompt_type: aiAgentPromptType,
      name,
      value: finalValue,
      status: status ?? EAiAgentStatus.active,
    };

    return this.createPrompt(processedInput, accountId, t);
  }
}
