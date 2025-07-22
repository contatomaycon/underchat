import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface ITokenJwtData {
  account_id: number;
  user_id: string;
  actions: IJwtGroupHierarchy[];
}
