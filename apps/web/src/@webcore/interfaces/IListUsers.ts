import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListUsers {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  user_status?: string | null;
  permission_role_id?: string | null;
  account_id?: string | null;
  search?: string | null;
}
