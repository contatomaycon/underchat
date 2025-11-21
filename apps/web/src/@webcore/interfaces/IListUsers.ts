import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListUsers {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  user_status?: string | null;
  search?: string | null;
}
