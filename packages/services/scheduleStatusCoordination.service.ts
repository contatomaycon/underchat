import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

export interface ScheduleReconciliationLease {
  scheduleId: string;
  key: string;
  token: string;
  recoveryDeadline: number;
  deadlineVersion: number;
}

export interface ScheduleLegacyProcessingBootstrapLease {
  key: string;
  token: string;
}

export type ScheduleLegacyProcessingBootstrapClaim =
  | {
      state: 'acquired';
      lease: ScheduleLegacyProcessingBootstrapLease;
    }
  | {
      state: 'busy' | 'completed';
    };

export interface ScheduleLegacyDeadlineSeedResult {
  deadline: number;
  seeded: boolean;
}

export interface ScheduleMessageAttemptIdentity {
  scheduleId: string;
  messageId: string;
  attemptId?: string;
  accountId?: string;
  workerId?: string;
}

export interface ScheduleMessageOperationalIdentity {
  scheduleId: string;
  accountId: string;
  workerId: string;
  messageId: string;
  attemptId: string;
}

export interface ScheduleMessageLedgerOperationalIdentity extends ScheduleMessageOperationalIdentity {
  ledgerOperationId: string;
}

export interface ScheduleMessageLedgerReservationAdoptionIdentity extends ScheduleMessageLedgerOperationalIdentity {
  ledgerReservationOwner: string;
}

export type ScheduleMessageOperationalState =
  | 'pending'
  | 'pre_provider_failed'
  | 'provider_rejected'
  | 'ambiguous'
  | 'succeeded';

export type ScheduleMessageOperationalTransitionResult =
  'transitioned' | 'unchanged' | 'stale' | 'invalid';

export type ScheduleMessageLedgerOperationalTransitionResult =
  ScheduleMessageOperationalTransitionResult;

export type ScheduleMessageLedgerReservationAdoptionResult =
  'transitioned' | 'unchanged' | 'stale' | 'terminal' | 'invalid';

export interface ScheduleMessageAttemptLease {
  scheduleId: string;
  messageId: string;
  attemptId: string;
  key: string;
  token: string;
  state: 'in_flight' | 'reconciling';
}

export type ScheduleMessageAttemptQueueResult = 'queued' | 'busy' | 'completed';

export type ScheduleMessageReconciliationClaim =
  | {
      state: 'acquired';
      lease: ScheduleMessageAttemptLease;
    }
  | {
      state: 'busy' | 'completed' | 'stale';
    };

export class ScheduleReconciliationLeaseLostError extends Error {
  constructor(scheduleId: string) {
    super(`Schedule reconciliation lease lost for ${scheduleId}`);
    this.name = 'ScheduleReconciliationLeaseLostError';
  }
}

export class ScheduleLegacyProcessingBootstrapLeaseLostError extends Error {
  constructor() {
    super('Schedule legacy processing bootstrap lease was lost');
    this.name = 'ScheduleLegacyProcessingBootstrapLeaseLostError';
  }
}

export class ScheduleMessageInFlightLeaseUnavailableError extends Error {
  constructor(scheduleId: string, messageId: string) {
    super(
      `Schedule message is already in flight for ${scheduleId}:${messageId}`
    );
    this.name = 'ScheduleMessageInFlightLeaseUnavailableError';
  }
}

const SCHEDULE_RECONCILIATION_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
local incoming = now + tonumber(ARGV[2])
local version = redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
if not current or tonumber(current) > incoming then
  redis.call('ZADD', KEYS[1], incoming, ARGV[1])
end
return { tostring(incoming), tostring(version) }
`;

const CLAIM_RECONCILIATION_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > now then
  return {}
end
local acquired = redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3], 'NX')
if not acquired then
  return {}
end
local recovery = now + tonumber(ARGV[3])
local version = redis.call('HGET', KEYS[3], ARGV[1]) or '0'
redis.call('ZADD', KEYS[1], recovery, ARGV[1])
return { tostring(recovery), tostring(version) }
`;

const ASSERT_AND_EXTEND_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const ASSERT_AND_EXTEND_RECONCILIATION_LEASE_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[2] then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local recovery = now + tonumber(ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('ZADD', KEYS[1], recovery, ARGV[1])
return tostring(recovery)
`;

const RELEASE_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`;

const COMPLETE_RECONCILIATION_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[2] then
  return 0
end
local currentVersion = redis.call('HGET', KEYS[4], ARGV[1]) or '0'
if currentVersion == ARGV[3] then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[4], ARGV[1])
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local completed = cjson.encode({
  schedule_id = ARGV[1],
  completed_at = now
})
redis.call('SET', KEYS[3], completed, 'PX', ARGV[4])
redis.call('DEL', KEYS[2])
return 1
`;

const CLAIM_LEGACY_PROCESSING_BOOTSTRAP_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  local completed_ttl = redis.call('PTTL', KEYS[2])
  if completed_ttl == -1 then
    redis.call('DEL', KEYS[2])
  else
    return 'completed'
  end
end
local acquired = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if acquired then
  return 'acquired'
end
return 'busy'
`;

