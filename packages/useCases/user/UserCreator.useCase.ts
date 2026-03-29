import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserService } from '@core/services/user.service';
import { CountryService } from '@core/services/country.service';
import { StorageService } from '@core/services/storage.service';
import { validatePassword } from '@core/common/utils/passwordValidator';
import { PlanAccountService } from '@core/services/planAccount.service';

@injectable()
export class UserCreatorUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(CountryService)
    private readonly countryService: CountryService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService
  ) {}

  private readonly normalizeEmail = (email: string): string =>
    email.trim().toLowerCase();

  async validate(
    t: TFunction<'translation', undefined>,
    input: CreateUserRequest,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    if (input.document_type_id?.value) {
      const documentTypeExists =
        await this.userService.existsUserDocumentTypeById(
          input.document_type_id.value
        );

      if (!documentTypeExists) {
        throw new Error(t('document_type_not_found'));
      }
    }

    if (input.country_id?.value) {
      const countryExists = await this.countryService.existsCountryById(
        input.country_id.value
      );
      if (!countryExists) {
        throw new Error(t('country_not_found'));
      }
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

    if (!input.password?.value) {
      throw new Error(t('password_required'));
    }

    const passwordValidation = validatePassword(input.password.value);
    if (!passwordValidation.isValid) {
      const errorMessages = passwordValidation.errors.map((err) => t(err));
      throw new Error(errorMessages.join(', '));
    }

    if (!input.name?.value) {
      throw new Error(t('name_required'));
    }

    if (!input.last_name?.value) {
      throw new Error(t('last_name_required'));
    }

    await this.planAccountService.validateCanCreateUser(t, accountId);
  }

  private processSectorIdsFromMultipartFormData(input: any): void {
    const sectorIdsArray: string[] = [];

    Object.keys(input).forEach((key) => {
      const match = key.match(/^sector_ids\[(\d+)\]$/);
      if (!match) {
        return;
      }

      const index = parseInt(match[1], 10);
      const field = input[key];
      const value =
        typeof field === 'object' && field.value ? field.value : field;
      sectorIdsArray[index] = value;
    });

    if (sectorIdsArray.length > 0) {
      input.sector_ids = sectorIdsArray.filter(Boolean);
    }
  }

  private processChannelIdsFromMultipartFormData(input: any): void {
    const channelIdsArray: string[] = [];

    Object.keys(input).forEach((key) => {
      const match = key.match(/^channel_ids\[(\d+)\]$/);
      if (!match) {
        return;
      }

      const index = parseInt(match[1], 10);
      const field = input[key];
      const value =
        typeof field === 'object' && field.value ? field.value : field;
      channelIdsArray[index] = value;
    });

    if (channelIdsArray.length > 0) {
      input.channel_ids = channelIdsArray.filter(Boolean);
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateUserRequest,
    accountId: string
  ): Promise<boolean> {
    if (input.email?.value) {
      input.email.value = this.normalizeEmail(input.email.value);
    }

    this.processSectorIdsFromMultipartFormData(input);
    this.processChannelIdsFromMultipartFormData(input);

    await this.validate(t, input, accountId);

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
