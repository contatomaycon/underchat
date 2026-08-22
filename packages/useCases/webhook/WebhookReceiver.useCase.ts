import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { IntegrationService } from '@core/services/integration.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';

@injectable()
export class WebhookReceiverUseCase {
  constructor(
    @inject(ApiKeyViewerRepository)
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository,
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    tokenKeyData: ITokenKeyData,
    body: ReceiveWebhookRequest,
    integrationEntitlementRevision: string,
    operationId?: string
  ): Promise<boolean> {
    await this.planEntitlementService.assertEntitled(
      tokenKeyData.account_id,
      EPlanProduct.integration,
      { expectedRevision: integrationEntitlementRevision }
    );

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
      body as unknown as Record<string, unknown>,
      integrationEntitlementRevision,
      operationId
    );
  }
}
