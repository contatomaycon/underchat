import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewLabelTemplateResponse } from '@core/schema/labelTemplate/viewLabelTemplate/response.schema';
import { LabelTemplateService } from '@core/services/labelTemplate.service';

@injectable()
export class LabelTemplateViewerUseCase {
  constructor(
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    labelTemplateId: string,
    accountId: string
  ): Promise<ViewLabelTemplateResponse | null> {
    const labelTemplate = await this.labelTemplateService.viewLabelTemplateById(
      labelTemplateId,
      accountId
    );

    if (!labelTemplate) {
      throw new Error(t('label_template_not_found'));
    }

    return labelTemplate;
  }
}
