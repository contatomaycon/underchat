import { IJwtGroupHierarchy } from './IJwtGroupHierarchy';

export interface IJwtPermissionsWithPlan {
  actions: IJwtGroupHierarchy[];
  plan_is_active: boolean;
}
