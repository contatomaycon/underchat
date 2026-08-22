import { createHmac } from 'node:crypto';
import {
  BALANCER_RUNTIME_FENCE_MINIMUM_TOKEN_BYTES,
  BALANCER_RUNTIME_FENCE_TOKEN_ENV,
  balancerRuntimeFenceToken,
  deriveBalancerRuntimeFenceToken,
  isUsableBalancerRuntimeFenceSecret,
} from './balancerRuntimeFenceAuth';

const BALANCE_DERIVATION_SECRET_ENVS = [
  'CENTRIFUGO_HMAC_SECRET_KEY',
  'JWT_SECRET',
] as const;
const BALANCE_DERIVATION_MINIMUM_SECRET_BYTES = 16;
const WARM_CONTROL_DERIVATION_CONTEXT = 'underchat:balance-warm-control:v1';
const WARM_CONTROL_SECRET_ENV = 'JWT_SECRET';
const DEVELOPMENT_WARM_CONTROL_SECRET =
  'underchat-development-warm-control-authority-v1';
export const BALANCE_WARM_CONTROL_TOKEN_METADATA =
  'x-underchat-warm-control-token';

function explicitRuntimeFenceToken(): string | undefined {
  const explicitToken = process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV]?.trim();
  return isUsableBalancerRuntimeFenceSecret(
    explicitToken,
    BALANCER_RUNTIME_FENCE_MINIMUM_TOKEN_BYTES
  )
    ? explicitToken
    : undefined;
}

function balanceDerivationSecret(): string | undefined {
  for (const environmentKey of BALANCE_DERIVATION_SECRET_ENVS) {
    const secret = process.env[environmentKey]?.trim();
    if (
      isUsableBalancerRuntimeFenceSecret(
        secret,
        BALANCE_DERIVATION_MINIMUM_SECRET_BYTES
      )
    ) {
      return secret;
    }
  }

  return undefined;
}

function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV?.trim().toLowerCase() === 'production' ||
    process.env.APP_ENVIRONMENT?.trim().toLowerCase() === 'prod'
  );
}

/*
 * Control-plane-only resolver used by Balance and Service. Workers receive
 * only its domain-separated runtime HMAC output; credentials such as
 * JWT_SECRET never cross the container boundary.
 */
export function balanceRuntimeFenceToken(): string {
  const explicitToken = explicitRuntimeFenceToken();
  if (explicitToken) {
    return explicitToken;
  }

  const secret = balanceDerivationSecret();
  if (secret) {
    return deriveBalancerRuntimeFenceToken(secret);
  }

  /*
   * Preserve the deterministic development fallback and the production
   * fail-closed behavior from the worker-safe resolver.
   */
  return balancerRuntimeFenceToken();
}

/*
 * This credential authorizes warm-pool Docker mutations. It is intentionally
 * derived exclusively from an existing control-plane secret that is denied at
 * the worker container boundary. Runtime-fence and Centrifugo credentials are
 * deliberately not accepted here: workers receive both and could otherwise
 * derive warm control-plane authority themselves.
 */
export function balanceWarmControlToken(): string {
  const configuredSecret = process.env[WARM_CONTROL_SECRET_ENV]?.trim();
  const source = isUsableBalancerRuntimeFenceSecret(
    configuredSecret,
    BALANCE_DERIVATION_MINIMUM_SECRET_BYTES
  )
    ? configuredSecret
    : undefined;

  if (!source && isProductionEnvironment()) {
    throw new Error(
      `${WARM_CONTROL_SECRET_ENV} must contain an existing control-plane secret with at least ${BALANCE_DERIVATION_MINIMUM_SECRET_BYTES} bytes`
    );
  }

  return createHmac('sha256', source ?? DEVELOPMENT_WARM_CONTROL_SECRET)
    .update(WARM_CONTROL_DERIVATION_CONTEXT, 'utf8')
    .digest('base64url');
}
