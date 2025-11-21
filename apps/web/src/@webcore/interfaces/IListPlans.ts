import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListPlans {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  plan_id?: string | null;
  name?: string | null;
  price?: number | null;
  search?: string | null;
}
