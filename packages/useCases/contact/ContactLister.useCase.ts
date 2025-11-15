import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ListContactFinalResponse } from '@core/schema/contact/listContact/response.schema';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactListerUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListContactRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListContactFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.contactService.listContacts(
      perPage,
      currentPage,
      query,
      isAdministrator,
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
