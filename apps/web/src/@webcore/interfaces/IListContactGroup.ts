import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListContactGroup {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  name?: string | null;
  description?: string | null;
  search?: string | null;
}
