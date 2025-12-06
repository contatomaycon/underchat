import { inject, injectable } from 'tsyringe';
import { AccountPlanProductsListerRepository } from '@core/repositories/accountSettings/AccountPlanProductsLister.repository';
import { ListAccountPlanProductsFinalResponse } from '@core/schema/accountSettings/listAccountPlanProducts/response.schema';

@injectable()
export class AccountPlanProductsListerUseCase {
  constructor(
    @inject(AccountPlanProductsListerRepository)
    private readonly accountPlanProductsListerRepository: AccountPlanProductsListerRepository
  ) {}

  execute = async (
    accountId: string
  ): Promise<ListAccountPlanProductsFinalResponse> => {
    return this.accountPlanProductsListerRepository.listAccountPlanProducts(
      accountId
    );
  };
}
