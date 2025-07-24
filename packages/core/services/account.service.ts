import { injectable } from 'tsyringe';
import { AccountInfoViewerRepository } from '@core/repositories/account/AccountInfoViewer.repository';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';

@injectable()
export class AccountService {
  constructor(
    private readonly accountInfoViewerRepository: AccountInfoViewerRepository
  ) {}

  viewAccountInfoByAccountId = async (
    accountId: number
  ): Promise<AccountInfoResponse | null> => {
    return this.accountInfoViewerRepository.viewAccountInfoByAccountId(
      accountId
    );
  };
}
