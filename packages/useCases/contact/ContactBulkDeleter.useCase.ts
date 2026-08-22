import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactDeleterUseCase } from './ContactDeleter.useCase';

@injectable()
export class ContactBulkDeleterUseCase {
  constructor(
    @inject(ContactDeleterUseCase)
    private readonly contactDeleterUseCase: ContactDeleterUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactIds: string[],
    accountId: string,
    actorUserId?: string
  ): Promise<{ deleted_count: number; failed_count: number }> {
    if (contactIds.length === 0) {
      return { deleted_count: 0, failed_count: 0 };
    }

    const results = await Promise.allSettled(
      contactIds.map((contactId) =>
        this.contactDeleterUseCase.execute(
          t,
          contactId,
          accountId,
          actorUserId
        )
      )
    );
    const deletedCount = results.filter(
      (result) => result.status === 'fulfilled' && result.value
    ).length;

    const failedCount = contactIds.length - deletedCount;

    return {
      deleted_count: deletedCount,
      failed_count: failedCount,
    };
  }
}
