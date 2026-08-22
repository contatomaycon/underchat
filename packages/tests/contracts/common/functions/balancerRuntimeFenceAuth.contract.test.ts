import {
  BALANCER_RUNTIME_FENCE_TOKEN_ENV,
  balancerRuntimeFenceToken,
  isValidBalancerRuntimeFenceToken,
} from '@core/common/functions/balancerRuntimeFenceAuth';

describe('balancer runtime fence authentication', () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousAppEnvironment = process.env.APP_ENVIRONMENT;
  const previousToken = process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV];
  const previousCentrifugoSecret = process.env.CENTRIFUGO_HMAC_SECRET_KEY;

  afterEach(() => {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousAppEnvironment === undefined)
      delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = previousAppEnvironment;
    if (previousToken === undefined)
      delete process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV];
    else process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = previousToken;
    if (previousCentrifugoSecret === undefined)
      delete process.env.CENTRIFUGO_HMAC_SECRET_KEY;
    else process.env.CENTRIFUGO_HMAC_SECRET_KEY = previousCentrifugoSecret;
  });

  it('fails startup closed when both production credential sources are unavailable', () => {
    process.env.NODE_ENV = 'production';
    delete process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV];
    delete process.env.CENTRIFUGO_HMAC_SECRET_KEY;
    expect(() => balancerRuntimeFenceToken()).toThrow(
      BALANCER_RUNTIME_FENCE_TOKEN_ENV
    );

    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = 'DEVTRON_SECRET_REQUIRED';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY = 'DEVTRON_SECRET_REQUIRED';
    expect(() => balancerRuntimeFenceToken()).toThrow(
      'CENTRIFUGO_HMAC_SECRET_KEY'
    );
  });

  it('derives a domain-separated production token from the existing Centrifugo secret', () => {
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = 'DEVTRON_SECRET_REQUIRED';
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'centrifugo-hmac-secret-used-only-by-contract-tests-2026';

    const token = balancerRuntimeFenceToken();

    expect(token).toBe('3uY-FkuJzsSUbEu2-Tai9ANUD-C4i8br9QLSKICGiGI');
    expect(token).not.toBe(process.env.CENTRIFUGO_HMAC_SECRET_KEY);
    expect(Buffer.byteLength(token, 'utf8')).toBeGreaterThanOrEqual(32);
    expect(balancerRuntimeFenceToken()).toBe(token);
  });

  it('prefers an explicit valid token over the derivation source', () => {
    const token = 'a-production-grade-runtime-fence-secret-1234';
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = token;
    process.env.CENTRIFUGO_HMAC_SECRET_KEY =
      'centrifugo-hmac-secret-used-only-by-contract-tests-2026';

    expect(balancerRuntimeFenceToken()).toBe(token);
  });

  it('compares the supplied metadata token in constant time', () => {
    const token = 'a-production-grade-runtime-fence-secret-1234';
    process.env.NODE_ENV = 'production';
    process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV] = token;

    expect(isValidBalancerRuntimeFenceToken(token, token)).toBe(true);
    expect(isValidBalancerRuntimeFenceToken(Buffer.from(token), token)).toBe(
      true
    );
    expect(isValidBalancerRuntimeFenceToken('wrong-token', token)).toBe(false);
    expect(isValidBalancerRuntimeFenceToken(undefined, token)).toBe(false);
  });

  it('uses a deterministic local-only fallback outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.APP_ENVIRONMENT;
    delete process.env[BALANCER_RUNTIME_FENCE_TOKEN_ENV];
    delete process.env.CENTRIFUGO_HMAC_SECRET_KEY;

    expect(balancerRuntimeFenceToken()).toBe(
      'underchat-development-runtime-fence-v1'
    );
  });
});
