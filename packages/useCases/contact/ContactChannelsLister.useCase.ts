import { injectable } from 'tsyringe';
import { ContactChannelsListerRepository } from '@core/repositories/contact/ContactChannelsLister.repository';
import { ListContactChannelsResponse } from '@core/schema/contact/listContactChannels/response.schema';

@injectable()
export class ContactChannelsListerUseCase {
  constructor(
    private readonly contactChannelsListerRepository: ContactChannelsListerRepository
  ) {}

  async execute(accountId: string): Promise<ListContactChannelsResponse> {
    return this.contactChannelsListerRepository.listChannelsByAccount(
      accountId
    );
  }
}
