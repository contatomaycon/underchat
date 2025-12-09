import { IActionsTokenKeyData } from './IActionsTokenKeyData';

export interface ITokenKeyData {
  account_id: string;
  api_key_id: string;
  api_key: string;
  permission_role_id: string;
  name: string;
  actions: IActionsTokenKeyData[];
}
