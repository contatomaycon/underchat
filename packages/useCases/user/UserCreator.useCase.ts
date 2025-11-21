import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserService } from '@core/services/user.service';
import { CountryService } from '@core/services/country.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class UserCreatorUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly countryService: CountryService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: CreateUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<void> {
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

    const userEmailExists = await this.userService.existsUserEmailById(
      input.email
    );

    if (userEmailExists) {
      throw new Error(t('user_already_exists_email'));
    }

    if (isAdministrator) {
      return;
    }

    const [viewAccountQuantityProduct, totalUserByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.user
        ),
        this.userService.totalUserByAccount(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('user_not_available'));
    }

    if (totalUserByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('user_not_available_additional'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    await this.validate(t, input, accountId, isAdministrator);

    const createUser = await this.userService.createUser(t, accountId, input);

    if (!createUser) {
      throw new Error(t('user_creation_failed'));
    }

    return true;
  }
}
