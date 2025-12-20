import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListSchedules {
  page?: number;
  per_page?: number;
  sort_by?: SortRequest[];
  search?: string;
}
