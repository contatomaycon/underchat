import { injectable } from 'tsyringe';
import { listContactGroup } from './methods/listContactGroup';
import { viewContactGroup } from './methods/viewContactGroup';
import { deleteContactGroup } from './methods/deleteContactGroup';
import { editContactGroup } from './methods/editContactGroup';
import { createContactGroup } from './methods/createContactGroup';
import { listContactGroupAll } from './methods/listContactGroupAll';

@injectable()
class ContactGroupController {
  public listContactGroup = listContactGroup;
  public listContactGroupAll = listContactGroupAll;
  public viewContactGroup = viewContactGroup;
  public deleteContactGroup = deleteContactGroup;
  public updateContactGroup = editContactGroup;
  public createContactGroup = createContactGroup;
}

export default ContactGroupController;
