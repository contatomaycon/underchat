import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserService } from '@core/services/user.service';
import { CountryService } from '@core/services/country.service';

@injectable()
export class UserCreatorUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly countryService: CountryService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateUserRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const documentTypeExists =
      await this.userService.existsUserDocumentTypeById(
        input.user_document.user_document_type_id
      );

    if (!documentTypeExists) {
      throw new Error(t('document_type_not_found'));
    }

    const countryExists = await this.countryService.existsCountryById(
      input.user_address?.country_id
    );
    if (!countryExists) {
      throw new Error(t('country_not_found'));
    }

    const createUser = await this.userService.createUser(t, accountId, input);

    if (!createUser) {
      throw new Error(t('user_creation_failed'));
    }

    return true;
  }
}
