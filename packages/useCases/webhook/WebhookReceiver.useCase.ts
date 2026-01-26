import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappings } from '@core/mappings/webhook.mappings';
import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';

@injectable()
export class WebhookReceiverUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly apiKeyViewerRepository: ApiKeyViewerRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    tokenKeyData: ITokenKeyData,
    body: ReceiveWebhookRequest
  ): Promise<boolean> {
    console.log('body');
    console.dir(body, { depth: null, colors: true });

    const apiKeyData = await this.apiKeyViewerRepository.viewApiKeyById(
      tokenKeyData.api_key_id
    );

    if (!apiKeyData || !apiKeyData.worker_id) {
      return false;
    }

    const mappings = webhookMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook,
      mappings
    );

    if (!result) {
      return false;
    }

    const documentId = `${tokenKeyData.account_id}_${apiKeyData.worker_id}`;
    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.webhook,
      documentId,
      body as unknown as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  }
}
