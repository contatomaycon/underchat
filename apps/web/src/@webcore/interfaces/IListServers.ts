import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListServers {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  status?: number | null;
  search?: string | null;
}
