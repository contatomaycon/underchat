import 'reflect-metadata';
import {
  InboundMessageSpoolService,
  ObsoleteInboundMessageSpoolPayloadError,
} from '@core/services/inboundMessageSpool.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  IInboundMessageParkingPayload,
  IInboundMessageSpoolPayload,
} from '@core/common/interfaces/IInboundMessageSpoolPayload';

function makePayload(
  overrides: Partial<IInboundMessageSpoolPayload> = {}
): IInboundMessageSpoolPayload {
  return {
    provider: 'wwebjs',
    source_provider: 'wwebjs',
    account_id: 'account-1',
    worker_id: 'worker-1',
    runtime_generation: '7',
    connection_epoch: 'epoch-7',
    event_source: 'incoming_upsert',
    dedupe_key: 'message-key-1',
    kafka_topic: 'upsert-message',
    kafka_key: 'account-1:worker-1:5511999999999@s.whatsapp.net',
    upsert: {
      worker_id: 'worker-1',
      account_id: 'account-1',
      source_provider: 'wwebjs',
      runtime_generation: '7',
      connection_epoch: 'epoch-7',
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
    raw_meta: { inbound_spool_first_stored_at_ms: Date.now() },
    received_at: new Date(0).toISOString(),
    attempts: 0,
    ...overrides,
  };
}

function makeConsumerParking(
  overrides: Partial<IInboundMessageParkingPayload> = {}
): IInboundMessageParkingPayload {
  const upsert = makePayload().upsert;
  return {
    provider: 'message_upsert_consumer',
    account_id: upsert.account_id,
    worker_id: upsert.worker_id,
    event_source: 'message_upsert_consume',
    reason: 'message_processing_retry_exhausted',
    stage: 'message_upsert.consume.retry_parked',
    parked_at: new Date().toISOString(),
    kafka_topic: 'upsert.message',
    kafka_key: 'original-kafka-key',
    dedupe_key: 'semantic-event-1',
    partition: 8,
    offset: 100,
    retry_count: 1,
    upsert,
    ...overrides,
  };
}

function makeRedis() {
  const streams = new Map<string, Map<string, string>>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const expirations = new Map<string, number>();
  let nextId = 1;
  const deleteKeys = (...keys: string[]) => {
    for (const key of keys) {
      streams.delete(key);
      hashes.delete(key);
      zsets.delete(key);
      strings.delete(key);
      sets.delete(key);
      expirations.delete(key);
    }
    return keys.length;
  };

  return {
    streams,
    hashes,
    zsets,
    strings,
    sets,
    expirations,
    get: jest.fn(async (key: string) => strings.get(key) ?? null),
    time: jest.fn(async () => {
      const now = Date.now();
      return [String(Math.floor(now / 1000)), String((now % 1000) * 1000)] as [
        string,
        string,
      ];
    }),
    set: jest.fn(
      async (
        key: string,
        value: string,
        ...options: Array<string | number>
      ) => {
        if (options.includes('NX') && strings.has(key)) {
          return null;
        }
        strings.set(key, value);
        const pxIndex = options.indexOf('PX');
        if (pxIndex >= 0) {
          expirations.set(key, Number(options[pxIndex + 1]));
        }
        return 'OK';
      }
    ),
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
    xgroup: jest.fn(async (..._args: Array<string | number>) => 'OK'),
    xreadgroup: jest.fn(async (...args: Array<string | number>) => {
      const streamsIndex = args.indexOf('STREAMS');
      const stream = String(args[streamsIndex + 1] ?? '');
      const entries = [...(streams.get(stream) ?? [])].map(([id, payload]) => [
        id,
        ['payload', payload],
      ]);
      return entries.length > 0 ? [[stream, entries]] : null;
    }),
    xautoclaim: jest.fn(async () => ['0-0', []]),
    xack: jest.fn(async () => 1),
    hset: jest.fn(async (key: string, field: string, value: string) => {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    }),
    hget: jest.fn(async (key: string, field: string) =>
      hashes.get(key)?.get(field)
    ),
    hdel: jest.fn(async (key: string, field: string) => {
      const deleted = hashes.get(key)?.delete(field) ? 1 : 0;
      if (hashes.get(key)?.size === 0) hashes.delete(key);
      return deleted;
    }),
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      const zset = zsets.get(key) ?? new Map<string, number>();
      zset.set(member, score);
      zsets.set(key, zset);
      return 1;
    }),
    zrangebyscore: jest.fn(
      async (
        key: string,
        _min: string,
        max: number | string,
        _limit: 'LIMIT',
        _offset: number,
        count: number
      ) => {
        const maximum = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
        return [...(zsets.get(key) ?? [])]
          .filter(([, score]) => score <= maximum)
          .slice(0, count)
          .map(([member]) => member);
      }
    ),
    zrem: jest.fn(async (key: string, member: string) => {
      const deleted = zsets.get(key)?.delete(member) ? 1 : 0;
      if (zsets.get(key)?.size === 0) zsets.delete(key);
      return deleted;
    }),
    zremrangebyscore: jest.fn(
      async (key: string, _min: string | number, max: string | number) => {
        const zset = zsets.get(key);
        if (!zset) return 0;
        const maximum = Number(max);
        let deleted = 0;
        for (const [member, score] of zset) {
          if (score <= maximum) {
            zset.delete(member);
            deleted += 1;
          }
        }
        if (zset.size === 0) zsets.delete(key);
        return deleted;
      }
    ),
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key) ?? new Set<string>();
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added += 1;
        }
      }
      sets.set(key, set);
      return added;
    }),
    srem: jest.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) {
        return 0;
      }
      let removed = 0;
      for (const member of members) {
        if (set.delete(member)) {
          removed += 1;
        }
      }
      if (set.size === 0) {
        sets.delete(key);
      }
      return removed;
    }),
    sscan: jest.fn(
      async (key: string, _cursor: string, _count: 'COUNT', _limit: number) => {
        return ['0', [...(sets.get(key) ?? [])]] as [string, string[]];
      }
    ),
    scan: jest.fn(
      async (
        _cursor: string,
        _match: 'MATCH',
        pattern: string,
        _count: 'COUNT',
        _limit: number
      ) => {
        const prefix = pattern.slice(0, -'*:parking'.length);
        const keys = [...zsets.keys()].filter(
          (key) => key.startsWith(prefix) && key.endsWith(':parking')
        );
        return ['0', keys] as [string, string[]];
      }
    ),
    del: jest.fn(async (...keys: string[]) => deleteKeys(...keys)),
    unlink: jest.fn(async (...keys: string[]) => deleteKeys(...keys)),
    eval: jest.fn(
      // This test-only interpreter intentionally models every spool Lua
      // transition in one place so all fake Redis structures stay atomic.
      // eslint-disable-next-line max-statements, complexity
      async (script: string, numberOfKeys: number, ...args: string[]) => {
        if (script.includes('inbound-provider-stream-store-v2')) {
          const [stream, rawPayload] = args;
          const payload = JSON.parse(rawPayload) as IInboundMessageSpoolPayload;
          payload.raw_meta = {
            ...(payload.raw_meta ?? {}),
            inbound_spool_first_stored_at_ms: Date.now(),
          };
          const id = `${Date.now()}-${nextId++}`;
          const entries = streams.get(stream) ?? new Map<string, string>();
          entries.set(id, JSON.stringify(payload));
          streams.set(stream, entries);
          return id;
        }

        if (script.includes('inbound-message-consumer-parking-store-v1')) {
          const [
            payloadKey,
            parkingKey,
            claimsKey,
            lineageKey,
            terminalRecordKey,
            member,
            rawPayload,
            rawBaseDelay,
            rawMaxDelay,
            rawLineageTtl,
          ] = args;
          if (strings.has(terminalRecordKey)) {
            return 0;
          }
          const hash = hashes.get(payloadKey) ?? new Map<string, string>();
          const incoming = JSON.parse(
            rawPayload
          ) as IInboundMessageParkingPayload;
          const previousRaw = hash.get(member);
          const previous = previousRaw
            ? (JSON.parse(previousRaw) as IInboundMessageParkingPayload)
            : null;
          const retryCount = Math.max(
            incoming.retry_count ?? 1,
            (previous?.retry_count ?? 0) + 1
          );
          const now = Date.now();
          const previousFirstParkedAt = Number(previous?.first_parked_at);
          const lineageFirstParkedAt = Number(strings.get(lineageKey));
          const storedFirstParkedAt = previousRaw
            ? Number.isFinite(previousFirstParkedAt)
              ? previousFirstParkedAt
              : 0
            : null;
          const storedLineageFirstParkedAt = strings.has(lineageKey)
            ? Number.isFinite(lineageFirstParkedAt)
              ? lineageFirstParkedAt
              : 0
            : null;
          const firstParkedAt =
            storedFirstParkedAt !== null && storedLineageFirstParkedAt !== null
              ? Math.min(storedFirstParkedAt, storedLineageFirstParkedAt)
              : (storedFirstParkedAt ?? storedLineageFirstParkedAt ?? now);
          incoming.retry_count = retryCount;
          incoming.next_attempt_at =
            now +
            Math.min(
              Number(rawBaseDelay) * Math.pow(2, Math.max(0, retryCount - 1)),
              Number(rawMaxDelay)
            );
          incoming.first_parked_at = String(firstParkedAt);
          incoming.parked_at = String(now);
          const serialized = JSON.stringify(incoming);
          hash.set(member, serialized);
          hashes.set(payloadKey, hash);
          expirations.delete(payloadKey);
          if (!strings.has(lineageKey)) {
            strings.set(lineageKey, String(firstParkedAt));
            expirations.set(lineageKey, Number(rawLineageTtl));
          }
          if (!hashes.get(claimsKey)?.has(member)) {
            const zset = zsets.get(parkingKey) ?? new Map<string, number>();
            zset.set(member, incoming.next_attempt_at);
            zsets.set(parkingKey, zset);
          }
          return 1;
        }

        if (script.includes('inbound-message-consumer-redrive-claim-v1')) {
          const [
            parkingKey,
            payloadKey,
            claimsKey,
            indexKey,
            leaderKey,
            member,
            rawNow,
            rawLeaseUntil,
            owner,
            expectedLeader,
          ] = args;
          if (expectedLeader && strings.get(leaderKey) !== expectedLeader) {
            return null;
          }
          const score = zsets.get(parkingKey)?.get(member);
          if (score === undefined || score > Number(rawNow)) {
            return null;
          }
          const payload = hashes.get(payloadKey)?.get(member);
          if (!payload) {
            zsets.get(parkingKey)?.delete(member);
            hashes.get(claimsKey)?.delete(member);
            if ((zsets.get(parkingKey)?.size ?? 0) === 0) {
              sets.get(indexKey)?.delete(parkingKey);
            }
            return null;
          }
          const claims = hashes.get(claimsKey) ?? new Map<string, string>();
          claims.set(member, owner);
          hashes.set(claimsKey, claims);
          zsets.get(parkingKey)?.set(member, Number(rawLeaseUntil));
          return payload;
        }

        if (script.includes('inbound-message-consumer-redrive-complete-v1')) {
          const [
            parkingKey,
            payloadKey,
            claimsKey,
            indexKey,
            lineageKey,
            leaderKey,
            member,
            owner,
            expectedPayload,
            rawRetryAt,
            rawArchiveRetention,
            firstParkedAt,
            rawLineageRetention,
            expectedLeader,
          ] = args;
          if (expectedLeader && strings.get(leaderKey) !== expectedLeader) {
            return -2;
          }
          if (hashes.get(claimsKey)?.get(member) !== owner) {
            return 0;
          }
          if (hashes.get(payloadKey)?.get(member) !== expectedPayload) {
            hashes.get(claimsKey)?.delete(member);
            const current = JSON.parse(
              hashes.get(payloadKey)?.get(member) ?? '{}'
            ) as IInboundMessageParkingPayload;
            zsets
              .get(parkingKey)
              ?.set(member, current.next_attempt_at ?? Number(rawRetryAt));
            return -1;
          }
          if (!strings.has(lineageKey)) {
            strings.set(lineageKey, firstParkedAt);
            expirations.set(lineageKey, Number(rawLineageRetention));
          }
          zsets.get(parkingKey)?.delete(member);
          hashes.get(payloadKey)?.delete(member);
          hashes.get(claimsKey)?.delete(member);
          if ((zsets.get(parkingKey)?.size ?? 0) === 0) {
            sets.get(indexKey)?.delete(parkingKey);
            if (hashes.has(payloadKey)) {
              expirations.set(payloadKey, Number(rawArchiveRetention));
            }
          }
          return 1;
        }

        if (
          script.includes('inbound-message-consumer-redrive-terminalize-v1')
        ) {
          const [
            parkingKey,
            payloadKey,
            claimsKey,
            indexKey,
            terminalRecordKey,
            terminalIndexKey,
            lineageKey,
            leaderKey,
            member,
            owner,
            expectedPayload,
            terminalPayload,
            rawNow,
            rawExpiresAt,
            rawRetention,
            expectedLeader,
          ] = args;
          if (expectedLeader && strings.get(leaderKey) !== expectedLeader) {
            return -2;
          }
          if (hashes.get(claimsKey)?.get(member) !== owner) {
            return 0;
          }
          if (hashes.get(payloadKey)?.get(member) !== expectedPayload) {
            hashes.get(claimsKey)?.delete(member);
            const current = JSON.parse(
              hashes.get(payloadKey)?.get(member) ?? '{}'
            ) as IInboundMessageParkingPayload;
            zsets
              .get(parkingKey)
              ?.set(member, current.next_attempt_at ?? Number(rawNow));
            return -1;
          }
          strings.set(terminalRecordKey, terminalPayload);
          expirations.set(terminalRecordKey, Number(rawRetention));
          const terminalIndex =
            zsets.get(terminalIndexKey) ?? new Map<string, number>();
          for (const [terminalMember, expiresAt] of terminalIndex) {
            if (expiresAt <= Number(rawNow)) {
              terminalIndex.delete(terminalMember);
            }
          }
          terminalIndex.set(terminalRecordKey, Number(rawExpiresAt));
          zsets.set(terminalIndexKey, terminalIndex);
          expirations.set(terminalIndexKey, Number(rawRetention));
          zsets.get(parkingKey)?.delete(member);
          hashes.get(payloadKey)?.delete(member);
          hashes.get(claimsKey)?.delete(member);
          if (strings.has(lineageKey)) {
            expirations.set(lineageKey, Number(rawRetention));
          }
          if ((zsets.get(parkingKey)?.size ?? 0) === 0) {
            sets.get(indexKey)?.delete(parkingKey);
          }
          return 1;
        }

        if (script.includes('inbound-message-consumer-redrive-reschedule-v1')) {
          const [
            parkingKey,
            payloadKey,
            claimsKey,
            leaderKey,
            member,
            owner,
            expectedPayload,
            replacementPayload,
            rawNextAttempt,
            rawRetryAt,
            expectedLeader,
          ] = args;
          if (expectedLeader && strings.get(leaderKey) !== expectedLeader) {
            return -2;
          }
          if (hashes.get(claimsKey)?.get(member) !== owner) {
            return 0;
          }
          if (hashes.get(payloadKey)?.get(member) !== expectedPayload) {
            hashes.get(claimsKey)?.delete(member);
            const current = JSON.parse(
              hashes.get(payloadKey)?.get(member) ?? '{}'
            ) as IInboundMessageParkingPayload;
            zsets
              .get(parkingKey)
              ?.set(member, current.next_attempt_at ?? Number(rawRetryAt));
            return -1;
          }
          hashes.get(payloadKey)?.set(member, replacementPayload);
          zsets.get(parkingKey)?.set(member, Number(rawNextAttempt));
          hashes.get(claimsKey)?.delete(member);
          return 1;
        }

        if (
          script.includes('inbound-message-consumer-redrive-leader-renew-v1')
        ) {
          const [leaderKey, owner] = args;
          return strings.get(leaderKey) === owner ? 1 : 0;
        }

        if (
          script.includes('inbound-message-consumer-redrive-leader-release-v1')
        ) {
          const [leaderKey, owner] = args;
          if (strings.get(leaderKey) !== owner) {
            return 0;
          }
          strings.delete(leaderKey);
          return 1;
        }

        if (
          script.includes('inbound-message-consumer-legacy-migration-state-v1')
        ) {
          const [leaderKey, migrationKey, owner, serializedState] = args;
          if (strings.get(leaderKey) !== owner) {
            return 0;
          }
          strings.set(migrationKey, serializedState);
          return 1;
        }

        if (script.includes('inbound-provider-parking-requeue-v1')) {
          const [
            parkingKey,
            payloadKey,
            retryKey,
            retryPayloadKey,
            member,
            expectedPayload,
            replacementPayload,
            rawDueAt,
          ] = args;
          const current = hashes.get(payloadKey)?.get(member);
          if (!current) {
            zsets.get(parkingKey)?.delete(member);
            return 0;
          }
          if (current !== expectedPayload) {
            return -1;
          }
          if (replacementPayload) {
            const retryHash =
              hashes.get(retryPayloadKey) ?? new Map<string, string>();
            retryHash.set(member, replacementPayload);
            hashes.set(retryPayloadKey, retryHash);
            const retrySet = zsets.get(retryKey) ?? new Map<string, number>();
            retrySet.set(member, Number(rawDueAt));
            zsets.set(retryKey, retrySet);
          }
          zsets.get(parkingKey)?.delete(member);
          hashes.get(payloadKey)?.delete(member);
          if (zsets.get(parkingKey)?.size === 0) {
            zsets.delete(parkingKey);
          }
          if (hashes.get(payloadKey)?.size === 0) {
            hashes.delete(payloadKey);
          }
          return 1;
        }

        if (script.includes('inbound-provider-retry-discard-v1')) {
          const [hashKey, retryKey, member, expectedPayload] = args;
          if (hashes.get(hashKey)?.get(member) !== expectedPayload) {
            return 0;
          }
          hashes.get(hashKey)?.delete(member);
          zsets.get(retryKey)?.delete(member);
          if (hashes.get(hashKey)?.size === 0) {
            hashes.delete(hashKey);
          }
          if (zsets.get(retryKey)?.size === 0) {
            zsets.delete(retryKey);
          }
          return 1;
        }

        if (script.includes('inbound-provider-scope-discovery-repair-v1')) {
          const [
            fenceKey,
            sortedSetKey,
            payloadHashKey,
            workerId,
            rawActiveGeneration,
            activeEpoch,
            activeProvider,
            targetProvider,
            rawTargetGeneration,
            targetEpoch,
            rawCursor,
            rawCount,
            rawNow,
          ] = args;
          const rawFence = strings.get(fenceKey);
          const fence = rawFence
            ? (JSON.parse(rawFence) as Record<string, unknown>)
            : undefined;
          if (
            fence?.state !== 'active' ||
            fence.worker_id !== workerId ||
            Number(fence.runtime_generation) !== Number(rawActiveGeneration) ||
            fence.connection_epoch !== activeEpoch ||
            fence.source_provider !== activeProvider
          ) {
            return [-1, rawCursor, 0, 0];
          }

          const activeGeneration = Number(rawActiveGeneration);
          const targetGeneration = Number(rawTargetGeneration);
          if (
            targetGeneration > activeGeneration ||
            (targetGeneration === activeGeneration &&
              targetProvider === activeProvider &&
              targetEpoch === activeEpoch)
          ) {
            return [-2, rawCursor, 0, 0];
          }
          const sortedSetHasWrongType =
            streams.has(sortedSetKey) ||
            hashes.has(sortedSetKey) ||
            strings.has(sortedSetKey) ||
            sets.has(sortedSetKey);
          const payloadHashHasWrongType =
            streams.has(payloadHashKey) ||
            zsets.has(payloadHashKey) ||
            strings.has(payloadHashKey) ||
            sets.has(payloadHashKey);
          if (sortedSetHasWrongType || payloadHashHasWrongType) {
            return [-3, rawCursor, 0, 0];
          }

          const entries = [...(hashes.get(payloadHashKey) ?? [])];
          const offset = Math.max(0, Number(rawCursor) || 0);
          const count = Math.max(1, Number(rawCount) || 1);
          const page = entries.slice(offset, offset + count);
          const nextCursor =
            offset + page.length >= entries.length
              ? '0'
              : String(offset + page.length);
          let repaired = 0;
          for (const [member, rawPayload] of page) {
            const sortedSet =
              zsets.get(sortedSetKey) ?? new Map<string, number>();
            if (!sortedSet.has(member)) {
              let score = Number(rawNow);
              try {
                const payload = JSON.parse(rawPayload) as Record<
                  string,
                  unknown
                >;
                score = Number(payload.next_attempt_at) || score;
              } catch {
                // Repair is deliberately non-destructive even for malformed
                // data; its lifecycle remains owned by the existing reader.
              }
              sortedSet.set(member, score);
              zsets.set(sortedSetKey, sortedSet);
              repaired += 1;
            }
          }
          return [1, nextCursor, repaired, page.length];
        }

        if (script.includes('inbound-provider-empty-scope-prune-v1')) {
          const [
            fenceKey,
            indexKey,
            streamKey,
            retryKey,
            retryPayloadKey,
            parkingKey,
            payloadKey,
            workerId,
            rawActiveGeneration,
            activeEpoch,
            activeProvider,
            targetProvider,
            rawTargetGeneration,
            targetEpoch,
          ] = args;
          const rawFence = strings.get(fenceKey);
          const fence = rawFence
            ? (JSON.parse(rawFence) as Record<string, unknown>)
            : undefined;
          if (
            fence?.state !== 'active' ||
            fence.worker_id !== workerId ||
            Number(fence.runtime_generation) !== Number(rawActiveGeneration) ||
            fence.connection_epoch !== activeEpoch ||
            fence.source_provider !== activeProvider
          ) {
            return -1;
          }

          const activeGeneration = Number(rawActiveGeneration);
          const targetGeneration = Number(rawTargetGeneration);
          if (
            targetGeneration > activeGeneration ||
            (targetGeneration === activeGeneration &&
              targetProvider === activeProvider &&
              targetEpoch === activeEpoch)
          ) {
            return -2;
          }

          const typedKeys = [
            [streamKey, 'stream', streams.get(streamKey)?.size ?? 0],
            [retryKey, 'zset', zsets.get(retryKey)?.size ?? 0],
            [retryPayloadKey, 'hash', hashes.get(retryPayloadKey)?.size ?? 0],
            [parkingKey, 'zset', zsets.get(parkingKey)?.size ?? 0],
            [payloadKey, 'hash', hashes.get(payloadKey)?.size ?? 0],
          ] as const;
          let hasData = false;
          let hasHashData = false;
          for (const [key, expectedType, size] of typedKeys) {
            const actualTypes = [
              streams.has(key) ? 'stream' : null,
              zsets.has(key) ? 'zset' : null,
              hashes.has(key) ? 'hash' : null,
              strings.has(key) ? 'string' : null,
              sets.has(key) ? 'set' : null,
            ].filter((type): type is string => type !== null);
            if (
              actualTypes.length > 0 &&
              (actualTypes.length !== 1 || actualTypes[0] !== expectedType)
            ) {
              return -3;
            }
            hasData ||= size > 0;
            hasHashData ||= expectedType === 'hash' && size > 0;
          }
          if (hasHashData) {
            return 2;
          }
          if (hasData) {
            return 0;
          }

          deleteKeys(
            streamKey,
            retryKey,
            retryPayloadKey,
            parkingKey,
            payloadKey
          );
          const index = sets.get(indexKey);
          for (const key of [
            streamKey,
            retryKey,
            retryPayloadKey,
            parkingKey,
            payloadKey,
          ]) {
            index?.delete(key);
          }
          if (index?.size === 0) {
            sets.delete(indexKey);
          }
          return 1;
        }

        if (script.includes('inbound-provider-scored-payload-store-v2')) {
          const [
            hashKey,
            sortedSetKey,
            member,
            serializedPayload,
            rawScore,
            rawFirstStoredAt,
          ] = args;
          const incoming = JSON.parse(serializedPayload) as
            IInboundMessageSpoolPayload | IInboundMessageParkingPayload;
          const hash = hashes.get(hashKey) ?? new Map<string, string>();
          const previousRaw = hash.get(member);
          const previous = JSON.parse(previousRaw ?? '{}') as
            IInboundMessageSpoolPayload | IInboundMessageParkingPayload;
          const previousFirstStoredAt = Number(
            previous.raw_meta?.inbound_spool_first_stored_at_ms
          );
          const trustedFirstStoredAt = Number(rawFirstStoredAt);
          const storedFirstStoredAt = previousRaw
            ? Number.isFinite(previousFirstStoredAt)
              ? previousFirstStoredAt
              : 0
            : null;
          const suppliedFirstStoredAt = rawFirstStoredAt
            ? Number.isFinite(trustedFirstStoredAt)
              ? trustedFirstStoredAt
              : 0
            : null;
          const firstStoredAt =
            storedFirstStoredAt !== null && suppliedFirstStoredAt !== null
              ? Math.min(storedFirstStoredAt, suppliedFirstStoredAt)
              : (storedFirstStoredAt ?? suppliedFirstStoredAt ?? Date.now());
          incoming.raw_meta = {
            ...(incoming.raw_meta ?? {}),
            inbound_spool_first_stored_at_ms: firstStoredAt,
          };
          hash.set(member, JSON.stringify(incoming));
          hashes.set(hashKey, hash);
          const sortedSet =
            zsets.get(sortedSetKey) ?? new Map<string, number>();
          sortedSet.set(member, Number(rawScore));
          zsets.set(sortedSetKey, sortedSet);
          return 1;
        }

        const [
          fenceKey,
          spoolKey,
          indexKey,
          workerId,
          runtimeGeneration,
          connectionEpoch,
          provider,
        ] = args;
        const raw = strings.get(fenceKey);
        const fence = raw
          ? (JSON.parse(raw) as Record<string, unknown>)
          : undefined;
        if (
          fence?.state !== 'active' ||
          fence.worker_id !== workerId ||
          Number(fence.runtime_generation) !== Number(runtimeGeneration) ||
          fence.connection_epoch !== connectionEpoch ||
          fence.source_provider !== provider
        ) {
          return -1;
        }
        const deleted = deleteKeys(spoolKey);
        const index = sets.get(indexKey);
        index?.delete(spoolKey);
        if (index?.size === 0) {
          sets.delete(indexKey);
        }
        return deleted;
      }
    ),
  };
}

