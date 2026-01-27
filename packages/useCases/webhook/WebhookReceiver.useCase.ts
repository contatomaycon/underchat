import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { IntegrationService } from '@core/services/integration.service';

@injectable()
export class WebhookReceiverUseCase {
  constructor(
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    private readonly integrationService: IntegrationService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    tokenKeyData: ITokenKeyData,
    body: ReceiveWebhookRequest
  ): Promise<boolean> {
    const apiKeyData = await this.apiKeyViewerRepository.viewApiKeyById(
      tokenKeyData.api_key_id
    );

    if (!apiKeyData || !apiKeyData.worker_id) {
      return false;
    }

    return this.integrationService.processWebhook(
      t,
      tokenKeyData.account_id,
      apiKeyData.worker_id,
      body as unknown as Record<string, unknown>
    );
  }
}
