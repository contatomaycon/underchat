import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappingMappings } from '@core/mappings/webhookMapping.mappings';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WebhookMappingSaverRepository {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  saveWebhookMapping = async (
    accountId: string,
    mapping: Record<string, string>
  ): Promise<boolean> => {
    const indexCreated = await this.ensureIndexExists();

    if (!indexCreated) {
      return false;
    }

    const document = await this.prepareDocument(accountId, mapping);

    const updateResult = await this.saveDocument(accountId, document);

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };

  private readonly ensureIndexExists = async (): Promise<boolean> => {
    const mappings = webhookMappingMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook_mapping,
      mappings
    );

    return result !== null && result !== undefined;
  };

  private readonly prepareDocument = async (
    accountId: string,
    mapping: Record<string, string>
  ): Promise<{
    account_id: string;
    mapping: Record<string, string>;
    created_at?: string;
    updated_at: string;
  }> => {
    const existing = await this.elasticDatabaseService.view(
      EElasticIndex.webhook_mapping,
      accountId
    );

    const now = currentTime();
    const document: {
      account_id: string;
      mapping: Record<string, string>;
      created_at?: string;
      updated_at: string;
    } = {
      account_id: accountId,
      mapping,
      updated_at: now,
    };

    if (!existing) {
      document.created_at = now;
    }

    return document;
  };

  private readonly saveDocument = async (
    accountId: string,
    document: {
      account_id: string;
      mapping: Record<string, string>;
      created_at?: string;
      updated_at: string;
    }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.webhook_mapping,
      accountId,
      document,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return updateResult;
  };
}
