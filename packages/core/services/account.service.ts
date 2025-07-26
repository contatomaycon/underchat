import { injectable } from 'tsyringe';
import { AccountInfoViewerRepository } from '@core/repositories/account/AccountInfoViewer.repository';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';

@injectable()
export class AccountService {
  constructor(
    private readonly accountInfoViewerRepository: AccountInfoViewerRepository,
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository
  ) {}

  viewAccountInfoByAccountId = async (
    accountId: number
  ): Promise<AccountInfoResponse | null> => {
    return this.accountInfoViewerRepository.viewAccountInfoByAccountId(
      accountId
    );
  };

  viewAccountQuantityProduct = async (
    accountId: number,
    planProductId: number
  ): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      planProductId
    );
  };
}
