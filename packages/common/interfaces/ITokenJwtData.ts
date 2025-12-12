import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface ITokenJwtData {
  account_id: string;
  user_id: string;
  permission_role_id: string;
  actions: IJwtGroupHierarchy[];
  sectors: string[];
  plan_is_active: boolean;
}
