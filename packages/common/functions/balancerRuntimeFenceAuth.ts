import { createHmac, timingSafeEqual } from 'node:crypto';

export const BALANCER_RUNTIME_FENCE_TOKEN_METADATA =
  'x-underchat-runtime-fence-token';
export const BALANCER_RUNTIME_FENCE_TOKEN_ENV =
  'BALANCER_GRPC_RUNTIME_FENCE_TOKEN';
const DEVELOPMENT_TOKEN = 'underchat-development-runtime-fence-v1';
const UNRESOLVED_SECRET = 'DEVTRON_SECRET_REQUIRED';
const DERIVATION_SECRET_ENV = 'CENTRIFUGO_HMAC_SECRET_KEY';
const DERIVATION_CONTEXT = 'underchat:balancer-grpc-runtime-fence:v1';
export const BALANCER_RUNTIME_FENCE_MINIMUM_TOKEN_BYTES = 32;

export function isUsableBalancerRuntimeFenceSecret(
  value: string | undefined,
  minimumBytes: number = BALANCER_RUNTIME_FENCE_MINIMUM_TOKEN_BYTES
): value is string {
  return (
    value !== undefined &&
    value !== UNRESOLVED_SECRET &&
    Buffer.byteLength(value, 'utf8') >= minimumBytes
  );
}

export function deriveBalancerRuntimeFenceToken(secret: string): string {
  return createHmac('sha256', secret)
    .update(DERIVATION_CONTEXT, 'utf8')
    .digest('base64url');
}

export function balancerRuntimeFenceToken(): string {
  const token = process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV]?.trim();
  if (isUsableBalancerRuntimeFenceSecret(token)) {
    return token;
  }

  const derivationSecret = process.env[DERIVATION_SECRET_ENV]?.trim();
  if (isUsableBalancerRuntimeFenceSecret(derivationSecret)) {
    return deriveBalancerRuntimeFenceToken(derivationSecret);
  }

  const production =
    process.env.NODE_ENV?.trim().toLowerCase() === 'production' ||
    process.env.APP_ENVIRONMENT?.trim().toLowerCase() === 'prod';

  if (production) {
    throw new Error(
      `${BALANCER_RUNTIME_FENCE_TOKEN_ENV} or ${DERIVATION_SECRET_ENV} must contain a production secret with at least ${BALANCER_RUNTIME_FENCE_MINIMUM_TOKEN_BYTES} bytes`
    );
  }

  return DEVELOPMENT_TOKEN;
}

export function isValidBalancerRuntimeFenceToken(
  candidate?: string | Buffer | null,
  expectedToken: string = balancerRuntimeFenceToken()
): boolean {
  const supplied = Buffer.isBuffer(candidate)
    ? candidate
    : Buffer.from(candidate?.trim() ?? '', 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');

  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
