import { injectable } from 'tsyringe';
import { listContact } from './methods/listContact';
import { viewContact } from './methods/viewContact';
import { viewContactPhone } from './methods/viewContactPhone';
import { viewContactEmail } from './methods/viewContactEmail';
import { deleteContact } from './methods/deleteContact';
import { editContact } from './methods/editContact';
import { createContact } from './methods/createContact';

@injectable()
class ContactController {
  public listContact = listContact;
  public viewContact = viewContact;
  public viewContactPhone = viewContactPhone;
  public viewContactEmail = viewContactEmail;
  public deleteContact = deleteContact;
  public updateContact = editContact;
  public createContact = createContact;
}

export default ContactController;
