import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { UpdateLabelTemplateRequest } from '@core/schema/labelTemplate/editLabelTemplate/request.schema';

@injectable()
export class LabelTemplateUpdaterUseCase {
  constructor(private readonly labelTemplateService: LabelTemplateService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    labelTemplateId: string,
    body: UpdateLabelTemplateRequest
  ): Promise<boolean> {
    const labelTemplateExists =
      await this.labelTemplateService.existsLabelTemplateById(labelTemplateId);

    if (!labelTemplateExists) {
      throw new Error(t('label_template_not_found'));
    }

    if (body.label_status?.label_status_id) {
      const labelStatusExists =
        await this.labelTemplateService.existsLabelStatusById(
          body.label_status.label_status_id
        );

      if (!labelStatusExists) {
        throw new Error(t('label_status_not_found'));
      }
    }

    const labelTemplateUpdater =
      await this.labelTemplateService.updateLabelTemplateById(
        labelTemplateId,
        body
      );

    if (!labelTemplateUpdater) {
      throw new Error(t('label_template_update_error'));
    }

    return labelTemplateUpdater;
  }
}
