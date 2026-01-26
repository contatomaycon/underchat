import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

@injectable()
export class WebhookDataViewerRepository {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  viewWebhookData = async (accountId: string): Promise<unknown | null> => {
    const document = await this.elasticDatabaseService.view(
      EElasticIndex.webhook,
      accountId
    );

    return document;
  };
}
