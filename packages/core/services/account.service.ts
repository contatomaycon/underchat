import { injectable } from 'tsyringe';
import { AccountInfoViewerRepository } from '@core/repositories/account/AccountInfoViewer.repository';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { AccountViewerExistsRepository } from '@core/repositories/account/AccountViewerExists.repository';
import { AccountNameViewerRepository } from '@core/repositories/account/AccountNameViewer.repository';
import { IViewAccountName } from '@core/common/interfaces/IViewAccountName';
import { AccountListerRepository } from '@core/repositories/account/AccountLister.repository';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { AccountCreatorRepository } from '@core/repositories/account/AccountCreator.repository';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { AccountViewerRepository } from '@core/repositories/account/AccountViewer.repository';
import { ViewAccountResponse } from '@core/schema/account/viewAccount/response.schema';
import { AccountDeleterRepository } from '@core/repositories/account/AccountDeleter.repository';
import { AccountUpdaterRepository } from '@core/repositories/account/AccountUpdater.repository';
import { UpdateAccountRequest } from '@core/schema/account/editAccount/request.schema';

@injectable()
export class AccountService {
  constructor(
    private readonly accountInfoViewerRepository: AccountInfoViewerRepository,
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository,
    private readonly accountViewerExistsRepository: AccountViewerExistsRepository,
    private readonly accountNameViewerRepository: AccountNameViewerRepository,
    private readonly accountListerRepository: AccountListerRepository,
    private readonly accountCreatorRepository: AccountCreatorRepository,
    private readonly accountViewerRepository: AccountViewerRepository,
    private readonly accountDeleterRepository: AccountDeleterRepository,
    private readonly accountUpdaterRepository: AccountUpdaterRepository
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

  viewAccountName = async (
    accountId: string
  ): Promise<IViewAccountName | null> => {
    return this.accountNameViewerRepository.viewAccountName(accountId);
  };

  listAccounts = async (
    perPage: number,
    currentPage: number,
    query: ListAccountRequest,
    isAdministrator: boolean
  ): Promise<[ListAccountResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountListerRepository.listAccounts(
        perPage,
        currentPage,
        query,
        isAdministrator
      ),
      this.accountListerRepository.listAccountsTotal(query, isAdministrator),
    ]);

    return [result, total];
  };

  createAccount = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    return this.accountCreatorRepository.createAccount(input);
  };

  viewAccounts = async (
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewAccountResponse | null> => {
    return this.accountViewerRepository.viewAccounts(
      accountId,
      isAdministrator
    );
  };

  deleteAccountById = async (accountId: string): Promise<boolean> => {
    return this.accountDeleterRepository.deleteAccountById(accountId);
  };

  updateAccountById = async (
    input: UpdateAccountRequest,
    accountId: string
  ): Promise<boolean> => {
    return this.accountUpdaterRepository.updateAccountById(input, accountId);
  };
}
