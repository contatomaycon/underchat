import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ContactService } from '@core/services/contact.service';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { ContactGroupService } from '@core/services/contactGroup.service';

@injectable()
export class ContactGroupCreatorUseCase {
  constructor(
    private readonly contactGroupService: ContactGroupService,
    private readonly accountService: AccountService,
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactGroupRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    if (input.contacts?.length) {
      for (const c of input.contacts) {
        if (!c?.contact_id) continue;

        const contactExists = await this.contactService.existsContactById(
          c.contact_id
        );

        if (!contactExists) {
          throw new Error(t('contact_not_found'));
        }
      }
    }

    const contactGroupCreated =
      await this.contactGroupService.createContactGroup(t, accountId, input);

    if (!contactGroupCreated) {
      throw new Error(t('contact_group_creation_failed'));
    }

    return true;
  }
}