function setRuntimeFence(
  redis: ReturnType<typeof makeRedis>,
  overrides: Partial<Record<string, unknown>> = {}
): void {
  redis.strings.set(
    'whatsapp:runtime-fence:v1:worker-1',
    JSON.stringify({
      state: 'active',
      worker_id: 'worker-1',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
      source_provider: 'wwebjs',
      ...overrides,
    })
  );
}

function installConsumerRedriveState(
  service: InboundMessageSpoolService,
  publisher: jest.Mock,
  owner: string
) {
  const state = {
    running: false,
    stopped: false,
    inFlight: undefined as Promise<void> | undefined,
    indexScanCursor: '0',
    pendingParkingKeys: [] as string[],
    leaderOwner: owner,
    leaderOwned: false,
    leaderLeaseValidUntil: 0,
    publisher,
  };
  (service as any).consumerRedriveState = state;
  return state;
}

function readOnlyConsumerTerminalPayload(redis: ReturnType<typeof makeRedis>): {
  key: string;
  payload: IInboundMessageParkingPayload;
} {
  const terminalIndex = redis.zsets.get(
    'inbound:message:message_upsert_consumer:terminal-index:v1'
  );
  const [key] = [...(terminalIndex?.keys() ?? [])];
  if (!key) {
    throw new Error('expected one consumer terminal record');
  }
  const rawPayload = redis.strings.get(key);
  if (!rawPayload) {
    throw new Error('expected terminal payload to remain addressable');
  }
  return {
    key,
    payload: JSON.parse(rawPayload) as IInboundMessageParkingPayload,
  };
}

