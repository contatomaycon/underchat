import { injectable } from 'tsyringe';
import { listContact } from './methods/listContact';
import { viewContact } from './methods/viewContact';
import { viewContactPhone } from './methods/viewContactPhone';
import { viewContactEmail } from './methods/viewContactEmail';
import { viewContactDocument } from './methods/viewContactDocument';
import { deleteContact } from './methods/deleteContact';
import { bulkDeleteContact } from './methods/bulkDeleteContact';
import { bulkUpdateContactLabels } from './methods/bulkUpdateContactLabels';
import { bulkUpdateContactDetails } from './methods/bulkUpdateContactDetails';
import { editContact } from './methods/editContact';
import { createContact } from './methods/createContact';
import { exportContact } from './methods/exportContact';
import { validateContact } from './methods/validateContact';
import { deletePhoto } from './methods/deletePhoto';
import { listUsers } from './methods/listUsers';
import { removeContactLabelTemplate } from './methods/removeContactLabelTemplate';
import { listContactChannels } from './methods/listContactChannels';
import { viewContactChannelsByContactId } from './methods/viewContactChannelsByContactId';
import { listLabelTemplates } from './methods/listLabelTemplates';

@injectable()
class ContactController {
  public listContact = listContact;
  public viewContact = viewContact;
  public viewContactPhone = viewContactPhone;
  public viewContactEmail = viewContactEmail;
  public viewContactDocument = viewContactDocument;
  public deleteContact = deleteContact;
  public bulkDeleteContact = bulkDeleteContact;
  public bulkUpdateContactLabels = bulkUpdateContactLabels;
  public bulkUpdateContactDetails = bulkUpdateContactDetails;
  public editContact = editContact;
  public createContact = createContact;
  public exportContact = exportContact;
  public validateContact = validateContact;
  public deletePhoto = deletePhoto;
  public listUsers = listUsers;
  public removeContactLabelTemplate = removeContactLabelTemplate;
  public listContactChannels = listContactChannels;
  public viewContactChannelsByContactId = viewContactChannelsByContactId;
  public listLabelTemplates = listLabelTemplates;
}

export default ContactController;
