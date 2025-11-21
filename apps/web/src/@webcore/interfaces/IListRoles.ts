import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListRoles {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  role_name?: string | null;
  search?: string | null;
}
