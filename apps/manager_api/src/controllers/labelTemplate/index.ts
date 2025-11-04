import { injectable } from 'tsyringe';
import { listLabelTemplate } from './methods/listLabelTemplate';
import { viewLabelTemplate } from './methods/viewLabelTemplate';
import { deleteLabelTemplate } from './methods/deleteLabelTemplate';
import { editLabelTemplate } from './methods/editLabelTemplate';
import { createLabelTemplate } from './methods/createLabelTemplate';

@injectable()
class LabelTemplateController {
  public listLabelTemplate = listLabelTemplate;
  public viewLabelTemplate = viewLabelTemplate;
  public deleteLabelTemplate = deleteLabelTemplate;
  public updateLabelTemplate = editLabelTemplate;
  public createLabelTemplate = createLabelTemplate;
}

export default LabelTemplateController;
