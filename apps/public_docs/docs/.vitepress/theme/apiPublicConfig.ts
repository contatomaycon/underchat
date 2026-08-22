const LOCAL_API_ORIGIN = 'http://localhost:3001';

export const resolvePublicApiOrigin = (value?: string): string => {
  const configuredValue = value?.trim();
  if (!configuredValue && import.meta.env.PROD) {
    throw new Error(
      'VITE_API_PUBLIC_URL is required when building the public documentation'
    );
  }

  const parsed = new URL(configuredValue || LOCAL_API_ORIGIN);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const isLocalHostname =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'VITE_API_PUBLIC_URL must be an HTTP(S) origin without credentials, path, query, or fragment'
    );
  }
  if (
    import.meta.env.PROD &&
    (parsed.protocol !== 'https:' || isLocalHostname)
  ) {
    throw new Error(
      'VITE_API_PUBLIC_URL must be a public HTTPS origin in production'
    );
  }

  return parsed.origin;
};

export const publicApiOrigin = resolvePublicApiOrigin(
  import.meta.env.VITE_API_PUBLIC_URL
);
