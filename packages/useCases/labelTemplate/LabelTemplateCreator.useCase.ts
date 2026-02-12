import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateLabelTemplateRequest } from '@core/schema/labelTemplate/createLabelTemplate/request.schema';
import { LabelTemplateService } from '@core/services/labelTemplate.service';

@injectable()
export class LabelTemplateCreatorUseCase {
  constructor(
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateLabelTemplateRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const labelStatusExists =
      await this.labelTemplateService.existsLabelStatusById(
        input.label_status.label_status_id
      );

    if (!labelStatusExists) {
      throw new Error(t('label_status_not_found'));
    }

    const createLabelTemplate =
      await this.labelTemplateService.createLabelTemplate(input, accountId);

    if (!createLabelTemplate) {
      throw new Error(t('label_template_creation_failed'));
    }

    return true;
  }
}
