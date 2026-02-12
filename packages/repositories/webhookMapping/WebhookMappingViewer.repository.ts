import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappingMappings } from '@core/mappings/webhookMapping.mappings';

@injectable()
export class WebhookMappingViewerRepository {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  viewWebhookMapping = async (
    accountId: string,
    workerId: string
  ): Promise<{
    account_id: string;
    worker_id: string;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at?: string;
  } | null> => {
    const mappings = webhookMappingMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook_mapping,
      mappings
    );

    if (!result) {
      return null;
    }

    const documentId = `${accountId}_${workerId}`;
    const document = await this.elasticDatabaseService.view(
      EElasticIndex.webhook_mapping,
      documentId
    );

    if (!document) {
      return null;
    }

    return document as {
      account_id: string;
      worker_id: string;
      mapping: Record<string, string | string[]>;
      created_at?: string;
      updated_at?: string;
    };
  };
}
