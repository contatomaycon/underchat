import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { LabelTemplateService } from '@core/services/labelTemplate.service';

@injectable()
export class LabelTemplateDeleterUseCase {
  constructor(
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    labelTemplateId: string,
    accountId: string
  ): Promise<boolean> {
    const labelTemplateExists =
      await this.labelTemplateService.viewLabelTemplateById(
        labelTemplateId,
        accountId
      );

    if (!labelTemplateExists) {
      throw new Error(t('label_template_not_found'));
    }

    return this.labelTemplateService.deleteLabelTemplateById(
      labelTemplateId,
      accountId
    );
  }
}
