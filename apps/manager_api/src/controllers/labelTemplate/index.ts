import { injectable } from 'tsyringe';
import { listLabelTemplate } from './methods/listLabelTemplate';
import { viewLabelTemplate } from './methods/viewLabelTemplate';
import { deleteLabelTemplate } from './methods/deleteLabelTemplate';
import { editLabelTemplate } from './methods/editLabelTemplate';
import { createLabelTemplate } from './methods/createLabelTemplate';
import { listLabelTemplateAll } from './methods/listLabelTemplateAll';

@injectable()
class LabelTemplateController {
  public listLabelTemplate = listLabelTemplate;
  public viewLabelTemplate = viewLabelTemplate;
  public deleteLabelTemplate = deleteLabelTemplate;
  public updateLabelTemplate = editLabelTemplate;
  public createLabelTemplate = createLabelTemplate;
  public listLabelTemplateAll = listLabelTemplateAll;
}

export default LabelTemplateController;
