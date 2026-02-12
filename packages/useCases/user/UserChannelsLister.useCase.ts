import { injectable, inject } from 'tsyringe';
import { UserChannelsListerRepository } from '@core/repositories/user/UserChannelsLister.repository';
import { ListUserChannelsResponse } from '@core/schema/user/listUserChannels/response.schema';

@injectable()
export class UserChannelsListerUseCase {
  constructor(
    @inject(UserChannelsListerRepository)
    private readonly userChannelsListerRepository: UserChannelsListerRepository
  ) {}

  async execute(accountId: string): Promise<ListUserChannelsResponse> {
    return this.userChannelsListerRepository.listChannelsByAccount(accountId);
  }
}
