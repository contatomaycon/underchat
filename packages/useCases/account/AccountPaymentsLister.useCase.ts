import { inject, injectable } from 'tsyringe';
import { AccountPaymentsListerRepository } from '@core/repositories/account/AccountPaymentsLister.repository';
import { ListAccountPaymentsFinalResponse } from '@core/schema/account/listAccountPayments/response.schema';
import { ListAccountPaymentsRequest } from '@core/schema/account/listAccountPayments/request.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class AccountPaymentsListerUseCase {
  constructor(
    @inject(AccountPaymentsListerRepository)
    private readonly accountPaymentsListerRepository: AccountPaymentsListerRepository
  ) {}

  execute = async (
    accountId: string,
    query: ListAccountPaymentsRequest
  ): Promise<ListAccountPaymentsFinalResponse> => {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await Promise.all([
      this.accountPaymentsListerRepository.listAccountPayments(
        accountId,
        perPage,
        currentPage
      ),
      this.accountPaymentsListerRepository.listAccountPaymentsTotal(accountId),
    ]);

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
  };
}
