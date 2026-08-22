import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  centrifugoEnvironment: {
    centrifugoHttpApiUrl: 'http://centrifugo.test/api',
    centrifugoHttpApiKey: 'test-key',
    centrifugoHmacSecretKey: 'test-secret',
    centrifugoWsUrl: 'ws://centrifugo.test',
  },
}));

import { State } from 'centrifuge';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { CentrifugoService } from '@core/services/centrifugo.service';

async function flushPromises(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('CentrifugoService assignment fencing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function makeService(): CentrifugoService {
    return new CentrifugoService({
      state: State.Connected,
    } as never);
  }

  it('drops a rate-limited publication when its assignment is revoked before the HTTP boundary', async () => {
    const service = makeService();
    (service as any).tokenBucket = 0;
    (service as any).lastTokenRefill = Date.now();
    let active = true;
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    const publication = service.publishSub(
      'chat#account-1',
      { id: 'message-1' },
      assertActive
    );
    const rejectedPublication = expect(publication).rejects.toBeInstanceOf(
      KafkaConsumerDispatchRevokedError
    );
    await flushPromises();
    expect(service.getQueueStats().queueSize).toBe(1);

    active = false;
    await jest.advanceTimersByTimeAsync(25);

    await rejectedPublication;
    expect(globalThis.fetch).not.toHaveBeenCalled();
    service.cleanup();
  });

  it('does not retry an immediate publication after the assignment is revoked', async () => {
    const service = makeService();
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response('unavailable', { status: 503 });
    });
    let guardCalls = 0;
    const assertActive = jest.fn(() => {
      guardCalls += 1;
      if (guardCalls >= 4) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    const publication = service.publishSubImmediate(
      'chat#account-1',
      { id: 'message-1' },
      assertActive
    );
    const rejectedPublication = expect(publication).rejects.toBeInstanceOf(
      KafkaConsumerDispatchRevokedError
    );
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(300);

    await rejectedPublication;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('retries with one idempotency key and rejects a fenced publication that cannot be confirmed', async () => {
    const service = makeService();
    const assertActive = jest.fn();
    (globalThis.fetch as jest.Mock).mockImplementation(async () => {
      return new Response('unavailable', { status: 503 });
    });

    const publication = service.publishSub(
      'chat#account-1',
      { id: 'message-observable-failure' },
      assertActive
    );
    const rejectedPublication = expect(publication).rejects.toThrow(
      'Centrifugo HTTP API error: 503'
    );

    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(600);
    await rejectedPublication;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    const idempotencyKeys = (globalThis.fetch as jest.Mock).mock.calls.map(
      ([, init]) => {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          params: { idempotency_key?: string };
        };
        return body.params.idempotency_key;
      }
    );
    expect(idempotencyKeys.every(Boolean)).toBe(true);
    expect(new Set(idempotencyKeys).size).toBe(1);

    // A failed attempt must not poison the short duplicate cache. The same
    // logical event can be published again after a delayed Kafka redelivery.
    // Its Centrifugo key stays stable beyond the local 2-second cache window.
    await jest.advanceTimersByTimeAsync(2_500);
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(
      service.publishSub(
        'chat#account-1',
        { id: 'message-observable-failure' },
        assertActive
      )
    ).resolves.toEqual({});
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    const redeliveryBody = JSON.parse(
      String((globalThis.fetch as jest.Mock).mock.calls[3][1].body)
    ) as { params: { idempotency_key?: string } };
    expect(redeliveryBody.params.idempotency_key).toBe(idempotencyKeys[0]);
    service.cleanup();
  });

  it('keeps non-fenced callers best-effort while logging terminal failure', async () => {
    const service = makeService();
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response('invalid request', { status: 400 });
    });

    await expect(
      service.publishSub('chat#account-1', { id: 'message-best-effort' })
    ).resolves.toEqual({});

    expect(console.error).toHaveBeenCalledWith(
      '[CentrifugoService] best_effort_publish_failed',
      expect.objectContaining({
        operation: 'publishSub',
        channel: 'chat#account-1',
        error: expect.stringContaining('400'),
      })
    );
    service.cleanup();
  });

  it('propagates a terminal failure for strict publications', async () => {
    const service = makeService();
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response('invalid request', { status: 400 });
    });

    await expect(
      service.publishStrict('channels:config', { id: 'strict-failure' })
    ).rejects.toThrow('Centrifugo HTTP API error: 400');

    expect(console.error).not.toHaveBeenCalledWith(
      '[CentrifugoService] best_effort_publish_failed',
      expect.anything()
    );
    service.cleanup();
  });

  it('confirms successful strict publications', async () => {
    const service = makeService();

    await expect(
      service.publishSubStrict('chat#account-1', {
        id: 'strict-success',
      })
    ).resolves.toEqual({});

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('never queues a strict publication behind the best-effort rate limiter', async () => {
    const service = makeService();
    (service as any).tokenBucket = 0;
    (service as any).lastTokenRefill = Date.now();

    await expect(
      service.publishStrict('channels:config', { id: 'strict-direct' })
    ).resolves.toEqual({});

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(service.getQueueStats().queueSize).toBe(0);
    service.cleanup();
  });

  it('does not wait for distributed duplicate-cache I/O on strict publications', async () => {
    const service = makeService();
    const duplicateRead = jest.fn(() => new Promise<boolean>(() => {}));
    const cacheWrite = jest.fn(() => new Promise<void>(() => {}));
    (service as any).isDuplicatePublish = duplicateRead;
    (service as any).cachePublish = cacheWrite;

    await expect(
      service.publishStrict('channels:config', { id: 'strict-no-redis' })
    ).resolves.toEqual({});

    expect(duplicateRead).not.toHaveBeenCalled();
    expect(cacheWrite).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('uses only the local circuit breaker for lease-bound strict publications', async () => {
    const service = makeService();
    const distributedCircuitRead = jest.fn(
      () => new Promise<boolean>(() => {})
    );
    const distributedCircuitSuccess = jest.fn(
      () => new Promise<void>(() => {})
    );
    (service as any).isCircuitOpen = distributedCircuitRead;
    (service as any).recordCircuitSuccess = distributedCircuitSuccess;

    await expect(
      service.publishStrict('channels:config', { id: 'strict-local-circuit' })
    ).resolves.toEqual({});

    expect(distributedCircuitRead).not.toHaveBeenCalled();
    expect(distributedCircuitSuccess).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('rejects strict HTTP failures without waiting for distributed circuit I/O', async () => {
    const service = makeService();
    const distributedCircuitFailure = jest.fn(
      () => new Promise<void>(() => {})
    );
    (service as any).recordCircuitFailure = distributedCircuitFailure;
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response('invalid request', { status: 400 });
    });

    await expect(
      service.publishStrict('channels:config', {
        id: 'strict-local-circuit-failure',
      })
    ).rejects.toThrow('Centrifugo HTTP API error: 400');

    expect(distributedCircuitFailure).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('keeps one idempotency key after a lost response and durable redelivery', async () => {
    const service = makeService();
    const payload = { id: 'strict-response-lost' };
    (globalThis.fetch as jest.Mock).mockImplementation(async () => {
      throw new TypeError('response lost after request write');
    });

    const firstPublication = service.publishSubStrict(
      'chat#account-1',
      payload
    );
    const rejectedPublication = expect(firstPublication).rejects.toThrow(
      'Centrifugo HTTP API connection error'
    );

    await flushPromises();
    await rejectedPublication;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const firstAttemptKeys = (globalThis.fetch as jest.Mock).mock.calls.map(
      ([, init]) => {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          params: { idempotency_key?: string };
        };
        return body.params.idempotency_key;
      }
    );
    expect(firstAttemptKeys.every(Boolean)).toBe(true);
    expect(new Set(firstAttemptKeys).size).toBe(1);

    await jest.advanceTimersByTimeAsync(2_500);
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      service.publishSubStrict('chat#account-1', payload)
    ).resolves.toEqual({});
    const redeliveryBody = JSON.parse(
      String((globalThis.fetch as jest.Mock).mock.calls[1][1].body)
    ) as { params: { idempotency_key?: string } };
    expect(redeliveryBody.params.idempotency_key).toBe(firstAttemptKeys[0]);
    service.cleanup();
  });

  it('applies failure policy to invalid subscriber channels', async () => {
    const service = makeService();

    await expect(
      service.publishSub('chat:missing-user-limit', { id: 'message-1' })
    ).resolves.toEqual({});
    await expect(
      service.publishSub(
        'chat:missing-user-limit',
        { id: 'message-1' },
        jest.fn()
      )
    ).rejects.toThrow('Invalid channel format for publishSub');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    service.cleanup();
  });

  it('coalesces simultaneous local publications of the same event', async () => {
    const service = makeService();
    const payload = { message: { id: 'message-1', text: 'hello' } };

    await expect(
      Promise.all([
        service.publishSub('chat#account-1', payload),
        service.publishSub('chat#account-1', payload),
      ])
    ).resolves.toEqual([{}, {}]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    service.cleanup();
  });

  it('does not collapse distinct nested publication payloads', async () => {
    const service = makeService();

    await service.publishSub('chat#account-1', {
      message: { id: 'message-1', text: 'first' },
    });
    await service.publishSub('chat#account-1', {
      message: { id: 'message-2', text: 'second' },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    service.cleanup();
  });
});
