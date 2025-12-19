import { injectable } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';
import { EditAccountInfoRequest } from '@core/schema/account/editAccountInfo/request.schema';
import { UpsertAccountCustomizationRequest } from '@core/schema/accountSettings/upsertAccountCustomization/request.schema';
import { AccountInfoUpserterTransactionRepository } from '@core/repositories/account/AccountInfoUpserterTransaction.repository';
import { PlanAccountService } from '@core/services/planAccount.service';
import { TFunction } from 'i18next';

@injectable()
export class AccountCustomizationUpserterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly storageService: StorageService,
    private readonly accountInfoUpserterTransactionRepository: AccountInfoUpserterTransactionRepository,
    private readonly planAccountService: PlanAccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: UpsertAccountCustomizationRequest
  ): Promise<{ created: boolean }> {
    const canEdit =
      await this.planAccountService.validateCanCreatePersonalization(accountId);

    if (!canEdit) {
      throw new Error(t('personalization_not_available'));
    }
    const payload: EditAccountInfoRequest = {
      ...body,
      account_id: { value: accountId },
    };

    const currentAccountInfo =
      await this.accountService.viewAccountInfoByAccountId(accountId);

    let urlLogo: string | null | undefined = undefined;

    if (payload.delete_logo?.value) {
      const currentLogoUrl = currentAccountInfo?.account_info_id
        ? await this.accountService.viewLogoByAccountInfoId(
            currentAccountInfo.account_info_id
          )
        : null;

      if (currentLogoUrl) {
        await this.storageService.deleteImage(currentLogoUrl);
      }

      urlLogo = null;
    }

    const logoFile = payload.logo;

    if (!payload.delete_logo?.value && logoFile) {
      const uploadResult = await this.storageService.uploadImage(
        logoFile,
        accountId
      );

      urlLogo = uploadResult?.url ?? null;
    }

    const { created } =
      await this.accountInfoUpserterTransactionRepository.upsertAccountInfo(
        accountId,
        payload,
        urlLogo
      );

    if (body.name?.value && body.name.value.trim().length > 0) {
      await this.accountService.updateAccountById(
        { name: body.name.value.trim() },
        accountId
      );
    }

    return { created };
  }
}
