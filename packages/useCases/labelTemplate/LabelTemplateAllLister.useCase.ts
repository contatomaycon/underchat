import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { AccountService } from '@core/services/account.service';
import { ListLabelTemplateAllResponse } from '@core/schema/labelTemplate/listLabelTemplateAll/response.schema';

@injectable()
export class LabelTemplateAllListerUseCase {
  constructor(
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListLabelTemplateAllResponse[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    return this.labelTemplateService.listLabelTemplateAll(accountId);
  }
}
