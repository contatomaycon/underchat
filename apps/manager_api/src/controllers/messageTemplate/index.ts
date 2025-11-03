import { injectable } from 'tsyringe';
import { listMessageTemplate } from './methods/listMessageTemplate';
import { viewMessageTemplate } from './methods/viewMessageTemplate';
import { deleteMessageTemplate } from './methods/deleteMessageTemplate';
import { editMessageTemplate } from './methods/editMessageTemplate';
import { createMessageTemplate } from './methods/createMessageTemplate';

@injectable()
class MessageTemplateController {
  public listMessageTemplate = listMessageTemplate;
  public viewMessageTemplate = viewMessageTemplate;
  public deleteMessageTemplate = deleteMessageTemplate;
  public updateMessageTemplate = editMessageTemplate;
  public createMessageTemplate = createMessageTemplate;
}

export default MessageTemplateController;
