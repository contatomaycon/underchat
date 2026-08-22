import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { MessageStatusService } from '@core/services/messageStatus.service';

describe('MessageStatusService worker scope and monotonicity', () => {
  const makeService = () => {
    const elasticDatabaseService = {
      select: jest.fn(async () => ({ hits: { hits: [] } })),
    };
    const service = new MessageStatusService(
      elasticDatabaseService as never,
      {} as never,
      {} as never,
      {} as never
    );

    return { elasticDatabaseService, service };
  };

  it('scopes equal WhatsApp message ids by account and worker', async () => {
    const { elasticDatabaseService, service } = makeService();

    await (service as any).findMessageByWhatsAppId(
      'account-1',
      'provider-message-1',
      undefined,
      'worker-2'
    );

    expect(elasticDatabaseService.select).toHaveBeenCalledWith(
      EElasticIndex.message,
      expect.objectContaining({
        query: {
          bool: {
            must: expect.arrayContaining([
              {
                bool: {
                  should: [
                    { term: { 'worker.id': 'worker-2' } },
                    { term: { 'worker.id.keyword': 'worker-2' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ]),
          },
        },
      })
    );
  });

  it('uses the same Kafka key for serialized and raw stanza ids', () => {
    expect(
      MessageStatusService.statusKafkaKey(
        'account-1',
        'true_5511999999999@s.whatsapp.net_physical-message-1',
        'worker-1'
      )
    ).toBe(
      MessageStatusService.statusKafkaKey(
        'account-1',
        'physical-message-1',
        'worker-1'
      )
    );
  });

  it('keeps sent below a definitive failure and delivered/read above it', () => {
    const { service } = makeService();
    const failedScript = (
      service as any
    ).buildMarkSummaryAsFailedScriptSource();
    const positiveScript = (service as any).buildMessageSummaryScriptSource();

    expect(failedScript).toContain("'sent': 2");
    expect(failedScript).toContain("'failed': 3");
    expect(failedScript).toContain("'delivered': 4");
    expect(failedScript).toContain('currentDeliveryRank > nextDeliveryRank');
    expect(positiveScript).toContain('nextDeliveryRank < currentDeliveryRank');
    expect(positiveScript).toContain('summary.is_sent_to_internal = true');
  });

  it('does not enqueue a Centrifugo retry after the assignment is revoked', async () => {
    const centrifugoService = {
      publishSubImmediate: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
    };
    const redis = {
      lpush: jest.fn(),
      ltrim: jest.fn(),
    };
    const service = new MessageStatusService(
      {} as never,
      centrifugoService as never,
      {} as never,
      redis as never
    );
    const assertActive = jest
      .fn<void, []>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new KafkaConsumerDispatchRevokedError();
      });
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: '019f661c-6ac3-75cc-8a4e-743b928ddb15' },
    };

    await expect(
      (service as any).publishCentrifugoImmediate(
        'account:account-1',
        message,
        'account-1',
        assertActive
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(centrifugoService.publishSubImmediate).toHaveBeenCalledTimes(1);
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('does not enqueue a durable Centrifugo retry for a guarded Kafka status', async () => {
    const centrifugoService = {
      publishSubImmediate: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
    };
    const redis = {
      lpush: jest.fn(),
      ltrim: jest.fn(),
    };
    const service = new MessageStatusService(
      {} as never,
      centrifugoService as never,
      {} as never,
      redis as never
    );
    const assertActive = jest.fn();
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    };

    await expect(
      (service as any).publishCentrifugoImmediate(
        'account:account-1',
        message,
        'account-1',
        assertActive
      )
    ).resolves.toBeUndefined();

    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('keeps the versioned retry queue for unguarded status callers', async () => {
    const centrifugoService = {
      publishSubImmediate: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
    };
    const redis = {
      lpush: jest.fn(async () => 1),
      ltrim: jest.fn(async () => 'OK'),
    };
    const service = new MessageStatusService(
      {} as never,
      centrifugoService as never,
      {} as never,
      redis as never
    );
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    };

    await (service as any).publishCentrifugoImmediate(
      'account:account-1',
      message,
      'account-1'
    );
    await Promise.resolve();

    expect(redis.lpush).toHaveBeenCalledWith(
      'centrifugo:status:retry:v2',
      expect.any(String)
    );
  });

  it('does not mutate the message when the assignment is revoked while preparing a delivery webhook', async () => {
    let active = true;
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => {
        active = false;
        return {
          eventId: 'event-1',
          created: true,
          state: 'preparing',
          envelope: {
            id: 'event-1',
            type: 'message.delivery.sent',
            occurred_at: '2026-07-16T12:00:00.000Z',
            account_id: 'account-1',
            aggregate: { type: 'message', id: 'message-1' },
            data: {},
            previous: null,
            source: 'message_status',
            context: {
              channel_ids: ['019f661c-6ac3-75cc-8a4e-743b928ddb15'],
            },
          },
        };
      }),
    };
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      outboundWebhookEventService as never
    );
    const updateSummaryAtomicallyWithLock = jest.fn();
    (service as any).updateSummaryAtomicallyWithLock =
      updateSummaryAtomicallyWithLock;
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      type_user: 'operator',
      account: { id: 'account-1' },
      worker: { id: '019f661c-6ac3-75cc-8a4e-743b928ddb15' },
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      message_key: { from_me: true },
    };

    await expect(
      (service as any).applySummaryPatchToMessage(
        'account-1',
        'provider-message-1',
        message,
        { is_sent: true },
        'worker-1',
        assertActive
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(updateSummaryAtomicallyWithLock).not.toHaveBeenCalled();
  });

  it('does not retry lock acquisition after revocation during backoff', async () => {
    jest.useFakeTimers();
    try {
      let active = true;
      const elasticDatabaseService = {
        updateWithScriptOCC: jest.fn(),
      };
      const redis = {
        set: jest.fn(async () => null),
        del: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
      };
      const service = new MessageStatusService(
        elasticDatabaseService as never,
        {} as never,
        {} as never,
        redis as never
      );
      const assertActive = jest.fn(() => {
        if (!active) {
          throw new KafkaConsumerDispatchRevokedError();
        }
      });

      const updatePromise = (service as any).updateSummaryAtomicallyWithLock(
        'message-1',
        {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
        { is_sent: true },
        3,
        [],
        assertActive
      );

      await jest.advanceTimersByTimeAsync(0);
      expect(redis.set).toHaveBeenCalledTimes(1);

      const rejectedUpdate = expect(updatePromise).rejects.toBeInstanceOf(
        KafkaConsumerDispatchRevokedError
      );
      active = false;
      await jest.advanceTimersByTimeAsync(100);

      await rejectedUpdate;
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('owns the distributed status lock with a UUID and releases by compare-and-delete', async () => {
    const redis = {
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      redis as never
    );
    (service as any).updateSummaryAtomicallyWithRetry = jest
      .fn()
      .mockResolvedValue('updated');

    await expect(
      (service as any).updateSummaryAtomicallyWithLock(
        'message-1',
        {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
        { is_sent: true },
        1
      )
    ).resolves.toBe('updated');

    expect(redis.set).toHaveBeenCalledWith(
      'lock:update-status:message-1',
      expect.any(String),
      'PX',
      30_000,
      'NX'
    );
    const lockToken = (redis.set.mock.calls[0] as unknown[])[1];
    expect(lockToken).not.toBe('1');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'lock:update-status:message-1',
      lockToken
    );
  });

  it('aborts the old lock holder after a compare-and-extend lease loss', async () => {
    jest.useFakeTimers();
    try {
      const redis = {
        set: jest.fn(async () => 'OK'),
        eval: jest.fn(async (script: string) =>
          script.includes('PEXPIRE') ? 0 : 1
        ),
      };
      const service = new MessageStatusService(
        {} as never,
        {} as never,
        {} as never,
        redis as never
      );
      (service as any).lockTtlSeconds = 0.03;
      let releaseOperation!: () => void;
      const blocked = new Promise<void>((resolve) => {
        releaseOperation = resolve;
      });
      const downstreamEffect = jest.fn();
      const mutation = (service as any).withStatusMutationLock(
        'message-1',
        1,
        async (assertLeaseActive: () => Promise<void>) => {
          await blocked;
          await assertLeaseActive();
          downstreamEffect();
          return 'updated';
        }
      );

      await jest.advanceTimersByTimeAsync(10);
      releaseOperation();

      await expect(mutation).rejects.toMatchObject({
        name: 'MessageStatusMutationLeaseLostError',
      });
      expect(downstreamEffect).not.toHaveBeenCalled();
      expect(redis.eval.mock.calls[0][0]).toEqual(
        expect.stringContaining('PEXPIRE')
      );
      expect(redis.eval.mock.calls.at(-1)?.[0]).toEqual(
        expect.stringContaining("redis.call('DEL'")
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not issue another OCC mutation after revocation during retry backoff', async () => {
    jest.useFakeTimers();
    try {
      let active = true;
      const elasticDatabaseService = {
        updateWithScriptOCC: jest.fn(async () => 'conflict'),
        view: jest.fn(),
      };
      const service = new MessageStatusService(
        elasticDatabaseService as never,
        {} as never,
        {} as never,
        {} as never
      );
      const assertActive = jest.fn(() => {
        if (!active) {
          throw new KafkaConsumerDispatchRevokedError();
        }
      });

      const updatePromise = (service as any).updateSummaryAtomicallyWithRetry(
        'message-1',
        {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
        { is_sent: true },
        3,
        [],
        assertActive
      );

      await jest.advanceTimersByTimeAsync(0);
      expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(
        1
      );

      const rejectedUpdate = expect(updatePromise).rejects.toBeInstanceOf(
        KafkaConsumerDispatchRevokedError
      );
      active = false;
      await jest.advanceTimersByTimeAsync(100);

      await rejectedUpdate;
      expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(
        1
      );
      expect(elasticDatabaseService.view).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes the assignment guard into the failure OCC route', async () => {
    let active = true;
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn(
        async (...args: Array<Record<string, unknown>>) => {
          const options = args[3] as {
            assertActive?: () => void | Promise<void>;
          };
          expect(options.assertActive).toBe(assertActive);
          active = false;
          await options.assertActive?.();
          return 'updated';
        }
      ),
    };
    const service = new MessageStatusService(
      elasticDatabaseService as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      (service as any).markSummaryAsFailedAtomically(
        'message-1',
        [],
        'failed',
        undefined,
        assertActive
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
  });
});
