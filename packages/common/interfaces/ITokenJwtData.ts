import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';

export interface IUserChannel {
  id: string;
  name: string;
}

export interface ITokenJwtData {
  account_id: string;
  user_id: string;
  session_id: string;
  permission_role_id: string;
  actions: IJwtGroupHierarchy[];
  sectors: string[];
  channels: IUserChannel[];
  plan_is_active: boolean;
  session_platform?: SessionPlatform | null;
}
