import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactGroupService } from '@core/services/contactGroup.service';
import { ViewContactGroupResponse } from '@core/schema/contactGroup/viewContactGroup/response.schema';

@injectable()
export class ContactGroupViewerUseCase {
  constructor(
    @inject(ContactGroupService)
    private readonly contactGroupService: ContactGroupService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    accountId: string
  ): Promise<ViewContactGroupResponse | null> {
    const contactGroupExists =
      await this.contactGroupService.existsContactGroupById(
        contactGroupId,
        accountId
      );

    if (!contactGroupExists) {
      throw new Error(t('contact_group_not_found'));
    }

    return this.contactGroupService.viewContactGroupById(
      contactGroupId,
      accountId
    );
  }
}
