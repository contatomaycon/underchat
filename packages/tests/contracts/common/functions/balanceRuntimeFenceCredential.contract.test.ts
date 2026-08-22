import { BALANCER_RUNTIME_FENCE_TOKEN_ENV } from '@core/common/functions/balancerRuntimeFenceAuth';
import {
  balanceRuntimeFenceToken,
  balanceWarmControlToken,
} from '@core/common/functions/balanceRuntimeFenceCredential';
import {
  classifyWorkerContainerEnvironmentKey,
  isInheritedWorkerEnvironmentKeyAllowed,
} from '@core/common/functions/workerContainerEnvironmentPolicy';

const credentialKeys = [
  BALANCER_RUNTIME_FENCE_TOKEN_ENV,
  'CENTRIFUGO_HMAC_SECRET_KEY',
  'JWT_SECRET',
] as const;

describe('Balance runtime-fence credential resolution', () => {
  const previousEnvironment = new Map(
    credentialKeys.map((key) => [key, process.env[key]])
  );
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousAppEnvironment = process.env.APP_ENVIRONMENT;

  afterEach(() => {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousAppEnvironment === undefined)
      delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = previousAppEnvironment;
  });

  it('derives from the existing Balance JWT secret when explicit and Centrifugo credentials are unresolved', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = 'DEVTRON_SECRET_REQUIRED';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY = 'DEVTRON_SECRET_REQUIRED';
    process.env.JWT_SECRET =
      'existing-balance-jwt-secret-used-only-by-contract-tests';

    const token = balanceRuntimeFenceToken();

    expect(token).toHaveLength(43);
    expect(token).not.toBe(process.env.JWT_SECRET);
    expect(balanceRuntimeFenceToken()).toBe(token);
  });

  it('prefers the existing Centrifugo secret over the Balance-only fallback', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = 'DEVTRON_SECRET_REQUIRED';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'centrifugo-hmac-secret-used-only-by-contract-tests-2026';
    process.env.JWT_SECRET =
      'existing-balance-jwt-secret-used-only-by-contract-tests';

    expect(balanceRuntimeFenceToken()).toBe(
      '3uY-FkuJzsSUbEu2-Tai9ANUD-C4i8br9QLSKICGiGI'
    );
  });

  it('derives warm control authority exclusively from the worker-denied JWT secret', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] =
      'runtime-fence-token-visible-to-workers-2026';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'centrifugo-hmac-secret-used-only-by-contract-tests-2026';
    process.env.JWT_SECRET =
      'existing-balance-jwt-secret-used-only-by-contract-tests';

    const runtimeToken = balanceRuntimeFenceToken();
    const warmControlToken = balanceWarmControlToken();

    expect(warmControlToken).toHaveLength(43);
    expect(warmControlToken).not.toBe(runtimeToken);
    expect(warmControlToken).not.toBe(process.env.CENTRIFUGO_HMAC_SECRET_KEY);

    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] =
      'another-runtime-fence-token-visible-to-workers-2026';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'another-centrifugo-secret-visible-to-workers-in-tests';

    expect(balanceRuntimeFenceToken()).not.toBe(runtimeToken);
    expect(balanceWarmControlToken()).toBe(warmControlToken);

    process.env.JWT_SECRET =
      'another-existing-balance-jwt-secret-used-by-tests';
    expect(balanceWarmControlToken()).not.toBe(warmControlToken);
  });

  it('rejects worker-visible credentials as warm authority in production', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] =
      'runtime-fence-token-visible-to-workers-2026';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'centrifugo-hmac-secret-visible-to-workers-in-tests-2026';
    delete process.env.JWT_SECRET;

    expect(() => balanceWarmControlToken()).toThrow('JWT_SECRET');
  });

  it('keeps the warm authority source outside the worker environment contract', () => {
    expect(isInheritedWorkerEnvironmentKeyAllowed('JWT_SECRET')).toBe(false);
    expect(classifyWorkerContainerEnvironmentKey('JWT_SECRET')).toBe(
      'intentionally_denied'
    );
  });

  it('uses a deterministic non-production fallback without a new environment variable', () => {
    process.env.NODE_ENV = 'development';
    delete process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV];
    delete process.env.CENTRIFUGO_HMAC_SECRET_KEY;
    delete process.env.JWT_SECRET;

    const token = balanceWarmControlToken();

    expect(token).toHaveLength(43);
    expect(balanceWarmControlToken()).toBe(token);
  });

  it('fails closed in production when no existing credential can safely derive a token', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = 'DEVTRON_SECRET_REQUIRED';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY = 'DEVTRON_SECRET_REQUIRED';
    process.env.JWT_SECRET = 'short';

    expect(() => balanceRuntimeFenceToken()).toThrow(
      BALANCER_RUNTIME_FENCE_TOKEN_ENV
    );
  });
});
