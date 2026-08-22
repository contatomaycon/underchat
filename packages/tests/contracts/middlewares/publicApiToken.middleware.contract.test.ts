import 'reflect-metadata';
import { consumePublicApiRateLimit } from '@core/middlewares/publicApiToken.middleware';

describe('public API token rate limit contract', () => {
  it('uses only the token hash in Redis and exposes the remaining quota', async () => {
    const evalMock = jest.fn(async () => [1, 60]);
    const result = await consumePublicApiRateLimit(
      { eval: evalMock } as never,
      'a'.repeat(64),
      120
    );

    expect(result).toEqual(
      expect.objectContaining({
        allowed: true,
        limit: 120,
        remaining: 119,
        retryAfter: 60,
      })
    );
    expect(evalMock.mock.calls[0]).toEqual(
      expect.arrayContaining([1, `public-api:rate-limit:${'a'.repeat(64)}`, 60])
    );
  });

  it('rejects request 121 and returns no remaining quota', async () => {
    const result = await consumePublicApiRateLimit(
      { eval: jest.fn(async () => [121, 17]) } as never,
      'b'.repeat(64),
      120
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBe(17);
  });
});
