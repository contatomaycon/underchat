import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappings } from '@core/mappings/webhook.mappings';

@injectable()
export class WebhookReceiverUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    tokenKeyData: ITokenKeyData,
    body: ReceiveWebhookRequest
  ): Promise<boolean> {
    console.log('body');
    console.dir(body, { depth: null, colors: true });

    const mappings = webhookMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook,
      mappings
    );

    if (!result) {
      return false;
    }

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.webhook,
      tokenKeyData.account_id,
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
