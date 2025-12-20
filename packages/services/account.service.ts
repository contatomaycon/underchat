import { injectable, inject } from 'tsyringe';
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
import { AccountInfoViewerExistsRepository } from '@core/repositories/account/AccountInfoViewerExists.repository';
import { AccountInfoCreatorRepository } from '@core/repositories/account/AccountInfoCreator.repository';
import { AccountInfoUpdaterRepository } from '@core/repositories/account/AccountInfoUpdater.repository';
import { AccountInfoByIdViewerExistsRepository } from '@core/repositories/account/AccountInfoByIdViewerExists.repository';
import { CreateAccountInfoRequest } from '@core/schema/account/createAccountInfo/request.schema';
import { EditAccountInfoRequest } from '@core/schema/account/editAccountInfo/request.schema';
import { AccountAllListerRepository } from '@core/repositories/account/AccountAllLister.repository';
import { AccountMasterAccessibleListerRepository } from '@core/repositories/account/AccountMasterAccessibleLister.repository';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { AccountSubscriptionsListerRepository } from '@core/repositories/account/AccountSubscriptionsLister.repository';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';
import { PlanAccountStatusViewerRepository } from '@core/repositories/planAccount/PlanAccountStatusViewer.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { IPlanAccountStatus } from '@core/common/interfaces/IPlanAccountStatus';
import { AccountSubscribersListerRepository } from '@core/repositories/account/AccountSubscribersLister.repository';
import { ListAccountSubscribersRequest } from '@core/schema/account/listAccountSubscribers/request.schema';
import { ListAccountSubscribersResponse } from '@core/schema/account/listAccountSubscribers/response.schema';
import { AccountCancellingListerRepository } from '@core/repositories/account/AccountCancellingLister.repository';
import { ListAccountCancellingRequest } from '@core/schema/account/listAccountCancelling/request.schema';
import { ListAccountCancellingResponse } from '@core/schema/account/listAccountCancelling/response.schema';
import { AccountCancelledListerRepository } from '@core/repositories/account/AccountCancelledLister.repository';
import { ListAccountCancelledRequest } from '@core/schema/account/listAccountCancelled/request.schema';
import { ListAccountCancelledResponse } from '@core/schema/account/listAccountCancelled/response.schema';
import { AccountTestsListerRepository } from '@core/repositories/account/AccountTestsLister.repository';
import { ListAccountTestsRequest } from '@core/schema/account/listAccountTests/request.schema';
import { ListAccountTestsResponse } from '@core/schema/account/listAccountTests/response.schema';
import { AccountBlockedListerRepository } from '@core/repositories/account/AccountBlockedLister.repository';
import { ListAccountBlockedRequest } from '@core/schema/account/listAccountBlocked/request.schema';
import { ListAccountBlockedResponse } from '@core/schema/account/listAccountBlocked/response.schema';
import { AccountExpiredListerRepository } from '@core/repositories/account/AccountExpiredLister.repository';
import { ListAccountExpiredRequest } from '@core/schema/account/listAccountExpired/request.schema';
import { ListAccountExpiredResponse } from '@core/schema/account/listAccountExpired/response.schema';
import Redis from 'ioredis';

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
    private readonly accountUpdaterRepository: AccountUpdaterRepository,
    private readonly accountInfoViewerExistsRepository: AccountInfoViewerExistsRepository,
    private readonly accountInfoCreatorRepository: AccountInfoCreatorRepository,
    private readonly accountInfoUpdaterRepository: AccountInfoUpdaterRepository,
    private readonly accountInfoByIdViewerExistsRepository: AccountInfoByIdViewerExistsRepository,
    private readonly accountAllListerRepository: AccountAllListerRepository,
    private readonly accountMasterAccessibleListerRepository: AccountMasterAccessibleListerRepository,
    private readonly accountSubscriptionsListerRepository: AccountSubscriptionsListerRepository,
    private readonly planAccountStatusViewerRepository: PlanAccountStatusViewerRepository,
    private readonly accountSubscribersListerRepository: AccountSubscribersListerRepository,
    private readonly accountCancellingListerRepository: AccountCancellingListerRepository,
    private readonly accountCancelledListerRepository: AccountCancelledListerRepository,
    private readonly accountBlockedListerRepository: AccountBlockedListerRepository,
    private readonly accountTestsListerRepository: AccountTestsListerRepository,
    private readonly accountExpiredListerRepository: AccountExpiredListerRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  viewAccountInfoByAccountId = async (
    accountId: string
  ): Promise<AccountInfoResponse | null> => {
    return this.accountInfoViewerRepository.viewAccountInfoByAccountId(
      accountId
    );
  };

  viewLogoByAccountInfoId = async (
    accountInfoId: string
  ): Promise<string | null> => {
    return this.accountInfoViewerRepository.viewLogoByAccountInfoId(
      accountInfoId
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
    query: ListAccountRequest
  ): Promise<[ListAccountResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountListerRepository.listAccounts(perPage, currentPage, query),
      this.accountListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAllAccounts = async (): Promise<IAccountBasic[]> => {
    return this.accountAllListerRepository.listAllAccounts();
  };

  listMasterAccessibleAccounts = async (
    excludeAccountId: string
  ): Promise<IAccountBasic[]> => {
    return this.accountMasterAccessibleListerRepository.listMasterAccessibleAccounts(
      excludeAccountId
    );
  };

  createAccount = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    return this.accountCreatorRepository.createAccount(input);
  };

  createAccountWithPlanAndApiKey = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    return this.accountCreatorRepository.createAccountWithPlanAndApiKey(input);
  };

  viewAccounts = async (
    accountId: string
  ): Promise<ViewAccountResponse | null> => {
    return this.accountViewerRepository.viewAccounts(accountId);
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

  existsAccountInfoById = async (accountId: string): Promise<boolean> => {
    return this.accountInfoViewerExistsRepository.existsAccountInfoById(
      accountId
    );
  };

  totalAccountInfoByAccountId = async (accountId: string): Promise<number> => {
    return this.accountInfoViewerExistsRepository.totalAccountInfoByAccountId(
      accountId
    );
  };

  createAccountInfo = async (
    input: CreateAccountInfoRequest,
    urlLogo: string | null
  ): Promise<string | null> => {
    return this.accountInfoCreatorRepository.createAccountInfo(input, urlLogo);
  };

  updateAccountInfoById = async (
    accountInfoId: string,
    input: EditAccountInfoRequest,
    urlLogo: string | null | undefined
  ): Promise<boolean> => {
    return this.accountInfoUpdaterRepository.updateAccountInfoById(
      accountInfoId,
      input,
      urlLogo
    );
  };

  accountInfoByIdExists = async (accountInfoId: string): Promise<boolean> => {
    return this.accountInfoByIdViewerExistsRepository.accountInfoByIdExists(
      accountInfoId
    );
  };

  listAccountSubscriptions = async (
    accountId: string
  ): Promise<ListAccountSubscriptionsResponse | null> => {
    return this.accountSubscriptionsListerRepository.listAccountSubscriptions(
      accountId
    );
  };

  isPlanActive = async (accountId: string): Promise<boolean> => {
    const latest =
      await this.planAccountStatusViewerRepository.viewLatestByAccountId(
        accountId
      );
    if (!latest) {
      return false;
    }

    if (latest.account_status_id === EAccountStatus.blocked) {
      return false;
    }

    if (!latest.next_payment_date) {
      return false;
    }

    const nextPayment = new Date(latest.next_payment_date);
    if (Number.isNaN(nextPayment.getTime())) {
      return false;
    }

    const now = Date.now();
    if (nextPayment.getTime() <= now) {
      return false;
    }

    if (latest.cancellation_date) {
      return true;
    }

    const activeStatus = latest.account_status_id === EAccountStatus.active;
    if (!activeStatus) {
      return latest.account_status_id === EAccountStatus.inactive;
    }

    return true;
  };

  viewPlanStatus = async (
    accountId: string
  ): Promise<IPlanAccountStatus | null> => {
    return this.planAccountStatusViewerRepository.viewLatestByAccountId(
      accountId
    );
  };

  isAccountBlocked = async (accountId: string): Promise<boolean> => {
    const planStatus = await this.viewPlanStatus(accountId);
    if (!planStatus) {
      return false;
    }

    return planStatus.account_status_id === EAccountStatus.blocked;
  };

  listAccountSubscribers = async (
    perPage: number,
    currentPage: number,
    query: ListAccountSubscribersRequest
  ): Promise<[ListAccountSubscribersResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountSubscribersListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountSubscribersListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAccountCancelling = async (
    perPage: number,
    currentPage: number,
    query: ListAccountCancellingRequest
  ): Promise<[ListAccountCancellingResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountCancellingListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountCancellingListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAccountCancelled = async (
    perPage: number,
    currentPage: number,
    query: ListAccountCancelledRequest
  ): Promise<[ListAccountCancelledResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountCancelledListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountCancelledListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAccountBlocked = async (
    perPage: number,
    currentPage: number,
    query: ListAccountBlockedRequest
  ): Promise<[ListAccountBlockedResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountBlockedListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountBlockedListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAccountTests = async (
    perPage: number,
    currentPage: number,
    query: ListAccountTestsRequest
  ): Promise<[ListAccountTestsResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountTestsListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountTestsListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listAccountExpired = async (
    perPage: number,
    currentPage: number,
    query: ListAccountExpiredRequest
  ): Promise<[ListAccountExpiredResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountExpiredListerRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountExpiredListerRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  updateAccountStatusById = async (
    accountId: string,
    accountStatusId: string
  ): Promise<boolean> => {
    return this.accountUpdaterRepository.updateAccountStatusById(
      accountId,
      accountStatusId
    );
  };

  clearAllAccountSessions = async (accountId: string): Promise<void> => {
    const pattern = `jwtSession:${accountId}:*`;
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100,
    });

    const keysToDelete: string[] = [];

    stream.on('data', (keys: string[]) => {
      keysToDelete.push(...keys);
    });

    await new Promise<void>((resolve) => {
      stream.on('end', () => {
        resolve();
      });
    });

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
  };
}
