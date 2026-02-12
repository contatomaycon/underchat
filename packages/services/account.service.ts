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
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { AccountSubscriptionsListerRepository } from '@core/repositories/account/AccountSubscriptionsLister.repository';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';
import { PlanAccountStatusViewerRepository } from '@core/repositories/planAccount/PlanAccountStatusViewer.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { IPlanAccountStatus } from '@core/common/interfaces/IPlanAccountStatus';
import { AccountAllListerWithDetailsRepository } from '@core/repositories/account/AccountAllListerWithDetails.repository';
import { PlanAccountExclusiveListerRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveLister.repository';
import { ListPlanAccountExclusivesResponse } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/response.schema';
import { PlanAccountExclusiveCreatorRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveCreator.repository';
import { CreatePlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/createPlanAccountExclusive/request.schema';
import { PlanAccountExclusiveDeleterRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveDeleter.repository';
import { ExclusivePlansListerRepository } from '@core/repositories/planAccountExclusive/ExclusivePlansLister.repository';
import { ListExclusivePlansResponseArray } from '@core/schema/planAccountExclusive/listExclusivePlans/response.schema';
import Redis from 'ioredis';

@injectable()
export class AccountService {
  constructor(
    @inject(AccountInfoViewerRepository)
    private readonly accountInfoViewerRepository: AccountInfoViewerRepository,
    @inject(AccountQuantityProductViewerRepository)
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository,
    @inject(AccountViewerExistsRepository)
    private readonly accountViewerExistsRepository: AccountViewerExistsRepository,
    @inject(AccountNameViewerRepository)
    private readonly accountNameViewerRepository: AccountNameViewerRepository,
    @inject(AccountListerRepository)
    private readonly accountListerRepository: AccountListerRepository,
    @inject(AccountCreatorRepository)
    private readonly accountCreatorRepository: AccountCreatorRepository,
    @inject(AccountViewerRepository)
    private readonly accountViewerRepository: AccountViewerRepository,
    @inject(AccountDeleterRepository)
    private readonly accountDeleterRepository: AccountDeleterRepository,
    @inject(AccountUpdaterRepository)
    private readonly accountUpdaterRepository: AccountUpdaterRepository,
    @inject(AccountInfoViewerExistsRepository)
    private readonly accountInfoViewerExistsRepository: AccountInfoViewerExistsRepository,
    @inject(AccountInfoCreatorRepository)
    private readonly accountInfoCreatorRepository: AccountInfoCreatorRepository,
    @inject(AccountInfoUpdaterRepository)
    private readonly accountInfoUpdaterRepository: AccountInfoUpdaterRepository,
    @inject(AccountInfoByIdViewerExistsRepository)
    private readonly accountInfoByIdViewerExistsRepository: AccountInfoByIdViewerExistsRepository,
    @inject(AccountAllListerRepository)
    private readonly accountAllListerRepository: AccountAllListerRepository,
    @inject(AccountSubscriptionsListerRepository)
    private readonly accountSubscriptionsListerRepository: AccountSubscriptionsListerRepository,
    @inject(PlanAccountStatusViewerRepository)
    private readonly planAccountStatusViewerRepository: PlanAccountStatusViewerRepository,
    @inject(AccountAllListerWithDetailsRepository)
    private readonly accountAllListerWithDetailsRepository: AccountAllListerWithDetailsRepository,
    @inject(PlanAccountExclusiveListerRepository)
    private readonly planAccountExclusiveListerRepository: PlanAccountExclusiveListerRepository,
    @inject(PlanAccountExclusiveCreatorRepository)
    private readonly planAccountExclusiveCreatorRepository: PlanAccountExclusiveCreatorRepository,
    @inject(PlanAccountExclusiveDeleterRepository)
    private readonly planAccountExclusiveDeleterRepository: PlanAccountExclusiveDeleterRepository,
    @inject(ExclusivePlansListerRepository)
    private readonly exclusivePlansListerRepository: ExclusivePlansListerRepository,
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

  listAllAccountsWithDetails = async (
    perPage: number,
    currentPage: number,
    query: ListAccountRequest
  ): Promise<[ListAccountResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.accountAllListerWithDetailsRepository.listAccounts(
        perPage,
        currentPage,
        query
      ),
      this.accountAllListerWithDetailsRepository.listAccountsTotal(query),
    ]);

    return [result, total];
  };

  listPlanAccountExclusives = async (
    accountId: string
  ): Promise<ListPlanAccountExclusivesResponse> => {
    return this.planAccountExclusiveListerRepository.listPlanAccountExclusives(
      accountId
    );
  };

  createPlanAccountExclusive = async (
    input: CreatePlanAccountExclusiveRequest
  ): Promise<string | null> => {
    return this.planAccountExclusiveCreatorRepository.createPlanAccountExclusive(
      input
    );
  };

  deletePlanAccountExclusive = async (
    planAccountExclusiveId: string
  ): Promise<boolean> => {
    return this.planAccountExclusiveDeleterRepository.deletePlanAccountExclusiveById(
      planAccountExclusiveId
    );
  };

  listExclusivePlans = async (
    accountId: string
  ): Promise<ListExclusivePlansResponseArray> => {
    return this.exclusivePlansListerRepository.listExclusivePlans(accountId);
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
