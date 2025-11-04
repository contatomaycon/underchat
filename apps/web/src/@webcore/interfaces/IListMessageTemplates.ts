import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListMessageTemplates {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  command?: string | null;
  message_status?: string | null;
  search?: string | null;
}
