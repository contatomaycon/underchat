export const filterNavItemsByPlan = (
  items: any[],
  planIsActive: boolean,
  planProducts: string[] = []
): any[] => {
  const hasRequiredProducts = (item: any): boolean => {
    const requiredPlanProducts = item.requiredPlanProducts;
    if (
      !Array.isArray(requiredPlanProducts) ||
      requiredPlanProducts.length === 0
    ) {
      return true;
    }

    return requiredPlanProducts.every((productId) =>
      planProducts.includes(productId)
    );
  };

  const result: any[] = [];

  for (const item of items) {
    if (!hasRequiredProducts(item)) {
      continue;
    }

    const hasChildren = 'children' in item;

    if (hasChildren) {
      const children = filterNavItemsByPlan(
        item.children || [],
        planIsActive,
        planProducts
      );
      const keep =
        (planIsActive && children.length > 0) ||
        item.allowedWhenExpired === true;
      if (keep) {
        const clone = { ...item, children };
        result.push(clone);
      }
      continue;
    }

    if (planIsActive || item.allowedWhenExpired === true) {
      result.push(item);
    }
  }

  return result;
};
