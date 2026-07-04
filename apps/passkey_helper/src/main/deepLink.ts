import { createHash } from 'node:crypto';

export const PASSKEY_PROTOCOL = 'underchat-passkey';
export const DEV_MANAGER_API_URL = 'http://localhost:3002/v1';
export const PROD_MANAGER_API_URL = 'https://api-manager.underchat.com.br/v1';
export const DEFAULT_MANAGER_API_URL =
  import.meta.env.MAIN_VITE_UNDERCHAT_MANAGER_API_URL?.trim() ||
  (import.meta.env.DEV ? DEV_MANAGER_API_URL : PROD_MANAGER_API_URL);

export interface PasskeyDeepLinkContext {
  apiBaseUrl: string;
  mode: 'pair' | 'secure';
  token: string;
  tokenHash: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function parsePasskeyDeepLink(rawUrl: string): PasskeyDeepLinkContext {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Link de passkey invalido.');
  }

  if (parsed.protocol !== `${PASSKEY_PROTOCOL}:`) {
    throw new Error('Protocolo de passkey invalido.');
  }

  if (parsed.hostname !== 'pair' && parsed.hostname !== 'secure') {
    throw new Error('Acao de passkey invalida.');
  }

  const token = parsed.searchParams.get('token')?.trim();
  const apiBaseUrl = normalizeApiBaseUrl(parsed.searchParams.get('api'));

  if (!token || token.length < 16 || token.length > 512) {
    throw new Error('Token de passkey invalido.');
  }

  return {
    apiBaseUrl,
    mode: parsed.hostname === 'secure' ? 'secure' : 'pair',
    token,
    tokenHash: hashToken(token),
  };
}

export function normalizeApiBaseUrl(rawApi: string | null): string {
  const apiValue = rawApi?.trim() || DEFAULT_MANAGER_API_URL;

  let apiUrl: URL;

  try {
    apiUrl = new URL(apiValue);
  } catch {
    throw new Error('API da Underchat invalida.');
  }

  const isHttps = apiUrl.protocol === 'https:';
  const isLocalHttp =
    apiUrl.protocol === 'http:' && LOOPBACK_HOSTS.has(apiUrl.hostname);

  if (!isHttps && !isLocalHttp) {
    throw new Error(
      'A API precisa usar HTTPS. HTTP so e permitido em localhost.'
    );
  }

  apiUrl.hash = '';
  apiUrl.search = '';
  apiUrl.pathname = apiUrl.pathname.replace(/\/+$/, '');

  return apiUrl.toString().replace(/\/+$/, '');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function extractDeepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith(`${PASSKEY_PROTOCOL}://`)) {
      return arg;
    }

    if (arg.startsWith('--deep-link=')) {
      const value = arg.slice('--deep-link='.length);

      if (value.startsWith(`${PASSKEY_PROTOCOL}://`)) {
        return value;
      }
    }
  }

  return null;
}

export function isAllowedHttpApiUrl(
  rawUrl: string,
  apiBaseUrl: string
): boolean {
  let target: URL;
  let api: URL;

  try {
    target = new URL(rawUrl);
    api = new URL(apiBaseUrl);
  } catch {
    return false;
  }

  const apiPath = api.pathname.replace(/\/+$/, '');
  const targetPath =
    apiPath && target.pathname.startsWith(`${apiPath}/`)
      ? target.pathname.slice(apiPath.length)
      : target.pathname;

  return (
    target.origin === api.origin &&
    (targetPath.startsWith('/worker/connection/passkey-helper/') ||
      targetPath.startsWith('/worker/connection/secure-helper/'))
  );
}

export function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Erro inesperado no helper de passkey.';
}
