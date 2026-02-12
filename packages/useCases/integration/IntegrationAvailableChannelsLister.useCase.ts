import { injectable, inject } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';

@injectable()
export class IntegrationAvailableChannelsListerUseCase {
  constructor(
    @inject(IntegrationService)
    private readonly integrationService: IntegrationService
  ) {}

  async execute(accountId: string): Promise<ListAvailableChannelsResponse> {
    return this.integrationService.listAvailableChannels(accountId);
  }
}
