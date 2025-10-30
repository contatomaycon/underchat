export function createCacheKey(
  nameCache: string,
  idCache: string | string[] | undefined,
  paramsCache?: string
): string {
  if (!idCache) {
    throw new Error('id is required');
  }

  const idCacheKey = Array.isArray(idCache) ? idCache[0] : idCache;

  let cacheKey = `${nameCache}:${idCacheKey}`;

  if (paramsCache) {
    const encodedparamsCache = encodeURIComponent(paramsCache);
    cacheKey += `:${encodedparamsCache}`;
  }

  return cacheKey;
}
