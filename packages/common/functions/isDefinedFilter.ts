import { SQLWrapper } from 'drizzle-orm';

export function isDefinedFilter(
  condition: SQLWrapper | undefined
): condition is SQLWrapper {
  return condition !== undefined;
}
