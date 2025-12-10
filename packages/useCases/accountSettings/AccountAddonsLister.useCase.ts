import { inject, injectable } from 'tsyringe';
import { AccountAddonsListerRepository } from '@core/repositories/accountSettings/AccountAddonsLister.repository';
import { ListAccountAddonsFinalResponse } from '@core/schema/accountSettings/listAccountAddons/response.schema';

@injectable()
export class AccountAddonsListerUseCase {
  constructor(
    @inject(AccountAddonsListerRepository)
    private readonly accountAddonsListerRepository: AccountAddonsListerRepository
  ) {}

  execute = async (
    accountId: string
  ): Promise<ListAccountAddonsFinalResponse> => {
    return this.accountAddonsListerRepository.listAccountAddons(accountId);
  };
}
