import { IActionsTokenKeyData } from './IActionsTokenKeyData';

export interface ITokenKeyData {
  api_key_id: string;
  api_key: string;
  name: string;
  actions: IActionsTokenKeyData[];
}
