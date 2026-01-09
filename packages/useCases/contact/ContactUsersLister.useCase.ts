import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ContactService } from '@core/services/contact.service';
import { ListContactUsersResponse } from '@core/schema/contact/listUsers/response.schema';

@injectable()
export class ContactUsersListerUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListContactUsersResponse[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const results = await this.contactService.listContactUsers(accountId);

    return results;
  }
}
