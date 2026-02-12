import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListIntegrationSectorsResponse } from '@core/schema/integration/listSectors/response.schema';

@injectable()
export class IntegrationSectorsListerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(accountId: string): Promise<ListIntegrationSectorsResponse> {
    return this.integrationService.listSectorsForWebhook(accountId);
  }
}
