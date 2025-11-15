import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactGroupService } from '@core/services/contactGroup.service';
import { ContactService } from '@core/services/contact.service';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';

@injectable()
export class ContactGroupUpdaterUseCase {
  constructor(
    private readonly contactGroupService: ContactGroupService,
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    body: UpdateContactGroupRequest
  ): Promise<boolean> {
    const contactGroupExists =
      await this.contactGroupService.viewContactGroupById(contactGroupId);

    if (!contactGroupExists) {
      throw new Error(t('contact_group_not_found'));
    }

    if (body.contacts?.length) {
      for (const c of body.contacts) {
        if (!c?.contact_id) continue;

        const contactExists = await this.contactService.existsContactById(
          c.contact_id
        );

        if (!contactExists) {
          throw new Error(t('contact_not_found'));
        }
      }
    }

    const contactGroupUpdater =
      await this.contactGroupService.updateContactGroupById(
        t,
        contactGroupId,
        body
      );

    if (!contactGroupUpdater) {
      throw new Error(t('contact_group_update_error'));
    }

    return true;
  }
}
