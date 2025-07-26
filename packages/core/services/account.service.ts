import { injectable } from 'tsyringe';
import { AccountInfoViewerRepository } from '@core/repositories/account/AccountInfoViewer.repository';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { AccountViewerExistsRepository } from '@core/repositories/account/AccountViewerExists.repository';

@injectable()
export class AccountService {
  constructor(
    private readonly accountInfoViewerRepository: AccountInfoViewerRepository,
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository,
    private readonly accountViewerExistsRepository: AccountViewerExistsRepository
  ) {}

  viewAccountInfoByAccountId = async (
    accountId: string
  ): Promise<AccountInfoResponse | null> => {
    return this.accountInfoViewerRepository.viewAccountInfoByAccountId(
      accountId
    );
  };

  viewAccountQuantityProduct = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      planProductId
    );
  };

  existsAccountById = async (accountId: string): Promise<boolean> => {
    return this.accountViewerExistsRepository.existsAccountById(accountId);
  };
}
