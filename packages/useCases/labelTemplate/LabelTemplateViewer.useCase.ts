import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewLabelTemplateResponse } from '@core/schema/labelTemplate/viewLabelTemplate/response.schema';
import { LabelTemplateService } from '@core/services/labelTemplate.service';

@injectable()
export class LabelTemplateViewerUseCase {
  constructor(private readonly labelTemplateService: LabelTemplateService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    labelTemplateId: string
  ): Promise<ViewLabelTemplateResponse | null> {
    const labelTemplateExists =
      await this.labelTemplateService.existsLabelTemplateById(labelTemplateId);

    if (!labelTemplateExists) {
      throw new Error(t('label_template_not_found'));
    }

    return this.labelTemplateService.viewLabelTemplateById(labelTemplateId);
  }
}
