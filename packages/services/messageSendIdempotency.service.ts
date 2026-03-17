import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { generalEnvironment } from '@core/config/environments';

export type MessageSendClaimStatus = 'acquired' | 'duplicate' | 'error';
export type MessageSendLookupStatus = 'claimed' | 'not_found' | 'error';

@injectable()
export class MessageSendIdempotencyService {
  private readonly keyPrefix = 'message-send:idempotency:v1';
  private readonly ttlSeconds =
    generalEnvironment.messageSendIdempotencyTtlSeconds;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  private normalizeSegment(value: string): string {
    return value.trim();
  }

  private buildKey(accountId: string, hash: string): string {
    const normalizedAccountId = this.normalizeSegment(accountId);
    const normalizedHash = this.normalizeSegment(hash);
    return `${this.keyPrefix}:${normalizedAccountId}:${normalizedHash}`;
  }

  private canUse(accountId: string, hash: string): boolean {
    return (
      typeof accountId === 'string' &&
      typeof hash === 'string' &&
      accountId.trim().length > 0 &&
      hash.trim().length > 0
    );
  }

  async claimSend(
    accountId: string,
    hash: string,
    meta?: Record<string, unknown>
  ): Promise<MessageSendClaimStatus> {
    if (!this.canUse(accountId, hash)) {
      return 'error';
    }

    try {
      const key = this.buildKey(accountId, hash);
      const value = meta ? JSON.stringify(meta) : '1';
      const acquired = await this.redis.set(
        key,
        value,
        'EX',
        this.ttlSeconds,
        'NX'
      );
      return acquired === 'OK' ? 'acquired' : 'duplicate';
    } catch {
      return 'error';
    }
  }

  async lookupClaim(
    accountId: string,
    hash: string
  ): Promise<MessageSendLookupStatus> {
    if (!this.canUse(accountId, hash)) {
      return 'error';
    }

    try {
      const key = this.buildKey(accountId, hash);
      const exists = await this.redis.exists(key);
      return exists === 1 ? 'claimed' : 'not_found';
    } catch {
      return 'error';
    }
  }
}
