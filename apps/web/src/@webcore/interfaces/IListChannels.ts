import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListChannels {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  status?: string | null;
  type?: string | null;
  search?: string | null;
}