const COMPLETE_LEGACY_PROCESSING_BOOTSTRAP_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local completed = cjson.encode({
  completed_at = now,
  seeded_schedules = tonumber(ARGV[2])
})
redis.call('SET', KEYS[2], completed, 'PX', ARGV[3])
redis.call('DEL', KEYS[1])
return 1
`;

const SEED_LEGACY_RECONCILIATION_DEADLINE_SCRIPT = `
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
if current then
  return { tostring(current), '0' }
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local incoming = tonumber(ARGV[2])
if not incoming or incoming < now then
  incoming = now
end
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('ZADD', KEYS[1], incoming, ARGV[1])
return { tostring(incoming), '1' }
`;

const QUEUE_MESSAGE_ATTEMPT_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_state = redis.call('HGET', KEYS[1], 'state') or ''
local current_lease = tonumber(redis.call('HGET', KEYS[1], 'lease_until_ms') or '0')
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if current_attempt ~= '' and current_attempt ~= ARGV[2] then
  return 'busy'
end
if current_account ~= '' and ARGV[5] ~= '' and current_account ~= ARGV[5] then
  return 'busy'
end
if current_worker ~= '' and ARGV[6] ~= '' and current_worker ~= ARGV[6] then
  return 'busy'
end
if current_message ~= '' and current_message ~= ARGV[7] then
  return 'busy'
end
if current_attempt == ARGV[2] and current_state == 'completed' then
  return 'completed'
end
if current_lease > now and (
  current_state == 'queued' or
  current_state == 'in_flight' or
  current_state == 'grace' or
  current_state == 'reconciling'
) then
  if current_attempt == ARGV[2] and current_state == 'queued' then
    return 'queued'
  end
  return 'busy'
end

local lease_until = now + tonumber(ARGV[3])
redis.call('HSET', KEYS[1],
  'state', 'queued',
  'attempt_id', ARGV[2],
  'owner', '',
  'lease_until_ms', tostring(lease_until),
  'updated_at_ms', tostring(now)
)
if current_account == '' and ARGV[5] ~= '' then
  redis.call('HSET', KEYS[1], 'account_id', ARGV[5])
end
if current_worker == '' and ARGV[6] ~= '' then
  redis.call('HSET', KEYS[1], 'worker_id', ARGV[6])
end
if current_message == '' then
  redis.call('HSET', KEYS[1], 'message_id', ARGV[7])
end
if redis.call('HEXISTS', KEYS[1], 'operational_state') == 0 then
  redis.call('HSET', KEYS[1],
    'operational_state', 'pending',
    'operational_updated_at_ms', tostring(now)
  )
end
redis.call('EXPIRE', KEYS[1], ARGV[4])

local current_deadline = redis.call('ZSCORE', KEYS[2], ARGV[1])
redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
if not current_deadline or tonumber(current_deadline) > lease_until then
  redis.call('ZADD', KEYS[2], lease_until, ARGV[1])
end
return 'queued'
`;

const SET_MESSAGE_OPERATIONAL_STATE_SCRIPT = `
local function schedule_reconciliation()
  local time = redis.call('TIME')
  local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
  local current_deadline = redis.call('ZSCORE', KEYS[2], ARGV[7])
  redis.call('HINCRBY', KEYS[3], ARGV[7], 1)
  if not current_deadline or tonumber(current_deadline) > now then
    redis.call('ZADD', KEYS[2], now, ARGV[7])
  end
  return now
end

local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if current_attempt ~= '' and current_attempt ~= ARGV[1] then
  return 'stale'
end
if current_account ~= '' and current_account ~= ARGV[2] then
  return 'stale'
end
if current_worker ~= '' and current_worker ~= ARGV[3] then
  return 'stale'
end
if current_message ~= '' and current_message ~= ARGV[4] then
  return 'stale'
end

local current = redis.call('HGET', KEYS[1], 'operational_state') or 'pending'
local target = ARGV[5]
if current == target then
  redis.call('EXPIRE', KEYS[1], ARGV[6])
  schedule_reconciliation()
  return 'unchanged'
end

local allowed = false
if current == 'pending' then
  allowed = target == 'pre_provider_failed'
    or target == 'provider_rejected'
    or target == 'ambiguous'
    or target == 'succeeded'
elseif current == 'pre_provider_failed' then
  allowed = target == 'provider_rejected'
    or target == 'ambiguous'
    or target == 'succeeded'
elseif current == 'ambiguous' then
  allowed = target == 'provider_rejected' or target == 'succeeded'
end

if not allowed then
  return 'invalid'
end

local now = schedule_reconciliation()
redis.call('HSET', KEYS[1],
  'attempt_id', ARGV[1],
  'account_id', ARGV[2],
  'worker_id', ARGV[3],
  'message_id', ARGV[4],
  'operational_state', target,
  'operational_updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[6])
return 'transitioned'
`;

