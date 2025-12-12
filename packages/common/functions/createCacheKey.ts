function joinParts(parts: string[]): string {
  const filteredParts = parts.filter(Boolean);

  if (!filteredParts.length) {
    throw new Error('invalid cache key parts');
  }

  return filteredParts.join(':');
}

export function createJwtCacheKey(
  accountId: string,
  userId: string,
  routeModule: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  if (!routeModule) {
    throw new Error('route module is required');
  }

  const encodedRouteModule = encodeURIComponent(routeModule);
  return joinParts(['jwtCache', accountId, userId, encodedRouteModule]);
}

export function createKeyApiCacheKey(
  keyApi: string,
  routeModule: string
): string {
  if (!keyApi) {
    throw new Error('key api is required');
  }

  if (!routeModule) {
    throw new Error('route module is required');
  }

  const encodedRouteModule = encodeURIComponent(routeModule);
  return joinParts(['keyCache', keyApi, encodedRouteModule]);
}
