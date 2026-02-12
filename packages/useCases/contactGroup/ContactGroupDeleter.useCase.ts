import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactGroupService } from '@core/services/contactGroup.service';

@injectable()
export class ContactGroupDeleterUseCase {
  constructor(
    @inject(ContactGroupService)
    private readonly contactGroupService: ContactGroupService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactGroupId: string
  ): Promise<boolean> {
    const contactGroupExists =
      await this.contactGroupService.existsContactGroupById(contactGroupId);

    if (!contactGroupExists) {
      throw new Error(t('contact_group_not_found'));
    }

    return this.contactGroupService.deleteContactGroup(t, contactGroupId);
  }
}
