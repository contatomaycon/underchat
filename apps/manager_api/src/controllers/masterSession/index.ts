import { injectable } from 'tsyringe';
import { listAccounts } from './methods/listAccounts';
import { login } from './methods/login';

@injectable()
class MasterSessionController {
  public listAccounts = listAccounts;
  public login = login;
}

export default MasterSessionController;
