import { injectable } from 'tsyringe';
import { ContactChannelsListerRepository } from '@core/repositories/contact/ContactChannelsLister.repository';
import { ListContactChannelsResponse } from '@core/schema/contact/listContactChannels/response.schema';

@injectable()
export class ContactChannelsListerUseCase {
  constructor(
    private readonly contactChannelsListerRepository: ContactChannelsListerRepository
  ) {}

  async execute(
    accountId: string,
    allowedChannelIds: string[]
  ): Promise<ListContactChannelsResponse> {
    const allChannels =
      await this.contactChannelsListerRepository.listChannelsByAccount(
        accountId
      );

    if (allowedChannelIds.length === 0) {
      return allChannels;
    }

    const allowedSet = new Set(allowedChannelIds);
    return allChannels.filter((ch) => allowedSet.has(ch.channel_id));
  }
}
