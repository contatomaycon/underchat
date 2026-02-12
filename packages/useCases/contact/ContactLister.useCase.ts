import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ListContactFinalResponse } from '@core/schema/contact/listContact/response.schema';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactListerUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService
  ) {}

  async execute(
    query: ListContactRequest,
    accountId: string
  ): Promise<ListContactFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.contactService.listContacts(
      perPage,
      currentPage,
      query,
      accountId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
