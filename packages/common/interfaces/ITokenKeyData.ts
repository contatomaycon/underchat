import { IApiKeyGroupHierarchy } from './IApiKeyGroupHierarchy';

export interface ITokenKeyData {
  account_id: string;
  api_key_id: string;
  api_key: string;
  name: string;
  actions: IApiKeyGroupHierarchy[];
}
