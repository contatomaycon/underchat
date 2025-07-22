import { IActionsTokenKeyData } from './IActionsTokenKeyData';

export interface ITokenKeyData {
  account_id: number;
  api_key_id: string;
  api_key: string;
  name: string;
  actions: IActionsTokenKeyData[];
}