const SET_MESSAGE_OPERATIONAL_STATE_FROM_LEDGER_SCRIPT = `
local function schedule_reconciliation()
  local time = redis.call('TIME')
  local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
  local current_deadline = redis.call('ZSCORE', KEYS[2], ARGV[1])
  redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
  if not current_deadline or tonumber(current_deadline) > now then
    redis.call('ZADD', KEYS[2], now, ARGV[1])
  end
  return now
end

local incoming_attempt = ARGV[2]
local incoming_account = ARGV[3]
local incoming_worker = ARGV[4]
local incoming_message = ARGV[5]
local target = ARGV[6]
local ledger_operation_id = ARGV[7]
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if ledger_operation_id ~= incoming_message then
  return 'stale'
end
if current_account ~= '' and current_account ~= incoming_account then
  return 'stale'
end
if current_worker ~= '' and current_worker ~= incoming_worker then
  return 'stale'
end
if current_message ~= '' and current_message ~= incoming_message then
  return 'stale'
end

local current = redis.call('HGET', KEYS[1], 'operational_state') or 'pending'
if current == target then
  redis.call('EXPIRE', KEYS[1], ARGV[8])
  schedule_reconciliation()
  return 'unchanged'
end

local allowed = false
if current == 'pending' then
  allowed = target == 'pre_provider_failed'
    or target == 'provider_rejected'
    or target == 'ambiguous'
    or target == 'succeeded'
elseif current == 'pre_provider_failed' then
  allowed = target == 'provider_rejected'
    or target == 'ambiguous'
    or target == 'succeeded'
elseif current == 'ambiguous' then
  allowed = target == 'provider_rejected' or target == 'succeeded'
end
if not allowed then
  if current == 'pre_provider_failed'
    or current == 'provider_rejected'
    or current == 'ambiguous'
    or current == 'succeeded' then
    redis.call('EXPIRE', KEYS[1], ARGV[8])
    schedule_reconciliation()
    return 'unchanged'
  end
  -- A ledger-proven terminal outcome repairs an unknown/corrupt legacy state.
  allowed = true
end

local now = schedule_reconciliation()
redis.call('HSET', KEYS[1],
  'state', redis.call('HGET', KEYS[1], 'state') or 'grace',
  'owner', redis.call('HGET', KEYS[1], 'owner') or '',
  'lease_until_ms', redis.call('HGET', KEYS[1], 'lease_until_ms') or '0',
  'attempt_id', current_attempt ~= '' and current_attempt or incoming_attempt,
  'account_id', incoming_account,
  'worker_id', incoming_worker,
  'message_id', incoming_message,
  'operational_state', target,
  'ledger_operation_id', ledger_operation_id,
  'operational_updated_at_ms', tostring(now))
redis.call('EXPIRE', KEYS[1], ARGV[8])
return 'transitioned'
`;

const ADOPT_MESSAGE_ATTEMPT_FROM_LEDGER_RESERVATION_SCRIPT = `
local function schedule_reconciliation()
  local time = redis.call('TIME')
  local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
  local current_deadline = redis.call('ZSCORE', KEYS[2], ARGV[1])
  redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
  if not current_deadline or tonumber(current_deadline) > now then
    redis.call('ZADD', KEYS[2], now, ARGV[1])
  end
  return now
end

local incoming_attempt = ARGV[2]
local incoming_account = ARGV[3]
local incoming_worker = ARGV[4]
local incoming_message = ARGV[5]
local ledger_operation_id = ARGV[6]
local ledger_reservation_owner = ARGV[7]
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if ledger_operation_id ~= incoming_message
  or ledger_reservation_owner == '' then
  return 'stale'
end
if current_account ~= '' and current_account ~= incoming_account then
  return 'stale'
end
if current_worker ~= '' and current_worker ~= incoming_worker then
  return 'stale'
end
if current_message ~= '' and current_message ~= incoming_message then
  return 'stale'
end

local current_operational =
  redis.call('HGET', KEYS[1], 'operational_state') or 'pending'
if current_operational ~= 'pending' then
  return 'terminal'
end

local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_ledger_owner =
  redis.call('HGET', KEYS[1], 'ledger_reservation_owner') or ''
local current_state = redis.call('HGET', KEYS[1], 'state') or ''
if current_attempt == incoming_attempt
  and current_ledger_owner == ledger_reservation_owner
  and current_state == 'grace' then
  redis.call('EXPIRE', KEYS[1], ARGV[8])
  schedule_reconciliation()
  return 'unchanged'
end

local now = schedule_reconciliation()
redis.call('HSET', KEYS[1],
  'state', 'grace',
  'attempt_id', incoming_attempt,
  'owner', '',
  'lease_until_ms', '0',
  'account_id', incoming_account,
  'worker_id', incoming_worker,
  'message_id', incoming_message,
  'operational_state', 'pending',
  'ledger_operation_id', ledger_operation_id,
  'ledger_reservation_owner', ledger_reservation_owner,
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', KEYS[1], ARGV[8])
return 'transitioned'
`;

const GET_MESSAGE_OPERATIONAL_STATE_SCRIPT = `
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if current_attempt == '' or current_attempt ~= ARGV[1] then
  return ''
end
if current_account == '' or current_account ~= ARGV[2] then
  return ''
end
if current_worker == '' or current_worker ~= ARGV[3] then
  return ''
end
if current_message == '' or current_message ~= ARGV[4] then
  return ''
end
return redis.call('HGET', KEYS[1], 'operational_state') or ''
`;

