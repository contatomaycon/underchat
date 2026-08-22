import { createHmac } from 'node:crypto';
import { balanceWarmControlToken } from './balanceRuntimeFenceCredential';

const WORKER_PROXY_FINGERPRINT_CONTEXT =
  'underchat:worker-proxy-fingerprint:v1';

export interface WorkerProxyFingerprintInput {
  protocol?: string | null;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export function workerProxyFingerprint(
  proxy?: WorkerProxyFingerprintInput
): string {
  const normalized = proxy
    ? JSON.stringify({
        protocol: proxy.protocol?.trim().toLowerCase() || 'http',
        host: proxy.host.trim().toLowerCase(),
        port: proxy.port,
        username: proxy.username ?? '',
        password: proxy.password ?? '',
      })
    : 'direct';

  return createHmac('sha256', balanceWarmControlToken())
    .update(WORKER_PROXY_FINGERPRINT_CONTEXT, 'utf8')
    .update('\0', 'utf8')
    .update(normalized, 'utf8')
    .digest('base64url');
}
