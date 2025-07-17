import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface ITokenJwtData {
  user_id: string;
  actions: IJwtGroupHierarchy[];
}