const CLAIM_MESSAGE_ATTEMPT_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_state = redis.call('HGET', KEYS[1], 'state') or ''
local current_lease = tonumber(redis.call('HGET', KEYS[1], 'lease_until_ms') or '0')

if current_attempt ~= '' and current_attempt ~= ARGV[1] then
  return 'stale'
end
if current_state == 'completed' then
  return 'completed'
end
if current_lease > now and (
  current_state == 'in_flight' or
  current_state == 'grace' or
  current_state == 'reconciling'
) then
  return 'busy'
end

local lease_until = now + tonumber(ARGV[3])
redis.call('HSET', KEYS[1],
  'state', 'in_flight',
  'attempt_id', ARGV[1],
  'owner', ARGV[2],
  'lease_until_ms', tostring(lease_until),
  'updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'acquired'
`;

const ASSERT_MESSAGE_ATTEMPT_LEASE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'state') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[2] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[3] then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local lease_until = now + tonumber(ARGV[4])
redis.call('HSET', KEYS[1],
  'lease_until_ms', tostring(lease_until),
  'updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[5])
return tostring(lease_until)
`;

const RELEASE_MESSAGE_ATTEMPT_LEASE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'state') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[2] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[3] then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local lease_until = now + tonumber(ARGV[4])
redis.call('HSET', KEYS[1],
  'state', 'grace',
  'owner', '',
  'lease_until_ms', tostring(lease_until),
  'updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

const CLAIM_MESSAGE_RECONCILIATION_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_state = redis.call('HGET', KEYS[1], 'state') or ''
local current_lease = tonumber(redis.call('HGET', KEYS[1], 'lease_until_ms') or '0')
local current_operational = redis.call('HGET', KEYS[1], 'operational_state') or ''
local reconciled_operational = redis.call('HGET', KEYS[1], 'reconciled_operational_state') or ''

if current_attempt ~= '' and current_attempt ~= ARGV[1] then
  return 'stale'
end
if current_state == 'completed' and (
  current_operational == '' or
  current_operational == reconciled_operational
) then
  return 'completed'
end
if current_lease > now and (
  current_state == 'queued' or
  current_state == 'in_flight' or
  current_state == 'grace' or
  current_state == 'reconciling'
) then
  return 'busy'
end

local lease_until = now + tonumber(ARGV[3])
redis.call('HSET', KEYS[1],
  'state', 'reconciling',
  'attempt_id', ARGV[1],
  'owner', ARGV[2],
  'lease_until_ms', tostring(lease_until),
  'updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'acquired'
`;

const COMPLETE_MESSAGE_ATTEMPT_LEASE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'state') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[2] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[3] then
  return 0
end
if ARGV[4] ~= '' and
   redis.call('HGET', KEYS[1], 'operational_state') ~= ARGV[4] then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
redis.call('HSET', KEYS[1],
  'state', 'completed',
  'owner', '',
  'lease_until_ms', '0',
  'updated_at_ms', tostring(now)
)
if ARGV[4] ~= '' then
  redis.call('HSET', KEYS[1], 'reconciled_operational_state', ARGV[4])
end
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

const COMPLETE_QUEUED_MESSAGE_ATTEMPT_SCRIPT = `
local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_state = redis.call('HGET', KEYS[1], 'state') or ''
if current_attempt ~= ARGV[1] or current_state ~= 'queued' then
  return 0
end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
redis.call('HSET', KEYS[1],
  'state', 'completed',
  'owner', '',
  'lease_until_ms', '0',
  'updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

@injectable()
export class ScheduleStatusCoordinationService {
  private readonly redisHashTag = '{schedule-status}';
  private readonly deadlineKey = `${this.redisHashTag}:reconciliation:v2:deadlines`;
  private readonly deadlineVersionKey = `${this.redisHashTag}:reconciliation:v2:versions`;
  private readonly keyPrefix = `${this.redisHashTag}:reconciliation:v2`;
  private readonly messageAttemptPrefix = `${this.redisHashTag}:message-attempt:v3`;
  private readonly legacyProcessingBootstrapPrefix = `${this.keyPrefix}:legacy-processing-bootstrap:v1`;
  private readonly legacyProcessingBootstrapLeaseKey = `${this.legacyProcessingBootstrapPrefix}:lease`;
  private readonly legacyProcessingBootstrapCompletedKey = `${this.legacyProcessingBootstrapPrefix}:completed`;
  private readonly reconciliationLeaseTtlMs = Math.max(
    30_000,
    Number(process.env.SCHEDULE_STATUS_RECONCILIATION_LEASE_TTL_MS) || 60_000
  );
  private readonly completedTtlMs = 24 * 60 * 60 * 1000;
  private readonly messageAttemptRetentionSeconds = 24 * 60 * 60;
  private readonly messageQueuedTtlMs = Math.max(
    60_000,
    Number(process.env.SCHEDULE_MESSAGE_QUEUED_TTL_MS) || 5 * 60_000
  );
  private readonly messageInFlightTtlMs = Math.max(
    60_000,
    Number(process.env.SCHEDULE_MESSAGE_IN_FLIGHT_TTL_MS) || 5 * 60_000
  );
  private readonly messageInFlightHeartbeatMs = Math.max(
    5_000,
    Math.min(
      Math.floor(this.messageInFlightTtlMs / 3),
      Number(process.env.SCHEDULE_MESSAGE_IN_FLIGHT_HEARTBEAT_MS) || 30_000
    )
  );
  private readonly messageInFlightGraceMs = Math.max(
    10_000,
    Number(process.env.SCHEDULE_MESSAGE_IN_FLIGHT_GRACE_MS) || 60_000
  );
  private readonly legacyProcessingBootstrapLeaseTtlMs = Math.max(
    60_000,
    Number(process.env.SCHEDULE_LEGACY_PROCESSING_BOOTSTRAP_LEASE_TTL_MS) ||
      5 * 60_000
  );
  private readonly legacyProcessingScanIntervalMs = Math.max(
    10_000,
    Number(process.env.SCHEDULE_LEGACY_PROCESSING_SCAN_INTERVAL_MS) || 60_000
  );

  constructor(@inject('Redis') private readonly redis: Redis) {}

  async scheduleReconciliation(
    scheduleId: string,
    delayMs: number
  ): Promise<number> {
    const normalizedScheduleId = this.required(scheduleId, 'scheduleId');
    const result = await this.redis.eval(
      SCHEDULE_RECONCILIATION_SCRIPT,
      2,
      this.deadlineKey,
      this.deadlineVersionKey,
      normalizedScheduleId,
      String(Math.max(0, Math.floor(delayMs)))
    );
    return Number(Array.isArray(result) ? result[0] : result);
  }

  async claimDueReconciliations(
    limit = 50
  ): Promise<ScheduleReconciliationLease[]> {
    const now = await this.redisTimeMilliseconds();
    const scheduleIds = await this.redis.zrangebyscore(
      this.deadlineKey,
      '-inf',
      now,
      'LIMIT',
      0,
      Math.max(1, Math.floor(limit))
    );
    const leases: ScheduleReconciliationLease[] = [];

    for (const scheduleId of scheduleIds) {
      const token = uuidv7();
      const key = this.reconciliationLeaseKey(scheduleId);
      const acquired = await this.redis.eval(
        CLAIM_RECONCILIATION_SCRIPT,
        3,
        this.deadlineKey,
        key,
        this.deadlineVersionKey,
        scheduleId,
        token,
        String(this.reconciliationLeaseTtlMs)
      );
      const [recoveryRaw, versionRaw] = Array.isArray(acquired) ? acquired : [];
      const recoveryDeadline = Number(recoveryRaw);
      const deadlineVersion = Number(versionRaw);
      if (
        Number.isFinite(recoveryDeadline) &&
        recoveryDeadline > 0 &&
        Number.isSafeInteger(deadlineVersion) &&
        deadlineVersion >= 0
      ) {
        leases.push({
          scheduleId,
          key,
          token,
          recoveryDeadline,
          deadlineVersion,
        });
      }
    }

    return leases;
  }

  async assertReconciliationLease(
    lease: ScheduleReconciliationLease
  ): Promise<void> {
    const extended = await this.redis.eval(
      ASSERT_AND_EXTEND_RECONCILIATION_LEASE_SCRIPT,
      2,
      this.deadlineKey,
      lease.key,
      lease.scheduleId,
      lease.token,
      String(this.reconciliationLeaseTtlMs)
    );
    const recoveryDeadline = Number(extended);
    if (!Number.isFinite(recoveryDeadline) || recoveryDeadline <= 0) {
      throw new ScheduleReconciliationLeaseLostError(lease.scheduleId);
    }
    lease.recoveryDeadline = recoveryDeadline;
  }

  async releaseReconciliationLease(
    lease: ScheduleReconciliationLease
  ): Promise<void> {
    await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, lease.key, lease.token);
  }

  async completeReconciliationLease(
    lease: ScheduleReconciliationLease
  ): Promise<boolean> {
    const result = await this.redis.eval(
      COMPLETE_RECONCILIATION_SCRIPT,
      4,
      this.deadlineKey,
      lease.key,
      this.reconciliationCompletedKey(lease.scheduleId),
      this.deadlineVersionKey,
      lease.scheduleId,
      lease.token,
      String(lease.deadlineVersion),
      String(this.completedTtlMs)
    );
    return Number(result) === 1;
  }

  async claimLegacyProcessingBootstrap(): Promise<ScheduleLegacyProcessingBootstrapClaim> {
    const token = uuidv7();
    const result = await this.redis.eval(
      CLAIM_LEGACY_PROCESSING_BOOTSTRAP_SCRIPT,
      2,
      this.legacyProcessingBootstrapLeaseKey,
      this.legacyProcessingBootstrapCompletedKey,
      token,
      String(this.legacyProcessingBootstrapLeaseTtlMs)
    );
    const state = String(result);

    if (state === 'acquired') {
      return {
        state,
        lease: {
          key: this.legacyProcessingBootstrapLeaseKey,
          token,
        },
      };
    }

    return {
      state: state === 'completed' ? 'completed' : 'busy',
    };
  }

  async assertLegacyProcessingBootstrapLease(
    lease: ScheduleLegacyProcessingBootstrapLease
  ): Promise<void> {
    const extended = await this.redis.eval(
      ASSERT_AND_EXTEND_LEASE_SCRIPT,
      1,
      lease.key,
      lease.token,
      String(this.legacyProcessingBootstrapLeaseTtlMs)
    );
    if (Number(extended) !== 1) {
      throw new ScheduleLegacyProcessingBootstrapLeaseLostError();
    }
  }

  async releaseLegacyProcessingBootstrapLease(
    lease: ScheduleLegacyProcessingBootstrapLease
  ): Promise<void> {
    await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, lease.key, lease.token);
  }

  async completeLegacyProcessingBootstrap(
    lease: ScheduleLegacyProcessingBootstrapLease,
    seededSchedules: number
  ): Promise<boolean> {
    const result = await this.redis.eval(
      COMPLETE_LEGACY_PROCESSING_BOOTSTRAP_SCRIPT,
      2,
      lease.key,
      this.legacyProcessingBootstrapCompletedKey,
      lease.token,
      String(Math.max(0, Math.floor(seededSchedules))),
      String(this.legacyProcessingScanIntervalMs)
    );
    return Number(result) === 1;
  }

  async seedLegacyReconciliationDeadline(
    scheduleId: string,
    deadlineEpochMillis: number
  ): Promise<ScheduleLegacyDeadlineSeedResult> {
    const normalizedScheduleId = this.required(scheduleId, 'scheduleId');
    const normalizedDeadline = Number.isFinite(deadlineEpochMillis)
      ? Math.max(0, Math.floor(deadlineEpochMillis))
      : 0;
    const result = await this.redis.eval(
      SEED_LEGACY_RECONCILIATION_DEADLINE_SCRIPT,
      2,
      this.deadlineKey,
      this.deadlineVersionKey,
      normalizedScheduleId,
      String(normalizedDeadline)
    );
    const [deadlineRaw, seededRaw] = Array.isArray(result) ? result : [];

    return {
      deadline: Number(deadlineRaw),
      seeded: Number(seededRaw) === 1,
    };
  }

  async queueMessageAttempt(
    input: ScheduleMessageAttemptIdentity
  ): Promise<ScheduleMessageAttemptQueueResult> {
    const identity = this.normalizeMessageAttemptIdentity(input);
    const result = await this.redis.eval(
      QUEUE_MESSAGE_ATTEMPT_SCRIPT,
      3,
      this.messageAttemptKey(identity.scheduleId, identity.messageId),
      this.deadlineKey,
      this.deadlineVersionKey,
      identity.scheduleId,
      identity.attemptId,
      String(this.messageQueuedTtlMs),
      String(this.messageAttemptRetentionSeconds),
      identity.accountId,
      identity.workerId,
      identity.messageId
    );
    const state = String(result);
    if (state === 'queued' || state === 'completed') {
      return state;
    }
    return 'busy';
  }

  async setMessageOperationalState(
    input: ScheduleMessageOperationalIdentity,
    state: ScheduleMessageOperationalState
  ): Promise<ScheduleMessageOperationalTransitionResult> {
    const identity = this.normalizeMessageOperationalIdentity(input);
    const result = String(
      await this.redis.eval(
        SET_MESSAGE_OPERATIONAL_STATE_SCRIPT,
        3,
        this.messageAttemptKey(identity.scheduleId, identity.messageId),
        this.deadlineKey,
        this.deadlineVersionKey,
        identity.attemptId,
        identity.accountId,
        identity.workerId,
        identity.messageId,
        state,
        String(this.messageAttemptRetentionSeconds),
        identity.scheduleId
      )
    );
    if (
      result === 'transitioned' ||
      result === 'unchanged' ||
      result === 'stale'
    ) {
      return result;
    }
    return 'invalid';
  }

  /**
   * Applies a terminal outcome already proven by the outbound idempotency
   * ledger. Unlike the normal transition, this CAS deliberately tolerates a
   * different delivery attempt id while requiring the stable
   * schedule/account/worker/message identity to match. It keeps the original
   * attempt id so the existing reconciliation record remains addressable.
   */
  async setMessageOperationalStateFromLedger(
    input: ScheduleMessageLedgerOperationalIdentity,
    state: ScheduleMessageOperationalState
  ): Promise<ScheduleMessageLedgerOperationalTransitionResult> {
    const identity = this.normalizeMessageOperationalIdentity(input);
    const ledgerOperationId = this.required(
      input.ledgerOperationId,
      'ledgerOperationId'
    );
    const result = String(
      await this.redis.eval(
        SET_MESSAGE_OPERATIONAL_STATE_FROM_LEDGER_SCRIPT,
        3,
        this.messageAttemptKey(identity.scheduleId, identity.messageId),
        this.deadlineKey,
        this.deadlineVersionKey,
        identity.scheduleId,
        identity.attemptId,
        identity.accountId,
        identity.workerId,
        identity.messageId,
        state,
        ledgerOperationId,
        String(this.messageAttemptRetentionSeconds)
      )
    );
    if (
      result === 'transitioned' ||
      result === 'unchanged' ||
      result === 'stale'
    ) {
      return result;
    }
    return 'invalid';
  }

  /**
   * Revokes an older attempt lease only after the caller has atomically
   * acquired the still-reserved provider ledger under a new owner. The old
   * sender can no longer cross its provider boundary because its ledger owner
   * is stale, so replacing an otherwise-live attempt lease is safe.
   */
  async adoptMessageAttemptFromLedgerReservation(
    input: ScheduleMessageLedgerReservationAdoptionIdentity
  ): Promise<ScheduleMessageLedgerReservationAdoptionResult> {
    const identity = this.normalizeMessageOperationalIdentity(input);
    const ledgerOperationId = this.required(
      input.ledgerOperationId,
      'ledgerOperationId'
    );
    const ledgerReservationOwner = this.required(
      input.ledgerReservationOwner,
      'ledgerReservationOwner'
    );
    const result = String(
      await this.redis.eval(
        ADOPT_MESSAGE_ATTEMPT_FROM_LEDGER_RESERVATION_SCRIPT,
        3,
        this.messageAttemptKey(identity.scheduleId, identity.messageId),
        this.deadlineKey,
        this.deadlineVersionKey,
        identity.scheduleId,
        identity.attemptId,
        identity.accountId,
        identity.workerId,
        identity.messageId,
        ledgerOperationId,
        ledgerReservationOwner,
        String(this.messageAttemptRetentionSeconds)
      )
    );
    if (
      result === 'transitioned' ||
      result === 'unchanged' ||
      result === 'stale' ||
      result === 'terminal'
    ) {
      return result;
    }
    return 'invalid';
  }

  async getMessageOperationalState(
    input: ScheduleMessageOperationalIdentity
  ): Promise<ScheduleMessageOperationalState | null> {
    const identity = this.normalizeMessageOperationalIdentity(input);
    const result = String(
      await this.redis.eval(
        GET_MESSAGE_OPERATIONAL_STATE_SCRIPT,
        1,
        this.messageAttemptKey(identity.scheduleId, identity.messageId),
        identity.attemptId,
        identity.accountId,
        identity.workerId,
        identity.messageId
      )
    );
    if (
      result === 'pending' ||
      result === 'pre_provider_failed' ||
      result === 'provider_rejected' ||
      result === 'ambiguous' ||
      result === 'succeeded'
    ) {
      return result;
    }
    return null;
  }

  async completeQueuedMessageAttempt(
    input: ScheduleMessageAttemptIdentity
  ): Promise<boolean> {
    const identity = this.normalizeMessageAttemptIdentity(input);
    const result = await this.redis.eval(
      COMPLETE_QUEUED_MESSAGE_ATTEMPT_SCRIPT,
      1,
      this.messageAttemptKey(identity.scheduleId, identity.messageId),
      identity.attemptId,
      String(this.messageAttemptRetentionSeconds)
    );
    return Number(result) === 1;
  }

  async withMessageInFlight<T>(
    input: ScheduleMessageAttemptIdentity,
    callback: (assertOwned: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    const identity = this.normalizeMessageAttemptIdentity(input);
    const key = this.messageAttemptKey(identity.scheduleId, identity.messageId);
    const token = uuidv7();
    const state = String(
      await this.redis.eval(
        CLAIM_MESSAGE_ATTEMPT_SCRIPT,
        1,
        key,
        identity.attemptId,
        token,
        String(this.messageInFlightTtlMs),
        String(this.messageAttemptRetentionSeconds)
      )
    );
    if (state !== 'acquired') {
      throw new ScheduleMessageInFlightLeaseUnavailableError(
        identity.scheduleId,
        identity.messageId
      );
    }

    const lease: ScheduleMessageAttemptLease = {
      ...identity,
      key,
      token,
      state: 'in_flight',
    };
    let leaseLost = false;
    const assertOwned = async (): Promise<void> => {
      if (leaseLost) {
        throw new ScheduleMessageInFlightLeaseUnavailableError(
          identity.scheduleId,
          identity.messageId
        );
      }
      const extended = await this.extendMessageAttemptLease(
        lease,
        this.messageInFlightTtlMs
      );
      if (!extended) {
        leaseLost = true;
        throw new ScheduleMessageInFlightLeaseUnavailableError(
          identity.scheduleId,
          identity.messageId
        );
      }
    };

    const heartbeat = setInterval(() => {
      void assertOwned().catch(() => {
        leaseLost = true;
      });
    }, this.messageInFlightHeartbeatMs);
    heartbeat.unref?.();

    try {
      await assertOwned();
      const result = await callback(assertOwned);
      await assertOwned();
      return result;
    } finally {
      clearInterval(heartbeat);
      await this.releaseMessageAttemptLease(
        lease,
        this.messageInFlightGraceMs
      ).catch(() => undefined);
      await this.scheduleReconciliation(
        identity.scheduleId,
        this.messageInFlightGraceMs
      ).catch(() => undefined);
    }
  }

  async claimMessageAttemptForReconciliation(
    input: ScheduleMessageAttemptIdentity
  ): Promise<ScheduleMessageReconciliationClaim> {
    const identity = this.normalizeMessageAttemptIdentity(input);
    const key = this.messageAttemptKey(identity.scheduleId, identity.messageId);
    const token = uuidv7();
    const state = String(
      await this.redis.eval(
        CLAIM_MESSAGE_RECONCILIATION_SCRIPT,
        1,
        key,
        identity.attemptId,
        token,
        String(this.reconciliationLeaseTtlMs),
        String(this.messageAttemptRetentionSeconds)
      )
    );
    if (state === 'acquired') {
      return {
        state,
        lease: {
          ...identity,
          key,
          token,
          state: 'reconciling',
        },
      };
    }
    if (state === 'completed' || state === 'stale') {
      return { state };
    }
    return { state: 'busy' };
  }

  async assertMessageAttemptLease(
    lease: ScheduleMessageAttemptLease
  ): Promise<void> {
    if (
      !(await this.extendMessageAttemptLease(
        lease,
        this.reconciliationLeaseTtlMs
      ))
    ) {
      throw new ScheduleMessageInFlightLeaseUnavailableError(
        lease.scheduleId,
        lease.messageId
      );
    }
  }

  async completeMessageAttemptLease(
    lease: ScheduleMessageAttemptLease,
    reconciledOperationalState?: ScheduleMessageOperationalState
  ): Promise<boolean> {
    const result = await this.redis.eval(
      COMPLETE_MESSAGE_ATTEMPT_LEASE_SCRIPT,
      1,
      lease.key,
      lease.state,
      lease.attemptId,
      lease.token,
      reconciledOperationalState ?? '',
      String(this.messageAttemptRetentionSeconds)
    );
    return Number(result) === 1;
  }

  async releaseMessageAttemptLease(
    lease: ScheduleMessageAttemptLease,
    graceMs = this.messageInFlightGraceMs
  ): Promise<boolean> {
    const result = await this.redis.eval(
      RELEASE_MESSAGE_ATTEMPT_LEASE_SCRIPT,
      1,
      lease.key,
      lease.state,
      lease.attemptId,
      lease.token,
      String(Math.max(0, Math.floor(graceMs))),
      String(this.messageAttemptRetentionSeconds)
    );
    return Number(result) === 1;
  }

  private reconciliationLeaseKey(scheduleId: string): string {
    return `${this.keyPrefix}:lease:${scheduleId}`;
  }

  private reconciliationCompletedKey(scheduleId: string): string {
    return `${this.keyPrefix}:completed:${scheduleId}`;
  }

  private messageAttemptKey(scheduleId: string, messageId: string): string {
    return `${this.messageAttemptPrefix}:${scheduleId}:${messageId}`;
  }

  private normalizeMessageAttemptIdentity(
    input: ScheduleMessageAttemptIdentity
  ): {
    scheduleId: string;
    messageId: string;
    attemptId: string;
    accountId: string;
    workerId: string;
  } {
    const scheduleId = this.required(input.scheduleId, 'scheduleId');
    const messageId = this.required(input.messageId, 'messageId');
    const attemptId = input.attemptId?.trim() || `legacy:${messageId}`;
    return {
      scheduleId,
      messageId,
      attemptId,
      accountId: input.accountId?.trim() ?? '',
      workerId: input.workerId?.trim() ?? '',
    };
  }

  private normalizeMessageOperationalIdentity(
    input: ScheduleMessageOperationalIdentity
  ): ScheduleMessageOperationalIdentity {
    return {
      scheduleId: this.required(input.scheduleId, 'scheduleId'),
      accountId: this.required(input.accountId, 'accountId'),
      workerId: this.required(input.workerId, 'workerId'),
      messageId: this.required(input.messageId, 'messageId'),
      attemptId: this.required(input.attemptId, 'attemptId'),
    };
  }

  private async extendMessageAttemptLease(
    lease: ScheduleMessageAttemptLease,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.redis.eval(
      ASSERT_MESSAGE_ATTEMPT_LEASE_SCRIPT,
      1,
      lease.key,
      lease.state,
      lease.attemptId,
      lease.token,
      String(Math.max(1, Math.floor(ttlMs))),
      String(this.messageAttemptRetentionSeconds)
    );
    const leaseUntil = Number(result);
    return Number.isFinite(leaseUntil) && leaseUntil > 0;
  }

  private required(value: string, name: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new TypeError(`${name} is required`);
    }
    return normalized;
  }

  async currentTimeMilliseconds(): Promise<number> {
    const [secondsRaw, microsecondsRaw] = await this.redis.time();
    const seconds = Number(secondsRaw);
    const microseconds = Number(microsecondsRaw);
    if (!Number.isFinite(seconds) || !Number.isFinite(microseconds)) {
      throw new Error('redis_time_unavailable');
    }
    return seconds * 1000 + Math.floor(microseconds / 1000);
  }

  private redisTimeMilliseconds(): Promise<number> {
    return this.currentTimeMilliseconds();
  }
}
