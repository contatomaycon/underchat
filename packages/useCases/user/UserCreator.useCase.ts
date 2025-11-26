import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserService } from '@core/services/user.service';
import { CountryService } from '@core/services/country.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class UserCreatorUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly countryService: CountryService,
    private readonly storageService: StorageService
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

    if (!input.document_type_id?.value) {
      throw new Error(t('document_type_not_found'));
    }

    const documentTypeExists =
      await this.userService.existsUserDocumentTypeById(
        input.document_type_id.value
      );

    if (!documentTypeExists) {
      throw new Error(t('document_type_not_found'));
    }

    if (!input.country_id?.value) {
      throw new Error(t('country_not_found'));
    }

    const countryExists = await this.countryService.existsCountryById(
      input.country_id.value
    );
    if (!countryExists) {
      throw new Error(t('country_not_found'));
    }

    if (!input.email?.value) {
      throw new Error(t('email_required'));
    }

    const userEmailExists = await this.userService.existsUserEmailById(
      input.email.value
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

    let photoUrl: string | null = null;

    if (input?.photo) {
      const uploadResult = await this.storageService.uploadImage(
        input.photo,
        accountId
      );

      if (!uploadResult) {
        throw new Error(t('profile_info_photo_upload_error'));
      }

      photoUrl = uploadResult.url;
    }

    const createUser = await this.userService.createUser(
      t,
      accountId,
      input,
      photoUrl
    );

    if (!createUser) {
      throw new Error(t('user_creation_failed'));
    }

    return true;
  }
}
