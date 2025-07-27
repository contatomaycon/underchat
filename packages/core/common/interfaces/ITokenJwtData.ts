import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface ITokenJwtData {
  account_id: string;
  user_id: string;
  permission_role_id: string;
  is_administrator: boolean;
  actions: IJwtGroupHierarchy[];
}
