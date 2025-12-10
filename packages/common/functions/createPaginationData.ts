import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export function setPaginationData(
  count: number,
  total: number,
  perPage: number,
  currentPage: number
): PagingResponseSchema {
  return {
    current_page: currentPage,
    total_pages: Math.ceil(total / perPage),
    per_page: perPage,
    count,
    total,
  };
}
