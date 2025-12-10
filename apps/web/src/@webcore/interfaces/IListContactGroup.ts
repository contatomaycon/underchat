import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListContactGroup {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  search?: string | null;
}
