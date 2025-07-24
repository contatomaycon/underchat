import { ESortOrder } from '@core/common/enums/ESortOrder';
import { SortItem, SortLister } from '../types';

export const sortHelpers = (sortBy: SortItem[], sorts: SortLister[]) => {
  const sortKey = sortBy.length ? sortBy[0].key : null;
  const sortOrder = sortBy.length ? sortBy[0].order : null;

  const sortsFind = sorts.find((s) => s.key === sortKey)?.value ?? null;

  return {
    sortBy: sortsFind,
    sortOrder: sortOrder === ESortOrder.asc ? ESortOrder.asc : ESortOrder.desc,
  };
};
