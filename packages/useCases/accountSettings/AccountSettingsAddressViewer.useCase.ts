import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountSettingsAddressViewerRepository } from '@core/repositories/accountSettings/AccountSettingsAddressViewer.repository';
import { ViewAddressResponse } from '@core/schema/accountSettings/viewAddress/response.schema';

@injectable()
export class AccountSettingsAddressViewerUseCase {
  constructor(
    private readonly accountSettingsAddressViewerRepository: AccountSettingsAddressViewerRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewAddressResponse | null> {
    const address =
      await this.accountSettingsAddressViewerRepository.viewAddressByUserId(
        userId
      );

    if (!address) {
      throw new Error(t('user_not_found'));
    }

    return address;
  }
}
