import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListUsers {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  user_status?: string | null;
  username?: string | null;
  email_partial?: string | null;
  document_partial?: string | null;
  phone_partial?: string | null;
  search?: string | null;
}
