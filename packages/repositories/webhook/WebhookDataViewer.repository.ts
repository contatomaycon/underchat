import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

@injectable()
export class WebhookDataViewerRepository {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  viewWebhookData = async (
    accountId: string,
    workerId: string
  ): Promise<unknown | null> => {
    const documentId = `${accountId}_${workerId}`;
    const document = await this.elasticDatabaseService.view(
      EElasticIndex.webhook,
      documentId
    );

    return document;
  };
}
