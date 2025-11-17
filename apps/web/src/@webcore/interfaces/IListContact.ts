import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListContact {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  search?: string | null;
}
