import { injectable } from 'tsyringe';
import { IntegrationService } from '@core/services/integration.service';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';

@injectable()
export class IntegrationAvailableChannelsListerUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(accountId: string): Promise<ListAvailableChannelsResponse> {
    return this.integrationService.listAvailableChannels(accountId);
  }
}
