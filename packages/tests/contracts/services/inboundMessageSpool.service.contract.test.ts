import 'reflect-metadata';
import { InboundMessageSpoolService } from '@core/services/inboundMessageSpool.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IInboundMessageSpoolPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';

function makePayload(): IInboundMessageSpoolPayload {
  return {
    provider: 'wwebjs',
    account_id: 'account-1',
    worker_id: 'worker-1',
    event_source: 'incoming_upsert',
    dedupe_key: 'message-key-1',
    kafka_topic: 'upsert-message',
    kafka_key: 'account-1:worker-1:5511999999999@s.whatsapp.net',
    upsert: {
      worker_id: 'worker-1',
      account_id: 'account-1',
      source_provider: 'wwebjs',
      type: EMessageType.text,
      message: {
        key: {
          id: 'message-key-1',
          remoteJid: '5511999999999@c.us',
          fromMe: false,
        },
        message: { conversation: 'hello' },
      },
      has_quoted: false,
    },
    received_at: new Date(0).toISOString(),
    attempts: 0,
  };
}

function makeRedis() {
  const streams = new Map<string, Map<string, string>>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  let nextId = 1;

  return {
    streams,
    hashes,
    zsets,
    xadd: jest.fn(
      async (stream: string, _id: string, field: string, value: string) => {
        const id = `${nextId++}-0`;
        const entries = streams.get(stream) ?? new Map<string, string>();
        entries.set(id, field === 'payload' ? value : '');
        streams.set(stream, entries);
        return id;
      }
    ),
    xdel: jest.fn(async (stream: string, id: string) => {
      streams.get(stream)?.delete(id);
      return 1;
    }),
    hset: jest.fn(async (key: string, field: string, value: string) => {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    }),
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      const zset = zsets.get(key) ?? new Map<string, number>();
      zset.set(member, score);
      zsets.set(key, zset);
      return 1;
    }),
  };
}

describe('InboundMessageSpoolService', () => {
  it('deletes the stream entry only after a successful publish', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const publisher = jest.fn(async () => undefined);

    await expect(service.publish(payload, publisher)).resolves.toBe(true);

    expect(publisher).toHaveBeenCalledWith(payload);
    expect(redis.xadd).toHaveBeenCalledWith(
      'inbound:message:wwebjs:worker-1:stream',
      '*',
      'payload',
      JSON.stringify(payload)
    );
    expect(redis.xdel).toHaveBeenCalledWith(
      'inbound:message:wwebjs:worker-1:stream',
      '1-0'
    );
    expect(
      redis.streams.get('inbound:message:wwebjs:worker-1:stream')?.size ?? 0
    ).toBe(0);
  });

  it('keeps the stream entry when publish fails', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const publisher = jest.fn(async () => {
      throw new Error('kafka down');
    });

    await expect(service.publish(payload, publisher)).resolves.toBe(false);

    expect(redis.xdel).not.toHaveBeenCalled();
    expect(
      redis.streams.get('inbound:message:wwebjs:worker-1:stream')?.size ?? 0
    ).toBe(1);
  });

  it('parks consumer failures in Redis without Kafka DLQ', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);

    await service.parkConsumerMessage({
      provider: 'message_upsert_consumer',
      worker_id: 'message-upsert',
      event_source: 'invalid_payload',
      reason: 'invalid_payload',
      stage: 'message_upsert.consume.invalid_payload',
      parked_at: new Date(0).toISOString(),
      kafka_topic: 'upsert-message',
      partition: 1,
      offset: 2,
      raw_payload: '{invalid',
    });

    expect(
      redis.hashes.get(
        'inbound:message:message_upsert_consumer:message-upsert:payloads'
      )?.size
    ).toBe(1);
    expect(
      redis.zsets.get(
        'inbound:message:message_upsert_consumer:message-upsert:parking'
      )?.size
    ).toBe(1);
  });
});
