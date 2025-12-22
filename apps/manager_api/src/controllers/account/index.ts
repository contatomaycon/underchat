import { injectable } from 'tsyringe';
import { listAccount } from './methods/listAccount';
import { viewAccount } from './methods/viewAccount';
import { deleteAccount } from './methods/deleteAccount';
import { editAccount } from './methods/editAccount';
import { createAccount } from './methods/createAccount';
import { viewAccountInfo } from './methods/viewAccountInfo';
import { createAccountInfo } from './methods/createAccountInfo';
import { editAccountInfo } from './methods/editAccountInfo';
import { listAllAccounts } from './methods/listAllAccounts';
import { listAccountSubscriptions } from './methods/listAccountSubscriptions';
import { updatePlanAccount } from './methods/updatePlanAccount';
import { viewPlanAccount } from './methods/viewPlanAccount';
import { listAccountSubscribers } from './methods/listAccountSubscribers';
import { listAccountCancelling } from './methods/listAccountCancelling';
import { listAccountCancelled } from './methods/listAccountCancelled';
import { listAccountBlocked } from './methods/listAccountBlocked';
import { listAccountTests } from './methods/listAccountTests';
import { listAccountExpired } from './methods/listAccountExpired';
import { listAccountDeleted } from './methods/listAccountDeleted';
import { listPlanAccountExclusive } from './methods/listPlanAccountExclusive';
import { createPlanAccountExclusive } from './methods/createPlanAccountExclusive';
import { deletePlanAccountExclusive } from './methods/deletePlanAccountExclusive';
import { listExclusivePlans } from './methods/listExclusivePlans';
import { listAllAccountsWithDetails } from './methods/listAllAccountsWithDetails';
import { blockAccount } from './methods/blockAccount';
import { unblockAccount } from './methods/unblockAccount';

@injectable()
class AccountController {
  public listAccount = listAccount;
  public viewAccount = viewAccount;
  public deleteAccount = deleteAccount;
  public updateAccount = editAccount;
  public createAccount = createAccount;
  public viewAccountInfo = viewAccountInfo;
  public createAccountInfo = createAccountInfo;
  public updateAccountInfo = editAccountInfo;
  public listAllAccounts = listAllAccounts;
  public listAccountSubscriptions = listAccountSubscriptions;
  public updatePlanAccount = updatePlanAccount;
  public viewPlanAccount = viewPlanAccount;
  public listAccountSubscribers = listAccountSubscribers;
  public listAccountCancelling = listAccountCancelling;
  public listAccountCancelled = listAccountCancelled;
  public listAccountBlocked = listAccountBlocked;
  public listAccountTests = listAccountTests;
  public listAccountExpired = listAccountExpired;
  public listAccountDeleted = listAccountDeleted;
  public listPlanAccountExclusive = listPlanAccountExclusive;
  public createPlanAccountExclusive = createPlanAccountExclusive;
  public deletePlanAccountExclusive = deletePlanAccountExclusive;
  public listExclusivePlans = listExclusivePlans;
  public listAllAccountsWithDetails = listAllAccountsWithDetails;
  public blockAccount = blockAccount;
  public unblockAccount = unblockAccount;
}

export default AccountController;
