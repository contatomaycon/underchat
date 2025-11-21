import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListSectors {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  name?: string | null;
  sector_status?: string | null;
  color?: string | null;
  search?: string | null;
}
