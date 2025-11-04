import { SortRequest } from '@core/schema/common/sortRequestSchema';

export interface IListLabelTemplates {
  page?: number;
  per_page?: number;
  sort_by: SortRequest[];
  label?: string | null;
  label_status?: string | null;
  search?: string | null;
}
