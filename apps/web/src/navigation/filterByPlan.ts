export const filterNavItemsByPlan = (
  items: any[],
  planIsActive: boolean
): any[] => {
  if (planIsActive) return items;

  const result: any[] = [];

  items.forEach((item) => {
    const hasChildren = 'children' in item;

    if (hasChildren) {
      const children = filterNavItemsByPlan(item.children || [], planIsActive);
      const keep = children.length > 0 || item.allowedWhenExpired === true;
      if (keep) {
        const clone = { ...item, children };
        result.push(clone);
      }
      return;
    }

    if (item.allowedWhenExpired === true) {
      result.push(item);
    }
  });

  return result;
};
