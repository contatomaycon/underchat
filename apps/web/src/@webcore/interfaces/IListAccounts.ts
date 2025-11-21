import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListAccounts {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  name?: string | null;
  account_status?: string | null;
  plan?: string | null;
  search?: string | null;
}
