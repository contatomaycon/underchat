import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';

interface IMessageHistoryCacheOptions {
  knownTtlSeconds?: number;
  inflightTtlSeconds?: number;
}

export class MessageHistoryReceiptCacheService {
  private readonly knownPrefix = 'wa:received-msg:v1';
  private readonly inflightPrefix = 'wa:received-msg:inflight:v1';
  private readonly knownTtlSeconds: number;
  private readonly inflightTtlSeconds: number;

  constructor(
    private readonly redis: Redis,
    options: IMessageHistoryCacheOptions = {}
  ) {
    this.knownTtlSeconds =
      options.knownTtlSeconds ??
      MessageHistoryReceiptCacheService.readPositiveIntEnv(
        'HISTORY_RECONCILIATION_CACHE_TTL_SECONDS',
        2_592_000
      );
    this.inflightTtlSeconds =
      options.inflightTtlSeconds ??
      MessageHistoryReceiptCacheService.readPositiveIntEnv(
        'HISTORY_RECONCILIATION_INFLIGHT_TTL_SECONDS',
        120
      );
  }

  public async isKnown(data: IUpsertMessage): Promise<boolean> {
    const fingerprint = this.buildFingerprint(data);
    if (!fingerprint) {
      return false;
    }

    try {
      const bucketKeys = this.buildLookupBucketKeys(data);
      const checks = await Promise.all(
        bucketKeys.map((key) => this.redis.sismember(key, fingerprint))
      );

      return checks.some((exists) => exists === 1);
    } catch {
      return false;
    }
  }

  public async markKnown(data: IUpsertMessage): Promise<void> {
    const fingerprint = this.buildFingerprint(data);
    if (!fingerprint) {
      return;
    }

    try {
      const key = this.buildKnownBucketKey(data);
      await this.redis
        .multi()
        .sadd(key, fingerprint)
        .expire(key, this.knownTtlSeconds)
        .exec();
    } catch {
      return;
    }
  }

  public async acquireInflight(data: IUpsertMessage): Promise<boolean> {
    const fingerprint = this.buildFingerprint(data);
    if (!fingerprint) {
      return false;
    }

    try {
      const key = this.buildInflightKey(data, fingerprint);
      const acquired = await this.redis.set(
        key,
        '1',
        'EX',
        this.inflightTtlSeconds,
        'NX'
      );
      return acquired === 'OK';
    } catch {
      return true;
    }
  }

  public async releaseInflight(data: IUpsertMessage): Promise<void> {
    const fingerprint = this.buildFingerprint(data);
    if (!fingerprint) {
      return;
    }

    try {
      await this.redis.del(this.buildInflightKey(data, fingerprint));
    } catch {
      return;
    }
  }

  private buildKnownBucketKey(data: IUpsertMessage): string {
    return this.buildKnownBucketKeyForDay(data, this.getBucketDay(data));
  }

  private buildLookupBucketKeys(data: IUpsertMessage): string[] {
    const bucketDay = this.getBucketDay(data);
    const keys = new Set<string>([this.buildKnownBucketKey(data)]);
    const timestampMs = this.getMessageTimestampMs(data);

    if (!timestampMs) {
      keys.add(
        this.buildKnownBucketKeyForDay(
          data,
          this.formatBucketDay(Date.now() - 86_400_000)
        )
      );
      return Array.from(keys);
    }

    keys.add(
      this.buildKnownBucketKeyForDay(
        data,
        this.formatBucketDay(timestampMs - 86_400_000)
      )
    );
    keys.add(
      this.buildKnownBucketKeyForDay(
        data,
        this.formatBucketDay(timestampMs + 86_400_000)
      )
    );
    keys.add(this.buildKnownBucketKeyForDay(data, bucketDay));

    return Array.from(keys);
  }

  private buildKnownBucketKeyForDay(
    data: IUpsertMessage,
    bucketDay: string
  ): string {
    return `${this.knownPrefix}:${data.account_id}:${data.worker_id}:${bucketDay}`;
  }

  private buildInflightKey(data: IUpsertMessage, fingerprint: string): string {
    return `${this.inflightPrefix}:${data.account_id}:${data.worker_id}:${fingerprint}`;
  }

  private buildFingerprint(data: IUpsertMessage): string | null {
    const messageId = this.toNonEmptyString(data.message?.key?.id);
    if (!data.account_id || !data.worker_id || !messageId) {
      return null;
    }

    const key = data.message?.key;
    const idCandidates = new Set<string>([messageId]);
    const parsed = parseSerializedMessageId(messageId);
    if (parsed?.stanzaId) {
      idCandidates.add(parsed.stanzaId);
    }

    const remoteCandidates = new Set<string>();
    for (const raw of [
      key?.remoteJid,
      key?.remoteJidAlt,
      key?.participant,
      key?.participantAlt,
      parsed?.remoteJid,
    ]) {
      const normalized = this.normalizeJidCandidate(raw);
      if (normalized) {
        remoteCandidates.add(normalized);
      }
    }

    const fingerprintInput = [
      data.account_id,
      data.worker_id,
      Array.from(idCandidates).sort().join(','),
      Array.from(remoteCandidates).sort().join(','),
      String(key?.fromMe === true),
    ].join('|');

    return createHash('sha1').update(fingerprintInput).digest('hex');
  }

  private normalizeJidCandidate(value: unknown): string | null {
    const raw = this.toNonEmptyString(value);
    if (!raw) {
      return null;
    }

    return normalizeJid(raw) ?? raw;
  }

  private getBucketDay(data: IUpsertMessage): string {
    return this.formatBucketDay(this.getMessageTimestampMs(data) ?? Date.now());
  }

  private formatBucketDay(timestampMs: number): string {
    return new Date(timestampMs).toISOString().slice(0, 10).replace(/-/g, '');
  }

  private getMessageTimestampMs(data: IUpsertMessage): number | null {
    const raw: unknown = data.message?.messageTimestamp;
    if (raw === null || raw === undefined) {
      return null;
    }

    const value =
      typeof raw === 'object' && raw && 'toNumber' in raw
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw);

    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  private toNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private static readPositiveIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