describe('InboundMessageSpoolService', () => {
  it('does not republish after Kafka succeeds when stream acknowledgement must be retried', async () => {
    const redis = {
      xack: jest.fn(async () => 1),
      xdel: jest
        .fn()
        .mockRejectedValueOnce(new Error('redis cleanup unavailable'))
        .mockResolvedValueOnce(1),
      time: jest.fn(async () => {
        const now = Date.now();
        return [String(Math.floor(now / 1000)), String((now % 1000) * 1000)];
      }),
    };
    const service = new InboundMessageSpoolService(redis as never);
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });
    const publisher = jest.fn(async () => undefined);
    const entry = {
      id: '1-0',
      payload: makePayload(),
      rawPayload: JSON.stringify(makePayload()),
    };
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await (service as any).processStreamEntry(
        'wwebjs',
        'worker-1',
        scope,
        entry,
        publisher
      );
      await (service as any).processStreamEntry(
        'wwebjs',
        'worker-1',
        scope,
        entry,
        publisher
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(redis.xack).toHaveBeenCalledTimes(2);
    expect(redis.xdel).toHaveBeenCalledTimes(2);
  });

  it('queues a persisted entry for the consumer-group publisher only', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const publisher = jest.fn(async () => undefined);

    await expect(service.publish(payload, publisher)).resolves.toBe(true);

    expect(publisher).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('inbound-provider-stream-store-v2'),
      1,
      'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream',
      JSON.stringify(payload)
    );
    expect(redis.xdel).not.toHaveBeenCalled();
    expect(
      redis.streams.get(
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream'
      )?.size ?? 0
    ).toBe(1);
    expect(redis.sets.get('inbound:message:spool-index:v1:worker-1')).toEqual(
      new Set([
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:retry',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:retry-payloads',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:parking',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:payloads',
      ])
    );
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'publishes fresh fromMe $provider stream and retry records at 4m59.999s',
    async (provider) => {
      jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
      try {
        const redis = makeRedis();
        const service = new InboundMessageSpoolService(redis as never);
        const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
        const stream = service.streamKey(provider, 'worker-1', scope);
        (service as any).states.set(stream, { running: true });
        const base = makePayload({
          provider,
          source_provider: provider,
          dedupe_key: `${provider}-fresh-retry`,
          received_at: '2001-01-01T00:00:00.000Z',
          next_attempt_at: 0,
        });
        const payload: IInboundMessageSpoolPayload = {
          ...base,
          upsert: {
            ...base.upsert,
            source_provider: provider,
            message: {
              ...base.upsert.message,
              key: { ...base.upsert.message.key, fromMe: true },
            },
          },
        };
        await (service as any).storeRetry(provider, 'worker-1', scope, payload);
        const retryHash = service.retryPayloadHashKey(
          provider,
          'worker-1',
          scope
        );
        const storedRetry = JSON.parse(
          [...(redis.hashes.get(retryHash)?.values() ?? [])][0] ?? '{}'
        ) as IInboundMessageSpoolPayload;
        const streamInput = makePayload({
          ...payload,
          dedupe_key: `${provider}-fresh-stream`,
          raw_meta: {},
        });
        await service.publish(
          streamInput,
          jest.fn(async () => undefined)
        );
        const [streamEntry] = [...(redis.streams.get(stream)?.entries() ?? [])];
        const streamPayload = JSON.parse(
          streamEntry?.[1] ?? '{}'
        ) as IInboundMessageSpoolPayload;
        jest.setSystemTime(new Date('2026-08-17T12:04:59.999Z'));
        const publisher = jest.fn(async () => undefined);

        await (service as any).processStreamEntry(
          provider,
          'worker-1',
          scope,
          {
            id: streamEntry?.[0] ?? `${provider}-fresh-stream`,
            payload: streamPayload,
            rawPayload: JSON.stringify(streamPayload),
          },
          publisher
        );
        await (service as any).processRetryBatch(
          provider,
          'worker-1',
          scope,
          publisher
        );

        expect(publisher).toHaveBeenCalledTimes(2);
        expect(publisher).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            received_at: '2001-01-01T00:00:00.000Z',
            upsert: expect.objectContaining({
              message: expect.objectContaining({
                key: expect.objectContaining({ fromMe: true }),
              }),
            }),
          })
        );
        expect(publisher).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            received_at: '2001-01-01T00:00:00.000Z',
            raw_meta: expect.objectContaining({
              inbound_spool_first_stored_at_ms: new Date(
                '2026-08-17T12:00:00.000Z'
              ).getTime(),
            }),
          })
        );
        expect(storedRetry.received_at).toBe('2001-01-01T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'acknowledges expired or clockless $provider stream and retry records before Kafka',
    async (provider) => {
      jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
      const infoSpy = jest
        .spyOn(console, 'info')
        .mockImplementation(() => undefined);
      try {
        const redis = makeRedis();
        const service = new InboundMessageSpoolService(redis as never);
        const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
        const stream = service.streamKey(provider, 'worker-1', scope);
        const retryKey = service.retrySetKey(provider, 'worker-1', scope);
        const retryHash = service.retryPayloadHashKey(
          provider,
          'worker-1',
          scope
        );
        (service as any).states.set(stream, { running: true });
        const publisher = jest.fn(async () => undefined);

        for (const [index, hasRedisClock] of [true, false].entries()) {
          const payload = makePayload({
            provider,
            source_provider: provider,
            dedupe_key: `${provider}-rejected-${index}`,
            received_at: '2099-01-01T00:00:00.000Z',
            raw_meta: hasRedisClock
              ? { inbound_spool_first_stored_at_ms: Date.now() }
              : {},
            next_attempt_at: 0,
          });
          if (hasRedisClock) {
            await (service as any).storeRetry(
              provider,
              'worker-1',
              scope,
              payload
            );
          } else {
            const member = (service as any).payloadMember(payload) as string;
            const hash = redis.hashes.get(retryHash) ?? new Map();
            hash.set(member, JSON.stringify(payload));
            redis.hashes.set(retryHash, hash);
            const retry = redis.zsets.get(retryKey) ?? new Map();
            retry.set(member, 0);
            redis.zsets.set(retryKey, retry);
          }
          jest.setSystemTime(new Date('2026-08-17T12:05:00.000Z'));
          await (service as any).processStreamEntry(
            provider,
            'worker-1',
            scope,
            {
              id: `${provider}-rejected-${index}`,
              payload,
              rawPayload: JSON.stringify(payload),
            },
            publisher
          );
          await (service as any).processRetryBatch(
            provider,
            'worker-1',
            scope,
            publisher
          );
          jest.setSystemTime(new Date('2026-08-17T12:00:00.000Z'));
        }

        expect(publisher).not.toHaveBeenCalled();
        expect(redis.xack).toHaveBeenCalledTimes(2);
        expect(redis.xdel).toHaveBeenCalledTimes(2);
        expect(redis.zsets.get(retryKey)?.size ?? 0).toBe(0);
        expect(redis.hashes.get(retryHash)?.size ?? 0).toBe(0);
      } finally {
        infoSpy.mockRestore();
        jest.useRealTimers();
      }
    }
  );

  it('rechecks Redis TIME for every provider retry member that crosses the deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
      const stream = service.streamKey('wwebjs', 'worker-1', scope);
      (service as any).states.set(stream, { running: true });
      for (const dedupeKey of ['first-member', 'second-member']) {
        await (service as any).storeRetry(
          'wwebjs',
          'worker-1',
          scope,
          makePayload({ dedupe_key: dedupeKey, next_attempt_at: 0 })
        );
      }
      jest.setSystemTime(new Date('2026-08-17T12:04:59.999Z'));
      const publisher = jest.fn(async () => {
        jest.setSystemTime(new Date('2026-08-17T12:05:00.000Z'));
      });

      await (service as any).processRetryBatch(
        'wwebjs',
        'worker-1',
        scope,
        publisher
      );

      expect(publisher).toHaveBeenCalledTimes(1);
      expect(
        redis.zsets.get(service.retrySetKey('wwebjs', 'worker-1', scope))
          ?.size ?? 0
      ).toBe(0);
      expect(
        redis.hashes.get(
          service.retryPayloadHashKey('wwebjs', 'worker-1', scope)
        )?.size ?? 0
      ).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the oldest Redis provider clock when the stored and supplied markers diverge', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const payload = makePayload({ next_attempt_at: 0 });

    await (service as any).storeRetry(
      'wwebjs',
      'worker-1',
      scope,
      payload,
      2_000
    );
    await (service as any).storeRetry(
      'wwebjs',
      'worker-1',
      scope,
      payload,
      1_000
    );

    const storedValues = [
      ...(redis.hashes
        .get(service.retryPayloadHashKey('wwebjs', 'worker-1', scope))
        ?.values() ?? []),
    ];
    const stored = JSON.parse(
      storedValues[0] ?? '{}'
    ) as IInboundMessageSpoolPayload;
    expect(stored.raw_meta?.inbound_spool_first_stored_at_ms).toBe(1_000);
  });

  it('fails closed without publishing when Redis persistence fails', async () => {
    const redis = makeRedis();
    redis.eval.mockRejectedValueOnce(new Error('redis down'));
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const publisher = jest.fn(async () => undefined);

    await expect(service.publish(payload, publisher)).resolves.toBe(false);

    expect(publisher).not.toHaveBeenCalled();
    expect(redis.xdel).not.toHaveBeenCalled();
    expect(
      redis.streams.get(
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream'
      )?.size ?? 0
    ).toBe(0);
  });

  it('fails closed before stream persistence when scope indexing fails', async () => {
    const redis = makeRedis();
    redis.sadd.mockRejectedValueOnce(new Error('redis index unavailable'));
    const service = new InboundMessageSpoolService(redis as never);
    const publisher = jest.fn(async () => undefined);
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(service.publish(makePayload(), publisher)).resolves.toBe(
        false
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(redis.xadd).not.toHaveBeenCalled();
    expect(publisher).not.toHaveBeenCalled();
  });

  it('keeps a valid inbound event durable beyond twelve Kafka failures and publishes it exactly once after recovery', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });
    (service as any).maxAttempts = 12;
    (service as any).baseDelayMs = 1;
    (service as any).maxDelayMs = 1;

    let successfulPublications = 0;
    let failuresRemaining = 13;
    const publisher = jest.fn(async () => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('Kafka unavailable');
      }
      successfulPublications += 1;
    });
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      await (service as any).processStreamEntry(
        'wwebjs',
        'worker-1',
        scope,
        {
          id: '1-0',
          payload,
          rawPayload: JSON.stringify(payload),
        },
        publisher
      );

      const retryKey = service.retrySetKey('wwebjs', 'worker-1', scope);
      const retryHash = service.retryPayloadHashKey(
        'wwebjs',
        'worker-1',
        scope
      );
      const member = [...(redis.zsets.get(retryKey)?.keys() ?? [])][0];
      expect(member).toBeDefined();

      for (let attempt = 2; attempt <= 14; attempt += 1) {
        redis.zsets.get(retryKey)?.set(member as string, 0);
        await (service as any).processRetryBatch(
          'wwebjs',
          'worker-1',
          scope,
          publisher
        );
      }
      await (service as any).processRetryBatch(
        'wwebjs',
        'worker-1',
        scope,
        publisher
      );

      expect(publisher).toHaveBeenCalledTimes(14);
      expect(successfulPublications).toBe(1);
      expect(redis.zsets.get(retryKey)?.size ?? 0).toBe(0);
      expect(redis.hashes.get(retryHash)?.size ?? 0).toBe(0);
      expect(
        redis.zsets.get(service.parkingSetKey('wwebjs', 'worker-1', scope))
          ?.size ?? 0
      ).toBe(0);
      expect(warningSpy).toHaveBeenCalledWith(
        expect.stringContaining('durable retry continues'),
        expect.objectContaining({ attempts: 12 })
      );
    } finally {
      warningSpy.mockRestore();
    }
  });

  it('acknowledges a stream entry only when the publisher proves its runtime payload is obsolete', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });
    const publisher = jest.fn(async () => {
      throw new ObsoleteInboundMessageSpoolPayloadError(
        'superseded_runtime_outside_history_window'
      );
    });
    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    try {
      await (service as any).processStreamEntry(
        'wwebjs',
        'worker-1',
        scope,
        {
          id: '1-0',
          payload,
          rawPayload: JSON.stringify(payload),
        },
        publisher
      );
    } finally {
      infoSpy.mockRestore();
    }

    expect(redis.xack).toHaveBeenCalledWith(
      stream,
      'inbound-message-publisher',
      '1-0'
    );
    expect(redis.xdel).toHaveBeenCalledWith(stream, '1-0');
    expect(
      redis.zsets.get(service.retrySetKey('wwebjs', 'worker-1', scope))?.size ??
        0
    ).toBe(0);
  });

  it('keeps an ordinary runtime lease rejection durable instead of matching its error text as terminal', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    const retryKey = service.retrySetKey('wwebjs', 'worker-1', scope);
    const hashKey = service.retryPayloadHashKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });

    await (service as any).processStreamEntry(
      'wwebjs',
      'worker-1',
      scope,
      {
        id: '1-0',
        payload,
        rawPayload: JSON.stringify(payload),
      },
      jest.fn(async () => {
        throw new Error('wwebjs_inbound_spool_runtime_lease_revoked');
      })
    );

    expect(redis.zsets.get(retryKey)?.size).toBe(1);
    const persisted = JSON.parse(
      [...(redis.hashes.get(hashKey)?.values() ?? [])][0] ?? '{}'
    ) as IInboundMessageSpoolPayload;
    expect(persisted).toEqual(
      expect.objectContaining({
        attempts: 1,
        last_error: 'wwebjs_inbound_spool_runtime_lease_revoked',
        received_at: payload.received_at,
      })
    );
  });

  it('atomically removes an obsolete retry without treating it as Kafka unavailability', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload({ attempts: 208, next_attempt_at: 0 });
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const retryKey = service.retrySetKey('wwebjs', 'worker-1', scope);
    const hashKey = service.retryPayloadHashKey('wwebjs', 'worker-1', scope);
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });
    const member = (service as any).payloadMember(payload) as string;
    await (service as any).storeRetry('wwebjs', 'worker-1', scope, payload);
    redis.zsets.get(retryKey)?.set(member, 0);
    const publisher = jest.fn(async () => {
      throw new ObsoleteInboundMessageSpoolPayloadError(
        'superseded_runtime_outside_history_window'
      );
    });
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    try {
      await (service as any).processRetryBatch(
        'wwebjs',
        'worker-1',
        scope,
        publisher
      );
    } finally {
      warningSpy.mockRestore();
      infoSpy.mockRestore();
    }

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(redis.zsets.get(retryKey)?.has(member)).not.toBe(true);
    expect(redis.hashes.get(hashKey)?.has(member)).not.toBe(true);
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('does not delete a concurrent retry rewrite while acknowledging an obsolete snapshot', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload({ attempts: 208, next_attempt_at: 0 });
    const replacement = { ...payload, attempts: 209, last_error: 'new owner' };
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const retryKey = service.retrySetKey('wwebjs', 'worker-1', scope);
    const hashKey = service.retryPayloadHashKey('wwebjs', 'worker-1', scope);
    const stream = service.streamKey('wwebjs', 'worker-1', scope);
    (service as any).states.set(stream, { running: true });
    const member = (service as any).payloadMember(payload) as string;
    await (service as any).storeRetry('wwebjs', 'worker-1', scope, payload);
    redis.zsets.get(retryKey)?.set(member, 0);

    await (service as any).processRetryBatch(
      'wwebjs',
      'worker-1',
      scope,
      jest.fn(async () => {
        redis.hashes.get(hashKey)?.set(member, JSON.stringify(replacement));
        throw new ObsoleteInboundMessageSpoolPayloadError(
          'superseded_runtime_outside_history_window'
        );
      })
    );

    expect(redis.zsets.get(retryKey)?.has(member)).toBe(true);
    expect(redis.hashes.get(hashKey)?.get(member)).toBe(
      JSON.stringify(replacement)
    );
  });

  it('requeues valid legacy provider parking and removes invalid legacy parking without creating a terminal store', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };
    const parkingKey = service.parkingSetKey('wwebjs', 'worker-1', scope);
    const payloadKey = service.payloadHashKey('wwebjs', 'worker-1', scope);
    const retryKey = service.retrySetKey('wwebjs', 'worker-1', scope);
    const retryHash = service.retryPayloadHashKey('wwebjs', 'worker-1', scope);
    const validMember = 'wwebjs:legacy-valid';
    const invalidMember = 'wwebjs:legacy-invalid';
    const validParking: IInboundMessageParkingPayload = {
      provider: 'wwebjs',
      account_id: 'account-1',
      worker_id: 'worker-1',
      event_source: 'incoming_upsert',
      reason: 'retry_exhausted',
      stage: 'inbound_message_spool.publish',
      parked_at: new Date().toISOString(),
      kafka_topic: 'upsert-message',
      kafka_key: 'account-1:worker-1:chat-1',
      retry_count: 12,
      error: 'Kafka unavailable',
      upsert: {
        ...makePayload().upsert,
        event_id: 'legacy-event-1',
      },
    };
    redis.zsets.set(
      parkingKey,
      new Map([
        [validMember, 0],
        [invalidMember, 0],
      ])
    );
    redis.hashes.set(
      payloadKey,
      new Map([
        [validMember, JSON.stringify(validParking)],
        [invalidMember, JSON.stringify({ malformed: true })],
      ])
    );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await (service as any).requeueLegacyProviderParking(
        'wwebjs',
        'worker-1',
        scope
      );
    } finally {
      errorSpy.mockRestore();
    }

    expect(redis.zsets.get(parkingKey)?.size ?? 0).toBe(0);
    expect(redis.hashes.get(payloadKey)?.size ?? 0).toBe(0);
    expect(redis.zsets.get(retryKey)?.has(validMember)).toBe(true);
    const recovered = JSON.parse(
      redis.hashes.get(retryHash)?.get(validMember) ?? '{}'
    ) as IInboundMessageSpoolPayload;
    expect(recovered).toEqual(
      expect.objectContaining({
        dedupe_key: 'legacy-event-1',
        attempts: 12,
        runtime_generation: '7',
        connection_epoch: 'epoch-7',
        received_at: validParking.parked_at,
      })
    );
    expect(redis.zsets.get(retryKey)?.has(invalidMember)).not.toBe(true);
  });

  it('rotates streams by runtime generation and connection epoch', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const publisher = jest.fn(async () => undefined);

    await service.publish(makePayload(), publisher);
    await service.publish(
      makePayload({
        runtime_generation: '8',
        connection_epoch: 'epoch-8',
        upsert: {
          ...makePayload().upsert,
          runtime_generation: '8',
          connection_epoch: 'epoch-8',
        },
      }),
      publisher
    );

    expect(
      redis.eval.mock.calls
        .filter(([script]) =>
          String(script).includes('inbound-provider-stream-store-v2')
        )
        .map(([, , key]) => key)
    ).toEqual([
      'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream',
      'inbound:message:wwebjs:worker-1:generation:8:epoch:epoch-8:stream',
    ]);
  });

  it('hands persisted entries from a previous runtime to the new publisher', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const previousPayload = makePayload();
    const previousScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    };
    const previousStream = service.streamKey(
      'wwebjs',
      'worker-1',
      previousScope
    );
    const publisher = jest.fn(async () => undefined);

    await service.publish(previousPayload, publisher);
    setRuntimeFence(redis, {
      runtime_generation: 8,
      connection_epoch: 'epoch-8',
    });
    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 8, connectionEpoch: 'epoch-8' },
      publisher,
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const resumed = (service as any).states.get(previousStream);
    expect(resumed?.loop).toEqual(expect.any(Function));
    await resumed.loop();

    expect(publisher).toHaveBeenCalledWith(previousPayload);
    expect(redis.streams.get(previousStream)?.size ?? 0).toBe(0);
    expect(redis.unlink).not.toHaveBeenCalled();

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 8,
      connectionEpoch: 'epoch-8',
    });
  });

  it('keeps a stream claimed by the replacement runtime when the old runtime stops late', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const previousScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    };
    const replacementScope = {
      runtimeGeneration: 8,
      connectionEpoch: 'epoch-8',
    };
    const previousStream = service.streamKey(
      'wwebjs',
      'worker-1',
      previousScope
    );
    const replacementStream = service.streamKey(
      'wwebjs',
      'worker-1',
      replacementScope
    );
    redis.streams.set(
      previousStream,
      new Map([['1-0', JSON.stringify(makePayload())]])
    );
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([previousStream])
    );
    setRuntimeFence(redis);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      previousScope,
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    setRuntimeFence(redis, {
      runtime_generation: 8,
      connection_epoch: 'epoch-8',
    });
    service.startPublisher(
      'wwebjs',
      'worker-1',
      replacementScope,
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const replacementOwner = (service as any).states.get(
      replacementStream
    )?.ownerKey;
    expect((service as any).states.get(previousStream)?.ownerKey).toBe(
      replacementOwner
    );

    await service.stopPublisher('wwebjs', 'worker-1', previousScope);

    expect((service as any).states.has(previousStream)).toBe(true);
    expect((service as any).states.has(replacementStream)).toBe(true);

    await service.stopPublisher('wwebjs', 'worker-1', replacementScope);
    expect((service as any).states.has(previousStream)).toBe(false);
    expect((service as any).states.has(replacementStream)).toBe(false);
  });

  it('pauses publishers without deleting durable state when a connection scope stops', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload();

    await service.publish(
      payload,
      jest.fn(async () => undefined)
    );

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });

    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();
    expect(
      redis.streams.get(
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream'
      )?.size
    ).toBe(1);
    expect(
      redis.sets.get('inbound:message:spool-index:v1:worker-1')?.size
    ).toBe(5);
  });

  it('registers every scope key when a publisher starts before any payload exists', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined)
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.sets.get('inbound:message:spool-index:v1:worker-1')).toEqual(
      new Set([
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:retry',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:retry-payloads',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:parking',
        'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:payloads',
      ])
    );

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('resumes historical scopes only when their indexed structures contain durable work', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const activeKey =
      'inbound:message:wwebjs:worker-1:generation:7:epoch:epoch-7:stream';
    const obsoleteKeys = [
      'inbound:message:wwebjs:worker-1:generation:6:epoch:old:stream',
      'inbound:message:baileys:worker-1:generation:7:epoch:old:retry',
      'inbound:message:whatsmeow:worker-1:stream',
    ];
    redis.streams.set(activeKey, new Map());
    redis.streams.set(
      obsoleteKeys[0],
      new Map([['1-0', JSON.stringify(makePayload())]])
    );
    redis.zsets.set(obsoleteKeys[1], new Map([['retry-1', 0]]));
    redis.streams.set(obsoleteKeys[2], new Map());
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set(obsoleteKeys.filter((key) => key.includes(':generation:')))
    );
    setRuntimeFence(redis);
    const guard = jest.fn(async () => true);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      guard
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.streams.has(activeKey)).toBe(true);
    expect(redis.streams.has(obsoleteKeys[0])).toBe(true);
    expect(redis.zsets.has(obsoleteKeys[1])).toBe(true);
    expect(redis.streams.has(obsoleteKeys[2])).toBe(true);
    expect(redis.sscan).toHaveBeenCalledWith(
      'inbound:message:spool-index:v1:worker-1',
      '0',
      'COUNT',
      100
    );
    expect(redis.scan).not.toHaveBeenCalled();
    expect((service as any).states.has(obsoleteKeys[0])).toBe(true);
    expect(
      (service as any).states.has(obsoleteKeys[1].replace(':retry', ':stream'))
    ).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(2);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('preserves consumer parking diagnostics outside provider spool rotation', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    redis.hashes.set(payloadKey, new Map([['event-1', '{"reason":"failed"}']]));
    redis.zsets.set(parkingKey, new Map([['event-1', 1]]));

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.hashes.get(payloadKey)?.has('event-1')).toBe(true);
    expect(redis.zsets.get(parkingKey)?.has('event-1')).toBe(true);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('stops resuming scopes as soon as the active-runtime guard rejects', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const firstObsolete =
      'inbound:message:wwebjs:worker-1:generation:6:epoch:old:stream';
    const winnerSpool =
      'inbound:message:whatsmeow:worker-1:generation:8:epoch:winner:stream';
    redis.streams.set(
      firstObsolete,
      new Map([['1-0', JSON.stringify(makePayload())]])
    );
    redis.streams.set(winnerSpool, new Map());
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([firstObsolete, winnerSpool])
    );
    setRuntimeFence(redis);
    const guard = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      guard
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.streams.has(firstObsolete)).toBe(true);
    expect(redis.streams.has(winnerSpool)).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
    expect((service as any).states.has(firstObsolete)).toBe(true);
    expect((service as any).states.has(winnerSpool)).toBe(false);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('neither prunes nor resumes a future replacement-provider scope', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const replacementSpool =
      'inbound:message:whatsmeow:worker-1:generation:8:epoch:winner:stream';
    redis.streams.set(
      replacementSpool,
      new Map([['1-0', JSON.stringify(makePayload())]])
    );
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([replacementSpool])
    );
    setRuntimeFence(redis);
    const guard = jest.fn(async () => true);
    const publisher = jest.fn(async () => undefined);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      publisher,
      guard
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(guard).toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.streams.has(replacementSpool)).toBe(true);
    expect((service as any).states.has(replacementSpool)).toBe(false);
    expect(publisher).not.toHaveBeenCalled();

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('preserves a historical scope when the runtime fence changes after the local guard', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const historicalStream =
      'inbound:message:wwebjs:worker-1:generation:6:epoch:old:stream';
    redis.streams.set(historicalStream, new Map());
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([historicalStream])
    );
    setRuntimeFence(redis);
    const guard = jest.fn(async () => {
      setRuntimeFence(redis, {
        runtime_generation: 8,
        connection_epoch: 'winner',
      });
      return true;
    });

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      guard
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.streams.has(historicalStream)).toBe(true);
    expect(
      redis.sets
        .get('inbound:message:spool-index:v1:worker-1')
        ?.has(historicalStream)
    ).toBe(true);
    expect((service as any).states.has(historicalStream)).toBe(false);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('preserves a payload that wins the Redis race immediately before atomic pruning', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const historicalStream =
      'inbound:message:wwebjs:worker-1:generation:6:epoch:raced:stream';
    redis.streams.set(historicalStream, new Map());
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([historicalStream])
    );
    setRuntimeFence(redis);
    const evalImplementation = redis.eval.getMockImplementation();
    if (!evalImplementation) {
      throw new Error('Redis test interpreter is not installed');
    }
    redis.eval.mockImplementationOnce(
      async (script: string, numberOfKeys: number, ...args: string[]) => {
        redis.streams.set(
          historicalStream,
          new Map([['1-0', JSON.stringify(makePayload())]])
        );
        return evalImplementation(script, numberOfKeys, ...args);
      }
    );

    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.streams.get(historicalStream)?.size).toBe(1);
    expect(
      redis.sets
        .get('inbound:message:spool-index:v1:worker-1')
        ?.has(historicalStream)
    ).toBe(true);
    expect((service as any).states.has(historicalStream)).toBe(true);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('atomically prunes every reference and empty key for a historical scope', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const historicalScope = {
      runtimeGeneration: 6,
      connectionEpoch: 'empty',
    };
    const historicalKeys = [
      service.streamKey('wwebjs', 'worker-1', historicalScope),
      service.retrySetKey('wwebjs', 'worker-1', historicalScope),
      service.retryPayloadHashKey('wwebjs', 'worker-1', historicalScope),
      service.parkingSetKey('wwebjs', 'worker-1', historicalScope),
      service.payloadHashKey('wwebjs', 'worker-1', historicalScope),
    ];
    redis.streams.set(historicalKeys[0], new Map());
    redis.zsets.set(historicalKeys[1], new Map());
    redis.hashes.set(historicalKeys[2], new Map());
    redis.zsets.set(historicalKeys[3], new Map());
    redis.hashes.set(historicalKeys[4], new Map());
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set(historicalKeys)
    );
    setRuntimeFence(redis);
    service.startPublisher(
      'wwebjs',
      'worker-1',
      { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.scan).not.toHaveBeenCalled();
    expect(historicalKeys.every((key) => !redis.streams.has(key))).toBe(true);
    expect(historicalKeys.every((key) => !redis.zsets.has(key))).toBe(true);
    expect(historicalKeys.every((key) => !redis.hashes.has(key))).toBe(true);
    expect(
      historicalKeys.every(
        (key) =>
          !redis.sets.get('inbound:message:spool-index:v1:worker-1')?.has(key)
      )
    ).toBe(true);
    expect((service as any).states.has(historicalKeys[0])).toBe(false);

    await service.stopPublisher('wwebjs', 'worker-1', {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    });
  });

  it('prunes an empty prior epoch in the same generation while preserving the current scope', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const previousScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'previous-epoch',
    };
    const activeScope = {
      runtimeGeneration: 7,
      connectionEpoch: 'epoch-7',
    };
    const historicalStream = service.streamKey(
      'wwebjs',
      'worker-1',
      previousScope
    );
    redis.streams.set(historicalStream, new Map());
    await redis.xgroup(
      'CREATE',
      historicalStream,
      'inbound-message-publisher',
      '0',
      'MKSTREAM'
    );
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set([historicalStream])
    );
    setRuntimeFence(redis);

    service.startPublisher(
      'wwebjs',
      'worker-1',
      activeScope,
      jest.fn(async () => undefined),
      async () => true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.streams.has(historicalStream)).toBe(false);
    expect(
      redis.sets
        .get('inbound:message:spool-index:v1:worker-1')
        ?.has(historicalStream)
    ).toBe(false);
    expect(
      [
        service.streamKey('wwebjs', 'worker-1', activeScope),
        service.retrySetKey('wwebjs', 'worker-1', activeScope),
        service.retryPayloadHashKey('wwebjs', 'worker-1', activeScope),
        service.parkingSetKey('wwebjs', 'worker-1', activeScope),
        service.payloadHashKey('wwebjs', 'worker-1', activeScope),
      ].every((key) =>
        redis.sets.get('inbound:message:spool-index:v1:worker-1')?.has(key)
      )
    ).toBe(true);

    await service.stopPublisher('wwebjs', 'worker-1', activeScope);
  });

  it.each([
    'stream',
    'retry',
    'retry-payloads',
    'parking',
    'payloads',
  ] as const)(
    'preserves and resumes a historical scope when %s contains data',
    async (nonEmptySuffix) => {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const historicalScope = {
        runtimeGeneration: 6,
        connectionEpoch: `has-${nonEmptySuffix}`,
      };
      const keys = {
        stream: service.streamKey('wwebjs', 'worker-1', historicalScope),
        retry: service.retrySetKey('wwebjs', 'worker-1', historicalScope),
        'retry-payloads': service.retryPayloadHashKey(
          'wwebjs',
          'worker-1',
          historicalScope
        ),
        parking: service.parkingSetKey('wwebjs', 'worker-1', historicalScope),
        payloads: service.payloadHashKey('wwebjs', 'worker-1', historicalScope),
      };
      const allKeys = Object.values(keys);
      if (nonEmptySuffix === 'stream') {
        redis.streams.set(
          keys.stream,
          new Map([['1-0', JSON.stringify(makePayload())]])
        );
      } else if (nonEmptySuffix === 'retry' || nonEmptySuffix === 'parking') {
        redis.zsets.set(keys[nonEmptySuffix], new Map([['member-1', 0]]));
      } else {
        redis.hashes.set(
          keys[nonEmptySuffix],
          new Map([['member-1', JSON.stringify(makePayload())]])
        );
      }
      redis.sets.set(
        'inbound:message:spool-index:v1:worker-1',
        new Set(allKeys)
      );
      setRuntimeFence(redis);

      service.startPublisher(
        'wwebjs',
        'worker-1',
        { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
        jest.fn(async () => undefined),
        async () => true
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(
        allKeys.every((key) =>
          redis.sets.get('inbound:message:spool-index:v1:worker-1')?.has(key)
        )
      ).toBe(true);
      expect((service as any).states.has(keys.stream)).toBe(true);

      await service.stopPublisher('wwebjs', 'worker-1', {
        runtimeGeneration: 7,
        connectionEpoch: 'epoch-7',
      });
    }
  );

  it.each(['retry', 'parking'] as const)(
    'repairs orphaned %s payload discovery in bounded pages without deleting payloads',
    async (source) => {
      const previousMax =
        process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS;
      process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS = '2';
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const activeScope = {
        runtimeGeneration: 7,
        connectionEpoch: 'epoch-7',
      };
      const historicalScope = {
        runtimeGeneration: 6,
        connectionEpoch: `orphaned-${source}`,
      };
      const sortedSetKey =
        source === 'retry'
          ? service.retrySetKey('wwebjs', 'worker-1', historicalScope)
          : service.parkingSetKey('wwebjs', 'worker-1', historicalScope);
      const payloadHashKey =
        source === 'retry'
          ? service.retryPayloadHashKey('wwebjs', 'worker-1', historicalScope)
          : service.payloadHashKey('wwebjs', 'worker-1', historicalScope);
      const payloads = new Map<string, string>();
      for (let index = 0; index < 5; index += 1) {
        payloads.set(
          `member-${index}`,
          JSON.stringify({
            ...makePayload(),
            next_attempt_at: 10_000 + index,
          })
        );
      }
      redis.hashes.set(payloadHashKey, new Map(payloads));
      setRuntimeFence(redis);
      const guard = jest.fn(async () => true);
      const warningSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        await expect(
          (service as any).repairHistoricalScopeDiscoveryPair(
            'wwebjs',
            'worker-1',
            activeScope,
            'wwebjs',
            historicalScope,
            sortedSetKey,
            payloadHashKey,
            source,
            guard
          )
        ).resolves.toBe('complete');

        expect(redis.hashes.get(payloadHashKey)).toEqual(payloads);
        expect(redis.zsets.get(sortedSetKey)).toEqual(
          new Map([
            ['member-0', 10_000],
            ['member-1', 10_001],
            ['member-2', 10_002],
            ['member-3', 10_003],
            ['member-4', 10_004],
          ])
        );
        expect(redis.eval).toHaveBeenCalledTimes(3);
        expect(guard).toHaveBeenCalledTimes(2);
        expect(warningSpy).toHaveBeenCalledWith(
          '[InboundMessageSpool] indexed payload discovery repair yielded:',
          expect.objectContaining({
            source,
            payloads_examined: 2,
            max_payloads_per_page: 2,
          })
        );
      } finally {
        warningSpy.mockRestore();
        if (previousMax === undefined) {
          delete process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS;
        } else {
          process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS =
            previousMax;
        }
      }
    }
  );

  it('yields at the indexed pruning budget and continues from the pending page', async () => {
    const previousMax =
      process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS;
    process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS = '2';
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const obsoleteKeys = [
      'inbound:message:wwebjs:worker-1:generation:4:epoch:old-4:stream',
      'inbound:message:wwebjs:worker-1:generation:5:epoch:old-5:stream',
      'inbound:message:wwebjs:worker-1:generation:6:epoch:old-6:stream',
    ];
    for (const key of obsoleteKeys) {
      redis.streams.set(key, new Map());
    }
    redis.sets.set(
      'inbound:message:spool-index:v1:worker-1',
      new Set(obsoleteKeys)
    );
    setRuntimeFence(redis);
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      service.startPublisher(
        'wwebjs',
        'worker-1',
        { runtimeGeneration: 7, connectionEpoch: 'epoch-7' },
        jest.fn(async () => undefined),
        async () => true
      );
      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      expect(redis.streams.has(obsoleteKeys[0])).toBe(false);
      expect(redis.streams.has(obsoleteKeys[1])).toBe(false);
      expect(redis.streams.has(obsoleteKeys[2])).toBe(false);
      expect((service as any).states.has(obsoleteKeys[0])).toBe(false);
      expect((service as any).states.has(obsoleteKeys[1])).toBe(false);
      expect((service as any).states.has(obsoleteKeys[2])).toBe(false);
      expect(redis.eval).toHaveBeenCalledTimes(3);
      expect(redis.scan).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[InboundMessageSpool] indexed resume page yielded:',
        expect.objectContaining({
          worker_id: 'worker-1',
          indexed_keys_examined: 2,
          max_indexed_keys_per_page: 2,
        })
      );

      await service.stopPublisher('wwebjs', 'worker-1', {
        runtimeGeneration: 7,
        connectionEpoch: 'epoch-7',
      });
    } finally {
      warnSpy.mockRestore();
      if (previousMax === undefined) {
        delete process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS;
      } else {
        process.env.INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS =
          previousMax;
      }
    }
  });

  it('eventually prunes missing scope references beyond 500 indexed keys', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const indexKey = 'inbound:message:spool-index:v1:worker-1';
    const indexedKeys: string[] = [];

    for (let generation = 1; generation <= 101; generation += 1) {
      const prefix = `inbound:message:wwebjs:worker-1:generation:${generation}:epoch:old-${generation}`;
      indexedKeys.push(
        `${prefix}:stream`,
        `${prefix}:retry`,
        `${prefix}:retry-payloads`,
        `${prefix}:parking`,
        `${prefix}:payloads`
      );
    }
    redis.sets.set(indexKey, new Set(indexedKeys));
    const lastStream =
      'inbound:message:wwebjs:worker-1:generation:101:epoch:old-101:stream';
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    setRuntimeFence(redis, {
      runtime_generation: 102,
      connection_epoch: 'epoch-102',
    });

    try {
      service.startPublisher(
        'wwebjs',
        'worker-1',
        { runtimeGeneration: 102, connectionEpoch: 'epoch-102' },
        jest.fn(async () => undefined),
        async () => true
      );
      for (let turn = 0; turn < 6; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      expect(indexedKeys.length).toBeGreaterThan(500);
      expect((service as any).states.has(lastStream)).toBe(false);
      expect(redis.sets.get(indexKey)?.has(lastStream)).toBe(false);
      expect(redis.eval).toHaveBeenCalledTimes(101);
      expect(warnSpy).toHaveBeenCalledWith(
        '[InboundMessageSpool] indexed resume page yielded:',
        expect.objectContaining({
          worker_id: 'worker-1',
          page: 1,
          indexed_keys_examined: 500,
          max_indexed_keys_per_page: 500,
        })
      );

      await service.stopPublisher('wwebjs', 'worker-1', {
        runtimeGeneration: 102,
        connectionEpoch: 'epoch-102',
      });
    } finally {
      warnSpy.mockRestore();
    }
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
    expect(
      redis.sets.get('inbound:message:message_upsert_consumer:parking-index:v1')
    ).toEqual(
      new Set([
        'inbound:message:message_upsert_consumer:message-upsert:parking',
      ])
    );
  });

  it('keeps the Kafka offset fail-closed when consumer parking indexing fails after durable storage', async () => {
    const redis = makeRedis();
    redis.sadd.mockRejectedValueOnce(new Error('redis index unavailable'));
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makeConsumerParking();

    await expect(service.parkConsumerMessage(payload)).rejects.toThrow(
      'redis index unavailable'
    );

    expect(
      redis.hashes.get(
        'inbound:message:message_upsert_consumer:worker-1:payloads'
      )?.size
    ).toBe(1);
    expect(
      redis.zsets.get(
        'inbound:message:message_upsert_consumer:worker-1:parking'
      )?.size
    ).toBe(1);
  });

  it('discovers and terminalizes legacy consumer records without a Redis clock', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makeConsumerParking({
      reason: 'consecutive_failures_exhausted',
      dedupe_key: undefined,
    });
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'upsert.message:8:100';
    redis.zsets.set(parkingKey, new Map([[member, 1]]));
    redis.hashes.set(payloadKey, new Map([[member, JSON.stringify(payload)]]));
    const publisher = jest.fn(async () => {
      expect(redis.hashes.get(payloadKey)?.has(member)).toBe(true);
      return 'published' as const;
    });
    const state = installConsumerRedriveState(
      service,
      publisher,
      'legacy-migration-owner'
    );

    await (service as any).runMessageUpsertConsumerRedriveOnce(state);

    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'inbound:message:message_upsert_consumer:*:parking',
      'COUNT',
      5000
    );
    expect(publisher).not.toHaveBeenCalled();
    expect(redis.hashes.get(payloadKey)?.has(member)).toBe(false);
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(false);
    expect(readOnlyConsumerTerminalPayload(redis).payload).toEqual(
      expect.objectContaining({ terminal_reason: 'max_age' })
    );
    await service.stopMessageUpsertConsumerRedrive();
  });

  it('elects one global leader so two service pods perform one scan and one publish', async () => {
    const redis = makeRedis();
    const first = new InboundMessageSpoolService(redis as never);
    const second = new InboundMessageSpoolService(redis as never);
    await first.parkConsumerMessage(
      makeConsumerParking({ next_attempt_at: 1 })
    );
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);
    const firstState = installConsumerRedriveState(
      first,
      publisher,
      'service-pod-1'
    );
    const secondState = installConsumerRedriveState(
      second,
      publisher,
      'service-pod-2'
    );

    await Promise.all([
      (first as any).runMessageUpsertConsumerRedriveOnce(firstState),
      (second as any).runMessageUpsertConsumerRedriveOnce(secondState),
    ]);

    expect(redis.scan).toHaveBeenCalledTimes(1);
    expect(publisher).toHaveBeenCalledTimes(1);
    expect(
      redis.strings.get(
        'inbound:message:message_upsert_consumer:redrive-leader:v1'
      )
    ).toBe('service-pod-1');
    await first.stopMessageUpsertConsumerRedrive();
    await second.stopMessageUpsertConsumerRedrive();
  });

  it('releases leadership on shutdown and lets a standby pod take over', async () => {
    const redis = makeRedis();
    const first = new InboundMessageSpoolService(redis as never);
    const second = new InboundMessageSpoolService(redis as never);
    const firstPublisher = jest.fn(async () => 'published' as const);
    const secondPublisher = jest.fn(async () => 'published' as const);
    const firstState = installConsumerRedriveState(
      first,
      firstPublisher,
      'service-pod-1'
    );
    const secondState = installConsumerRedriveState(
      second,
      secondPublisher,
      'service-pod-2'
    );

    await (first as any).runMessageUpsertConsumerRedriveOnce(firstState);
    await (second as any).runMessageUpsertConsumerRedriveOnce(secondState);
    expect(
      redis.strings.get(
        'inbound:message:message_upsert_consumer:redrive-leader:v1'
      )
    ).toBe('service-pod-1');

    await first.stopMessageUpsertConsumerRedrive();
    await second.parkConsumerMessage(
      makeConsumerParking({ next_attempt_at: 1 })
    );
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    redis.zsets
      .get(parkingKey)
      ?.set('message_upsert_consumer:dedupe:semantic-event-1', 1);
    await (second as any).runMessageUpsertConsumerRedriveOnce(secondState);

    expect(secondPublisher).toHaveBeenCalledTimes(1);
    expect(
      redis.strings.get(
        'inbound:message:message_upsert_consumer:redrive-leader:v1'
      )
    ).toBe('service-pod-2');
    await second.stopMessageUpsertConsumerRedrive();
  });

  it('drains an in-flight redrive before releasing global leadership', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    let finishRedrive!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      finishRedrive = resolve;
    });
    const state = installConsumerRedriveState(
      service,
      jest.fn(async () => 'published' as const),
      'draining-pod'
    );
    state.running = true;
    state.leaderOwned = true;
    state.leaderLeaseValidUntil = Date.now() + 30_000;
    state.inFlight = inFlight;
    redis.strings.set(
      'inbound:message:message_upsert_consumer:redrive-leader:v1',
      'draining-pod'
    );

    const stopping = service.stopMessageUpsertConsumerRedrive();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      redis.strings.get(
        'inbound:message:message_upsert_consumer:redrive-leader:v1'
      )
    ).toBe('draining-pod');

    finishRedrive();
    await stopping;

    expect(
      redis.strings.has(
        'inbound:message:message_upsert_consumer:redrive-leader:v1'
      )
    ).toBe(false);
  });

  it('persists one bounded legacy scan page per tick and completes after a quiet verification pass', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const firstKey = 'inbound:message:message_upsert_consumer:legacy-1:parking';
    const secondKey =
      'inbound:message:message_upsert_consumer:legacy-2:parking';
    redis.scan
      .mockResolvedValueOnce(['42', [firstKey]])
      .mockResolvedValueOnce(['0', [secondKey]])
      .mockResolvedValueOnce(['0', [firstKey, secondKey]]);
    const publisher = jest.fn(async () => 'published' as const);
    const state = installConsumerRedriveState(
      service,
      publisher,
      'migration-pod'
    );

    try {
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      let migrationState = JSON.parse(
        redis.strings.get(
          'inbound:message:message_upsert_consumer:legacy-migration:v2'
        ) ?? '{}'
      );
      expect(migrationState).toEqual(
        expect.objectContaining({ cursor: '42', pass: 1, complete: false })
      );
      expect(redis.scan).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_999);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      expect(redis.scan).toHaveBeenCalledTimes(1);

      now.mockReturnValue(2_000);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      migrationState = JSON.parse(
        redis.strings.get(
          'inbound:message:message_upsert_consumer:legacy-migration:v2'
        ) ?? '{}'
      );
      expect(migrationState).toEqual(
        expect.objectContaining({ cursor: '0', pass: 2, complete: false })
      );
      expect(redis.scan).toHaveBeenCalledTimes(2);

      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      expect(redis.scan).toHaveBeenCalledTimes(2);

      now.mockReturnValue(302_001);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      migrationState = JSON.parse(
        redis.strings.get(
          'inbound:message:message_upsert_consumer:legacy-migration:v2'
        ) ?? '{}'
      );
      expect(redis.scan).toHaveBeenCalledTimes(3);
      expect(migrationState).toEqual(
        expect.objectContaining({ cursor: '0', pass: 2, complete: true })
      );
      for (const call of redis.scan.mock.calls) {
        expect(call).toEqual([
          expect.any(String),
          'MATCH',
          'inbound:message:message_upsert_consumer:*:parking',
          'COUNT',
          5000,
        ]);
      }
    } finally {
      await service.stopMessageUpsertConsumerRedrive();
      now.mockRestore();
    }
  });

  it('periodically audits completed legacy migration and recovers a key created behind the cursor', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const orphanKey =
      'inbound:message:message_upsert_consumer:late-legacy:parking';
    redis.strings.set(
      'inbound:message:message_upsert_consumer:legacy-migration:v2',
      JSON.stringify({
        cursor: '0',
        pass: 2,
        newKeysInPass: 0,
        resumeAt: 1_000,
        complete: true,
      })
    );
    redis.scan
      .mockResolvedValueOnce(['42', []])
      .mockResolvedValueOnce(['0', []])
      .mockResolvedValueOnce(['0', [orphanKey]]);
    const state = installConsumerRedriveState(
      service,
      jest.fn(async () => 'published' as const),
      'audit-pod'
    );

    try {
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      redis.zsets.set(orphanKey, new Map([['late-event', 10_000_000]]));

      now.mockReturnValue(1_999);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      expect(redis.scan).toHaveBeenCalledTimes(1);

      now.mockReturnValue(2_000);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      expect(
        redis.sets
          .get('inbound:message:message_upsert_consumer:parking-index:v1')
          ?.has(orphanKey)
      ).not.toBe(true);

      now.mockReturnValue(302_001);
      await (service as any).runMessageUpsertConsumerRedriveOnce(state);
      expect(
        redis.sets
          .get('inbound:message:message_upsert_consumer:parking-index:v1')
          ?.has(orphanKey)
      ).toBe(true);
      expect(redis.scan).toHaveBeenCalledTimes(3);
    } finally {
      await service.stopMessageUpsertConsumerRedrive();
      now.mockRestore();
    }
  });

  it('limits global redrive work to ten candidate members per tick', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const indexKey = 'inbound:message:message_upsert_consumer:parking-index:v1';
    redis.strings.set(
      'inbound:message:message_upsert_consumer:legacy-migration:v2',
      JSON.stringify({
        cursor: '0',
        pass: 2,
        newKeysInPass: 0,
        resumeAt: 0,
        complete: true,
      })
    );
    for (let index = 0; index < 12; index += 1) {
      const workerId = `worker-${index}`;
      const parkingKey = `inbound:message:message_upsert_consumer:${workerId}:parking`;
      const payloadKey = `inbound:message:message_upsert_consumer:${workerId}:payloads`;
      const member = `event-${index}`;
      redis.zsets.set(parkingKey, new Map([[member, 1]]));
      redis.hashes.set(
        payloadKey,
        new Map([
          [
            member,
            JSON.stringify(
              makeConsumerParking({
                worker_id: workerId,
                first_parked_at: String(Date.now()),
              })
            ),
          ],
        ])
      );
      const indexed = redis.sets.get(indexKey) ?? new Set<string>();
      indexed.add(parkingKey);
      redis.sets.set(indexKey, indexed);
    }
    const publisher = jest.fn(async () => 'published' as const);
    const state = installConsumerRedriveState(
      service,
      publisher,
      'bounded-redrive-pod'
    );

    await (service as any).runMessageUpsertConsumerRedriveOnce(state);

    expect(publisher).toHaveBeenCalledTimes(10);
    expect(state.pendingParkingKeys.length).toBeGreaterThan(0);
    await service.stopMessageUpsertConsumerRedrive();
  });

  it('prunes expired DLT index members on every leader tick', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const now = Date.now();
      const terminalIndexKey =
        'inbound:message:message_upsert_consumer:terminal-index:v1';
      redis.zsets.set(
        terminalIndexKey,
        new Map([
          ['expired-terminal-record', now - 1],
          ['live-terminal-record', now + 60_000],
        ])
      );
      const state = installConsumerRedriveState(
        service,
        jest.fn(async () => 'published' as const),
        'terminal-pruner'
      );

      await (service as any).runMessageUpsertConsumerRedriveOnce(state);

      expect(redis.zsets.get(terminalIndexKey)).toEqual(
        new Map([['live-terminal-record', now + 60_000]])
      );
      await service.stopMessageUpsertConsumerRedrive();
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows only one of many service pods to claim the same parked record', async () => {
    const redis = makeRedis();
    const first = new InboundMessageSpoolService(redis as never);
    const second = new InboundMessageSpoolService(redis as never);
    const payload = makeConsumerParking({ next_attempt_at: 1 });
    await first.parkConsumerMessage(payload);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);

    await Promise.all([
      (first as any).processConsumerParkingKey(parkingKey, publisher),
      (second as any).processConsumerParkingKey(parkingKey, publisher),
    ]);

    expect(publisher).toHaveBeenCalledTimes(1);
  });

  it('reschedules a producer failure with bounded internal backoff and preserves the record', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makeConsumerParking({ next_attempt_at: 1, retry_count: 1 });
    await service.parkConsumerMessage(payload);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const before = Date.now();

    await (service as any).processConsumerParkingKey(
      parkingKey,
      jest.fn(async () => {
        throw new Error('kafka producer unavailable');
      })
    );

    const stored = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(stored.retry_count).toBe(2);
    expect(stored.error).toBe('kafka producer unavailable');
    expect(stored.next_attempt_at).toBeGreaterThanOrEqual(before + 2000);
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(true);
  });

  it('does not delete a concurrent rewrite after publish completion', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const original = makeConsumerParking({ next_attempt_at: 1 });
    const rewritten = {
      ...original,
      retry_count: 2,
      error: 'newer parking failure',
    };
    await service.parkConsumerMessage(original);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);

    await (service as any).processConsumerParkingKey(
      parkingKey,
      jest.fn(async () => {
        await service.parkConsumerMessage(rewritten);
        return 'published' as const;
      })
    );

    const storedRewrite = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(storedRewrite).toEqual(
      expect.objectContaining({
        error: 'newer parking failure',
        retry_count: 2,
      })
    );
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(true);
    expect(redis.zsets.get(parkingKey)?.get(member)).toBe(
      storedRewrite.next_attempt_at
    );
  });

  it('does not terminalize or delete a concurrent rewrite after a terminal disposition', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const original = makeConsumerParking({ next_attempt_at: 1 });
    const rewritten = {
      ...original,
      retry_count: 2,
      error: 'newer transient failure',
    };
    await service.parkConsumerMessage(original);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);

    await (service as any).processConsumerParkingKey(
      parkingKey,
      jest.fn(async () => {
        await service.parkConsumerMessage(rewritten);
        return 'ignored' as const;
      })
    );

    const storedRewrite = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(storedRewrite).toEqual(
      expect.objectContaining({
        error: 'newer transient failure',
        retry_count: 2,
      })
    );
    expect(redis.zsets.get(parkingKey)?.get(member)).toBe(
      storedRewrite.next_attempt_at
    );
    expect(
      redis.zsets.get(
        'inbound:message:message_upsert_consumer:terminal-index:v1'
      )
    ).toBeUndefined();
  });

  it('keeps semantic retry lineage across publish and repark cycles with a capped backoff', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    const basePayload = makeConsumerParking({ retry_count: 1 });
    const publish = jest.fn(async () => 'published' as const);
    await service.parkConsumerMessage(basePayload);
    const firstStoredAt = (
      JSON.parse(
        redis.hashes.get(payloadKey)?.get(member) ?? '{}'
      ) as IInboundMessageParkingPayload
    ).first_parked_at;
    redis.zsets.get(parkingKey)?.set(member, 1);
    await (service as any).processConsumerParkingKey(parkingKey, publish);
    expect(redis.hashes.get(payloadKey)?.has(member)).toBe(false);

    const secondStartedAt = Date.now();
    await service.parkConsumerMessage({
      ...basePayload,
      parked_at: new Date(
        Date.parse(basePayload.parked_at) + 60_000
      ).toISOString(),
      retry_count: 2,
      upsert: {
        ...(basePayload.upsert ?? makePayload().upsert),
        consumer_redrive_attempt: 1,
      },
    });
    let stored = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(stored.retry_count).toBe(2);
    expect(stored.first_parked_at).toBe(firstStoredAt);
    expect(stored.next_attempt_at).toBeGreaterThanOrEqual(
      secondStartedAt + 2000
    );

    redis.zsets.get(parkingKey)?.set(member, 1);
    await (service as any).processConsumerParkingKey(parkingKey, publish);
    await service.parkConsumerMessage({
      ...basePayload,
      retry_count: 3,
      upsert: {
        ...(basePayload.upsert ?? makePayload().upsert),
        consumer_redrive_attempt: 2,
      },
    });
    stored = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(stored.retry_count).toBe(3);

    for (let retryCount = 4; retryCount <= 12; retryCount += 1) {
      await service.parkConsumerMessage({
        ...basePayload,
        retry_count: retryCount,
      });
    }
    const cappedAt = Date.now();
    stored = JSON.parse(
      redis.hashes.get(payloadKey)?.get(member) ?? '{}'
    ) as IInboundMessageParkingPayload;
    expect(stored.retry_count).toBe(12);
    expect(stored.next_attempt_at).toBeGreaterThanOrEqual(cappedAt + 59_000);
    expect(stored.next_attempt_at).toBeLessThanOrEqual(cappedAt + 60_000);
    expect(redis.hashes.get(payloadKey)?.size).toBe(1);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('keeps the oldest Redis consumer clock when payload and lineage diverge', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const payload = makeConsumerParking();
      const parkingKey =
        'inbound:message:message_upsert_consumer:worker-1:parking';
      const payloadKey =
        'inbound:message:message_upsert_consumer:worker-1:payloads';
      const member = 'message_upsert_consumer:dedupe:semantic-event-1';
      await service.parkConsumerMessage(payload);
      const original = JSON.parse(
        redis.hashes.get(payloadKey)?.get(member) ?? '{}'
      ) as IInboundMessageParkingPayload;
      const oldest = Number(original.first_parked_at);
      redis.hashes.get(payloadKey)?.set(
        member,
        JSON.stringify({
          ...original,
          first_parked_at: String(oldest + 30_000),
        })
      );

      await service.parkConsumerMessage(payload);

      const stored = JSON.parse(
        redis.hashes.get(payloadKey)?.get(member) ?? '{}'
      ) as IInboundMessageParkingPayload;
      expect(stored.first_parked_at).toBe(String(oldest));
      expect(redis.zsets.get(parkingKey)?.has(member)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retains an ignored terminal record in the bounded DLT', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(
      makeConsumerParking({ next_attempt_at: 1 })
    );
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => {
      expect(redis.hashes.get(payloadKey)?.has(member)).toBe(true);
      return 'ignored' as const;
    });

    await (service as any).processConsumerParkingKey(parkingKey, publisher);

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(redis.hashes.get(payloadKey)?.has(member)).toBe(false);
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(false);
    expect(redis.hashes.get(`${parkingKey}:claims`)?.has(member)).toBe(false);
    expect(
      redis.sets
        .get('inbound:message:message_upsert_consumer:parking-index:v1')
        ?.has(parkingKey)
    ).toBe(false);
    expect(redis.expirations.has(payloadKey)).toBe(false);
    const terminal = readOnlyConsumerTerminalPayload(redis);
    expect(terminal.payload).toEqual(
      expect.objectContaining({
        terminal_reason: 'permanent',
        terminalized_at: expect.any(String),
        first_parked_at: expect.any(String),
        raw_meta: expect.objectContaining({ redrive_disposition: 'ignored' }),
      })
    );
    expect(redis.expirations.get(terminal.key)).toBe(30 * 24 * 60 * 60 * 1000);

    await service.parkConsumerMessage(
      makeConsumerParking({ next_attempt_at: 1 })
    );
    expect(redis.expirations.has(payloadKey)).toBe(false);
    expect(redis.hashes.get(payloadKey)?.has(member)).toBe(false);
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(false);
    await (service as any).processConsumerParkingKey(parkingKey, publisher);
    expect(publisher).toHaveBeenCalledTimes(1);
  });

  it('rechecks a legacy replica-only account-or-worker miss in the new consumer', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(
      makeConsumerParking({
        error: 'Account or Worker not found: account=gone, worker=gone',
      })
    );
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);

    await (service as any).processConsumerParkingKey(parkingKey, publisher);

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(
      redis.zsets.get(
        'inbound:message:message_upsert_consumer:terminal-index:v1'
      )
    ).toBeUndefined();
  });

  it('does not classify an unrelated transient lookup failure as permanent', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(
      makeConsumerParking({
        error: 'Database unavailable while loading Account or Worker',
      })
    );
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);

    await (service as any).processConsumerParkingKey(parkingKey, publisher);

    expect(publisher).toHaveBeenCalledTimes(1);
    expect(
      redis.zsets.get(
        'inbound:message:message_upsert_consumer:terminal-index:v1'
      )
    ).toBeUndefined();
  });

  it('terminalizes a consumer record after its attempt budget', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(makeConsumerParking({ retry_count: 12 }));
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);

    await (service as any).processConsumerParkingKey(parkingKey, publisher);

    expect(publisher).not.toHaveBeenCalled();
    expect(readOnlyConsumerTerminalPayload(redis).payload).toEqual(
      expect.objectContaining({ terminal_reason: 'max_attempts' })
    );
  });

  it('publishes a fresh fromMe retry inside the five-minute window', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const base = makeConsumerParking({
        first_parked_at: '2026-08-17T12:00:00.000Z',
      });
      await service.parkConsumerMessage({
        ...base,
        upsert: {
          ...(base.upsert ?? makePayload().upsert),
          message: {
            ...(base.upsert ?? makePayload().upsert).message,
            key: {
              ...(base.upsert ?? makePayload().upsert).message.key,
              fromMe: true,
            },
          },
        },
      });
      jest.setSystemTime(new Date('2026-08-17T12:04:59.999Z'));
      const parkingKey =
        'inbound:message:message_upsert_consumer:worker-1:parking';
      const member = 'message_upsert_consumer:dedupe:semantic-event-1';
      redis.zsets.get(parkingKey)?.set(member, 1);
      const publisher = jest.fn(
        async (_payload: IInboundMessageParkingPayload) => 'published' as const
      );

      await (service as any).processConsumerParkingKey(parkingKey, publisher);

      expect(publisher).toHaveBeenCalledTimes(1);
      expect(publisher).toHaveBeenCalledWith(
        expect.objectContaining({
          upsert: expect.objectContaining({
            message: expect.objectContaining({
              key: expect.objectContaining({ fromMe: true }),
            }),
          }),
        })
      );
      expect(
        redis.zsets.get(
          'inbound:message:message_upsert_consumer:terminal-index:v1'
        )
      ).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('terminalizes at exactly five minutes without calling the Kafka publisher', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      const base = makeConsumerParking({
        first_parked_at: '2026-08-17T12:00:00.000Z',
        retry_count: 12,
        stage: 'message_upsert.discard.terminal',
        error: 'expired-secret-error',
        raw_meta: { secret: 'expired-secret-meta' },
      });
      await service.parkConsumerMessage({
        ...base,
        raw_payload: 'expired-secret-raw-payload',
        upsert: {
          ...(base.upsert ?? makePayload().upsert),
          message: {
            ...(base.upsert ?? makePayload().upsert).message,
            message: { conversation: 'expired-secret-upsert' },
          },
        },
      });
      const firstStoredAt = String(Date.now());
      jest.setSystemTime(new Date('2026-08-17T12:05:00.000Z'));
      const parkingKey =
        'inbound:message:message_upsert_consumer:worker-1:parking';
      const member = 'message_upsert_consumer:dedupe:semantic-event-1';
      redis.zsets.get(parkingKey)?.set(member, 1);
      const publisher = jest.fn(async () => 'published' as const);

      await (service as any).processConsumerParkingKey(parkingKey, publisher);

      expect(publisher).not.toHaveBeenCalled();
      const terminal = readOnlyConsumerTerminalPayload(redis).payload;
      expect(terminal).toEqual(
        expect.objectContaining({
          first_parked_at: firstStoredAt,
          terminal_reason: 'max_age',
          upsert: null,
          raw_payload: null,
        })
      );
      expect(JSON.stringify(terminal)).not.toContain('expired-secret');
      expect(redis.zsets.get(parkingKey)?.has(member)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rechecks Redis TIME per consumer member and strips expired message content', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-17T12:00:00.000Z') });
    try {
      const redis = makeRedis();
      const service = new InboundMessageSpoolService(redis as never);
      for (const [index, dedupeKey] of [
        'first-consumer-member',
        'secret-dedupe-value',
      ].entries()) {
        const base = makeConsumerParking();
        await service.parkConsumerMessage(
          makeConsumerParking({
            dedupe_key: dedupeKey,
            raw_payload: index === 1 ? 'sensitive-old-message' : undefined,
            raw_meta:
              index === 1 ? { secret: 'sensitive-raw-meta' } : undefined,
            error: index === 1 ? 'sensitive-error' : undefined,
            kafka_key:
              index === 1 ? '5511999999999@s.whatsapp.net' : base.kafka_key,
            upsert:
              index === 1
                ? {
                    ...(base.upsert ?? makePayload().upsert),
                    message: {
                      ...(base.upsert ?? makePayload().upsert).message,
                      message: { conversation: 'sensitive-upsert-secret' },
                    },
                  }
                : base.upsert,
          })
        );
      }
      const parkingKey =
        'inbound:message:message_upsert_consumer:worker-1:parking';
      for (const member of redis.zsets.get(parkingKey)?.keys() ?? []) {
        redis.zsets.get(parkingKey)?.set(member, 1);
      }
      jest.setSystemTime(new Date('2026-08-17T12:04:59.999Z'));
      const publisher = jest.fn(async () => {
        jest.setSystemTime(new Date('2026-08-17T12:05:00.000Z'));
        return 'published' as const;
      });

      await (service as any).processConsumerParkingKey(parkingKey, publisher);

      expect(publisher).toHaveBeenCalledTimes(1);
      const terminal = readOnlyConsumerTerminalPayload(redis).payload;
      expect(terminal).toEqual(
        expect.objectContaining({
          terminal_reason: 'max_age',
          upsert: null,
          raw_payload: null,
        })
      );
      const serializedTerminal = JSON.stringify(terminal);
      for (const secret of [
        'sensitive-old-message',
        'sensitive-raw-meta',
        'sensitive-error',
        'sensitive-upsert-secret',
        '5511999999999@s.whatsapp.net',
        'secret-dedupe-value',
      ]) {
        expect(serializedTerminal).not.toContain(secret);
      }
      expect(terminal.raw_meta).toBeUndefined();
      expect(terminal.error).toBeUndefined();
      expect(terminal.kafka_key).toBeUndefined();
      expect(terminal.dedupe_key).toBeUndefined();
      expect(redis.zsets.get(parkingKey)?.size ?? 0).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records the bounded publisher error while preserving max-attempts as the terminal cause', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(makeConsumerParking({ retry_count: 11 }));
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const oversizedError = `producer unavailable ${'x'.repeat(10_000)}`;

    await (service as any).processConsumerParkingKey(
      parkingKey,
      jest.fn(async () => {
        throw new Error(oversizedError);
      })
    );

    const terminal = readOnlyConsumerTerminalPayload(redis).payload;
    expect(terminal.terminal_reason).toBe('max_attempts');
    expect(Buffer.byteLength(terminal.error ?? '', 'utf8')).toBeLessThanOrEqual(
      4 * 1024
    );
    expect(
      Buffer.byteLength(
        String(terminal.raw_meta?.publisher_error ?? ''),
        'utf8'
      )
    ).toBeLessThanOrEqual(4 * 1024);
  });

  it('caps an invalid raw payload at 64 KiB before retaining it in the DLT', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const payloadKey =
      'inbound:message:message_upsert_consumer:worker-1:payloads';
    const member = 'invalid-event';
    const invalidPayload = `not-json:${'á'.repeat(100_000)}`;
    redis.zsets.set(parkingKey, new Map([[member, 1]]));
    redis.hashes.set(payloadKey, new Map([[member, invalidPayload]]));

    await (service as any).processConsumerParkingKey(
      parkingKey,
      jest.fn(async () => 'published' as const)
    );

    const terminal = readOnlyConsumerTerminalPayload(redis).payload;
    expect(terminal.terminal_reason).toBe('permanent');
    expect(
      Buffer.byteLength(terminal.raw_payload ?? '', 'utf8')
    ).toBeLessThanOrEqual(64 * 1024);
  });

  it('refuses a claim fenced by a different global redrive leader', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    await service.parkConsumerMessage(makeConsumerParking());
    const parkingKey =
      'inbound:message:message_upsert_consumer:worker-1:parking';
    const member = 'message_upsert_consumer:dedupe:semantic-event-1';
    redis.zsets.get(parkingKey)?.set(member, 1);
    const publisher = jest.fn(async () => 'published' as const);
    const state = installConsumerRedriveState(
      service,
      publisher,
      'stale-leader'
    );
    redis.strings.set(
      'inbound:message:message_upsert_consumer:redrive-leader:v1',
      'current-leader'
    );

    await (service as any).processConsumerParkingKey(
      parkingKey,
      publisher,
      10,
      state
    );

    expect(publisher).not.toHaveBeenCalled();
    expect(redis.zsets.get(parkingKey)?.has(member)).toBe(true);
  });

  it('stores retry discovery and payload atomically', async () => {
    const redis = makeRedis();
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload({
      attempts: 1,
      next_attempt_at: 1234,
    });
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };

    await (service as any).storeRetry('wwebjs', 'worker-1', scope, payload);

    const member = 'wwebjs:worker-1:7:epoch-7:message-key-1';
    const retryHash = service.retryPayloadHashKey('wwebjs', 'worker-1', scope);
    const retrySet = service.retrySetKey('wwebjs', 'worker-1', scope);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      retryHash,
      retrySet,
      member,
      JSON.stringify(payload),
      '1234',
      ''
    );
    expect(redis.hashes.get(retryHash)?.get(member)).toBe(
      JSON.stringify(payload)
    );
    expect(redis.zsets.get(retrySet)?.get(member)).toBe(1234);
    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('never exposes half of a retry record when the atomic Redis write fails', async () => {
    const redis = makeRedis();
    redis.eval.mockRejectedValueOnce(new Error('redis transaction failed'));
    const service = new InboundMessageSpoolService(redis as never);
    const payload = makePayload({ attempts: 1, next_attempt_at: 1234 });
    const scope = { runtimeGeneration: 7, connectionEpoch: 'epoch-7' };

    await expect(
      (service as any).storeRetry('wwebjs', 'worker-1', scope, payload)
    ).rejects.toThrow('redis transaction failed');

    expect(redis.hashes.size).toBe(0);
    expect(redis.zsets.size).toBe(0);
    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
  });
});
