import { setPaginationData } from '@core/common/functions/createPaginationData';

describe('setPaginationData', () => {
  it('builds paging payload with calculated total pages', () => {
    expect(setPaginationData(10, 101, 10, 2)).toEqual({
      current_page: 2,
      total_pages: 11,
      per_page: 10,
      count: 10,
      total: 101,
    });
  });

  it('returns zero total pages when total is zero', () => {
    expect(setPaginationData(0, 0, 10, 1)).toEqual({
      current_page: 1,
      total_pages: 0,
      per_page: 10,
      count: 0,
      total: 0,
    });
  });
});
