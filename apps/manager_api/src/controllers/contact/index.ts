import { injectable } from 'tsyringe';
import { listContact } from './methods/listContact';
import { viewContact } from './methods/viewContact';
import { viewContactPhone } from './methods/viewContactPhone';
import { viewContactEmail } from './methods/viewContactEmail';
import { viewContactDocument } from './methods/viewContactDocument';
import { deleteContact } from './methods/deleteContact';
import { editContact } from './methods/editContact';
import { createContact } from './methods/createContact';
import { exportContact } from './methods/exportContact';
import { validateContact } from './methods/validateContact';
import { deletePhoto } from './methods/deletePhoto';

@injectable()
class ContactController {
  public listContact = listContact;
  public viewContact = viewContact;
  public viewContactPhone = viewContactPhone;
  public viewContactEmail = viewContactEmail;
  public viewContactDocument = viewContactDocument;
  public deleteContact = deleteContact;
  public editContact = editContact;
  public createContact = createContact;
  public exportContact = exportContact;
  public validateContact = validateContact;
  public deletePhoto = deletePhoto;
}

export default ContactController;
