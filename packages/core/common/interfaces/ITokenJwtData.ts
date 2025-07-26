import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface ITokenJwtData {
  account_id: string;
  user_id: string;
  actions: IJwtGroupHierarchy[];
}
