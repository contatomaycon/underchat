import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListContactGroupAllResponse } from '@core/schema/contactGroup/listContactGroupAll/response.schema';
import { ContactGroupService } from '@core/services/contactGroup.service';
import { AccountService } from '@core/services/account.service';

@injectable()
export class ContactGroupAllListerUseCase {
  constructor(
    private readonly contactGroupService: ContactGroupService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListContactGroupAllResponse[] | null> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    return this.contactGroupService.listContactGroupAll(accountId);
  }
}
