import { injectable } from 'tsyringe';
import { listWhatsappTemplates } from './methods/listWhatsappTemplates';
import { syncWhatsappTemplates } from './methods/syncWhatsappTemplates';
import { createWhatsappTemplate } from './methods/createWhatsappTemplate';
import { viewWhatsappTemplate } from './methods/viewWhatsappTemplate';
import { updateWhatsappTemplate } from './methods/updateWhatsappTemplate';
import { deleteWhatsappTemplate } from './methods/deleteWhatsappTemplate';
import { deactivateWhatsappTemplate } from './methods/deactivateWhatsappTemplate';
import { uploadWhatsappTemplateMedia } from './methods/uploadWhatsappTemplateMedia';

@injectable()
class WhatsappOfficialTemplateController {
  public listWhatsappTemplates = listWhatsappTemplates;
  public syncWhatsappTemplates = syncWhatsappTemplates;
  public createWhatsappTemplate = createWhatsappTemplate;
  public viewWhatsappTemplate = viewWhatsappTemplate;
  public updateWhatsappTemplate = updateWhatsappTemplate;
  public deleteWhatsappTemplate = deleteWhatsappTemplate;
  public deactivateWhatsappTemplate = deactivateWhatsappTemplate;
  public uploadWhatsappTemplateMedia = uploadWhatsappTemplateMedia;
}

export default WhatsappOfficialTemplateController;
