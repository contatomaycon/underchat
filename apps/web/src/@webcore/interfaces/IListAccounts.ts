import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';

export interface IListAccounts {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  account_id?: string | null;
  name?: string | null;
  account_status?: string | null;
  plan?: string | null;
  search?: string | null;
  filter_status?: EAccountFilterStatus | null;
}
