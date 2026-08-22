import { createHash, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export type InboundActiveValidationLedgerState =
  'reserved' | 'handled' | 'ambiguous';
export type InboundActiveValidationTransitionStatus =
  'transitioned' | 'invalid_state' | 'owner_mismatch' | 'not_found' | 'error';

export interface IInboundActiveValidationClaimInput {
  accountId: string;
  workerId: string;
  eventId: string;
}

export interface IInboundActiveValidationAcquiredClaim {
  status: 'acquired';
  state: 'reserved';
  key: string;
  owner: string;
  eventId: string;
}

export interface IInboundActiveValidationDuplicateClaim {
  status: 'duplicate';
  state: InboundActiveValidationLedgerState;
  key: string;
  owner: null;
  eventId: string;
}

export interface IInboundActiveValidationErrorClaim {
  status: 'error';
  state: null;
  key: string | null;
  owner: null;
  eventId: string;
}

export type InboundActiveValidationClaimResult =
  | IInboundActiveValidationAcquiredClaim
  | IInboundActiveValidationDuplicateClaim
  | IInboundActiveValidationErrorClaim;

const CLAIM_SCRIPT = `
local key = KEYS[1]
local owner = ARGV[1]
local event_id = ARGV[2]
local now_ms = ARGV[3]
local ttl_seconds = tonumber(ARGV[4])

if redis.call('EXISTS', key) == 0 then
  redis.call('HSET', key,
    'schema_version', '1',
    'state', 'reserved',
    'owner', owner,
    'event_id', event_id,
    'error', '',
    'created_at_ms', now_ms,
    'updated_at_ms', now_ms)
  redis.call('EXPIRE', key, ttl_seconds)
  return {'acquired', 'reserved'}
end

local state = redis.call('HGET', key, 'state')
if state ~= 'reserved' and state ~= 'handled' and state ~= 'ambiguous' then
  state = 'ambiguous'
  redis.call('HSET', key,
    'schema_version', '1',
    'state', state,
    'owner', '',
    'error', 'invalid_ledger_record',
    'updated_at_ms', now_ms)
end

redis.call('EXPIRE', key, ttl_seconds)
return {'duplicate', state}
`;

const TRANSITION_SCRIPT = `
local key = KEYS[1]
local owner = ARGV[1]
local target_state = ARGV[2]
local error_value = ARGV[3]
local now_ms = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

local state = redis.call('HGET', key, 'state')
if not state then
  return 'not_found'
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 'owner_mismatch'
end
if state ~= 'reserved' then
  return 'invalid_state'
end

redis.call('HSET', key,
  'state', target_state,
  'owner', '',
  'error', error_value,
  'updated_at_ms', now_ms)
redis.call('EXPIRE', key, ttl_seconds)
return 'transitioned'
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]
local owner = ARGV[1]

local state = redis.call('HGET', key, 'state')
if not state then
  return 'not_found'
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 'owner_mismatch'
end
if state ~= 'reserved' then
  return 'invalid_state'
end

redis.call('DEL', key)
return 'transitioned'
`;

/**
 * Durable, provider-neutral fence for inbound events which may be consumed by
 * the active WhatsApp validation flow before normal message persistence.
 *
 * A reservation is deliberately never stolen. If execution stops after the
 * validation handler may have produced side effects, a redelivery remains
 * fail-closed instead of being persisted as an ordinary chat message.
 */
export class InboundActiveValidationLedgerService {
  public static readonly TTL_SECONDS = 7 * 24 * 60 * 60;
  private readonly keyPrefix = 'inbound-active-validation:ledger:v1';

  constructor(private readonly redis: Redis) {}

  public buildKey(input: IInboundActiveValidationClaimInput): string | null {
    const accountId = this.normalize(input.accountId);
    const workerId = this.normalize(input.workerId);
    const eventId = this.normalize(input.eventId);
    if (!accountId || !workerId || !eventId) {
      return null;
    }

    const digest = createHash('sha256')
      .update(`${accountId}\0${workerId}\0${eventId}`)
      .digest('hex');
    return `${this.keyPrefix}:${digest}`;
  }

  public async claim(
    input: IInboundActiveValidationClaimInput
  ): Promise<InboundActiveValidationClaimResult> {
    const eventId = this.normalize(input.eventId) ?? '';
    const key = this.buildKey(input);
    if (!key) {
      return this.errorClaim(eventId, null);
    }

    const owner = randomUUID();
    try {
      const raw = await this.redis.eval(
        CLAIM_SCRIPT,
        1,
        key,
        owner,
        eventId,
        String(Date.now()),
        String(InboundActiveValidationLedgerService.TTL_SECONDS)
      );
      const reply = this.parseClaimReply(raw);
      if (reply?.status === 'acquired' && reply.state === 'reserved') {
        return {
          status: 'acquired',
          state: 'reserved',
          key,
          owner,
          eventId,
        };
      }
      if (reply?.status === 'duplicate' && this.isState(reply.state)) {
        return {
          status: 'duplicate',
          state: reply.state,
          key,
          owner: null,
          eventId,
        };
      }
    } catch {}

    return this.errorClaim(eventId, key);
  }

  public markHandled(
    claim: IInboundActiveValidationAcquiredClaim
  ): Promise<InboundActiveValidationTransitionStatus> {
    return this.transition(claim, 'handled', '');
  }

  public markAmbiguous(
    claim: IInboundActiveValidationAcquiredClaim,
    error: unknown
  ): Promise<InboundActiveValidationTransitionStatus> {
    return this.transition(claim, 'ambiguous', this.errorMessage(error));
  }

  public async release(
    claim: IInboundActiveValidationAcquiredClaim
  ): Promise<InboundActiveValidationTransitionStatus> {
    try {
      const raw = await this.redis.eval(
        RELEASE_SCRIPT,
        1,
        claim.key,
        claim.owner
      );
      return this.parseTransitionStatus(raw);
    } catch {
      return 'error';
    }
  }

  private async transition(
    claim: IInboundActiveValidationAcquiredClaim,
    targetState: 'handled' | 'ambiguous',
    error: string
  ): Promise<InboundActiveValidationTransitionStatus> {
    try {
      const raw = await this.redis.eval(
        TRANSITION_SCRIPT,
        1,
        claim.key,
        claim.owner,
        targetState,
        error,
        String(Date.now()),
        String(InboundActiveValidationLedgerService.TTL_SECONDS)
      );
      return this.parseTransitionStatus(raw);
    } catch {
      return 'error';
    }
  }

  private parseClaimReply(
    raw: unknown
  ): { status: string; state: string } | null {
    if (!Array.isArray(raw) || raw.length < 2) {
      return null;
    }

    return {
      status: this.asString(raw[0]),
      state: this.asString(raw[1]),
    };
  }

  private parseTransitionStatus(
    raw: unknown
  ): InboundActiveValidationTransitionStatus {
    const status = this.asString(raw);
    if (
      status === 'transitioned' ||
      status === 'invalid_state' ||
      status === 'owner_mismatch' ||
      status === 'not_found'
    ) {
      return status;
    }
    return 'error';
  }

  private isState(value: string): value is InboundActiveValidationLedgerState {
    return value === 'reserved' || value === 'handled' || value === 'ambiguous';
  }

  private errorClaim(
    eventId: string,
    key: string | null
  ): IInboundActiveValidationErrorClaim {
    return {
      status: 'error',
      state: null,
      key,
      owner: null,
      eventId,
    };
  }

  private normalize(value: string): string | null {
    const normalized = value?.trim();
    return normalized || null;
  }

  private asString(value: unknown): string {
    if (Buffer.isBuffer(value)) {
      return value.toString('utf8');
    }
    return typeof value === 'string' ? value : '';
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1024);
  }
}
