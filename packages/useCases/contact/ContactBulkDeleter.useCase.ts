import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactBulkDeleterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactIds: string[]
  ): Promise<{ deleted_count: number; failed_count: number }> {
    if (contactIds.length === 0) {
      return { deleted_count: 0, failed_count: 0 };
    }

    const deletedCount =
      await this.contactService.deleteContactsByIds(contactIds);

    const failedCount = contactIds.length - deletedCount;

    return {
      deleted_count: deletedCount,
      failed_count: failedCount,
    };
  }
}
