import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListContact {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  nickname?: string | null;
  label_template?: string | null;
  search?: string | null;
}
