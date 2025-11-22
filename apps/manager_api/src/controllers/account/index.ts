import { injectable } from 'tsyringe';
import { listAccount } from './methods/listAccount';
import { viewAccount } from './methods/viewAccount';
import { deleteAccount } from './methods/deleteAccount';
import { editAccount } from './methods/editAccount';
import { createAccount } from './methods/createAccount';
import { viewAccountInfo } from './methods/viewAccountInfo';
import { createAccountInfo } from './methods/createAccountInfo';
import { editAccountInfo } from './methods/editAccountInfo';
import { deleteAccountInfo } from './methods/deleteAccountInfo';
import { listAllAccounts } from './methods/listAllAccounts';
import { listAccountSubscriptions } from './methods/listAccountSubscriptions';

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
  public deleteAccountInfo = deleteAccountInfo;
  public listAllAccounts = listAllAccounts;
  public listAccountSubscriptions = listAccountSubscriptions;
}

export default AccountController;
