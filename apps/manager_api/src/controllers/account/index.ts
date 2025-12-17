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
import { listAccountTests } from './methods/listAccountTests';

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
  public listAccountTests = listAccountTests;
}

export default AccountController;
